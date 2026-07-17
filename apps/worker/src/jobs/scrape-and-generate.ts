import "dotenv/config";
import {
  adapters,
  withBrowser,
  newPage,
  withRetry,
  extractArticleWithLlm,
  writeArticle,
  notify,
} from "@beatdagame/core";
import { prisma, articleExistsForUrl, logEvent, getOrCreateSource } from "@beatdagame/db";
import type { ScrapedArticle, SourceAdapter } from "@beatdagame/core";
import type { Page } from "playwright";

interface RunStats {
  candidatesSeen: number;
  duplicatesSkipped: number;
  articlesScraped: number;
  articlesGenerated: number;
  scrapeFailures: number;
  generationFailures: number;
}

/**
 * Attempts extraction via the adapter's CSS selectors first. Only if that
 * returns nothing does it fall back to a single LLM structured-extraction
 * call: logged as `extraction_fallback_used` so a human knows the selector
 * needs fixing, rather than silently depending on the LLM path forever.
 */
async function scrapeWithFallback(
  adapter: SourceAdapter,
  page: Page,
  url: string,
): Promise<ScrapedArticle | null> {
  const primary = await withRetry(() => adapter.scrapeArticle(page, url), {
    attempts: 3,
    label: `scrapeArticle(${adapter.slug}, ${url})`,
  }).catch((err) => {
    console.error(`Primary scrape failed for ${url}:`, err);
    return null;
  });

  if (primary) return primary;

  console.warn(`[${adapter.slug}] selectors returned nothing for ${url}, trying LLM fallback`);
  try {
    const rawText = await page.evaluate(() => document.body.innerText);
    const extracted = await extractArticleWithLlm(rawText, url);
    if (!extracted.title || !extracted.contentText) return null;
    return {
      title: extracted.title,
      excerpt: extracted.excerpt,
      imageUrl: extracted.imageUrl || undefined,
      contentText: extracted.contentText,
    };
  } catch (err) {
    console.error(`LLM fallback extraction also failed for ${url}:`, err);
    return null;
  }
}

async function processSource(adapter: SourceAdapter, stats: RunStats): Promise<void> {
  const source = await getOrCreateSource({
    slug: adapter.slug,
    name: adapter.name,
    listingUrl: adapter.listingUrl,
  });

  await withBrowser(async (browser) => {
    const page = await newPage(browser);

    const listing = await withRetry(() => adapter.listArticles(page), {
      label: `listArticles(${adapter.slug})`,
    });
    stats.candidatesSeen += listing.length;

    for (const item of listing) {
      try {
        // Dedup BEFORE any scrape/LLM spend: the single biggest fix vs the
        // old pipeline, which had no dedup at all.
        if (await articleExistsForUrl(item.url)) {
          stats.duplicatesSkipped++;
          continue;
        }

        const scraped = await scrapeWithFallback(adapter, page, item.url);
        if (!scraped) {
          stats.scrapeFailures++;
          await notify({
            severity: "warning",
            title: `Scrape failed: ${adapter.name}`,
            details: { url: item.url },
          });
          continue;
        }
        stats.articlesScraped++;

        // One article per row, one article per LLM writing call: never
        // batch multiple articles into a single LLM response like the old
        // PokerNews pipeline did.
        const article = await prisma.article.create({
          data: {
            sourceId: source.id,
            sourceUrl: item.url,
            sourceTitle: scraped.title,
            sourceImageUrl: scraped.imageUrl,
            sourcePublishedAt: scraped.publishedAt,
            status: "pending_generation",
          },
        });
        await logEvent(article.id, "scraped", { url: item.url });

        // An article with no source image can never get a proper WordPress
        // featured image (the publish job only re-edits an existing photo,
        // it doesn't generate one from nothing), so it would just clutter
        // the review queue and eventually fail to publish anyway. Reject
        // it immediately, before spending an LLM call writing text for it.
        if (!scraped.imageUrl) {
          await prisma.article.update({
            where: { id: article.id },
            data: { status: "rejected", notes: "Auto-rejected: no image available from source." },
          });
          await logEvent(article.id, "status_changed", {
            from: "pending_generation",
            to: "rejected",
            reason: "no_source_image",
          });
          continue;
        }

        try {
          const generated = await writeArticle({
            sourceTitle: scraped.title,
            sourceUrl: item.url,
            contentText: scraped.contentText,
            excerpt: scraped.excerpt,
          });

          await prisma.article.update({
            where: { id: article.id },
            data: {
              title: generated.title,
              excerpt: generated.excerpt,
              bodyHtml: generated.bodyHtml,
              status: "pending_review",
            },
          });
          await logEvent(article.id, "generated");
          stats.articlesGenerated++;
        } catch (err) {
          stats.generationFailures++;
          await logEvent(article.id, "generation_failed", { error: String(err) });
          await notify({
            severity: "error",
            title: `Article writing failed: ${adapter.name}`,
            details: { url: item.url, error: String(err) },
          });
          // Row stays as pending_generation with no title/body: visible in
          // the CRM as an incomplete draft rather than silently lost.
        }
      } catch (err) {
        // Isolation boundary: one bad candidate never aborts the whole run.
        console.error(`Unexpected error processing ${item.url}:`, err);
        await notify({
          severity: "error",
          title: `Unexpected scrape/generate error: ${adapter.name}`,
          details: { url: item.url, error: String(err) },
        });
      }
    }
  });
}

async function main() {
  const stats: RunStats = {
    candidatesSeen: 0,
    duplicatesSkipped: 0,
    articlesScraped: 0,
    articlesGenerated: 0,
    scrapeFailures: 0,
    generationFailures: 0,
  };

  for (const adapter of adapters) {
    console.log(`Processing source: ${adapter.name}`);
    try {
      await processSource(adapter, stats);
    } catch (err) {
      console.error(`Fatal error processing source ${adapter.name}:`, err);
      await notify({
        severity: "error",
        title: `Source-level scrape failure: ${adapter.name}`,
        details: { error: String(err) },
      });
    }
  }

  console.log("Run summary:", stats);
  await notify({
    severity: "info",
    title: "Daily scrape + generate run finished",
    details: stats as unknown as Record<string, unknown>,
  });
}

main()
  .catch((err) => {
    console.error("scrape-and-generate job crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

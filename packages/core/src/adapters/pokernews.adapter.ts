import type { Page } from "playwright";
import type { ListingItem, ScrapedArticle, SourceAdapter } from "../types.js";
import { safeParseDate } from "../scrape-utils.js";

/**
 * Selectors verified directly against https://www.pokernews.com/news/ on
 * 2026-07-16 (curl + DOM inspection, not guessed). Article body text is
 * scoped to `article[data-el="Article"] p`, which reliably excludes the ad
 * slots (`.article-rooms`), CTA buttons, and Google-source-preference
 * widgets that live as siblings alongside the real paragraphs: none of
 * those render as `<p>` elements. The one known rough edge: the trailing
 * author-bio paragraph is included as regular content; this is harmless
 * noise for the writer step (it gets summarized away), not worth a special
 * case for v1.
 */
export const pokerNewsAdapter: SourceAdapter = {
  slug: "pokernews",
  name: "PokerNews.com",
  listingUrl: "https://www.pokernews.com/news/",

  async listArticles(page: Page): Promise<ListingItem[]> {
    await page.goto(this.listingUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.ds-mediaList__item__title", { timeout: 15_000 });

    return page.$$eval("a.ds-mediaList__item__title", (anchors) =>
      anchors
        .map((a) => {
          const anchor = a as HTMLAnchorElement;
          const container = anchor.closest(".ds-mediaList__item");
          const img = container?.querySelector("figure img") as HTMLImageElement | null;
          return {
            url: anchor.href,
            title: anchor.textContent?.trim() ?? "",
            imageUrl: img?.getAttribute("src") ?? undefined,
          };
        })
        .filter((item) => item.url && item.title),
    );
  },

  async scrapeArticle(page: Page, url: string): Promise<ScrapedArticle | null> {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(() => {
      const title = document.querySelector("h1")?.textContent?.trim() ?? "";
      const ogImage = document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content");
      const ogDescription = document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content");
      const dateText = document
        .querySelector('article[data-el="Article"] time[datetime]')
        ?.getAttribute("datetime");
      const paragraphs = Array.from(document.querySelectorAll('article[data-el="Article"] p'))
        .map((p) => p.textContent?.trim())
        // drop tiny fragments (stray captions, empty nodes) but keep real sentences
        .filter((t): t is string => Boolean(t) && t.length > 20);

      return { title, ogImage, ogDescription, dateText, contentText: paragraphs.join("\n\n") };
    });

    if (!data.title || !data.contentText) {
      return null;
    }

    return {
      title: data.title,
      excerpt: data.ogDescription || undefined,
      imageUrl: data.ogImage ?? undefined,
      publishedAt: safeParseDate(data.dateText),
      contentText: data.contentText,
    };
  },
};

import type { Page } from "playwright";
import type { ListingItem, ScrapedArticle, SourceAdapter } from "../types.js";
import { safeParseDate } from "../scrape-utils.js";

/**
 * Selectors verified directly against https://www.wsop.com/news/ on
 * 2026-07-16 (curl + DOM inspection, not guessed). WSOP.com is a
 * Nuxt/Vue app; these classes are scoped (`data-v-*`) but the class
 * names themselves are stable content hooks, not generated hashes.
 *
 * If WSOP redesigns the site, `listArticles`/`scrapeArticle` will return
 * an empty title/content and the caller falls back to LLM extraction;
 * update the selectors below rather than relying on that fallback long-term.
 */
export const wsopAdapter: SourceAdapter = {
  slug: "wsop",
  name: "WSOP.com",
  listingUrl: "https://www.wsop.com/news/",

  async listArticles(page: Page): Promise<ListingItem[]> {
    await page.goto(this.listingUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".list-news a.list-row", { timeout: 15_000 });

    return page.$$eval(".list-news a.list-row", (anchors) =>
      anchors
        .map((a) => {
          const anchor = a as HTMLAnchorElement;
          const title = anchor.querySelector(".tit")?.textContent?.trim() ?? "";
          const imageUrl = anchor.querySelector(".photo img")?.getAttribute("src") ?? undefined;
          return { url: anchor.href, title, imageUrl };
        })
        .filter((item) => item.url && item.title),
    );
  },

  async scrapeArticle(page: Page, url: string): Promise<ScrapedArticle | null> {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(() => {
      const title = document.querySelector(".detail-header .title")?.textContent?.trim() ?? "";
      const excerpt = document.querySelector(".detail-header .message")?.textContent?.trim() ?? "";
      const dateText = document.querySelector(".detail-header .etc .date")?.textContent?.trim();
      const ogImage = document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content");
      const paragraphs = Array.from(document.querySelectorAll(".detail-body .news-contents p"))
        .map((p) => p.textContent?.trim())
        .filter((t): t is string => Boolean(t));

      return { title, excerpt, dateText, ogImage, contentText: paragraphs.join("\n\n") };
    });

    if (!data.title || !data.contentText) {
      // Selector likely broke, or this URL isn't a standard article layout.
      return null;
    }

    return {
      title: data.title,
      excerpt: data.excerpt || undefined,
      imageUrl: data.ogImage ?? undefined,
      publishedAt: safeParseDate(data.dateText),
      contentText: data.contentText,
    };
  },
};

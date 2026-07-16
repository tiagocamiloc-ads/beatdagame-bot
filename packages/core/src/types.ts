import type { Page } from "playwright";

/** One row on a source's listing page (e.g. wsop.com/news). */
export interface ListingItem {
  url: string;
  title: string;
  imageUrl?: string;
}

/** Full content pulled from an individual article page. */
export interface ScrapedArticle {
  title: string;
  publishedAt?: Date;
  imageUrl?: string;
  excerpt?: string;
  /** Plain-text (or lightly-cleaned) body used as the input to the writer. */
  contentText: string;
}

/**
 * One implementation per source. Selectors are the primary extraction
 * mechanism (fast, free, deterministic, fails loudly). If a selector
 * returns nothing, the caller falls back to `extractWithLlmFallback`
 * once and logs an `extraction_fallback_used` event so the selector can
 * be fixed rather than silently depending on the LLM path forever.
 */
export interface SourceAdapter {
  slug: string;
  name: string;
  listingUrl: string;

  listArticles(page: Page): Promise<ListingItem[]>;
  scrapeArticle(page: Page, url: string): Promise<ScrapedArticle | null>;
}

/** Structured output the Claude writing step must produce. */
export interface GeneratedArticle {
  title: string;
  excerpt: string;
  bodyHtml: string;
}

export interface ImageJobResult {
  status: "succeeded" | "failed" | "timeout";
  resultUrl?: string;
  errorMessage?: string;
}

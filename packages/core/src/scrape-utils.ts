import { chromium, type Browser, type Page } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Launches a single headless browser, runs `fn` with a fresh page, and
 * always closes the browser afterwards: used by the worker jobs so a
 * scraping run never leaks a Chromium process on the GitHub Actions runner.
 */
export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ userAgent: USER_AGENT });
  return context.newPage();
}

/**
 * Retry wrapper for network-flaky steps (page.goto, etc). Exponential
 * backoff, 3 attempts by default: replaces the old pipeline's total
 * absence of retry logic on scrape failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `[retry] ${opts.label ?? "operation"} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${String(err)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/** Best-effort date parsing: never throws; returns undefined on failure. */
export function safeParseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

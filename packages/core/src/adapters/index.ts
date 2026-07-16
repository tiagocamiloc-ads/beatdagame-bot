import type { SourceAdapter } from "../types.js";
import { wsopAdapter } from "./wsop.adapter.js";
import { pokerNewsAdapter } from "./pokernews.adapter.js";

export const adapters: SourceAdapter[] = [wsopAdapter, pokerNewsAdapter];

export function getAdapter(slug: string): SourceAdapter {
  const adapter = adapters.find((a) => a.slug === slug);
  if (!adapter) {
    throw new Error(`No source adapter registered for slug "${slug}"`);
  }
  return adapter;
}

export { wsopAdapter, pokerNewsAdapter };

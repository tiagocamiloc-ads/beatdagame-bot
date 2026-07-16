import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedArticle } from "../types.js";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const WRITE_ARTICLE_MODEL = "claude-sonnet-5";

/**
 * Structured output is enforced via tool_use with `tool_choice` forced to
 * this single tool: the Anthropic Messages API guarantees the tool's
 * `input` matches `input_schema`, so the caller never has to regex-strip
 * ```json fences and hope `JSON.parse` doesn't throw, unlike the old
 * pipeline's Code node.
 */
const WRITE_ARTICLE_TOOL: Anthropic.Tool = {
  name: "submit_article",
  description: "Submit the finished news brief for the poker article.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Informative, direct headline. May differ slightly from the source." },
      excerpt: { type: "string", description: "One short sentence summarizing the story. Must not repeat the title verbatim." },
      bodyHtml: {
        type: "string",
        description:
          "180-250 word English news brief as HTML using only <p> and <strong> tags, 5-6 short paragraphs, each adding new information with no repetition.",
      },
    },
    required: ["title", "excerpt", "bodyHtml"],
    additionalProperties: false,
  },
};

function writeArticleSystemPrompt(): string {
  return [
    "You are a poker journalist writing for an English-language poker news blog.",
    "Rules:",
    "- Never invent information that is not in the source content.",
    "- Neutral, journalistic tone.",
    "- Do not copy sentences verbatim from the source; rewrite in your own words.",
    "- Keep names, dates, numbers, and places accurate.",
    "- 180-250 words, 5-6 short paragraphs, each paragraph adds new information.",
    "- Allowed HTML: <p> and <strong> only. No headlines, lists, opinions, or artificial conclusions.",
  ].join("\n");
}

export interface WriteArticleInput {
  sourceTitle: string;
  sourceUrl: string;
  contentText: string;
  excerpt?: string;
}

export async function writeArticle(input: WriteArticleInput): Promise<GeneratedArticle> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: WRITE_ARTICLE_MODEL,
    max_tokens: 1024,
    system: writeArticleSystemPrompt(),
    tools: [WRITE_ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "submit_article" },
    messages: [
      {
        role: "user",
        content: [
          `Source title: ${input.sourceTitle}`,
          `Source URL: ${input.sourceUrl}`,
          input.excerpt ? `Original excerpt: ${input.excerpt}` : undefined,
          "",
          "Full source content:",
          input.contentText,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Claude did not return a submit_article tool call");
  }

  const result = toolUse.input as GeneratedArticle;
  if (!result.title || !result.excerpt || !result.bodyHtml) {
    throw new Error(`Claude tool_use input missing required fields: ${JSON.stringify(result)}`);
  }
  return result;
}

const EXTRACT_ARTICLE_TOOL: Anthropic.Tool = {
  name: "submit_extraction",
  description: "Submit the structured fields extracted from a poker news article page.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      excerpt: { type: "string", description: "First paragraph or lead summary, if present." },
      imageUrl: { type: "string", description: "Main article image URL if present in the text, else empty string." },
      contentText: { type: "string", description: "The full article body, plain text, cleaned of navigation/ads." },
    },
    required: ["title", "contentText"],
    additionalProperties: false,
  },
};

/**
 * Fallback path used ONLY when a source adapter's CSS selectors return
 * nothing (site redesign, layout variant, etc). Not the primary extraction
 * mechanism: see packages/core/src/adapters. Every use of this function
 * should be logged by the caller as an `extraction_fallback_used` event so
 * the underlying selector gets fixed.
 */
export async function extractArticleWithLlm(
  rawPageText: string,
  url: string,
): Promise<{ title: string; excerpt?: string; imageUrl?: string; contentText: string }> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: WRITE_ARTICLE_MODEL,
    max_tokens: 2048,
    system:
      "You extract structured article data from raw poker-news webpage text. Ignore navigation, ads, and related-article lists. Only extract the single main article on the page.",
    tools: [EXTRACT_ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "submit_extraction" },
    messages: [
      { role: "user", content: `URL: ${url}\n\nRaw page text:\n${rawPageText.slice(0, 15_000)}` },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Claude did not return a submit_extraction tool call");
  }
  return toolUse.input as { title: string; excerpt?: string; imageUrl?: string; contentText: string };
}

import type { ImageJobResult } from "../types.js";

const FEATURED_IMAGE_MODEL = "seedream/4.5-edit";
const STORY_IMAGE_MODEL = "google/nano-banana-edit";

// Rough per-job cost estimates for the monthly spend guardrail. These are
// deliberately conservative placeholders: replace with kie.ai's actual
// published per-model pricing once confirmed, the guardrail logic itself
// doesn't depend on the exact figure being perfect.
export const COST_ESTIMATE_USD: Record<string, number> = {
  [FEATURED_IMAGE_MODEL]: 0.1,
  [STORY_IMAGE_MODEL]: 0.1,
};

function getConfig() {
  const apiKey = process.env.KIE_AI_API_KEY;
  const baseUrl = process.env.KIE_AI_BASE_URL ?? "https://api.kie.ai/api/v1";
  if (!apiKey) throw new Error("KIE_AI_API_KEY is not set");
  return { apiKey, baseUrl };
}

async function kieFetch(path: string, init: RequestInit) {
  const { apiKey, baseUrl } = getConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`kie.ai request failed: ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

export async function createTask(model: string, input: Record<string, unknown>): Promise<string> {
  const json = await kieFetch("/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({ model, input }),
  });
  const taskId = json?.data?.taskId;
  if (!taskId) throw new Error(`kie.ai createTask response missing data.taskId: ${JSON.stringify(json)}`);
  return taskId as string;
}

interface RecordInfoResponse {
  data?: { state?: string; resultJson?: string };
}

const FAILURE_STATES = new Set(["fail", "failed", "error"]);

/**
 * Single reusable poller: replaces the old workflow's four near-identical
 * Wait/If/HTTP-request node chains duplicated across the featured-image and
 * IG-story branches. Success is determined by the presence of a parseable
 * `resultUrls` array (the actual proof of completion), not by matching an
 * exact `state` string: kie.ai's own state-string vocabulary was never
 * fully confirmed against the old workflow (its conditionals checked for
 * `state === "f"`, which was clearly incomplete/buggy).
 */
export async function pollUntilComplete(
  taskId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<ImageJobResult> {
  const maxAttempts = opts.maxAttempts ?? 20;
  const intervalMs = opts.intervalMs ?? 15_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const json = (await kieFetch(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
    })) as RecordInfoResponse;

    const state = json.data?.state?.toLowerCase();

    if (json.data?.resultJson) {
      try {
        const parsed = JSON.parse(json.data.resultJson) as { resultUrls?: string[] };
        if (parsed.resultUrls?.[0]) {
          return { status: "succeeded", resultUrl: parsed.resultUrls[0] };
        }
      } catch {
        // resultJson present but not parseable yet: keep polling.
      }
    }

    if (state && FAILURE_STATES.has(state)) {
      return { status: "failed", errorMessage: `kie.ai task ${taskId} reported state="${state}"` };
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return { status: "timeout", errorMessage: `kie.ai task ${taskId} did not complete within ${maxAttempts} attempts` };
}

/** Subtle photographic re-edit of the source image (copyright-distancing pass). */
export async function submitFeaturedImageEdit(sourceImageUrl: string): Promise<{ taskId: string; model: string }> {
  const taskId = await createTask(FEATURED_IMAGE_MODEL, {
    prompt:
      "Edit the provided image with very subtle photographic adjustments while preserving the original scene exactly. " +
      "This is a small edit of the existing photo, NOT a recreation. Goal: as little as possible perspective change " +
      "(5% horizontal and 5% vertical), shallow depth of field on the background, very minor background element " +
      "repositioning. Locked elements (must remain identical to the input image): all faces, people, body proportions, " +
      "poses, expressions, clothing, playing cards, symbols, suits, ranks, text, and logos. Playing cards must remain " +
      "exactly the same card identities as in the original image. Logos and text must remain identical in shape, " +
      "spelling, color, and position. Copy these elements directly from the original image without modification. " +
      "Output style: maintain realistic photography and the original composition.",
    image_urls: [sourceImageUrl],
    aspect_ratio: "16:9",
    quality: "basic",
  });
  return { taskId, model: FEATURED_IMAGE_MODEL };
}

/** 9:16 Instagram Story image: source photo + branded template overlay + headline text. */
export async function submitStoryImageEdit(
  sourceImageUrl: string,
  templateUrl: string,
  headline: string,
): Promise<{ taskId: string; model: string }> {
  const taskId = await createTask(STORY_IMAGE_MODEL, {
    output_format: "png",
    image_size: "9:16",
    image_urls: [sourceImageUrl, templateUrl],
    prompt:
      "Use the first image as the base image and keep it exactly the same. Place the second image frame on top of " +
      "the photo as an overlay, preserving its transparency so the photo remains visible behind it. Do not crop, " +
      `resize, recreate, or modify the original photo. Inside the second image, replace the existing headline text ` +
      `with: "${headline}". Keep the same font style, font family, size, layout and alignment. Do not add any other ` +
      "elements or effects.",
  });
  return { taskId, model: STORY_IMAGE_MODEL };
}

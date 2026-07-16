import "dotenv/config";
import {
  submitFeaturedImageEdit,
  submitStoryImageEdit,
  pollUntilComplete,
  COST_ESTIMATE_USD,
  publishArticleToWordPress,
  notify,
} from "@beatdagame/core";
import {
  prisma,
  releaseStaleLocks,
  getApprovedArticlesReadyToPublish,
  claimArticleForPublishing,
  markPublishSucceeded,
  markPublishFailed,
  recordImageJob,
  completeImageJob,
  monthlyImageSpendUsd,
  logEvent,
} from "@beatdagame/db";
import type { Article } from "@beatdagame/db";

const WORKER_RUN_ID = `publish-${process.env.GITHUB_RUN_ID ?? Date.now()}`;
const MAX_MONTHLY_SPEND = Number(process.env.MAX_MONTHLY_IMAGE_SPEND_USD ?? "150");
const STORY_TEMPLATE_URL = process.env.STORY_TEMPLATE_IMAGE_URL;

/**
 * Generates the featured image via kie.ai. Falls back to the original
 * source image on failure rather than blocking the whole publish: a
 * slightly-less-unique image beats not publishing at all.
 */
async function resolveFeaturedImage(article: Article): Promise<string> {
  const sourceImage = article.sourceImageUrl;
  if (!sourceImage) {
    throw new Error(`Article ${article.id} has no sourceImageUrl to base the featured image on`);
  }

  const { taskId, model } = await submitFeaturedImageEdit(sourceImage);
  const job = await recordImageJob({
    articleId: article.id,
    kind: "featured",
    model,
    externalTaskId: taskId,
    costEstimateUsd: COST_ESTIMATE_USD[model] ?? 0,
  });
  await logEvent(article.id, "image_job_submitted", { kind: "featured", taskId });

  const result = await pollUntilComplete(taskId);
  if (result.status === "succeeded" && result.resultUrl) {
    await completeImageJob(job.id, "succeeded", { resultUrl: result.resultUrl });
    await logEvent(article.id, "image_job_completed", { kind: "featured" });
    return result.resultUrl;
  }

  await completeImageJob(job.id, "failed", { errorMessage: result.errorMessage });
  await logEvent(article.id, "image_job_failed", { kind: "featured", error: result.errorMessage });
  console.warn(`Featured image generation failed for ${article.id}, falling back to source image`);
  return sourceImage;
}

/** Optional IG Story asset: best-effort, skipped entirely if over budget. */
async function maybeGenerateStoryImage(article: Article, featuredImageUrl: string): Promise<string | undefined> {
  if (!STORY_TEMPLATE_URL || !article.title) return undefined;

  const spentSoFar = await monthlyImageSpendUsd();
  if (spentSoFar >= MAX_MONTHLY_SPEND) {
    console.warn(`Monthly image spend budget ($${MAX_MONTHLY_SPEND}) reached, skipping IG story image`);
    await recordImageJob({
      articleId: article.id,
      kind: "ig_story",
      model: "google/nano-banana-edit",
      costEstimateUsd: 0,
    }).then((job) => completeImageJob(job.id, "skipped_budget", {}));
    return undefined;
  }

  try {
    const { taskId, model } = await submitStoryImageEdit(featuredImageUrl, STORY_TEMPLATE_URL, article.title);
    const job = await recordImageJob({
      articleId: article.id,
      kind: "ig_story",
      model,
      externalTaskId: taskId,
      costEstimateUsd: COST_ESTIMATE_USD[model] ?? 0,
    });

    const result = await pollUntilComplete(taskId);
    if (result.status === "succeeded" && result.resultUrl) {
      await completeImageJob(job.id, "succeeded", { resultUrl: result.resultUrl });
      return result.resultUrl;
    }
    await completeImageJob(job.id, "failed", { errorMessage: result.errorMessage });
    return undefined;
  } catch (err) {
    console.error(`IG story image generation failed for ${article.id}:`, err);
    return undefined;
  }
}

async function publishOne(articleId: string): Promise<void> {
  const claimed = await claimArticleForPublishing(articleId, WORKER_RUN_ID);
  if (!claimed) {
    // Another concurrent run already claimed it, or it's no longer
    // approved: this is the compare-and-swap guard doing its job.
    console.log(`Article ${articleId} could not be claimed (already locked or not approved), skipping`);
    return;
  }

  try {
    if (!claimed.title || !claimed.bodyHtml || !claimed.excerpt) {
      throw new Error("Article is missing title/bodyHtml/excerpt: cannot publish an incomplete draft");
    }

    const featuredImageUrl = await resolveFeaturedImage(claimed);
    const igStoryImageUrl = await maybeGenerateStoryImage(claimed, featuredImageUrl);

    if (igStoryImageUrl) {
      await prisma.article.update({ where: { id: claimed.id }, data: { igStoryImageUrl } });
    }

    const post = await publishArticleToWordPress({
      title: claimed.title,
      bodyHtml: claimed.bodyHtml,
      excerpt: claimed.excerpt,
      sourceUrl: claimed.sourceUrl ?? claimed.legacySourceText ?? "",
      imageUrl: featuredImageUrl,
    });

    await markPublishSucceeded(claimed.id, { wpPostId: post.id, wpPostUrl: post.url });

    await notify({
      severity: "info",
      title: `Published: ${claimed.title}`,
      details: {
        postUrl: post.url,
        ...(igStoryImageUrl ? { igStoryImage: igStoryImageUrl, note: "manual IG Story post pending" } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markPublishFailed(claimed.id, message);
    await notify({
      severity: "error",
      title: `Publish failed: ${claimed.title ?? claimed.id}`,
      details: { error: message, retryCount: claimed.retryCount + 1 },
    });
  }
}

async function main() {
  const released = await releaseStaleLocks(30);
  if (released > 0) {
    console.log(`Released ${released} stale publish lock(s) from a previous crashed run`);
  }

  const candidates = await getApprovedArticlesReadyToPublish(10);
  console.log(`Found ${candidates.length} article(s) approved and ready to publish`);

  for (const article of candidates) {
    await publishOne(article.id);
  }
}

main()
  .catch((err) => {
    console.error("publish job crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

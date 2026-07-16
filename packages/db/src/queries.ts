import { prisma } from "./index.js";
import type { Article, ArticleEventType, ImageJobKind, ImageJobStatus, Prisma } from "@prisma/client";

const MAX_PUBLISH_RETRIES = 3;

/**
 * Dedup check. Must be called BEFORE scraping the article body or spending
 * any LLM tokens: this is the fix for the old pipeline inserting
 * near-duplicate rows for the same underlying story.
 */
export async function articleExistsForUrl(sourceUrl: string): Promise<boolean> {
  const existing = await prisma.article.findUnique({
    where: { sourceUrl },
    select: { id: true },
  });
  return existing !== null;
}

export async function logEvent(
  articleId: string,
  eventType: ArticleEventType,
  payload?: Record<string, unknown>,
) {
  await prisma.articleEvent.create({
    data: { articleId, eventType, payload: payload as Prisma.InputJsonValue },
  });
}

/**
 * Atomic compare-and-swap claim, replacing the old "match row by Titulo"
 * update. Uses `updateMany` with a `status: 'approved'` guard in the WHERE
 * clause so two overlapping publish-job runs can never both win the same
 * row: the second run's updateMany simply matches zero rows.
 */
export async function claimArticleForPublishing(
  articleId: string,
  workerRunId: string,
): Promise<Article | null> {
  const result = await prisma.article.updateMany({
    where: { id: articleId, status: "approved" },
    data: { status: "publishing", lockedAt: new Date(), lockedBy: workerRunId },
  });

  if (result.count === 0) {
    // Someone else already claimed it, or it's no longer approved.
    return null;
  }

  await logEvent(articleId, "publish_started", { workerRunId });
  return prisma.article.findUniqueOrThrow({ where: { id: articleId } });
}

export async function getApprovedArticlesReadyToPublish(limit = 10): Promise<Article[]> {
  return prisma.article.findMany({
    where: { status: "approved" },
    orderBy: { approvedAt: "asc" },
    take: limit,
  });
}

export async function markPublishSucceeded(
  articleId: string,
  data: { wpPostId: number; wpPostUrl: string },
) {
  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: "published",
      wpPostId: data.wpPostId,
      wpPostUrl: data.wpPostUrl,
      publishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      errorMessage: null,
    },
  });
  await logEvent(articleId, "publish_succeeded", data);
}

/**
 * On failure: release the lock, record the error, and bump retryCount.
 * After MAX_PUBLISH_RETRIES, the article is parked in `failed` instead of
 * being retried forever: the old system had no such ceiling.
 */
export async function markPublishFailed(articleId: string, errorMessage: string) {
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  const nextRetryCount = article.retryCount + 1;
  const exhausted = nextRetryCount >= MAX_PUBLISH_RETRIES;

  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: exhausted ? "failed" : "approved",
      lockedAt: null,
      lockedBy: null,
      retryCount: nextRetryCount,
      errorMessage,
    },
  });
  await logEvent(articleId, "publish_failed", { errorMessage, retryCount: nextRetryCount, exhausted });
}

/** Stale-lock recovery: if a job crashed mid-run and never released its lock. */
export async function releaseStaleLocks(olderThanMinutes = 30) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await prisma.article.updateMany({
    where: { status: "publishing", lockedAt: { lt: cutoff } },
    data: { status: "approved", lockedAt: null, lockedBy: null },
  });
  return result.count;
}

export async function recordImageJob(input: {
  articleId: string;
  kind: ImageJobKind;
  model: string;
  externalTaskId?: string;
  costEstimateUsd: number;
}) {
  return prisma.imageGenerationJob.create({
    data: {
      articleId: input.articleId,
      kind: input.kind,
      model: input.model,
      externalTaskId: input.externalTaskId,
      costEstimateUsd: input.costEstimateUsd,
    },
  });
}

export async function completeImageJob(
  jobId: string,
  status: ImageJobStatus,
  data: { resultUrl?: string; errorMessage?: string },
) {
  return prisma.imageGenerationJob.update({
    where: { id: jobId },
    data: { status, completedAt: new Date(), ...data },
  });
}

/** Cost guardrail: sum of estimated spend for the current calendar month. */
export async function monthlyImageSpendUsd(): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const result = await prisma.imageGenerationJob.aggregate({
    where: { createdAt: { gte: startOfMonth }, status: { not: "skipped_budget" } },
    _sum: { costEstimateUsd: true },
  });
  return Number(result._sum.costEstimateUsd ?? 0);
}

export async function getOrCreateSource(input: { slug: string; name: string; listingUrl: string }) {
  return prisma.source.upsert({
    where: { slug: input.slug },
    update: { name: input.name, listingUrl: input.listingUrl },
    create: input,
  });
}

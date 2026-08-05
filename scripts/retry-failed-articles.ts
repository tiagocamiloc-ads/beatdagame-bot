/**
 * Recovers articles stuck in `failed` (publish retries exhausted) so the
 * next `publish.yml` run picks them up again -- e.g. after a kie.ai credit
 * outage that burned through all 3 automatic retries before the balance
 * was topped up.
 *
 * By default only targets articles whose last errorMessage looks image/kie
 * related, so a `failed` article that hit some other unrelated error isn't
 * silently re-queued. Pass --all to reset every failed article.
 *
 * Usage:
 *   pnpm retry-failed              # dry run, lists what would change
 *   pnpm retry-failed --apply      # actually resets matched articles
 *   pnpm retry-failed --apply --all
 */
import "dotenv/config";
import { prisma, logEvent } from "@beatdagame/db";

const IMAGE_ERROR_PATTERN = /kie|image|credit|insufficient|balance/i;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");

  const failed = await prisma.article.findMany({
    where: { status: "failed" },
    orderBy: { updatedAt: "asc" },
  });

  const targets = all ? failed : failed.filter((a) => a.errorMessage && IMAGE_ERROR_PATTERN.test(a.errorMessage));

  console.log(`${failed.length} article(s) in "failed" status total.`);
  console.log(`${targets.length} match${all ? " (--all)" : " the kie.ai/image error pattern"}.\n`);

  for (const article of targets) {
    console.log(`- [${article.id}] ${article.title ?? article.sourceTitle ?? "(untitled)"}`);
    console.log(`    retryCount=${article.retryCount}  error=${article.errorMessage}`);
  }

  if (!apply) {
    console.log(targets.length > 0 ? "\nDry run only. Re-run with --apply to reset these back to \"approved\"." : "");
    return;
  }

  for (const article of targets) {
    await prisma.article.update({
      where: { id: article.id },
      data: {
        status: "approved",
        retryCount: 0,
        errorMessage: null,
        approvedAt: new Date(),
      },
    });
    await logEvent(article.id, "status_changed", {
      from: "failed",
      to: "approved",
      by: "retry-failed-articles script",
    });
  }

  console.log(`\nReset ${targets.length} article(s) to "approved". They'll publish on the next publish.yml run.`);
}

main()
  .catch((err) => {
    console.error("retry-failed-articles crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

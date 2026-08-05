/**
 * Holds back "approved" articles whose source-reported publish date falls
 * outside the current calendar month, moving them to "rejected" instead of
 * letting publish.yml put out week(s)-old news as if it were fresh. Mirrors
 * the same rejection convention used by the 5-day staleness check in
 * scrape-and-generate.ts (status "rejected" + explanatory `notes`).
 *
 * Useful after a bulk `retry-failed --apply`: articles that piled up in
 * "failed" during an extended outage may span several months by the time
 * they're recovered, and not all of them are still worth publishing.
 *
 * Usage:
 *   pnpm hold-stale-approved            # dry run, lists what would change
 *   pnpm hold-stale-approved --apply
 */
import "dotenv/config";
import { prisma, logEvent } from "@beatdagame/db";

function isCurrentMonth(date: Date): boolean {
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
}

async function main() {
  const apply = process.argv.includes("--apply");

  const approved = await prisma.article.findMany({
    where: { status: "approved" },
    orderBy: { approvedAt: "asc" },
  });

  const stale = approved.filter((a) => a.sourcePublishedAt && !isCurrentMonth(a.sourcePublishedAt));

  console.log(`${approved.length} article(s) currently "approved".`);
  console.log(`${stale.length} have a source publish date outside the current month.\n`);

  for (const article of stale) {
    console.log(`- [${article.id}] ${article.title ?? article.sourceTitle ?? "(untitled)"}`);
    console.log(`    sourcePublishedAt=${article.sourcePublishedAt?.toISOString()}`);
  }

  if (!apply) {
    console.log(stale.length > 0 ? "\nDry run only. Re-run with --apply to move these to \"rejected\"." : "");
    return;
  }

  for (const article of stale) {
    const note = `Adiado: notícia de ${article.sourcePublishedAt?.toISOString().slice(0, 7)}, fora do mês atual.`;
    await prisma.article.update({
      where: { id: article.id },
      data: { status: "rejected", notes: note },
    });
    await logEvent(article.id, "status_changed", {
      from: "approved",
      to: "rejected",
      reason: "stale_source_publish_date_outside_current_month",
      by: "hold-stale-approved script",
    });
  }

  console.log(`\nMoved ${stale.length} article(s) to "rejected".`);
}

main()
  .catch((err) => {
    console.error("hold-stale-approved crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

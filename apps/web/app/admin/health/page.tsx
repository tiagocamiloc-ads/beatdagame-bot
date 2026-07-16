import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@beatdagame/db";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FAILURE_EVENT_TYPES = [
  "scrape_failed",
  "generation_failed",
  "publish_failed",
  "image_job_failed",
] as const;

async function getHealthData() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [sources, statusCounts, recentFailures, staleGeneration] = await Promise.all([
    prisma.source.findMany({
      include: {
        articles: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.article.groupBy({ by: ["status"], _count: true }),
    prisma.articleEvent.findMany({
      where: { eventType: { in: [...FAILURE_EVENT_TYPES] }, createdAt: { gte: since24h } },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { article: { select: { title: true, sourceUrl: true } } },
    }),
    prisma.article.count({
      where: { status: "pending_generation", createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    }),
  ]);

  return { sources, statusCounts, recentFailures, staleGeneration };
}

export default async function AdminHealthPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { sources, statusCounts, recentFailures, staleGeneration } = await getHealthData();

  const countByStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count]));

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Estado do sistema</h1>
        <p className="text-sm text-slate-500">Última execução por fonte, contagem de falhas (24h) e pendentes.</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Fontes</h2>
        <div className="grid grid-cols-2 gap-3">
          {sources.map((source) => (
            <div key={source.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-medium text-slate-900">{source.name}</p>
              <p className="text-xs text-slate-500">
                Último artigo: {source.articles[0]?.createdAt ? new Date(source.articles[0].createdAt).toLocaleString("pt-PT") : "nunca"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Contadores</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {["pending_generation", "pending_review", "approved", "published", "rejected", "failed"].map((status) => (
            <div key={status} className="rounded-lg border border-slate-200 bg-white p-3 text-center">
              <p className="text-2xl font-bold text-slate-900">{countByStatus[status] ?? 0}</p>
              <p className="text-xs text-slate-500">{status}</p>
            </div>
          ))}
        </div>
        {staleGeneration > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ {staleGeneration} artigo(s) presos em "pending_generation" há mais de 1 hora: possível falha do worker.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Falhas nas últimas 24h ({recentFailures.length})
        </h2>
        {recentFailures.length === 0 ? (
          <p className="text-sm text-slate-400">Sem falhas registadas nas últimas 24 horas.</p>
        ) : (
          <ul className="space-y-2">
            {recentFailures.map((event) => (
              <li key={event.id} className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm">
                <span className="font-medium text-red-700">{event.eventType}</span>{" "}
                <span className="text-slate-600">
                  : {event.article?.title ?? event.article?.sourceUrl ?? event.articleId}
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  {new Date(event.createdAt).toLocaleString("pt-PT")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

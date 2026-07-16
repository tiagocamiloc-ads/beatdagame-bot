import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@beatdagame/db";

// Statuses shown on the Kanban board. `pending_generation` (scraped but not
// yet written by Claude) and `publishing` (mid-flight lock state) are
// intentionally left off the board's default columns: see /admin/health
// for visibility into those instead.
const BOARD_STATUSES = ["pending_review", "approved", "publishing", "rejected", "published", "failed"] as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const articles = await prisma.article.findMany({
    where: { status: { in: [...BOARD_STATUSES] } },
    orderBy: { updatedAt: "desc" },
    take: 1000,
    select: {
      id: true,
      title: true,
      excerpt: true,
      bodyHtml: true,
      status: true,
      sourceUrl: true,
      sourceImageUrl: true,
      generatedImageUrl: true,
      notes: true,
      wpPostUrl: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(articles);
}

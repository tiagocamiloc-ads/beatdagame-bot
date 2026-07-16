import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, logEvent } from "@beatdagame/db";
import type { ArticleStatus } from "@beatdagame/db";

// Humans in the CRM may only move a card between these three states.
// `publishing` / `published` / `failed` are owned by the worker jobs;
// the board renders them read-only (see components/board/Board.tsx).
const HUMAN_EDITABLE_STATUSES: ArticleStatus[] = ["pending_review", "approved", "rejected"];

interface PatchBody {
  title?: string;
  excerpt?: string;
  bodyHtml?: string;
  notes?: string;
  status?: string;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as PatchBody;

  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.excerpt === "string") data.excerpt = body.excerpt;
  if (typeof body.bodyHtml === "string") data.bodyHtml = body.bodyHtml;
  if (typeof body.notes === "string") data.notes = body.notes;

  if (body.status !== undefined) {
    if (!HUMAN_EDITABLE_STATUSES.includes(body.status as ArticleStatus)) {
      return NextResponse.json(
        { error: `Status "${body.status}" cannot be set manually from the CRM` },
        { status: 400 },
      );
    }
    data.status = body.status;
    if (body.status === "approved") data.approvedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const existing = await prisma.article.findUnique({ where: { id: params.id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  // A card sitting in "published" or "failed" is a worker-owned terminal
  // state; block any edit from the CRM rather than silently reopening it.
  if (existing.status === "published" || existing.status === "publishing") {
    return NextResponse.json({ error: "Cannot edit an article that is publishing or already published" }, { status: 409 });
  }

  const updated = await prisma.article.update({ where: { id: params.id }, data });

  if (typeof body.status === "string" && body.status !== existing.status) {
    await logEvent(params.id, "status_changed", { from: existing.status, to: body.status, by: session.user?.email });
  }

  return NextResponse.json(updated);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const article = await prisma.article.findUnique({ where: { id: params.id } });
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  return NextResponse.json(article);
}

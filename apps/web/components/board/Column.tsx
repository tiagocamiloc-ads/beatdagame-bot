"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ColumnDef } from "@/lib/columns";
import type { BoardArticle } from "@/lib/api";
import { ArticleCard } from "./ArticleCard";

const COLUMN_ICONS: Record<string, string> = {
  pending_review: "🕐",
  approved: "✅",
  rejected: "❌",
  published: "🌐",
  failed: "🚫",
};

export function Column({
  column,
  articles,
  onCardClick,
}: {
  column: ColumnDef;
  articles: BoardArticle[];
  onCardClick: (article: BoardArticle) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !column.droppable });

  return (
    <div className="flex w-80 shrink-0 flex-col rounded-2xl bg-slate-100/60">
      <div
        className="flex items-center justify-between rounded-t-2xl px-4 py-3 text-white"
        style={{ backgroundColor: column.color }}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {COLUMN_ICONS[column.id]} {column.label}
        </span>
        <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold">{articles.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-0 overflow-y-auto p-3 transition-colors ${
          isOver ? "bg-slate-200/70" : ""
        }`}
        style={{ minHeight: 200, maxHeight: "calc(100vh - 220px)" }}
      >
        {articles.length === 0 && (
          <p className="mt-8 text-center text-xs text-slate-400">Sem artigos</p>
        )}
        {articles.map((article) => (
          <ArticleCard
            key={article.id}
            article={article}
            draggable={column.droppable}
            onClick={() => onCardClick(article)}
          />
        ))}
      </div>
    </div>
  );
}

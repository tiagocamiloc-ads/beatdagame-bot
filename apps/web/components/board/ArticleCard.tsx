"use client";

import { useDraggable } from "@dnd-kit/core";
import type { BoardArticle } from "@/lib/api";

function formatDate(date: string | Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

function stripHtml(html: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function ArticleCard({
  article,
  draggable,
  onClick,
}: {
  article: BoardArticle;
  draggable: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: article.id,
    disabled: !draggable,
  });

  const image = article.generatedImageUrl ?? article.sourceImageUrl;

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      className={`mb-3 cursor-pointer rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md ${
        isDragging ? "opacity-50" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-400">
        {formatDate(article.createdAt)}
      </div>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-40 w-full rounded-none object-cover" />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-slate-100 text-xs text-slate-400">
          Sem imagem
        </div>
      )}

      <div className="p-3">
        <h3 className="mb-1 line-clamp-2 text-sm font-semibold text-slate-900">
          {article.title || "(sem título)"}
        </h3>
        <p className="line-clamp-3 text-xs text-slate-500">
          {article.excerpt || stripHtml(article.bodyHtml).slice(0, 140)}
        </p>
        {article.errorMessage && (
          <p className="mt-2 line-clamp-2 text-xs text-red-600">Erro: {article.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { fetchArticles, updateArticle, type BoardArticle } from "@/lib/api";
import { COLUMNS, FAILED_COLUMN } from "@/lib/columns";
import type { ArticleStatus } from "@beatdagame/db";
import { Column } from "./Column";
import { EditArticleModal } from "./EditArticleModal";

export function Board() {
  const queryClient = useQueryClient();
  const { data: articles, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["articles"],
    queryFn: fetchArticles,
  });

  const [selected, setSelected] = useState<BoardArticle | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ArticleStatus }) => updateArticle(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["articles"] });
      const previous = queryClient.getQueryData<BoardArticle[]>(["articles"]);
      queryClient.setQueryData<BoardArticle[]>(["articles"], (old) =>
        old?.map((a) => (a.id === id ? { ...a, status: status as BoardArticle["status"] } : a)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["articles"], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["articles"] }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateArticle>[1] }) =>
      updateArticle(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      setSelected(null);
    },
  });

  const columns = useMemo(() => {
    const hasFailed = (articles ?? []).some((a) => a.status === "failed");
    return hasFailed ? [...COLUMNS, FAILED_COLUMN] : COLUMNS;
  }, [articles]);

  const articlesByColumn = useMemo(() => {
    const map = new Map<string, BoardArticle[]>();
    for (const column of columns) {
      map.set(
        column.id,
        (articles ?? []).filter((a) => column.statuses.includes(a.status)),
      );
    }
    return map;
  }, [articles, columns]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const targetColumn = columns.find((c) => c.id === over.id);
    if (!targetColumn || !targetColumn.droppable) return;

    const article = articles?.find((a) => a.id === active.id);
    if (!article) return;

    // Dropped into a column it's already logically part of (e.g. dropping
    // an "approved" card back onto the same column that also matches
    // "publishing"): no-op.
    if (targetColumn.statuses.includes(article.status)) return;

    // The board always writes the column's primary (first) status, e.g.
    // dropping onto "Aprovado" always sets `approved`, never `publishing`.
    statusMutation.mutate({ id: article.id, status: targetColumn.statuses[0] });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-lg font-bold text-white">
            B
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Artigos Beatdagame</h1>
            <p className="text-xs text-slate-500">Gestão de blog posts</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            🔄 Atualizar
          </button>
          <span className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-500">
            Total: {articles?.length ?? 0} artigos
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
          >
            ➜ Sair
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">A carregar artigos…</div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex flex-1 gap-4 overflow-x-auto p-6">
            {columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                articles={articlesByColumn.get(column.id) ?? []}
                onCardClick={setSelected}
              />
            ))}
          </div>
        </DndContext>
      )}

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-xs text-slate-400">
        💡 Dica: Arraste os artigos entre as colunas ou faça duplo clique para editar.
      </div>

      {selected && (
        <EditArticleModal
          article={selected}
          onClose={() => setSelected(null)}
          saving={saveMutation.isPending}
          onSave={(updates) => saveMutation.mutate({ id: selected.id, updates })}
        />
      )}
    </div>
  );
}

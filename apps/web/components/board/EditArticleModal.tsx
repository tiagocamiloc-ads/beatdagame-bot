"use client";

import { useState } from "react";
import type { BoardArticle } from "@/lib/api";
import type { ArticleStatus } from "@beatdagame/db";
import { RichTextEditor } from "./RichTextEditor";

const STATUS_LABELS: Record<ArticleStatus, string> = {
  pending_generation: "A gerar…",
  pending_review: "Por Aprovar",
  approved: "Aprovado",
  rejected: "Reprovado",
  published: "Publicado",
  publishing: "A publicar…",
  failed: "Falhado",
};

const EDITABLE_STATUSES: ArticleStatus[] = ["pending_review", "approved", "rejected"];

export function EditArticleModal({
  article,
  onClose,
  onSave,
  saving,
}: {
  article: BoardArticle;
  onClose: () => void;
  onSave: (updates: { title: string; bodyHtml: string; notes: string; status: ArticleStatus }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(article.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(article.bodyHtml ?? "");
  const [notes, setNotes] = useState(article.notes ?? "");
  const [status, setStatus] = useState(article.status);

  const isLocked = !EDITABLE_STATUSES.includes(article.status);
  const image = article.generatedImageUrl ?? article.sourceImageUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Editar Artigo</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">
            ✕
          </button>
        </div>

        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="mb-4 h-56 w-full rounded-lg object-cover" />
        )}

        {isLocked && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Este artigo está no estado "{STATUS_LABELS[article.status]}", gerido automaticamente. Não pode ser editado no CRM.
          </p>
        )}

        <label className="mb-1 block text-sm font-medium text-slate-700">Título</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isLocked}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Conteúdo</label>
        <div className="mb-4">
          {isLocked ? (
            <div className="tiptap" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          ) : (
            <RichTextEditor content={bodyHtml} onChange={setBodyHtml} />
          )}
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">Estado</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ArticleStatus)}
          disabled={isLocked}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
        >
          {EDITABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          {isLocked && <option value={article.status}>{STATUS_LABELS[article.status]}</option>}
        </select>

        <label className="mb-1 block text-sm font-medium text-slate-700">Notas/Observações</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Adicione notas sobre este artigo…"
          rows={3}
          className="mb-6 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          {!isLocked && (
            <button
              onClick={() => onSave({ title, bodyHtml, notes, status })}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "A gravar…" : "💾 Gravar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

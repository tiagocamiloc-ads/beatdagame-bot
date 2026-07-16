import type { ArticleStatus } from "@beatdagame/db";

export interface ColumnDef {
  id: string;
  label: string;
  statuses: ArticleStatus[];
  color: string;
  /** Columns a human can drag a card INTO from the board. */
  droppable: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { id: "pending_review", label: "Por Aprovar", statuses: ["pending_review"], color: "#f59e0b", droppable: true },
  { id: "approved", label: "Aprovado", statuses: ["approved", "publishing"], color: "#22c55e", droppable: true },
  { id: "rejected", label: "Reprovado", statuses: ["rejected"], color: "#ef4444", droppable: true },
  { id: "published", label: "Publicado", statuses: ["published"], color: "#3b82f6", droppable: false },
];

/** Only rendered when there's at least one failed article: keeps the
 * default board identical to the original 4-column layout when nothing
 * has gone wrong. */
export const FAILED_COLUMN: ColumnDef = {
  id: "failed",
  label: "Falhados",
  statuses: ["failed"],
  color: "#7c3aed",
  droppable: false,
};

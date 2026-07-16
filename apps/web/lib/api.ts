import type { Article } from "@beatdagame/db";

export type BoardArticle = Pick<
  Article,
  | "id"
  | "title"
  | "excerpt"
  | "bodyHtml"
  | "status"
  | "sourceUrl"
  | "sourceImageUrl"
  | "generatedImageUrl"
  | "notes"
  | "wpPostUrl"
  | "errorMessage"
  | "createdAt"
  | "updatedAt"
>;

export async function fetchArticles(): Promise<BoardArticle[]> {
  const res = await fetch("/api/articles");
  if (!res.ok) throw new Error("Failed to load articles");
  return res.json();
}

export async function updateArticle(
  id: string,
  data: Partial<Pick<BoardArticle, "title" | "excerpt" | "bodyHtml" | "notes" | "status">>,
): Promise<BoardArticle> {
  const res = await fetch(`/api/articles/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to update article");
  }
  return res.json();
}

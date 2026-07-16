/**
 * One-off migration: imports the legacy Google Sheet ("Bot BDG - Artigos.csv"
 * export) into the new Postgres schema.
 *
 * Usage:
 *   pnpm migrate:sheets [path-to-csv]
 *   (defaults to "./Bot BDG - Artigos.csv" in the repo root)
 *
 * Run this against a STAGING database first (point DATABASE_URL at a
 * throwaway/staging Supabase project), verify the row count and a manual
 * sample against the CSV, and only then run it against production.
 *
 * Column mapping (old -> new), per the approved migration plan:
 *   Titulo              -> title
 *   Texto 1              -> bodyHtml
 *   Texto 2 / Texto 3     -> dropped (counted + logged, never imported)
 *   Link Imagem           -> generatedImageUrl
 *   Fonte                 -> sourceUrl (first occurrence only, see below)
 *   status + publicado    -> status enum
 *   notas                 -> notes
 *   excerto                -> excerpt
 *   data criação          -> createdAt
 *   data publicação       -> publishedAt (only when status = published)
 *   link do post           -> wpPostUrl
 *
 * The old system had no deduplication, so the CSV genuinely contains
 * multiple rows citing the exact same source URL (that's the duplicate-
 * content bug this whole rebuild fixes). Since the new `sourceUrl` column
 * is UNIQUE, only the first row seen for a given URL keeps it; every
 * subsequent duplicate is imported with `sourceUrl = null`,
 * `legacyImport = true`, and the original value preserved in
 * `legacySourceText`: Postgres allows multiple NULLs in a unique column,
 * so this never collides.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "@beatdagame/db";
import type { ArticleStatus } from "@beatdagame/db";

interface CsvRow {
  Titulo: string;
  "Texto 1": string;
  "Texto 2": string;
  "Texto 3": string;
  "Link Imagem": string;
  Fonte: string;
  status: string;
  publicado: string;
  "link do post": string;
  notas: string;
  excerto: string;
  "data criação": string;
  "data publicação": string;
}

function mapStatus(status: string, publicado: string): ArticleStatus {
  const s = status.trim().toLowerCase();
  const p = publicado.trim().toLowerCase();

  if (s === "aprovado" && p === "sim") return "published";
  if (s === "aprovado") return "approved";
  if (s === "reprovado") return "rejected";
  return "pending_review"; // covers "por aprovar" and any unexpected value
}

function sourceSlugForUrl(url: string | null): "wsop" | "pokernews" | "legacy-import" {
  if (!url) return "legacy-import";
  if (url.includes("wsop.com")) return "wsop";
  if (url.includes("pokernews.com")) return "pokernews";
  return "legacy-import";
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function parseDateOrUndefined(value: string): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function main() {
  const csvPath = resolve(process.argv[2] ?? "./Bot BDG - Artigos.csv");
  console.log(`Reading CSV from ${csvPath}`);

  const raw = readFileSync(csvPath, "utf-8");
  const rows: CsvRow[] = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  console.log(`Parsed ${rows.length} rows`);

  const sources = {
    wsop: await prisma.source.upsert({
      where: { slug: "wsop" },
      update: {},
      create: { slug: "wsop", name: "WSOP.com", listingUrl: "https://www.wsop.com/news/" },
    }),
    pokernews: await prisma.source.upsert({
      where: { slug: "pokernews" },
      update: {},
      create: { slug: "pokernews", name: "PokerNews.com", listingUrl: "https://www.pokernews.com/news/" },
    }),
    "legacy-import": await prisma.source.upsert({
      where: { slug: "legacy-import" },
      update: {},
      create: {
        slug: "legacy-import",
        name: "Legacy import (unknown source)",
        listingUrl: "",
        active: false,
      },
    }),
  };

  const seenSourceUrls = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let danglingTexto2Or3 = 0;

  for (const [index, row] of rows.entries()) {
    try {
      if (!row.Titulo?.trim()) {
        skipped++;
        continue;
      }

      if (row["Texto 2"]?.trim() || row["Texto 3"]?.trim()) danglingTexto2Or3++;

      const fonte = row.Fonte?.trim() || "";
      const candidateUrl = isLikelyUrl(fonte) ? fonte : null;
      const claimUrl = candidateUrl && !seenSourceUrls.has(candidateUrl);
      if (claimUrl && candidateUrl) seenSourceUrls.add(candidateUrl);

      const sourceUrl = claimUrl ? candidateUrl : null;
      const legacyImport = !claimUrl;
      const legacySourceText = legacyImport ? fonte || null : null;

      const status = mapStatus(row.status, row.publicado);
      const slug = sourceSlugForUrl(candidateUrl);

      await prisma.article.create({
        data: {
          sourceId: sources[slug].id,
          sourceUrl: sourceUrl ?? undefined,
          legacyImport,
          legacySourceText,
          status,
          title: row.Titulo.trim(),
          bodyHtml: row["Texto 1"]?.trim() || null,
          excerpt: row.excerto?.trim() || null,
          generatedImageUrl: row["Link Imagem"]?.trim() || null,
          notes: row.notas?.trim() || null,
          wpPostUrl: row["link do post"]?.trim() || null,
          createdAt: parseDateOrUndefined(row["data criação"]) ?? new Date(),
          publishedAt: status === "published" ? parseDateOrUndefined(row["data publicação"]) : undefined,
          approvedAt: status === "approved" || status === "published" ? parseDateOrUndefined(row["data criação"]) : undefined,
        },
      });
      imported++;

      if (imported % 50 === 0) console.log(`  ...${imported} imported`);
    } catch (err) {
      console.error(`Row ${index + 2} ("${row.Titulo}") failed to import:`, err);
      skipped++;
    }
  }

  console.log("\nMigration summary:");
  console.log(`  Rows in CSV:            ${rows.length}`);
  console.log(`  Imported:               ${imported}`);
  console.log(`  Skipped (no title/err): ${skipped}`);
  console.log(`  Had non-empty Texto 2/3 (dropped): ${danglingTexto2Or3}`);

  const totalInDb = await prisma.article.count();
  console.log(`  Total articles now in DB: ${totalInDb}`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

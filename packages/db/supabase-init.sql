-- ============================================================================
-- Beatdagame Bot: schema inicial para o Supabase
--
-- Como usar:
--   1. Abre o teu projeto em https://supabase.com/dashboard
--   2. Vai a "SQL Editor" (barra lateral esquerda) -> "New query"
--   3. Cola este ficheiro inteiro e clica "Run"
--   4. (Opcional) corre também o bloco de seed no fundo, para pré-criar as
--      duas fontes conhecidas (WSOP.com, PokerNews.com) -- se não o fizeres,
--      o worker cria-as automaticamente sozinho na primeira vez que corre.
--
-- Este ficheiro é gerado a partir de packages/db/prisma/schema.prisma e é
-- idêntico ao que "prisma migrate deploy" aplicaria. Está também guardado
-- como migração formal do Prisma em
-- packages/db/prisma/migrations/00000000000000_init/migration.sql -- não
-- precisas de correr os dois; escolhe um caminho:
--   a) Colar isto no SQL Editor do Supabase (mais simples, nenhuma
--      ferramenta local necessária), OU
--   b) Correr `pnpm --filter @beatdagame/db exec prisma migrate deploy`
--      a partir da tua máquina, com DATABASE_URL a apontar para o Supabase.
-- Depois de escolheres a opção (a), a Prisma CLI vai continuar a funcionar
-- normalmente no futuro (`prisma migrate dev` para novas alterações),
-- porque a migração já está registada localmente no repositório.
-- ============================================================================

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('pending_generation', 'pending_review', 'approved', 'publishing', 'published', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "ArticleEventType" AS ENUM ('scraped', 'scrape_failed', 'generated', 'generation_failed', 'extraction_fallback_used', 'status_changed', 'publish_started', 'publish_succeeded', 'publish_failed', 'image_job_submitted', 'image_job_completed', 'image_job_failed', 'duplicate_skipped');

-- CreateEnum
CREATE TYPE "ImageJobKind" AS ENUM ('featured', 'ig_story');

-- CreateEnum
CREATE TYPE "ImageJobStatus" AS ENUM ('pending', 'succeeded', 'failed', 'skipped_budget');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listingUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "sourceImageUrl" TEXT,
    "sourcePublishedAt" TIMESTAMP(3),
    "status" "ArticleStatus" NOT NULL DEFAULT 'pending_generation',
    "title" TEXT,
    "excerpt" TEXT,
    "bodyHtml" TEXT,
    "generatedImageUrl" TEXT,
    "igStoryImageUrl" TEXT,
    "wpPostId" INTEGER,
    "wpPostUrl" TEXT,
    "notes" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "legacyImport" BOOLEAN NOT NULL DEFAULT false,
    "legacySourceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_events" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "eventType" "ArticleEventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_generation_jobs" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "kind" "ImageJobKind" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kie.ai',
    "model" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "status" "ImageJobStatus" NOT NULL DEFAULT 'pending',
    "costEstimateUsd" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "resultUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "image_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sources_slug_key" ON "sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "articles_sourceUrl_key" ON "articles"("sourceUrl");

-- CreateIndex
CREATE INDEX "articles_status_idx" ON "articles"("status");

-- CreateIndex
CREATE INDEX "articles_sourceId_status_idx" ON "articles"("sourceId", "status");

-- CreateIndex
CREATE INDEX "article_events_articleId_createdAt_idx" ON "article_events"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "image_generation_jobs_createdAt_idx" ON "image_generation_jobs"("createdAt");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_events" ADD CONSTRAINT "article_events_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_generation_jobs" ADD CONSTRAINT "image_generation_jobs_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- SEED (opcional): pré-criar as duas fontes conhecidas.
-- Podes saltar este bloco -- o worker faz upsert automaticamente destas
-- mesmas linhas (por "slug") na primeira vez que o job de scraping corre.
-- ============================================================================

INSERT INTO "sources" ("id", "slug", "name", "listingUrl", "active")
VALUES
  ('src_wsop', 'wsop', 'WSOP.com', 'https://www.wsop.com/news/', true),
  ('src_pokernews', 'pokernews', 'PokerNews.com', 'https://www.pokernews.com/news/', true)
ON CONFLICT ("slug") DO NOTHING;

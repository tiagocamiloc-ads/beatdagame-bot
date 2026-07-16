# Beatdagame Bot

Sistema próprio que substitui os workflows n8n, o Google Sheets e o CRM Lovable
usados para gerar, rever e publicar notícias de poker em beatdagame.com.

Ver o plano completo em `.claude/plans` desta conversa para o contexto e as
decisões de arquitetura. Resumo rápido:

- **Base de dados**: Postgres gerido (Supabase)
- **Scraping + geração de artigos**: scripts Node/TypeScript, correm via GitHub Actions (cron diário)
- **Publicação no WordPress**: script Node/TypeScript, corre via GitHub Actions (cron horário), idempotente
- **CRM (Kanban)**: Next.js, deploy no Netlify
- **Escrita de artigos**: Claude (Anthropic), output estruturado
- **Geração de imagem**: kie.ai (mantido)

Nenhum destes componentes depende de n8n, Google Sheets ou Lovable.

## Ação imediata: rodar a key do kie.ai

A key do kie.ai que estava no workflow n8n antigo (`Bearer 6805fd12...`) foi
partilhada em texto simples numa conversa e deve ser considerada comprometida.
**Gera uma nova key no painel do kie.ai e revoga a antiga antes de continuares
com o resto deste setup.**

## Estrutura do repositório

```
apps/
  web/        Next.js (CRM + API), deploy no Netlify
  worker/     scripts que correm via GitHub Actions (scrape, geração, publicação)
packages/
  db/         schema Prisma + client partilhado
  core/       adaptadores de scraping, cliente Claude, cliente kie.ai, cliente WordPress, notificações
scripts/
  migrate-from-sheets.ts   importa o CSV do Google Sheets antigo
  create-user.ts           cria um login para o CRM
.github/workflows/
  scrape-and-generate.yml  cron diário
  publish.yml              cron horário
```

## Setup passo a passo

### 1. Pré-requisitos

- Node.js 22+, [pnpm](https://pnpm.io) 9+
- Conta [Supabase](https://supabase.com) (base de dados Postgres gerida)
- Conta [Netlify](https://netlify.com) (hosting do CRM)
- Repositório no GitHub (para os jobs agendados via GitHub Actions)
- API key da [Anthropic](https://console.anthropic.com)
- API key do [kie.ai](https://kie.ai) (nova, ver acima)
- Acesso de administrador ao WordPress de beatdagame.com

### 2. Base de dados (Supabase)

1. Cria um novo projeto no Supabase.
2. Em **Project Settings → Database**, copia a connection string do **Session
   pooler** (recomendado para jobs de curta duração como os do GitHub Actions).
3. Guarda essa string, vais precisar dela como `DATABASE_URL`.
4. Abre **SQL Editor → New query** no dashboard do Supabase, cola o conteúdo
   de [`packages/db/supabase-init.sql`](packages/db/supabase-init.sql) e
   clica **Run**. Isto cria todas as tabelas (`sources`, `articles`,
   `article_events`, `image_generation_jobs`, `users`) e, opcionalmente,
   pré-regista as duas fontes (WSOP.com, PokerNews.com).

Não precisas de correr nada por linha de comandos para criar o schema; o
ficheiro `.sql` já está pronto a colar. Se preferires o caminho via CLI (por
exemplo, para gerares novas migrações mais tarde a partir de alterações ao
`schema.prisma`), tens essa alternativa no passo 3.

### 3. Setup local

```bash
git clone <este-repositório>
cd "BEATDAGAME - BOT"
corepack enable
pnpm install

cp .env.example .env
# edita .env e preenche DATABASE_URL, ANTHROPIC_API_KEY, KIE_AI_API_KEY, etc.

pnpm db:generate
```

Se já correste o `supabase-init.sql` no passo 2, o schema está pronto e podes
avançar para o passo 4. Caso contrário (ou para aplicar alterações futuras ao
schema), corre:

```bash
pnpm --filter @beatdagame/db exec prisma migrate deploy
```

Isto aplica as migrações Prisma (a mesma migração `00000000000000_init` que
gerou o `supabase-init.sql`) diretamente contra o `DATABASE_URL` do `.env`.

### 4. Criar o primeiro utilizador do CRM

```bash
pnpm create-user tiagocamiloc@gmail.com "uma-password-forte" "Tiago"
```

### 5. WordPress: Application Password

1. No wp-admin de beatdagame.com: **Utilizadores → Perfil → Application
   Passwords**.
2. Cria uma nova, dá-lhe um nome como "beatdagame-bot", copia a password
   gerada (só é mostrada uma vez).
3. Guarda como `WP_USERNAME` (o teu username de wp-admin) e `WP_APP_PASSWORD`.

### 6. Slack (opcional, mas recomendado)

Cria um [Incoming Webhook](https://api.slack.com/messaging/webhooks) no canal
onde já recebes as notificações hoje, e guarda o URL como `SLACK_WEBHOOK_URL`.

### 7. Email de alerta (opcional)

Cria uma conta em [Resend](https://resend.com), verifica um domínio, e guarda
a key como `RESEND_API_KEY`. Define `ALERT_EMAIL_TO`/`ALERT_EMAIL_FROM`.

### 8. Testar localmente antes de agendar

```bash
pnpm scrape             # corre o job de scraping + geração uma vez
pnpm publish-articles   # corre o job de publicação uma vez
pnpm dev:web             # arranca o CRM em http://localhost:3000
```

### 9. Migrar os artigos existentes (593 do Sheet antigo)

**Corre isto primeiro contra uma base de dados de staging** (cria um segundo
projeto Supabase gratuito só para teste, aponta `DATABASE_URL` para lá).

```bash
pnpm migrate:sheets "./Bot BDG - Artigos.csv"
```

O script imprime um resumo no final (linhas importadas, ignoradas, contagem
de `Texto 2`/`Texto 3` não vazios que foram descartados). Confirma que o
número de artigos importados bate certo com o CSV, e faz uma amostragem manual
via `pnpm db:studio` antes de repetir o comando contra a base de dados de
produção.

### 10. GitHub Actions: configurar secrets

Em **Settings → Secrets and variables → Actions** do repositório, adiciona:

| Secret | Valor |
|---|---|
| `DATABASE_URL` | connection string do Supabase |
| `ANTHROPIC_API_KEY` | key da Anthropic |
| `KIE_AI_API_KEY` | key nova do kie.ai |
| `KIE_AI_BASE_URL` | `https://api.kie.ai/api/v1` |
| `MAX_MONTHLY_IMAGE_SPEND_USD` | ex.: `150` |
| `STORY_TEMPLATE_IMAGE_URL` | URL do template PNG do Story (opcional) |
| `WP_BASE_URL` | `https://www.beatdagame.com` |
| `WP_USERNAME` | o teu username wp-admin |
| `WP_APP_PASSWORD` | a Application Password gerada no passo 5 |
| `WP_DEFAULT_CATEGORY_ID` | `6` (ou o ID da categoria certa) |
| `SLACK_WEBHOOK_URL` | opcional |
| `RESEND_API_KEY` / `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM` | opcional |

Os workflows em `.github/workflows/` já estão prontos: `scrape-and-generate.yml`
corre todos os dias, `publish.yml` corre a cada hora. Podes disparar qualquer
um manualmente no separador **Actions** do GitHub (`workflow_dispatch`) para
testar antes de confiares no agendamento automático.

### 11. Deploy do CRM no Netlify

1. **Add new site → Import an existing project**, liga o repositório GitHub.
2. O `netlify.toml` na raiz já define `base = "apps/web"` e o comando de
   build correto para o monorepo: não precisas de configurar nada manualmente
   aqui.
3. Em **Site settings → Environment variables**, adiciona: `DATABASE_URL`,
   `NEXTAUTH_URL` (o domínio final do site Netlify), `NEXTAUTH_SECRET` (gera
   um valor aleatório, ex.: `openssl rand -base64 32`).
4. Faz deploy. O Netlify volta a fazer deploy automaticamente a cada push em
   `main`.

### 12. Corte a partir do sistema antigo

1. Confirma que o novo sistema está estável (ver checklist de verificação
   abaixo).
2. Desativa o workflow **"Publicar Post BDG 2026"** no n8n.
3. Ativa/confirma que `publish.yml` está a correr no GitHub Actions.
4. Muda a equipa de revisão para o novo CRM (`/board` no site Netlify).
5. Desativa o workflow **"Criar Artigos Beatdagame EN"** no n8n.
6. Conforme combinado, desliga/arquiva o Google Sheet e o CRM Lovable pouco
   depois de confirmares que tudo está a funcionar (não é preciso manter um
   período longo de fallback).

## Checklist de verificação antes do corte

- [ ] `pnpm migrate:sheets` corrido contra staging, contagem de linhas confere com o CSV
- [ ] `pnpm scrape` (`workflow_dispatch` manual) não cria linhas duplicadas numa segunda execução para a mesma fonte
- [ ] Um artigo gerado por `pnpm scrape` cumpre o schema (título, excerto, corpo HTML preenchidos)
- [ ] Aprovar um artigo de teste no CRM e correr `pnpm publish-articles` cria o post no WordPress e atualiza o estado para `published`
- [ ] Duas execuções sobrepostas de `publish-articles` não publicam o mesmo artigo duas vezes (lock compare-and-swap)
- [ ] Uma falha simulada do kie.ai (ex.: key inválida temporariamente) incrementa `retryCount` e chega alerta ao Slack

## Comandos úteis

```bash
pnpm dev:web           # CRM em localhost:3000
pnpm scrape             # correr scraping+geração manualmente
pnpm publish-articles   # correr publicação manualmente
pnpm db:studio          # explorar a base de dados visualmente
pnpm typecheck           # verificar tipos em todo o monorepo
```

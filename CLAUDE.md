# XONIK Usher

XONIK Usher (usher.xonik.com) is a multi-tenant SaaS that gives businesses an AI chat assistant for their website, starting with dentists. Each business (a "client") signs up, adds its Business Info and documents, allows its website domains, and pastes one script tag on its site. Visitors chat with an assistant that answers from the client's own details, a shared industry knowledge pack and the client's documents, and can send appointment requests that become leads with email alerts.

The package is still named `website-assistant`. [README.md](README.md) is the full setup and operations guide (Supabase setup, migrations, how each feature works); keep it in sync with this file.

## Tech stack

- **App:** Next.js 16 (App Router, Turbopack, Cache Components), React 19, TypeScript, Tailwind CSS 4, Zod
- **Database and auth:** Supabase (Postgres with Row Level Security, Auth, Storage), pgvector for document search
- **Assistant:** Claude API through `@anthropic-ai/sdk` (model and effort set by environment variables)
- **Embeddings:** Voyage AI (`voyage-4`, 1024-dimension vectors)
- **Email:** Resend (lead alerts)
- **Documents:** `unpdf` (PDF), `mammoth` (DOCX)
- **Widget:** one plain JavaScript file, [public/widget.js](public/widget.js), drawn inside a Shadow DOM
- **Tests:** Node's test runner, PGlite with pgvector (offline database tests), Playwright (browser tests and scripted end-to-end checks)

## Layout

- `src/app/` pages, route handlers (`api/`), server actions (`actions/`)
- `src/lib/` server logic: chat engine and prompt layers (`chat/`), documents, embeddings, public API guard (`public-api/`), leads, notifications, dashboard data, Supabase clients (`supabase/`, including the server-only admin client)
- `src/components/` UI
- `supabase/migrations/` schema, policies and storage, one file per step, applied in order
- `supabase/packs/` industry knowledge packs (published with `npm run packs:sync`)
- `scripts/` evaluation and end-to-end test scripts; `tests/` unit, database, Playwright and fixture files

## The 8-step plan

| Step | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: Next.js, Supabase, auth, `clients` table, RLS | Done |
| 2 | Dentist industry knowledge pack and chat engine (Claude API) | Done |
| 3 | Business Info and document upload with Voyage embeddings (pgvector) | Done |
| 4 | Public API keys, domain lock, rate and monthly limits | Done |
| 5 | Embeddable website widget (`widget.js`, Shadow DOM) | Done |
| 6 | Appointment requests, leads, email alerts via Resend | Done |
| 7 | Client dashboard: overview, setup checklist, conversations, knowledge gaps, settings, delete account | Done (`test:dashboard` 26 of 26, 29 Oct 2026) |
| 8 | Billing | Not started |

## Running the app

```bash
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev                        # http://localhost:3000
npm run packs:sync                 # after changing supabase/packs/
```

Every migration in `supabase/migrations/` must be applied to the Supabase project (SQL Editor or `npx supabase db push`).

## Tests

Offline (no Supabase project, no app running):

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript types |
| `npm run lint` | ESLint |
| `npm run test:unit` | Document extraction and chunking, domain lock rules, mobile number and request form rules, hidden tags, the alert email |
| `npm run test:db` | Every migration on in-process Postgres with pgvector; Row Level Security isolates clients on every table, and fails if any public table has RLS off |

Live (real Supabase project, Claude, Voyage and Resend keys in `.env`). Start `npm run dev` first; each script creates temporary clients and deletes them afterwards. Run them one at a time, never in parallel, because they share the Voyage and rate limits.

| Step | Command |
| --- | --- |
| 1 | `npm run test:e2e` (Playwright; needs **Confirm email** off in Supabase). Set `E2E_PORT=3000` to reuse a running dev server, otherwise it starts its own on port 3100 |
| 2 | `npm run eval:assistant -- --out eval-results.md` |
| 3 | `npm run eval:knowledge -- --out knowledge-results.md` |
| 4 | `npm run test:public-api -- --out public-api-results.md --screenshots public-api-screenshots` (about 3 minutes) |
| 5 | `npm run test:widget -- --out widget-results.md --screenshots widget-screenshots` (about 4 minutes) |
| 6 | `npm run test:leads -- --out leads-results.md --screenshots leads-screenshots` |
| 7 | `npm run test:dashboard -- --out dashboard-results.md --screenshots dashboard-screenshots` (about 10 minutes) |
| 5-7 | `npm run test:forms -- --out forms-results.md` (every dashboard form keeps what was typed when the server refuses it) |

If `test:e2e` fails at sign-up with "We can't send confirmation emails right now", **Confirm email** is on in Supabase (Authentication > Sign In / Providers > Email) and the built-in mailer's limit of about 2 emails an hour has been reached. Turn it off for the run.

**Hidden pages in browser tests:** with Cache Components, Next.js keeps recently visited pages mounted but hidden (`display: none`) after client-side navigation, and keeps its own `role="alert"` route announcer on every page. In Playwright, find elements with `getByRole` (it skips hidden elements) or scope to the visible form; `getByLabel` and a page-wide `getByRole("alert")` can match the hidden copies.

Results files (`*-results.md`) and screenshot folders are git-ignored. `EVAL_BASE_URL` points the scripts at another address (default `http://localhost:3000`).

**Voyage free tier:** without a payment method, Voyage allows 3 requests per minute. A visitor message can use two embeddings (document search and the knowledge gap), so the dashboard test spaces chat messages 40 seconds apart (`CHAT_SPACING_MS`, set it to `0` on a paid plan). Space any new test that embeds in the same way.

## Environment variables

Names only. Values live in `.env` or `.env.local` (never committed); see [.env.example](.env.example).

App (`NEXT_PUBLIC_` ones are the only values the browser may see):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SECRET_KEY` (server-only)
- `ANTHROPIC_API_KEY` (server-only)
- `ANTHROPIC_MODEL`
- `ANTHROPIC_EFFORT`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_API_KEY` (server-only)
- `EMBEDDING_MODEL`
- `PUBLIC_CHAT_IP_LIMIT_PER_MINUTE`
- `RESEND_API_KEY` (server-only)
- `RESEND_FROM_EMAIL`
- `LEADS_TIMEZONE`

Tests and tooling only:

- `LEAD_TEST_EMAIL` (where the leads test sends its alert)
- `E2E_PORT`, `E2E_EMAIL_DOMAIN` (Playwright suite)
- `EVAL_BASE_URL`, `CHAT_SPACING_MS` (test scripts)
- `SUPABASE_DB_URL` (direct database connection for applying migrations by hand; not read by the app)

## Launch tasks

Before going live:

- Turn **Confirm email** back on in Supabase (Authentication > Sign In / Providers > Email). It is off only so `npm run test:e2e` can sign up accounts.
- Connect Supabase Auth to Resend SMTP with a verified domain (Authentication > Emails > SMTP Settings), so confirmation and password emails are not limited to Supabase's built-in mailer (about 2 emails an hour).

## Working rules

- Build one step completely, working and tested, before starting the next.
- All code, comments, UI text and docs are in English.
- No AI or tool attribution anywhere, including git commit messages, PR descriptions, code comments and docs.
- Never expose API keys or secrets to the browser. Secrets are read only in server code (`import "server-only"`); only `NEXT_PUBLIC_` variables may reach client components.
- Row Level Security on every table, with policies that tie rows to the client. Add the new tables to `tests/db/rls.test.mjs`.
- The Voyage free tier allows 3 requests per minute, so tests that embed are spaced out.
- Update this file (plan status, tests, environment variables) at the end of every step.
- Commit and push at the end of every step, once its tests pass. Before committing, check that no key, secret or personal data is in a tracked file. Commit messages carry no co-author lines, "Generated with" lines or any AI or tool attribution.

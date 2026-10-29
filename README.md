# Website Assistant

Website Assistant lets businesses add a chat assistant to their website, trained on their own documents.

This repository contains the foundation:

- Sign up, sign in and sign out with email and password (Supabase Auth)
- A short onboarding form: business name, industry (dentist, pharmacy, other) and website domain
- A dashboard showing the business details, with an edit page
- A multi-tenant `clients` table protected by Row Level Security
- pgvector enabled, plus a private `documents` storage bucket where each client can only reach its own folder (both used in later steps)

**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, Storage).

---

## 1. Set up Supabase

### 1.1 Create a project

1. Sign in at [supabase.com](https://supabase.com/dashboard) and click **New project**.
2. Choose an organization, enter a project name (for example `website-assistant`), set a database password and pick the region closest to your customers.
3. Wait for the project to finish provisioning (about a minute).

### 1.2 Create the database schema

1. In your project, open **SQL Editor** and click **New query**.
2. Copy the entire contents of [`supabase/migrations/20261027000000_foundation.sql`](supabase/migrations/20261027000000_foundation.sql), paste it into the editor and click **Run**. You should see `Success. No rows returned`.

   The script is safe to run more than once. It:
   - enables the `vector` extension (pgvector) in the `extensions` schema,
   - creates the `public.clients` table with its constraints,
   - enables Row Level Security and adds the policies,
   - removes all access for signed-out visitors and lets signed-in clients write only the business fields,
   - creates the private `documents` storage bucket and its per-client policies.

3. Check that it worked. Run this query in the SQL Editor:

   ```sql
   select tablename, rowsecurity from pg_tables where schemaname = 'public';
   select extname from pg_extension where extname = 'vector';
   select id, public from storage.buckets where id = 'documents';
   ```

   Expected results: `clients | true`, `vector`, and `documents | false`.

> Using the Supabase CLI instead? Run `npx supabase link --project-ref <your-project-ref>` and then `npx supabase db push`. It applies the same migration file.

### 1.3 Configure authentication

1. Open **Authentication → URL Configuration**.
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** add `http://localhost:3000/auth/confirm`
   - When you deploy, add your production address as well (for example `https://app.yourdomain.com/auth/confirm`) and update the Site URL.
2. Open **Authentication → Sign In / Providers → Email**.
   - Make sure **Email** is enabled.
   - Set **Minimum password length** to `8` (the app requires at least 8 characters).
   - **Confirm email:** keep it **on** for production. For local development you can turn it **off** so new accounts can sign in straight away. It must be off while the end-to-end tests run.
3. Recommended: open **Authentication → Emails → Confirm signup** and replace the link in the template with:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
   ```

   With this link, confirmation works even when the email is opened in a different browser or device. The default link also works, but only in the browser used to sign up.

> Supabase's built-in email service only sends about 2 emails per hour and is meant for testing. When the limit is reached, sign-up shows "We can't send confirmation emails right now". Turn off **Confirm email** during development to avoid it. Before going live, set up your own SMTP provider under **Authentication → Emails → SMTP Settings**.

### 1.4 Copy your API settings

1. Open **Project Settings → Data API** and copy the **Project URL**. Use only the address, `https://<your-project-ref>.supabase.co`, without `/rest/v1/` at the end.
2. Open **Project Settings → API Keys** and copy the **Publishable key** (starts with `sb_publishable_`). The legacy `anon` key also works if your project only has that.
3. Copy a **Secret key** (starts with `sb_secret_`) from the same page. The chat engine needs it (see section 4). Never put this key in code, in the browser, or in version control.

---

## 2. Run the app locally

Requirements: Node.js 20.9 or newer and npm.

```bash
# 1. Install dependencies
npm install

# 2. Create your local settings file
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```

Open `.env.local` and fill in the values from step 1.4:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SECRET_KEY=sb_secret_...  # server-only
ANTHROPIC_API_KEY=sk-ant-...       # server-only, see section 4
```

```bash
# 3. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Get started**, create an account, fill in the business form, and you will land on your dashboard.

### Production build

```bash
npm run build
npm run start
```

---

## 3. Tests

| Command | What it checks | Needs Supabase? |
| --- | --- | --- |
| `npm run typecheck` | TypeScript types | No |
| `npm run lint` | ESLint rules | No |
| `npm run test:db` | Runs every migration on an in-process Postgres with pgvector and proves Row Level Security isolates clients: business details, Business Info, conversations, documents, chunks, document search and file storage | No |
| `npm run test:unit` | Extracts text from real PDF, Word and text files (including broken and scanned ones), checks how documents are split into chunks, the domain lock rules, mobile number and request form rules, the hidden form marker, and the alert email | No |
| `npm run test:dashboard` | The client dashboard in a real browser: overview numbers and charts against the database, usage warnings, setup checklist, conversations, knowledge gaps, settings, account deletion, isolation and phone layout (see section 9) | Yes |
| `npm run test:forms` | Every dashboard form keeps what the client typed when the server refuses it (API Key domains, Business Info, lead alerts, business details, Widget, lead notes) | Yes |
| `npm run test:leads` | Appointment requests in a real browser: booking intent, the form on desktop and mobile, validation, duplicates, the alert email, the Leads dashboard and isolation (see section 8) | Yes |
| `npm run test:widget` | The website chat widget in a real browser: allowed and blocked domains, page changes, mobile, keyboard, CSS isolation, dashboard settings and error messages (see section 7) | Yes |
| `npm run test:public-api` | The public chat API against the running app: domain lock, CORS, key regeneration, pause, rate limits, monthly limit, rejection log and client isolation (see section 6) | Yes |
| `npm run test:e2e` | Browser tests: pages render, signed-out visitors are redirected, forms validate. **With a real project configured**, it also signs up two businesses, completes onboarding, checks the dashboard, edits details, signs out and back in, and then calls the Supabase API directly as one client to confirm it cannot read, change, delete or impersonate the other, or touch its files | Optional |

Before the first browser test run, install the test browser:

```bash
npx playwright install chromium
```

To run the full end-to-end suite against your project:

1. Fill in `.env.local` as described above.
2. Turn **Confirm email** off in Supabase (see 1.3).
3. Optionally set `SUPABASE_SECRET_KEY` so the two test accounts are deleted afterwards. Without it, delete the `wa-e2e-...` users yourself under **Authentication → Users**.
4. Run `npm run test:e2e`.

Test accounts use addresses like `wa-e2e-alice-<id>@example.com`. If Supabase rejects that domain, set `E2E_EMAIL_DOMAIN` in `.env.local` to a domain you control.

---

## 4. The assistant (industry packs and chat engine)

### Set up

1. **Run the second migration.** In the Supabase **SQL Editor**, open a new query, paste the contents of [`supabase/migrations/20261028000000_chat_engine.sql`](supabase/migrations/20261028000000_chat_engine.sql) and click **Run**. It creates the `industry_packs` and `conversations` tables with Row Level Security.
2. **Add the Claude settings** to `.env` (or `.env.local`):

   ```bash
   SUPABASE_SECRET_KEY=sb_secret_...      # required by the chat engine
   ANTHROPIC_API_KEY=sk-ant-...           # from console.anthropic.com > API Keys
   ANTHROPIC_MODEL=claude-opus-5-5        # optional; change to switch models
   ANTHROPIC_EFFORT=low                   # optional; low suits short chat replies
   ```

   These are read only on the server and are never sent to the browser.
3. **Load the industry packs** into the database:

   ```bash
   npm run packs:sync
   ```

4. Restart `npm run dev`, open the dashboard and click **Test Assistant**.

### How it works

- **Industry packs** live in the `industry_packs` table: industry, version, knowledge, behavior rules and updated date. The engine uses the highest published version for the client's industry. The source files are in [`supabase/packs/`](supabase/packs/). To change a pack, edit its files and run `npm run packs:sync`. To publish a new version, bump `version` in `pack.json` first. To add a pack for another industry, add a folder (or insert a row directly); no code changes are needed.
- **The chat API** is `POST /api/chat` with `{ clientId, sessionId, message }`. It loads the client's business details and industry pack, adds the earlier turns of the same session, and streams the reply as newline-delimited JSON (`text`, `reset`, `done`, `error` events). Only the signed-in owner of the client can use it. Websites use the public chat API instead (see section 6).
- **Prompt layers**, from most shared to most specific: platform rules, then the industry pack (cached, shared by every client in the industry), then the business information. Client documents will be added to the business layer in the next step. The prompt tells the model that business information overrides the general industry knowledge, while safety rules can never be overridden.
- **Conversations** are saved to the `conversations` table after every reply (client ID, session ID, visitor message, assistant reply, time). Only the server writes them. Each client can read only its own conversations.
- **Model choice:** `claude-opus-5-5` by default, with server-side refusal fallbacks enabled on models that support them. Set `ANTHROPIC_MODEL` to change it, for example to `claude-haiku-5-5` for lower cost.

### Check the assistant's answers

With the app running (`npm run dev`):

```bash
npm run eval:assistant -- --out eval-results.md
```

This creates a temporary dentist account, asks 15 real patient questions through the chat API (fees, emergencies, Hindi, Hinglish, medicine requests, treatments, clinic facts, a follow-up that needs the conversation history), checks every reply against the behavior rules, verifies that conversations are saved and protected, and then deletes the account.

---

## 5. Client knowledge (Business Info and documents)

### Set up

1. **Run the third migration.** In the Supabase **SQL Editor**, paste [`supabase/migrations/20261029000000_client_knowledge.sql`](supabase/migrations/20261029000000_client_knowledge.sql) and click **Run**. It creates `business_profiles`, `documents` and `document_chunks` with Row Level Security, the document search function, and limits on the `documents` storage bucket (10 MB, PDF/DOCX/TXT only).
2. **Add the embedding settings** to `.env` (create a key at [dashboard.voyageai.com](https://dashboard.voyageai.com/)):

   ```bash
   EMBEDDING_PROVIDER=voyage
   EMBEDDING_API_KEY=pa-...
   EMBEDDING_MODEL=voyage-4
   ```

3. Run `npm run packs:sync` to publish the latest dentist pack (version 2 allows quoting the clinic's own listed fees).
4. Restart `npm run dev`.

### How it works

- **Business Info** (`/dashboard/business-info`) stores structured clinic details in `business_profiles`: address, phone, WhatsApp, email, opening hours per day, doctors, services, fees, offers, languages and a Google Maps link. Every field is optional. These details are added to every conversation.
- **Documents** (`/dashboard/documents`) accepts PDF, DOCX and TXT files up to 10 MB. Originals are stored in the private `documents` bucket under `<client id>/<document id>/`, so the knowledge can always be rebuilt from them. After upload, processing runs in the background: the text is extracted, split into overlapping chunks of about 1,000 characters, embedded and stored in `document_chunks`. The page shows Processing, Ready or Failed (with the reason) and updates itself.
- **Replace** stores the new file, removes the old file's knowledge right away and processes the new one. **Delete** removes the document, all its chunks and its stored file. A revision number on each document ensures that a slow, outdated processing run can never bring back old knowledge.
- **Search:** for each visitor message, the engine embeds the message (plus the previous one, for follow-ups) and finds the most similar chunks from that client's ready documents only. The search runs on the server and always filters by the client.
- **Priority:** Business Info first, then document excerpts, then the industry pack. When they disagree, the higher one wins. All safety rules still apply.
- **Changing the embedding model:** `EMBEDDING_MODEL` can be any Voyage model that returns 1024-dimension vectors. A model with a different size needs a migration of the `embedding` column, and every document must be uploaded again or reprocessed from the stored originals. Each chunk records the model that produced it.

### Check it

With the app running:

```bash
npm run eval:knowledge -- --out knowledge-results.md
```

This creates two temporary dentist clinics and uses the real dashboard in a headless browser. It uploads a clinic PDF with fees and timings and asks about them, checks that a scanned PDF fails with a clear message, fills in Business Info for a clinic without documents and asks about its timings, and checks that Business Info overrides the PDF and that the PDF overrides the industry pack. It then replaces and deletes the PDF and confirms the assistant stops using it, and confirms that neither clinic's data ever appears in the other's answers. The accounts are deleted afterwards.

---

## 6. API keys and domain lock (public chat API)

### Set up

1. **Run the fourth migration.** In the Supabase **SQL Editor**, paste [`supabase/migrations/20261030000000_public_api.sql`](supabase/migrations/20261030000000_public_api.sql) and click **Run**. It creates `api_keys`, `allowed_domains`, `rate_limit_buckets` and `public_api_rejections`, adds the pause switch, test mode and monthly message limit to `clients`, and gives every existing client a key with its website domain already allowed.
2. Optional: set `PUBLIC_CHAT_IP_LIMIT_PER_MINUTE` in `.env` (default `20`).
3. Restart `npm run dev` and open **Dashboard → API Key**.

### How it works

- **Public key:** each client has one key, `pk_live_` followed by 32 random characters, created by the database. It is meant to sit in the client's website code, like a payment provider's publishable key; it is useless on any other website. **Regenerate key** replaces it and the old key stops working immediately. The key never reveals the client's ID, and the browser never receives any secret.
- **Pause assistant** keeps the key and settings, but the API answers with "This assistant is not available right now".
- **Allowed domains:** `myclinic.com` covers `myclinic.com` and `www.myclinic.com` on http and https. Tick **Also allow all subdomains** (or type `*.myclinic.com`) to cover `book.myclinic.com` too. Domains are validated and duplicates are refused. `localhost` (any port) can be added and works only while **Test mode** is on. IP addresses are never allowed. A new client's website domain is allowed automatically.
- **Public chat API:** `POST /api/public/chat?key=pk_live_...` with `{ "sessionId": "<uuid>", "message": "..." }`. The key is in the URL so the browser's CORS preflight can be checked too. Checks run in this order: the key exists, the assistant is not paused, the `Origin` header matches an allowed domain, the request is valid, the visitor's IP and the key are within their per-minute limits, and the client is within its monthly limit. The reply streams in the same format as the dashboard's chat, using the same engine, Business Info and documents.
- **CORS:** only an allowed origin receives `Access-Control-Allow-Origin`. Any other website's script cannot read a response, not even an error.
- **Limits:** 20 messages per minute per visitor IP and 60 per minute per key (adjustable per key in `api_keys.requests_per_minute`), answered with HTTP 429, a `Retry-After` header and a "please slow down" message. The monthly limit is stored on the client (`clients.monthly_message_limit`, default 1000). Only website messages count; Test Assistant messages do not. Clients cannot change their own limit; change it in the SQL Editor or Table Editor.
- **Rejection log:** every refused request is stored in `public_api_rejections` (reason, origin, time) and shown on the API Key page. Visitor IP addresses are not stored; rate limiting uses a one-way hash.
- **Behind a proxy:** the visitor IP is read from `X-Forwarded-For`. Vercel and most hosting platforms set this header themselves. If you host elsewhere, make sure your proxy overwrites it.

### Check it

With the app running (`npm run dev`):

```bash
npm run test:public-api -- --out public-api-results.md --screenshots public-api-screenshots
```

This creates two temporary dentist clients and calls the API exactly as a website would. It checks the client's domain (and www) gets a streamed reply, and that other domains, look-alike domains, subdomains, missing origins and unknown keys are refused without CORS headers. It regenerates a key and checks the old one fails and the new one works, then pauses and unpauses the assistant. It confirms client A's key never returns client B's details (even with the same session ID) and never works on B's website. It triggers the per-key limit, the monthly limit and the per-visitor limit, and checks each client sees only its own rejection log. Finally it opens the domain check page in a real browser from `http://localhost` (allowed in test mode, blocked when test mode is off) and from `http://127.0.0.1` (always blocked). The test clients are deleted afterwards. It takes about three minutes because it waits for fresh rate-limit windows.

To try the domain check page yourself, run `npm run test:page`, turn on **Test mode**, add `localhost` to your allowed domains, and open `http://localhost:5500` and `http://127.0.0.1:5500` with your key.

---

## 7. Website chat widget

### Set up

1. **Run the fifth migration.** In the Supabase **SQL Editor**, paste [`supabase/migrations/20261031000000_widget.sql`](supabase/migrations/20261031000000_widget.sql) and click **Run**. It creates `widget_settings` (with defaults for every existing client) and the public `widget-logos` storage bucket.
2. In production, set `NEXT_PUBLIC_SITE_URL` to the app's public address, for example `https://usher.xonik.com`. The embed code shown to clients is built from it: `<script src="https://usher.xonik.com/widget.js" data-key="pk_live_..." async></script>`.
3. Restart `npm run dev` and open **Dashboard → Widget**.

### How it works

- **The widget** is one plain JavaScript file, [`public/widget.js`](public/widget.js) (about 8 KB gzipped, no framework), served at `/widget.js` and cached for 5 minutes. It loads with `async`, so it never blocks the client's page. Everything is drawn inside a Shadow DOM: the website's CSS cannot change the widget, and the widget's CSS cannot change the website.
- **Settings load on every page view** from `GET /api/public/widget?key=...`, which answers only on the client's allowed domains (the same key and domain checks as the chat API). On any other website the widget does not appear, and a short warning is written to the browser console for the site owner. Nothing is cached, so saved changes show on the next page load without touching the embed code.
- **Chat** goes through the public chat API from section 6, with streamed replies and a typing indicator. The session ID and the messages are kept in the visitor's browser (`localStorage`, per key), so the conversation continues on every page of the website, and the chat stays open across page changes. A conversation idle for 24 hours starts fresh. Visitors can start a new conversation from the header.
- **Friendly messages** for every problem: assistant paused (shown as soon as the chat opens, typing disabled), monthly limit reached, too many messages, the conversation limit, no internet connection, and the website being removed from the allowed domains while the chat is open.
- **Phones:** below 480px wide the chat opens full screen and the page behind it stops scrolling. The message box uses 16px text so phones do not zoom in.
- **Accessibility:** every control is a real button with a label, the chat is a labelled dialog, messages are announced through a live log region (a reply is announced once it is complete), Escape closes the chat and returns focus to the chat button, and focus rings stay visible on any brand color. Text on the brand color is automatically white or dark, whichever reads better.
- **Dashboard → Widget** sets the assistant name, logo, brand color, button position (bottom right or left), welcome message and up to 6 quick replies (add, edit, remove, reorder). The live preview runs the real `widget.js` in preview mode, so it matches what visitors see. Logos (PNG, JPG or WebP up to 512 KB, checked by content) are uploaded through the server, stored under a random file name, and the previous logo is deleted. The page also has the embed code with a copy button and install steps for plain HTML, WordPress, Wix and Shopify.
- **Defaults:** the assistant name is the business name, with a welcome message and industry quick replies (for dentists: Book an appointment, Clinic timings, Treatments we offer, Contact the clinic). Quick replies that open the appointment form are described in section 8.

### Check it

With the app running (`npm run dev`):

```bash
npm run test:widget -- --out widget-results.md --screenshots widget-screenshots
```

This creates a temporary dentist client and serves a sample clinic website ([`tests/widget/site`](tests/widget/site), with deliberately aggressive CSS) as `smilecare-dental.com` in a real browser. It checks the widget appears and answers there, continues the conversation on a second page, does not load on another domain or an IP address, is unaffected by the website's CSS (and does not affect it), works with the keyboard and has screen reader labels, and opens full screen on a phone. It then changes every setting in the real dashboard, checks the live preview, copies the embed code, and confirms the website shows the new settings after a refresh. Finally it triggers each error message. The client and its logo are deleted afterwards. It takes about four minutes.

To try it yourself: turn on **Test mode** and add `localhost` on the API Key page, run `npm run test:site -- --key <your pk_live key>`, and open `http://localhost:5600` (the widget appears) and `http://127.0.0.1:5600` (it does not).

---

## 8. Appointment requests and lead capture

### Set up

1. **Run the sixth migration.** In the Supabase **SQL Editor**, paste [`supabase/migrations/20261101000000_leads.sql`](supabase/migrations/20261101000000_leads.sql) and click **Run**. It creates `leads`, `notification_settings` and `lead_notifications` with Row Level Security, and turns quick replies into `{ "text", "action" }` objects ("Book an appointment" now opens the request form).
2. **Set up email alerts with [Resend](https://resend.com).** Create an API key (sending access is enough) and add it to `.env`:

   ```bash
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=                 # leave empty until you verify a domain
   LEADS_TIMEZONE=Asia/Kolkata        # optional; time zone for lead dates and counts
   ```

   Until you verify a domain in Resend (**Domains → Add domain**), emails are sent from `onboarding@resend.dev` and Resend only delivers them to your own Resend account address. After verifying, set a sender on that domain, for example `RESEND_FROM_EMAIL=Clinic Leads <leads@usher.xonik.com>`, and alerts can go to any clinic.
3. Restart `npm run dev`.

### How it works

- **Booking intent in the chat:** when a visitor clearly asks for an appointment or a callback, the assistant says it can take their details and ends its reply with a hidden marker. The server removes the marker from the stream (even when it arrives split across pieces) and tells the widget to show a **Request an appointment** button. The marker never reaches the visitor or the saved conversation. The assistant is told it can never book, reserve or confirm a slot.
- **Quick replies** can send a message or open the form. Each one has an **Opens the appointment form** option on the Widget page; for dentists, "Book an appointment" opens the form by default.
- **The request form** (inside the widget, full screen on phones) asks for name, mobile number, preferred date (today to 180 days ahead), preferred time (morning, afternoon or evening), an optional treatment or concern, and consent: "I agree that the clinic may contact me". Numbers without a country code must be Indian mobile numbers (10 digits starting with 6 to 9, optionally with 0 or 91 in front); with a `+` and a country code, any number of 8 to 15 digits is accepted. Numbers are stored in international format (`+919845012345`). The widget checks everything before sending and the server checks again.
- **After sending,** the visitor is told the clinic will call them on their number to confirm a time, and that nothing is booked until the clinic confirms.
- **Duplicates:** the same number can send one request per clinic every 10 minutes. The database checks this under a lock, so even simultaneous submissions save only one lead. A repeat gets "We already have your request…".
- **Public API:** `POST /api/public/leads?key=pk_live_...`, with the same key, pause and domain checks as chat, 5 requests per minute per visitor IP, and no effect on the monthly message limit. Each lead stores the widget's session ID as its conversation ID, plus the page it was sent from.
- **Alerts:** right after a lead is saved, every alert channel runs. Email is the first channel (`src/lib/notifications/`): a clean email with all details, a call link and a link to the lead in the dashboard. Clinics choose up to 5 alert addresses under **Business Info → Lead alerts**; with none set, alerts go to their sign-in email. Every delivery (sent, failed or skipped, with the reason) is stored in `lead_notifications` and shown on the lead. To add WhatsApp later, add a channel next to `email.ts` and list it in `index.ts`; the lead flow does not change.
- **Dashboard → Leads:** newest first, a **New** badge until a lead is opened, search by name or any part of the number, filters for status and received date, pages of 25, and **Export CSV** with the same filters (formula characters in free text are neutralized for spreadsheets). Opening a lead shows its details, the chat before the request, and alert deliveries; the clinic sets the status (New, Contacted, Booked, Not interested) and notes. The overview shows lead counts for today, this week (from Monday) and this month, in `LEADS_TIMEZONE`.
- **Isolation:** clients can read leads, alerts and alert settings only for their own business, and can change only a lead's status, notes and seen time. Only the server creates leads.

### Check it

With the app running (`npm run dev`):

```bash
npm run test:leads -- --out leads-results.md --screenshots leads-screenshots
```

This creates two temporary clinics. In real browsers it chats about booking and submits the form from the offer, from the quick reply on desktop, and on a phone. It checks that invalid numbers and missing consent are blocked (in the widget and on the server), and that duplicates are blocked, including three simultaneous submissions. It checks the alert email is sent to the address set in Business Info, then uses the Leads dashboard: counts, New badges, the lead page with its chat, status and notes, search, filters and CSV export. Finally it confirms neither clinic can see or change the other's leads. Set `LEAD_TEST_EMAIL` to the address that should receive the test alert (your Resend account address, or Resend's test inbox `delivered@resend.dev`, the default). With a full-access Resend key the test also reads the sent email back and checks its contents; with a sending-only key the contents are covered by `npm run test:unit`.

---

## 9. Client dashboard

### Set up

1. **Run the seventh migration.** In the Supabase **SQL Editor**, paste [`supabase/migrations/20261102000000_dashboard.sql`](supabase/migrations/20261102000000_dashboard.sql) and click **Run**. It adds the page address to conversations and an "installed" time to widget settings, creates `knowledge_gaps` and `knowledge_gap_questions` with Row Level Security, and adds the `conversation_list` and `dashboard_daily` functions (both run with the signed-in client's permissions).
2. Restart `npm run dev`.

### How it works

- **Navigation:** one sidebar for every page (Overview, Conversations, Leads, Knowledge gaps, Test Assistant, Business Info, Documents, Widget, API Key, Settings), with counts of new leads and open gaps. On phones and tablets it folds into a menu button. Every dashboard page has a loading state, an error state with "Try again", and a not-found page.
- **Overview:** conversations, visitor messages, leads and lead conversion (leads per conversation) for today, this week (from Monday) and this month; monthly usage against the limit, with a warning from 80% and a clear notice at 100% (the assistant has stopped answering); bar charts of conversations and leads per day for the last 30 days (hover, tap or use the arrow keys to read a day, or show them as a table); and the latest 5 leads. Only website conversations count, never Test Assistant ones. A conversation counts on the day it started. Days follow `LEADS_TIMEZONE`; the monthly limit follows calendar months in UTC, as the public API enforces it.
- **Setup checklist** (until everything is done): Business Info filled (a contact detail and opening hours), a document uploaded, a domain allowed, the widget installed, and the first website conversation. "Widget installed" completes by itself the first time the widget loads on one of the client's allowed websites (localhost in test mode does not count).
- **Conversations:** every website chat, newest first, with its date, number of messages, first visitor message, page and a **Lead** badge. Search covers every message and reply; filters for date and "has a lead"; open one to read the whole chat; **Export CSV** gives one row per message with the same filters.
- **Knowledge gaps:** when the assistant has to say the clinic will confirm a fact about the business (a fee, a timing, parking…), it adds a hidden `[[UNANSWERED|category|topic]]` tag that the server removes from the reply. After the reply is sent, the topic is embedded and the database adds the question to the most similar open gap of the same category (similarity of 0.85 or more), or starts a new one. Measured with Voyage: rewordings of the same question score 0.93 to 0.98; different questions in the same category at most 0.72. Each gap shows how often it was asked and what visitors wrote, with a button to the exact Business Info section (or to Documents), and **Mark as resolved**. A resolved gap opens again if visitors keep asking and the assistant still cannot answer.
- **Settings:** your name and business name, business details, login email (needs the current password; Supabase sends a confirmation link to the new address), password (needs the current password), and **Delete account**: after typing DELETE and the password, it deletes the stored documents and logo, then the user, which removes the business and, by cascade, every conversation, lead, document, key, domain, setting and gap. The public key stops working at once.
- **Reliability:** reads from Supabase are retried once when a connection fails before any answer arrives (an idle kept-alive connection closed by the other side). Writes are never retried.

### Check it

With the app running (`npm run dev`):

```bash
npm run test:dashboard -- --out dashboard-results.md --screenshots dashboard-screenshots
```

This creates two temporary clinics. It completes the setup checklist step by step (Business Info, a document upload, the widget loading on the sample website, and a conversation), chats with the assistant as three visitors (including a lead and questions it cannot answer), and checks every overview number and chart bar against the database. It checks the usage warnings at 80% and 100%, the Conversations page (order, badges, search, filters, the full chat, CSV), and that knowledge gaps are detected, grouped, linked and resolved. It confirms clinic B sees none of clinic A's data, that all 13 pages fit a phone screen and the phone menu works, and that profile, email and password changes work. Finally it deletes clinic A through **Delete account** and checks that nothing is left in any table or storage. It takes about ten minutes.

---

## How data isolation works

Every request to Supabase is made as the signed-in user. The database itself decides what that user may see, so a bug in the app cannot leak one client's data to another.

- **Row Level Security** is enabled on `public.clients`. Clients can select, insert and update only the row whose `user_id` matches their own account. There is no delete policy. A business is removed only when its account is deleted.
- **Column privileges:** signed-in clients may write only `business_name`, `industry` and `website_domain`. The `user_id` is always filled in by the database from the session, so a client cannot create or move a business into someone else's account.
- **No anonymous access:** signed-out visitors have no privileges on the table at all.
- **One business per account:** `user_id` is unique.
- **Storage:** files in the private `documents` bucket must be stored under `<client id>/...`, and each client can only read and write inside its own folder.
- **Server checks:** pages and server actions verify the session on every request. The proxy (`src/proxy.ts`) refreshes the session cookie and redirects signed-out visitors. This is for convenience only; access control is enforced by the database.

When you add tables in later steps, enable Row Level Security on each one and add a policy that ties rows to the client. `npm run test:db` fails if any table in the `public` schema has Row Level Security turned off.

---

## Project structure

```
src/
  app/
    page.tsx                  Home page
    (auth)/login, signup      Sign-in and sign-up pages
    auth/confirm/route.ts     Handles the email confirmation link
    (app)/onboarding          Business details form (first visit)
    (app)/dashboard           Overview, Conversations, Leads, Knowledge gaps, Test Assistant, Business Info,
                              Documents, Widget, API Key, Settings (sidebar layout, loading and error states)
    api/chat/route.ts         Chat API for the dashboard (streams the assistant's reply)
    api/public/chat/route.ts  Public chat API for websites (key, domain lock, CORS, limits)
    api/public/widget/        Widget settings for websites (same key and domain checks)
    api/widget/logo/          Widget logo upload and removal
    api/public/leads/         Appointment requests from websites
    api/leads/export/         Leads as CSV
    api/conversations/export/ Conversations as CSV
    api/documents/            Document upload, list, replace and delete
    actions/                  Server actions for auth, business details and Business Info
  components/                 UI building blocks, forms, document manager and chat panel
  lib/
    business.ts               Industries, domain normalization, validation
    business-profile.ts       Business Info fields, validation and how they are given to the assistant
    data.ts                   Server-side data access (current user, business, Business Info)
    chat/                     Prompt layers, Claude streaming, document search, pack and history loading
    documents/                Text extraction, chunking and background processing
    embeddings.ts             Embedding provider (Voyage AI by default)
    public-api/               Key lookup, allowed-domain rules, CORS, rate limits and rejection log
    widget.ts                 Widget settings limits and validation
    leads.ts, leads-query.ts  Request form rules, mobile numbers, lead search and filters
    notifications/            Lead alerts by channel (email with Resend)
    dashboard-data.ts         Overview numbers, setup checklist, conversations and knowledge gaps
    chat/hidden-tags.ts       Tags the assistant adds for the server (request form, unanswered questions)
    supabase/                 Supabase clients (including the server-only admin client), table types
  proxy.ts                    Session refresh and route protection
supabase/migrations/          Database schema, policies and storage setup
supabase/packs/               Industry knowledge packs (source files for npm run packs:sync)
scripts/                      Pack sync, assistant evaluations and the public API test
tests/db/                     Offline Row Level Security tests
tests/unit/                   Document extraction, chunking and domain lock tests
tests/public-api/             Domain check page for the public chat API
tests/widget/site/            Sample clinic website with aggressive CSS, for the widget test
public/widget.js              The website chat widget
tests/e2e/                    Browser and live Supabase tests
```

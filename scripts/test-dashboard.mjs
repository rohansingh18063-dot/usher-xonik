// End-to-end test of the client dashboard: overview stats and charts, usage
// warnings, the setup checklist (including "widget installed"), the
// Conversations page, knowledge gaps, account settings, deleting an account,
// isolation between two clinics, and every page on a phone.
//
// It creates two temporary dentist clinics (no sign-up email is sent), chats
// with clinic A's assistant on the sample website in a real browser, checks
// every number on the dashboard against the database, and deletes both
// clinics (clinic A through the dashboard's own "Delete account").
//
// Requirements: the app running (npm run dev), all migrations applied, packs
// synced, and ANTHROPIC_API_KEY, EMBEDDING_API_KEY and SUPABASE_SECRET_KEY set.
//
// Run with: npm run test:dashboard [-- --out results.md] [--screenshots dir]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { serveSampleSite } from "./serve-sample-site.mjs";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File not present.
  }
}

const baseUrl = (process.env.EVAL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const outFile = argument("--out");
const screenshotDir = argument("--screenshots");
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

const TIME_ZONE = process.env.LEADS_TIMEZONE?.trim() || "Asia/Kolkata";
const SITE_PORT = 5600;
const CLINIC_A = { name: "Smile Care Dental Clinic", domain: "smilecare-dental.com" };
const CLINIC_B = { name: "Bright Teeth Dental Studio", domain: "brightteeth-studio.com" };
const SITE = `http://${CLINIC_A.domain}:${SITE_PORT}`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

const short = (text) => (text ?? "").replace(/\s+/g, " ").slice(0, 150);
const dayIn = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createClinic(clinic) {
  const email = `wa-dash-${clinic.domain.split(".")[0]}-${Date.now().toString(36)}@example.com`;
  const password = `Dash-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ user_id: data.user.id, business_name: clinic.name, industry: "dentist", website_domain: clinic.domain })
    .select("id")
    .single();
  if (clientError) throw new Error(`Could not create a test client: ${clientError.message}`);
  const { data: key } = await admin.from("api_keys").select("public_key").eq("client_id", client.id).single();
  const user = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await user.auth.signInWithPassword({ email, password });
  return { ...clinic, email, password, userId: data.user.id, clientId: client.id, key: key.public_key, user };
}

async function signIn(browser, clinic, options = { viewport: { width: 1360, height: 900 } }) {
  const context = await browser.newContext({ ...options, timezoneId: TIME_ZONE, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(clinic.email);
  await page.getByLabel("Password").fill(clinic.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

const widget = (page) => page.locator("chat-widget-root");
const inWidget = (page, selector, options) => widget(page).locator(selector, options);

// Each visitor message uses up to two embeddings (document search, and the
// knowledge gap). Without a payment method, Voyage allows 3 requests a
// minute, so messages are spaced out. Set CHAT_SPACING_MS=0 on a paid plan.
const CHAT_SPACING = Number(process.env.CHAT_SPACING_MS ?? 40_000);
let lastAsked = 0;
const CONNECTION_PROBLEM = /^(This chat isn't available on this website|We couldn't reach the assistant)/;

/** Opens the widget on the sample website and asks one question; returns the reply. */
async function ask(page, question) {
  const reply = await askOnce(page, question);
  if (!CONNECTION_PROBLEM.test(reply)) return reply;
  console.log(`      (the connection dropped; asking "${question}" again)`);
  return askOnce(page, question);
}

async function askOnce(page, question) {
  await wait(Math.max(0, lastAsked + CHAT_SPACING - Date.now()));
  lastAsked = Date.now();
  await inWidget(page, ".launcher").waitFor({ timeout: 30_000 });
  if (await inWidget(page, ".panel").isHidden()) await inWidget(page, ".launcher").click();
  await inWidget(page, "#input").fill(question);
  await inWidget(page, "#input").press("Enter");
  await page.waitForFunction(
    () => {
      const log = document.querySelector("chat-widget-root")?.shadowRoot?.querySelector(".messages");
      return log && !log.hasAttribute("aria-busy");
    },
    null,
    { timeout: 90_000 },
  );
  return (await inWidget(page, ".bubble .text").last().textContent()).trim();
}

/** What the overview should show, worked out from the raw rows in the database. */
async function expectedStats(clinic) {
  const [{ data: turns }, { data: leads }] = await Promise.all([
    admin.from("conversations").select("session_id, created_at").eq("client_id", clinic.clientId).eq("channel", "website"),
    admin.from("leads").select("created_at").eq("client_id", clinic.clientId),
  ]);
  const started = new Map();
  for (const turn of turns) {
    if (!started.has(turn.session_id) || turn.created_at < started.get(turn.session_id)) started.set(turn.session_id, turn.created_at);
  }
  const today = dayIn(new Date().toISOString());
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = { today, week: addDays(today, -weekday), month: `${today.slice(0, 8)}01` };
  const count = (dates, since) => dates.filter((iso) => dayIn(iso) >= since).length;
  const periods = {};
  for (const [period, since] of Object.entries(from)) {
    const conversations = count([...started.values()], since);
    const leadCount = count(leads.map((lead) => lead.created_at), since);
    periods[period] = {
      conversations: String(conversations),
      messages: String(count(turns.map((turn) => turn.created_at), since)),
      leads: String(leadCount),
      conversion: conversations ? `${Math.round((leadCount / conversations) * 100)}%` : "—",
    };
  }
  const chart = { conversations: {}, leads: {} };
  for (let index = 29; index >= 0; index--) {
    const day = addDays(today, -index);
    chart.conversations[day] = [...started.values()].filter((iso) => dayIn(iso) === day).length;
    chart.leads[day] = leads.filter((lead) => dayIn(lead.created_at) === day).length;
  }
  return { periods, chart, sessions: started.size, messages: turns.length };
}

async function shownStats(page) {
  const periods = {};
  for (const period of ["today", "week", "month"]) {
    periods[period] = {};
    for (const stat of ["conversations", "messages", "leads", "conversion"]) {
      periods[period][stat] = (await page.getByTestId(`stat-${stat}`).locator(`[data-period="${period}"] dd`).textContent()).trim();
    }
  }
  const chart = {};
  for (const series of ["conversations", "leads"]) {
    chart[series] = Object.fromEntries(
      await page
        .getByTestId(`chart-${series}-bar`)
        .evaluateAll((bars) => bars.map((bar) => [bar.dataset.day, Number(bar.dataset.value)])),
    );
  }
  return { periods, chart };
}

async function checklist(page) {
  await page.goto(`${baseUrl}/dashboard`);
  if ((await page.getByTestId("setup-checklist").count()) === 0) return null;
  const state = {};
  for (const id of ["business-info", "document", "domain", "widget", "conversation"]) {
    state[id] = (await page.getByTestId(`checklist-${id}`).getAttribute("data-done")) === "true";
  }
  return state;
}

async function exportCsv(page, search = "") {
  await page.goto(`${baseUrl}/dashboard/conversations${search}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  const text = readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
  const rows = [];
  for (const match of text.matchAll(/((?:"(?:[^"]|"")*",?)+)\r\n/g)) {
    rows.push([...match[1].matchAll(/"((?:[^"]|"")*)"/g)].map((cell) => cell[1].replaceAll('""', '"')));
  }
  return { header: rows[0], rows: rows.slice(1) };
}

const listedSessions = (page) => page.getByTestId("conversation-row").evaluateAll((rows) => rows.map((row) => row.dataset.session));

async function shot(page, name, fullPage = false) {
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage });
}

async function waitFor(condition, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await wait(1000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function run(a, b, browser) {
  const owner = await signIn(browser, a);

  console.log("\n1. Setup checklist");
  const initial = await checklist(owner);
  check(
    "A new clinic sees the checklist with only the domain done",
    JSON.stringify(initial) === JSON.stringify({ "business-info": false, document: false, domain: true, widget: false, conversation: false }),
    JSON.stringify(initial),
  );
  const links = await owner.getByTestId("setup-checklist").locator("xpath=..").getByRole("link").evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  check(
    "Each open item links to the page that completes it",
    JSON.stringify(links) === JSON.stringify(["/dashboard/business-info", "/dashboard/documents", "/dashboard/widget", "/dashboard/widget"]),
    links.join(", "),
  );
  await shot(owner, "1-checklist-new-clinic", true);

  await admin.from("business_profiles").insert({
    client_id: a.clientId,
    phone: "+91 98450 00000",
    address: "12 MG Road, Bengaluru",
    opening_hours: { monday: "10:00 AM - 6:00 PM", tuesday: "10:00 AM - 6:00 PM", saturday: "10:00 AM - 2:00 PM" },
  });
  await owner.goto(`${baseUrl}/dashboard/documents`);
  await owner.waitForLoadState("networkidle");
  await owner.getByTestId("upload-input").setInputFiles({
    name: "about-the-clinic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Smile Care Dental Clinic has three treatment rooms and a children's corner. We use digital X-rays."),
  });
  await waitFor(async () => (await admin.from("documents").select("id").eq("client_id", a.clientId)).data?.length);

  const server = await serveSampleSite({ port: SITE_PORT, key: a.key, widgetSrc: `${baseUrl}/widget.js` });
  const blocked = await browser.newContext();
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(`http://evil-example.com:${SITE_PORT}/`);
  await wait(3000);
  await blocked.close();
  const afterBlocked = await checklist(owner);

  const visitor1 = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: TIME_ZONE });
  const page1 = await visitor1.newPage();
  await page1.goto(`${SITE}/`);
  await inWidget(page1, ".launcher").waitFor({ timeout: 30_000 });
  const installed = await waitFor(async () => {
    const { data } = await admin.from("widget_settings").select("installed_at, installed_origin").eq("client_id", a.clientId).single();
    return data?.installed_at ? data : null;
  });
  const afterInstall = await checklist(owner);
  check(
    "\"Widget installed\" completes by itself when the widget loads on an allowed domain (not on another domain)",
    afterBlocked.widget === false && afterInstall.widget === true && installed?.installed_origin === SITE &&
      afterInstall["business-info"] && afterInstall.document && !afterInstall.conversation,
    `after a page view on another domain: ${afterBlocked.widget}; after ${SITE}: ${afterInstall.widget}; Business Info: ${afterInstall["business-info"]}, document: ${afterInstall.document}`,
  );

  console.log("\n2. Conversations from visitors");
  const replies = {};
  replies.whitening = await ask(page1, "How much does teeth whitening cost at your clinic?");
  replies.sunday = await ask(page1, "Are you open on Sunday?");
  await inWidget(page1, ".restart").click();
  replies.book = await ask(page1, "I'd like to book an appointment please");
  const offer = inWidget(page1, ".bubble .offer");
  if (await offer.isVisible()) {
    await offer.click();
    await inWidget(page1, "#lead-name").fill("Priya Sharma");
    await inWidget(page1, "#lead-mobile").fill("9845012345");
    await inWidget(page1, "#lead-date").fill(addDays(dayIn(new Date().toISOString()), 2));
    await inWidget(page1, ".times label", { hasText: "Morning" }).click();
    await inWidget(page1, "#lead-consent").check();
    await inWidget(page1, ".lead-submit").click();
    await inWidget(page1, ".lead").waitFor({ state: "hidden", timeout: 30_000 });
  }
  const visitor2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: TIME_ZONE });
  const page2 = await visitor2.newPage();
  await page2.goto(`${SITE}/about.html`);
  replies.whitening2 = await ask(page2, "What is the price for whitening my teeth?");
  const visitor3 = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: TIME_ZONE });
  const page3 = await visitor3.newPage();
  await page3.goto(`${SITE}/`);
  replies.parking = await ask(page3, "Is there parking near the clinic?");
  console.log(`      (replies: ${Object.entries(replies).map(([key, value]) => `${key}: "${short(value).slice(0, 70)}"`).join("; ")})`);
  await Promise.all([visitor1.close(), visitor2.close(), visitor3.close()]);
  server.close();

  const finalChecklist = await checklist(owner);
  check("The checklist disappears once every item is complete", finalChecklist === null, finalChecklist ? JSON.stringify(finalChecklist) : "checklist no longer shown");

  console.log("\n3. Overview numbers");
  const expected = await expectedStats(a);
  await owner.goto(`${baseUrl}/dashboard`);
  const shown = await shownStats(owner);
  check(
    "Conversations, visitor messages, leads and conversion match the database for today, this week and this month",
    JSON.stringify(shown.periods) === JSON.stringify(expected.periods),
    `today ${JSON.stringify(shown.periods.today)}; month ${JSON.stringify(shown.periods.month)}`,
  );
  check(
    "Both charts show the last 30 days, matching the database day by day",
    JSON.stringify(shown.chart) === JSON.stringify(expected.chart) && Object.keys(shown.chart.conversations).length === 30,
    `30 days each; today: ${shown.chart.conversations[dayIn(new Date().toISOString())]} conversations, ${shown.chart.leads[dayIn(new Date().toISOString())]} lead(s)`,
  );
  const latest = await owner.getByTestId("latest-leads").locator("a").evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  const { data: dbLeads } = await admin.from("leads").select("id").eq("client_id", a.clientId).order("created_at", { ascending: false }).limit(5);
  check(
    "The latest leads link to each lead",
    JSON.stringify(latest) === JSON.stringify(dbLeads.map((lead) => `/dashboard/leads/${lead.id}`)) && latest.length > 0,
    `${latest.length} lead(s): ${latest.join(", ")}`,
  );
  await shot(owner, "2-overview", true);

  console.log("\n4. Usage warnings");
  const used = expected.messages;
  const usageAt = async (limit) => {
    await admin.from("clients").update({ monthly_message_limit: limit }).eq("id", a.clientId);
    await owner.goto(`${baseUrl}/dashboard`);
    const usage = owner.getByTestId("usage");
    return {
      level: await usage.getAttribute("data-level"),
      warning: (await usage.getByTestId("usage-warning").count()) ? (await usage.getByTestId("usage-warning").textContent()).trim() : null,
      used: (await owner.getByTestId("usage-used").textContent()).trim(),
    };
  };
  const below = await usageAt(used * 2);
  const eightyLimit = Math.floor(used / 0.8);
  const eighty = await usageAt(eightyLimit);
  await shot(owner, "3-usage-80", false);
  const atLimit = await usageAt(used);
  await owner.getByTestId("usage").scrollIntoViewIfNeeded();
  await shot(owner, "4-usage-100", false);
  const overLimit = await usageAt(Math.max(1, used - 1));
  await admin.from("clients").update({ monthly_message_limit: 1000 }).eq("id", a.clientId);
  check(
    "Usage shows messages used against the limit, with no warning below 80%",
    below.level === "normal" && below.warning === null && below.used === String(used),
    `${used} used of ${used * 2}: ${below.level}`,
  );
  check(
    "A warning shows from 80%",
    eighty.level === "warning" && /You have used (8\d|9\d)% of this month/.test(eighty.warning),
    `${used} of ${eightyLimit} (${Math.round((used / eightyLimit) * 100)}%): "${short(eighty.warning)}"`,
  );
  check(
    "At 100% (and above) the warning says the assistant has stopped answering",
    atLimit.level === "limit" && atLimit.warning.includes("Monthly limit reached") && overLimit.level === "limit",
    `${used} of ${used}: "${short(atLimit.warning)}"`,
  );

  console.log("\n5. Conversations page");
  await owner.goto(`${baseUrl}/dashboard/conversations`);
  const { data: rows } = await admin.from("conversations").select("session_id, visitor_message, page_url, created_at").eq("client_id", a.clientId).eq("channel", "website").order("created_at");
  const sessions = [...new Map(rows.map((row) => [row.session_id, row])).keys()];
  const firstBySession = new Map();
  for (const row of rows) if (!firstBySession.has(row.session_id)) firstBySession.set(row.session_id, row);
  const newestFirst = [...firstBySession.values()].sort((x, y) => y.created_at.localeCompare(x.created_at)).map((row) => row.session_id);
  const listed = await listedSessions(owner);
  const { data: leadSessions } = await admin.from("leads").select("conversation_id").eq("client_id", a.clientId);
  const withLead = new Set(leadSessions.map((lead) => lead.conversation_id));
  const badges = await owner.getByTestId("conversation-row").evaluateAll((items) =>
    items.map((item) => [item.dataset.session, item.textContent.includes("Lead")]),
  );
  const pageShown = await owner.getByTestId("conversation-row").filter({ hasText: "What is the price for whitening" }).textContent();
  check(
    "All conversations are listed newest first, with message counts, first message, page and Lead badge",
    JSON.stringify(listed) === JSON.stringify(newestFirst) &&
      badges.every(([session, badge]) => badge === withLead.has(session)) &&
      pageShown.includes(`${CLINIC_A.domain}:${SITE_PORT}/about.html`),
    `${listed.length} conversations; with a Lead badge: ${badges.filter(([, badge]) => badge).length}`,
  );
  await shot(owner, "5-conversations", true);

  const search = async (query) => {
    await owner.goto(`${baseUrl}/dashboard/conversations?${query}`);
    return listedSessions(owner);
  };
  const parkingSession = firstBySession.get(rows.find((row) => row.visitor_message.includes("parking")).session_id).session_id;
  const today = dayIn(new Date().toISOString());
  const searches = {
    parking: await search("q=PARKING"),
    sunday: await search("q=sunday"),
    nothing: await search("q=braces%20for%20my%20cat"),
    withLead: await search("lead=yes"),
    withoutLead: await search("lead=no"),
    today: await search(`from=${today}&to=${today}`),
    tomorrow: await search(`from=${addDays(today, 1)}`),
  };
  check(
    "Search by text and filters by date and lead work",
    JSON.stringify(searches.parking) === JSON.stringify([parkingSession]) &&
      searches.sunday.length === 1 &&
      searches.nothing.length === 0 &&
      searches.withLead.every((session) => withLead.has(session)) &&
      searches.withLead.length === [...withLead].filter((session) => sessions.includes(session)).length &&
      searches.withoutLead.every((session) => !withLead.has(session)) &&
      searches.withLead.length + searches.withoutLead.length === sessions.length &&
      searches.today.length === sessions.length &&
      searches.tomorrow.length === 0,
    Object.entries(searches).map(([key, value]) => `${key}: ${value.length}`).join(", "),
  );

  const firstSession = firstBySession.get(rows.find((row) => row.visitor_message.includes("teeth whitening cost")).session_id).session_id;
  await owner.goto(`${baseUrl}/dashboard/conversations/${firstSession}`);
  const messages = await owner.getByTestId("conversation-messages").textContent();
  const sessionTurns = rows.filter((row) => row.session_id === firstSession);
  check(
    "Opening a conversation shows the full chat",
    sessionTurns.every((turn) => messages.includes(turn.visitor_message)) && messages.includes(replies.whitening.slice(0, 40)) && messages.includes(replies.sunday.slice(0, 40)),
    `${sessionTurns.length} messages shown, with the assistant's replies`,
  );
  await shot(owner, "6-conversation", true);

  const all = await exportCsv(owner);
  const leadOnly = await exportCsv(owner, "?lead=yes");
  check(
    "CSV export has every message, and follows the filters",
    all.header?.join("|") === "Conversation|Time|Visitor message|Assistant reply|Page|Lead" &&
      all.rows.length === rows.length &&
      leadOnly.rows.every((row) => row[5] === "Yes" && withLead.has(row[0])) &&
      leadOnly.rows.length === rows.filter((row) => withLead.has(row.session_id)).length,
    `${all.rows.length} message rows; with lead only: ${leadOnly.rows.length}`,
  );

  console.log("\n6. Knowledge gaps");
  const gaps = await waitFor(async () => {
    const { data } = await admin.from("knowledge_gaps").select("id, category, topic, question_count, status").eq("client_id", a.clientId);
    const whitening = data?.find((gap) => /whiten/i.test(gap.topic));
    return whitening?.question_count >= 2 ? data : null;
  }, 45_000);
  const { data: allGaps } = await admin.from("knowledge_gaps").select("id, category, topic, question_count, status").eq("client_id", a.clientId);
  const whiteningGap = allGaps.find((gap) => /whiten/i.test(gap.topic));
  check(
    "Questions the assistant could not answer are detected, and similar ones are grouped",
    Boolean(gaps) && whiteningGap?.category === "fees" && whiteningGap.question_count === 2 && allGaps.filter((gap) => /whiten/i.test(gap.topic)).length === 1,
    allGaps.map((gap) => `"${gap.topic}" (${gap.category}) ×${gap.question_count}`).join("; "),
  );

  await owner.goto(`${baseUrl}/dashboard/gaps`);
  const card = owner.getByTestId("gap").filter({ hasText: whiteningGap.topic });
  const cardText = await card.textContent();
  check(
    "The Knowledge gaps page shows each gap with how often it was asked and what visitors asked",
    cardText.includes("Asked 2 times") && cardText.includes("How much does teeth whitening cost") && cardText.includes("What is the price for whitening"),
    short(cardText),
  );
  await shot(owner, "7-knowledge-gaps", true);
  await card.getByRole("link", { name: "Add fees in Business Info" }).click();
  await owner.waitForURL(/\/dashboard\/business-info#fees$/);
  await owner.locator('#fees[data-highlighted="true"]').waitFor({ timeout: 15_000 }).catch(() => {});
  const fees = await owner.locator("#fees").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { inView: box.top < window.innerHeight && box.bottom > 0, highlighted: node.dataset.highlighted === "true" };
  });
  check(
    "The gap's button opens the right part of Business Info",
    fees.inView && fees.highlighted,
    `${owner.url().replace(baseUrl, "")}; Fees section in view: ${fees.inView}, highlighted: ${fees.highlighted}`,
  );

  await owner.goto(`${baseUrl}/dashboard/gaps`);
  await owner.getByRole("button", { name: `Mark as resolved: ${whiteningGap.topic}` }).click();
  await owner.getByTestId("gap").filter({ hasText: whiteningGap.topic }).waitFor({ state: "detached", timeout: 15_000 });
  const { data: resolved } = await admin.from("knowledge_gaps").select("status, resolved_at").eq("id", whiteningGap.id).single();
  await owner.goto(`${baseUrl}/dashboard/gaps?status=resolved`);
  const inResolved = await owner.getByTestId("gap").filter({ hasText: whiteningGap.topic }).count();
  check(
    "A gap can be marked as resolved",
    resolved.status === "resolved" && Boolean(resolved.resolved_at) && inResolved === 1,
    `status ${resolved.status}; listed under Resolved: ${inResolved === 1}`,
  );

  console.log("\n7. Isolation between clinics");
  const bResponse = await fetch(`${baseUrl}/api/public/chat?key=${b.key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: `https://${b.domain}`, "X-Forwarded-For": "198.51.100.77" },
    body: JSON.stringify({ sessionId: crypto.randomUUID(), message: "Do you treat children?", pageUrl: `https://${b.domain}/kids` }),
  });
  await bResponse.text();
  const other = await signIn(browser, b);
  const bShown = await shownStats(other);
  const bExpected = await expectedStats(b);
  await other.goto(`${baseUrl}/dashboard/conversations`);
  const bSessions = await listedSessions(other);
  const bLatestLeads = await other.goto(`${baseUrl}/dashboard`).then(() => other.getByTestId("latest-leads").count());
  await other.goto(`${baseUrl}/dashboard/conversations/${firstSession}`);
  const notFound = await other.getByTestId("not-found").isVisible();
  await other.goto(`${baseUrl}/dashboard/gaps`);
  const bGapTopics = await other.getByTestId("gap-topic").allTextContents();
  const { data: bOwnGaps } = await admin.from("knowledge_gaps").select("topic").eq("client_id", b.clientId).eq("status", "open");
  const aTopics = new Set(allGaps.map((gap) => gap.topic));
  const bCsv = await exportCsv(other);
  const { data: bList } = await b.user.rpc("conversation_list", {});
  const { data: bDaily } = await b.user.rpc("dashboard_daily", { p_from: today, p_to: today, p_time_zone: TIME_ZONE });
  const { data: bReadsGaps } = await b.user.from("knowledge_gaps").select("id").eq("client_id", a.clientId);
  check(
    "Clinic B sees only its own data on every page, and nothing of clinic A's",
    JSON.stringify(bShown.periods) === JSON.stringify(bExpected.periods) &&
      bShown.periods.today.conversations === "1" &&
      bSessions.length === 1 &&
      !bSessions.some((session) => sessions.includes(session)) &&
      bLatestLeads === 0 &&
      notFound &&
      bGapTopics.length === bOwnGaps.length &&
      !bGapTopics.some((topic) => aTopics.has(topic) && !bOwnGaps.some((own) => own.topic === topic)) &&
      bCsv.rows.length === 1 &&
      bList.length === 1 &&
      bDaily[0].conversations === 1 &&
      bDaily[0].leads === 0 &&
      bReadsGaps.length === 0,
    `B's overview today: ${JSON.stringify(bShown.periods.today)}; conversations: ${bSessions.length}; A's conversation for B: ${notFound ? "not found" : "visible"}; ` +
      `gaps: ${bGapTopics.length} of its own (${bGapTopics.join(", ") || "none"}); CSV rows: ${bCsv.rows.length}; direct database reads of A's data: ${bReadsGaps.length}`,
  );
  await other.context().close();

  console.log("\n8. Every page on a phone");
  const phone = await signIn(browser, a, { ...devices["iPhone 13"] });
  const { data: aLead } = await admin.from("leads").select("id").eq("client_id", a.clientId).limit(1).single();
  const pages = [
    "/dashboard",
    "/dashboard/conversations",
    `/dashboard/conversations/${firstSession}`,
    "/dashboard/leads",
    `/dashboard/leads/${aLead.id}`,
    "/dashboard/gaps",
    "/dashboard/assistant",
    "/dashboard/business-info",
    "/dashboard/documents",
    "/dashboard/widget",
    "/dashboard/api-key",
    "/dashboard/settings",
    "/dashboard/edit",
  ];
  const problems = [];
  for (const path of pages) {
    await phone.goto(`${baseUrl}${path}`);
    await phone.locator("h1").first().waitFor({ timeout: 30_000 });
    const layout = await phone.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarHidden: getComputedStyle(document.querySelector("aside")).display === "none",
    }));
    if (layout.overflow > 1 || !layout.sidebarHidden) problems.push(`${path}: ${JSON.stringify(layout)}`);
    if (path === "/dashboard" || path === "/dashboard/conversations" || path === "/dashboard/gaps") {
      await shot(phone, `8-phone${path.replaceAll("/", "-")}`, true);
    }
  }
  check(
    "All 13 dashboard pages fit a phone screen (no sideways scrolling, sidebar folded away)",
    problems.length === 0,
    problems.length ? problems.join("; ") : pages.join(", "),
  );
  await phone.goto(`${baseUrl}/dashboard`);
  await phone.getByRole("button", { name: "Open menu" }).click();
  const menu = phone.getByRole("dialog", { name: "Menu" });
  await menu.waitFor();
  await shot(phone, "9-phone-menu");
  const menuLinks = await menu.getByRole("link").allTextContents();
  await menu.getByRole("link", { name: /Knowledge gaps/ }).click();
  await phone.waitForURL(/\/dashboard\/gaps$/);
  const menuClosed = (await phone.getByRole("dialog", { name: "Menu" }).count()) === 0;
  check(
    "On a phone the menu opens, lists every page and closes after choosing one",
    ["Overview", "Conversations", "Leads", "Knowledge gaps", "Test Assistant", "Business Info", "Documents", "Widget", "API Key", "Settings"].every((label) =>
      menuLinks.some((link) => link.startsWith(label)),
    ) && menuClosed,
    `${menuLinks.length} links; closed after navigating: ${menuClosed}`,
  );
  await phone.context().close();

  console.log("\n9. Account settings");
  await owner.goto(`${baseUrl}/dashboard/settings`);
  await owner.getByLabel("Your name").fill("Dr. Ananya Rao");
  await owner.getByLabel("Business name").fill("Smile Care Dental Studio");
  await owner.getByRole("button", { name: "Save profile" }).click();
  await owner.getByText("Profile saved.").waitFor({ timeout: 15_000 });
  const { data: renamed } = await admin.from("clients").select("business_name").eq("id", a.clientId).single();
  const { data: profileUser } = await admin.auth.admin.getUserById(a.userId);
  await owner.reload();
  const navName = await owner.getByTestId("nav-business-name").textContent();
  check(
    "Profile and business name can be changed",
    renamed.business_name === "Smile Care Dental Studio" && profileUser.user.user_metadata.full_name === "Dr. Ananya Rao" && navName === "Smile Care Dental Studio",
    `business "${renamed.business_name}", name "${profileUser.user.user_metadata.full_name}", sidebar "${navName}"`,
  );

  const emailBox = owner.getByLabel("New login email");
  await emailBox.fill("not-an-email");
  await owner.getByRole("button", { name: "Change login email" }).click();
  const badEmail = await owner.getByText("Enter a valid email address.").waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await emailBox.fill(`changed-${a.email}`);
  await owner.locator("form").filter({ has: emailBox }).getByLabel("Current password").fill("wrong-password");
  await owner.getByRole("button", { name: "Change login email" }).click();
  const wrongEmailPassword = await owner.getByText("Your password is not correct.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const { data: emailUser } = await admin.auth.admin.getUserById(a.userId);
  check(
    "Changing the login email needs a valid address and the current password",
    badEmail && wrongEmailPassword && emailUser.user.email === a.email && (await emailBox.inputValue()) === `changed-${a.email}`,
    `invalid address refused: ${badEmail}; wrong password refused: ${wrongEmailPassword}; email unchanged: ${emailUser.user.email === a.email}`,
  );

  const passwordForm = owner.locator("form").filter({ has: owner.getByLabel("Repeat new password") });
  const newPassword = `${a.password}-New`;
  await passwordForm.getByLabel("Current password").fill("wrong-password");
  await passwordForm.getByLabel("New password", { exact: true }).fill(newPassword);
  await passwordForm.getByLabel("Repeat new password").fill(newPassword);
  await owner.getByRole("button", { name: "Change password" }).click();
  const wrongCurrent = await owner.getByText("Your current password is not correct.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
  await passwordForm.getByLabel("Current password").fill(a.password);
  await owner.getByRole("button", { name: "Change password" }).click();
  const changed = await owner.getByText("Password changed.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const tryLogin = async (password) => {
    const client = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: a.email, password });
    if (!error) await client.auth.signOut({ scope: "local" });
    return !error;
  };
  const oldWorks = await tryLogin(a.password);
  const newWorks = await tryLogin(newPassword);
  check(
    "Password change needs the current password; afterwards only the new one works",
    wrongCurrent && changed && !oldWorks && newWorks,
    `wrong current password refused: ${wrongCurrent}; changed: ${changed}; old password works: ${oldWorks}; new password works: ${newWorks}`,
  );
  a.password = newPassword;
  await shot(owner, "10-settings", true);

  console.log("\n10. Delete account");
  // A logo, so deleting is checked for every kind of stored file.
  const logoPath = `${crypto.randomUUID()}.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await admin.storage.from("widget-logos").upload(logoPath, png, { contentType: "image/png" });
  await admin.from("widget_settings").update({ logo_path: logoPath }).eq("client_id", a.clientId);

  const TABLES = [
    "clients",
    "business_profiles",
    "documents",
    "document_chunks",
    "conversations",
    "leads",
    "lead_notifications",
    "api_keys",
    "allowed_domains",
    "widget_settings",
    "notification_settings",
    "knowledge_gaps",
    "knowledge_gap_questions",
    "public_api_rejections",
  ];
  const countRows = async () => {
    const counts = {};
    for (const table of TABLES) {
      const column = table === "clients" ? "id" : "client_id";
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq(column, a.clientId);
      counts[table] = count ?? 0;
    }
    const files = await admin.storage.from("documents").list(a.clientId);
    const docFiles = [];
    for (const folder of files.data ?? []) {
      const inside = await admin.storage.from("documents").list(`${a.clientId}/${folder.name}`);
      docFiles.push(...(inside.data ?? []));
    }
    const logo = await admin.storage.from("widget-logos").list("", { search: logoPath });
    counts["stored documents"] = docFiles.length;
    counts["stored logo"] = (logo.data ?? []).filter((file) => file.name === logoPath).length;
    return counts;
  };
  await waitFor(async () => (await admin.from("document_chunks").select("id").eq("client_id", a.clientId)).data?.length, 30_000);
  const before = await countRows();

  await owner.goto(`${baseUrl}/dashboard/settings`);
  await owner.getByRole("button", { name: "Delete my account…" }).click();
  const deleteForm = owner.getByTestId("delete-account-form");
  const finalButton = owner.getByRole("button", { name: "Permanently delete my account" });
  const disabledUntilConfirmed = await finalButton.isDisabled();
  await deleteForm.getByLabel("Type DELETE to confirm").fill("DELETE");
  await deleteForm.getByLabel("Current password").fill("wrong-password");
  await finalButton.click();
  const refused = await deleteForm.getByText("Your password is not correct.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
  const stillThere = (await admin.from("clients").select("id").eq("id", a.clientId)).data?.length === 1;
  await shot(owner, "11-delete-confirmation", true);
  await deleteForm.getByLabel("Current password").fill(a.password);
  await finalButton.click();
  await owner.waitForURL(/\/\?account=deleted$/, { timeout: 60_000 });
  const notice = await owner.getByText("Your account and all of its data have been deleted.").isVisible();
  check(
    "Deleting needs a clear confirmation: typing DELETE and the current password",
    disabledUntilConfirmed && refused && stillThere && notice,
    `button disabled until DELETE is typed: ${disabledUntilConfirmed}; wrong password refused and nothing deleted: ${refused && stillThere}; confirmation shown: ${notice}`,
  );

  const afterDelete = await countRows();
  const { data: gone } = await admin.auth.admin.getUserById(a.userId);
  const keyResponse = await fetch(`${baseUrl}/api/public/widget?key=${a.key}`, { headers: { Origin: SITE } });
  const { count: buckets } = await admin.from("rate_limit_buckets").select("*", { count: "exact", head: true }).like("bucket", `%${a.clientId}%`);
  await owner.goto(`${baseUrl}/dashboard`);
  const signedOut = /\/login$/.test(owner.url());
  const leftovers = Object.entries(afterDelete).filter(([, count]) => count > 0);
  check(
    "Deleting the account removes every row, file, key and lead, and the login",
    leftovers.length === 0 && !gone?.user && keyResponse.status === 401 && buckets === 0 && signedOut && !(await tryLogin(a.password)),
    `before: ${Object.entries(before).filter(([, count]) => count).map(([table, count]) => `${table} ${count}`).join(", ")}; ` +
      `after: ${leftovers.length ? leftovers.map(([table, count]) => `${table} ${count}`).join(", ") : "nothing left"}; key now answers ${keyResponse.status}; signed out: ${signedOut}`,
  );
  a.deleted = true;
  await owner.context().close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { error: setupError } = await admin.from("knowledge_gaps").select("id", { head: true, count: "exact" });
if (setupError) {
  console.error("The dashboard tables are missing. Apply supabase/migrations/20261102000000_dashboard.sql first.");
  process.exit(1);
}
try {
  await fetch(baseUrl);
} catch {
  console.error(`The app is not running at ${baseUrl}. Start it with npm run dev.`);
  process.exit(1);
}

const clinics = [];
let browser;
let failure;
try {
  clinics.push(await createClinic(CLINIC_A), await createClinic(CLINIC_B));
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${CLINIC_A.domain} 127.0.0.1, MAP evil-example.com 127.0.0.1`],
  });
  await run(clinics[0], clinics[1], browser);
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  for (const clinic of clinics) {
    if (clinic.deleted) continue;
    const { data: documents } = await admin.from("documents").select("storage_path").eq("client_id", clinic.clientId);
    if (documents?.length) await admin.storage.from("documents").remove(documents.map((document) => document.storage_path));
    await admin.from("rate_limit_buckets").delete().like("bucket", `%${clinic.clientId}%`);
    await admin.auth.admin.deleteUser(clinic.userId);
  }
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} checks passed.`);
if (failure) console.error("The test stopped early:", failure);

if (outFile) {
  const lines = ["| Result | Check | Details |", "| --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.passed ? "PASS" : "FAIL"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`);
  writeFileSync(outFile, `# Client dashboard test\n\n${passed} of ${results.length} checks passed.\n\n${lines.join("\n")}\n`);
}

process.exit(failure || passed !== results.length ? 1 : 0);

// End-to-end test of appointment requests (leads): booking intent in the
// chat, the request form on desktop and mobile, validation, duplicates, the
// alert email, the Leads dashboard (status, notes, search, filters, CSV) and
// isolation between two clinics.
//
// It creates two temporary dentist clinics (no sign-up email is sent), runs
// the checks in real browsers against the running app, prints the results,
// and deletes both clinics afterwards.
//
// Requirements: the app running (npm run dev), all migrations applied, packs
// synced, ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY set. For the email check,
// RESEND_API_KEY too; alerts go to LEAD_TEST_EMAIL (default delivered@resend.dev,
// Resend's test inbox).
//
// Run with: npm run test:leads [-- --out results.md] [--screenshots dir]

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
const ALERT_EMAIL = process.env.LEAD_TEST_EMAIL?.trim() || "delivered@resend.dev";
const SITE_PORT = 5600;
const CLINIC_A = { name: "Smile Care Dental Clinic", domain: "smilecare-dental.com", phone: "+91 98450 00000" };
const CLINIC_B = { name: "Bright Teeth Dental Studio", domain: "brightteeth-studio.com", phone: "+91 90000 77331" };
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

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const short = (text) => (text ?? "").replace(/\s+/g, " ").slice(0, 160);

async function createClinic(clinic) {
  const email = `wa-leads-${clinic.domain.split(".")[0]}-${Date.now().toString(36)}@example.com`;
  const password = `Leads-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ user_id: data.user.id, business_name: clinic.name, industry: "dentist", website_domain: clinic.domain })
    .select("id")
    .single();
  if (clientError) throw new Error(`Could not create a test client: ${clientError.message}`);
  await admin.from("business_profiles").insert({
    client_id: client.id,
    phone: clinic.phone,
    opening_hours: { monday: "10:00 AM - 6:00 PM", saturday: "10:00 AM - 2:00 PM", sunday: "Closed" },
  });
  const { data: key } = await admin.from("api_keys").select("public_key").eq("client_id", client.id).single();

  const user = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await user.auth.signInWithPassword({ email, password });
  return { ...clinic, email, password, userId: data.user.id, clientId: client.id, key: key.public_key, user };
}

const leadsOf = async (clinic) =>
  (await admin.from("leads").select("*").eq("client_id", clinic.clientId).order("created_at", { ascending: false })).data ?? [];

let visitor = 0;

/** Sends a lead straight to the public API, the way the widget does, as a separate visitor. */
async function postLead(clinic, origin, body) {
  const response = await fetch(`${baseUrl}/api/public/leads?key=${clinic.key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": `198.51.100.${++visitor}` },
    body: JSON.stringify({
      name: "Test Visitor",
      mobile: "9000000001",
      preferredDate: addDays(today(), 3),
      preferredTime: "evening",
      consent: true,
      ...body,
    }),
  });
  return { status: response.status, cors: response.headers.get("access-control-allow-origin"), body: await response.json() };
}

const widget = (page) => page.locator("chat-widget-root");
const inWidget = (page, selector, options) => widget(page).locator(selector, options);

async function openWidget(page) {
  await inWidget(page, ".launcher").waitFor({ timeout: 30_000 });
  if (await inWidget(page, ".panel").isHidden()) await inWidget(page, ".launcher").click();
  await inWidget(page, ".panel").waitFor({ state: "visible" });
}

async function lastReply(page) {
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

/** Fills the widget's request form; fields left out stay as they are. */
async function fillForm(page, { name, mobile, date, time, concern, consent }) {
  if (name !== undefined) await inWidget(page, "#lead-name").fill(name);
  if (mobile !== undefined) await inWidget(page, "#lead-mobile").fill(mobile);
  if (date !== undefined) await inWidget(page, "#lead-date").fill(date);
  if (time) await inWidget(page, ".times label", { hasText: time }).click();
  if (concern !== undefined) await inWidget(page, "#lead-concern").fill(concern);
  if (consent !== undefined) await inWidget(page, "#lead-consent").setChecked(consent);
}

async function submitForm(page) {
  await inWidget(page, ".lead-submit").click();
}

/** Submits the form and waits for the answer, which closes the form and adds a message to the chat. */
async function submitAndWait(page, tap = false) {
  const before = await inWidget(page, ".bubble").count();
  await (tap ? inWidget(page, ".lead-submit").tap() : inWidget(page, ".lead-submit").click());
  await inWidget(page, ".lead").waitFor({ state: "hidden", timeout: 30_000 });
  await page.waitForFunction(
    (count) => document.querySelector("chat-widget-root").shadowRoot.querySelectorAll(".bubble").length > count,
    before,
  );
  return (await inWidget(page, ".bubble .text").last().textContent()).trim();
}

/** Counts requests to an API path a page sends. */
function countRequests(page, path) {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (request.url().includes(path) && request.method() === "POST") counter.count++;
  });
  return counter;
}

const sessionIdOf = (page, clinic) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(`chat-widget:${key}`) ?? "{}").sessionId, clinic.key);

async function signIn(browser, clinic) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: TIME_ZONE, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(clinic.email);
  await page.getByLabel("Password").fill(clinic.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/);
  return page;
}

async function shot(page, name, fullPage = false) {
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage });
}

/** Downloads the CSV export from the Leads page with the given filters. */
async function exportCsv(page, search = "") {
  await page.goto(`${baseUrl}/dashboard/leads${search}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  const text = readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
  const rows = text
    .trim()
    .split("\r\n")
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replaceAll('""', '"')));
  return { header: rows[0], rows: rows.slice(1), filename: download.suggestedFilename() };
}

const rowNames = async (page) => page.getByTestId("lead-row").locator("td:first-child a").allTextContents();

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function run(a, b, browser) {
  console.log("\n0. Lead alert addresses (Business Info)");
  const owner = await signIn(browser, a);
  await owner.goto(`${baseUrl}/dashboard/business-info`);
  const alerts = owner.getByLabel("Email addresses for lead alerts");
  await alerts.fill("not-an-email");
  await owner.getByRole("button", { name: "Save alert addresses" }).click();
  const invalidShown = await owner
    .getByText('"not-an-email" is not a valid email address.')
    .waitFor({ timeout: 15_000 })
    .then(() => true, () => false);
  const keptInput = (await alerts.inputValue()) === "not-an-email";
  await alerts.fill(ALERT_EMAIL);
  await owner.getByRole("button", { name: "Save alert addresses" }).click();
  await owner.getByText("Lead alert addresses saved.").waitFor({ timeout: 15_000 });
  const { data: settings } = await admin.from("notification_settings").select("lead_alert_emails").eq("client_id", a.clientId).single();
  check(
    "The clinic sets which email receives lead alerts in Business Info",
    invalidShown && keptInput && JSON.stringify(settings.lead_alert_emails) === JSON.stringify([ALERT_EMAIL]),
    `invalid address refused (and the typed text kept: ${keptInput}); saved: ${settings.lead_alert_emails.join(", ")}`,
  );

  console.log("\n1. Booking intent in the chat");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: TIME_ZONE });
  const page = await desktop.newPage();
  await page.goto(`${SITE}/`);
  await openWidget(page);
  await inWidget(page, "#input").fill("Hi, I'd like to book an appointment for a teeth cleaning next week.");
  await inWidget(page, "#input").press("Enter");
  const intentReply = await lastReply(page);
  const offer = inWidget(page, ".bubble .offer");
  const offered = await offer.isVisible();
  check(
    "When the visitor wants an appointment, the assistant offers to take their details",
    offered && !intentReply.includes("[[") && !/(I have|I've|is now|has been)\s+(booked|confirmed|reserved|scheduled)/i.test(intentReply),
    `reply "${short(intentReply)}"; "Request an appointment" button shown: ${offered}`,
  );
  await shot(page, "1-booking-intent");

  await offer.click();
  await inWidget(page, ".lead").waitFor({ state: "visible" });
  const nameFocused = await page.evaluate(() => document.querySelector("chat-widget-root").shadowRoot.activeElement?.id);
  const preferredDate = addDays(today(), 2);
  await fillForm(page, {
    name: "Priya Sharma",
    mobile: "98450 12345",
    date: preferredDate,
    time: "Morning",
    concern: "Teeth cleaning",
    consent: true,
  });
  await shot(page, "2-form-desktop");
  const confirmation = await submitAndWait(page);
  const sessionId = await sessionIdOf(page, a);
  const [priya] = (await leadsOf(a)).filter((lead) => lead.mobile === "+919845012345");
  check(
    "After submitting, the visitor is told the clinic will call to confirm (no slot is confirmed)",
    nameFocused === "lead-name" &&
      confirmation.includes("will call you on +91 98450 12345 to confirm a time") &&
      confirmation.includes("not booked until"),
    `"${confirmation}"`,
  );
  check(
    "The lead is saved with all details, the conversation ID and the page it came from",
    priya?.name === "Priya Sharma" &&
      priya.preferred_date === preferredDate &&
      priya.preferred_time === "morning" &&
      priya.concern === "Teeth cleaning" &&
      priya.status === "new" &&
      priya.conversation_id === sessionId &&
      priya.source_url === `${SITE}/`,
    priya
      ? `${priya.name}, ${priya.mobile}, ${priya.preferred_date} ${priya.preferred_time}, "${priya.concern}", conversation ${priya.conversation_id === sessionId ? "matches the chat session" : "does not match"}, page ${priya.source_url}`
      : "no lead saved",
  );
  const { data: savedTurns } = await admin
    .from("conversations")
    .select("assistant_reply")
    .eq("client_id", a.clientId)
    .eq("session_id", sessionId);
  check(
    "The saved chat never contains the hidden form marker",
    savedTurns?.length === 1 && !savedTurns[0].assistant_reply.includes("[["),
    `${savedTurns?.length} saved turn(s)`,
  );
  await shot(page, "3-request-sent");

  console.log("\n2. Validation");
  const leadPosts = countRequests(page, "/api/public/leads");
  await inWidget(page, ".offer").first().click();
  await inWidget(page, ".lead").waitFor({ state: "visible" });
  await fillForm(page, { name: "Arjun Mehta", mobile: "12345", date: preferredDate, time: "Evening", consent: true });
  await submitForm(page);
  const mobileError = await inWidget(page, "#lead-mobile-error").textContent();
  const mobileInvalid = await inWidget(page, "#lead-mobile").getAttribute("aria-invalid");
  await fillForm(page, { mobile: "5123456789" });
  await submitForm(page);
  const stillInvalid = await inWidget(page, "#lead-mobile-error").isVisible();
  await fillForm(page, { mobile: "9876543210", consent: false });
  await submitForm(page);
  const consentError = await inWidget(page, "#lead-consent-error").textContent();
  await shot(page, "4-validation-errors");
  check(
    "An invalid mobile number and missing consent are blocked in the form",
    mobileInvalid === "true" && stillInvalid && mobileError.includes("valid mobile number") && consentError.includes("agree") && leadPosts.count === 0,
    `mobile: "${mobileError}"; consent: "${consentError}"; requests sent: ${leadPosts.count}`,
  );

  const serverMobile = await postLead(a, SITE, { mobile: "12345" });
  const serverIndian = await postLead(a, SITE, { mobile: "5123456789" });
  const serverConsent = await postLead(a, SITE, { mobile: "9876543210", consent: false });
  const serverPast = await postLead(a, SITE, { mobile: "9876543210", preferredDate: addDays(today(), -5) });
  check(
    "The server refuses them too, whatever the browser sends",
    [serverMobile, serverIndian, serverConsent, serverPast].every((r) => r.status === 400 && r.body.error.code === "invalid_lead") &&
      serverMobile.body.error.fields.mobile &&
      serverIndian.body.error.fields.mobile &&
      serverConsent.body.error.fields.consent &&
      serverPast.body.error.fields.preferredDate,
    `400 with field errors: mobile "${serverMobile.body.error.fields.mobile}", consent "${serverConsent.body.error.fields.consent}", past date "${serverPast.body.error.fields.preferredDate}"`,
  );
  await inWidget(page, ".back").click();

  console.log("\n3. Duplicates");
  await inWidget(page, ".offer").first().click();
  await fillForm(page, { name: "Priya Sharma", mobile: "+91 98450 12345", date: preferredDate, time: "Afternoon", consent: true });
  const duplicateMessage = await submitAndWait(page);
  const priyaCount = (await leadsOf(a)).filter((lead) => lead.mobile === "+919845012345").length;
  check(
    "Submitting the same number again within 10 minutes is blocked, with a friendly message",
    priyaCount === 1 && duplicateMessage.startsWith("We already have your request"),
    `"${duplicateMessage}"; leads for this number: ${priyaCount}`,
  );
  const burst = await Promise.all([1, 2, 3].map(() => postLead(a, SITE, { name: "Kiran Rao", mobile: "9123456780" })));
  const kiranCount = (await leadsOf(a)).filter((lead) => lead.mobile === "+919123456780").length;
  check(
    "Three submissions at the same moment save exactly one lead",
    burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.status === 409).length === 2 && kiranCount === 1,
    `responses ${burst.map((r) => r.status).join(", ")}; leads saved: ${kiranCount}`,
  );
  await desktop.close();

  console.log("\n4. Quick reply form, desktop and mobile");
  const quick = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: TIME_ZONE });
  const quickPage = await quick.newPage();
  const chatPosts = countRequests(quickPage, "/api/public/chat");
  await quickPage.goto(`${SITE}/`);
  await openWidget(quickPage);
  await inWidget(quickPage, ".quick button", { hasText: "Book an appointment" }).click();
  const formOpened = await inWidget(quickPage, ".lead").isVisible();
  await fillForm(quickPage, { name: "Oliver Brown", mobile: "+44 7700 900123", date: addDays(today(), 5), time: "Afternoon", consent: true });
  const quickConfirmation = await submitAndWait(quickPage);
  const [oliver] = (await leadsOf(a)).filter((lead) => lead.mobile === "+447700900123");
  check(
    "The \"Book an appointment\" quick reply opens the form directly (desktop), with an international number",
    formOpened && chatPosts.count === 0 && quickConfirmation.includes("+447700900123") && oliver?.preferred_time === "afternoon" && Boolean(oliver.conversation_id),
    `form opened without a chat message: ${formOpened && chatPosts.count === 0}; saved ${oliver?.name}, ${oliver?.mobile}`,
  );
  await quick.close();

  const phone = await browser.newContext({ ...devices["iPhone 13"], timezoneId: TIME_ZONE });
  const mobile = await phone.newPage();
  await mobile.goto(`${SITE}/`);
  await inWidget(mobile, ".launcher").waitFor({ timeout: 30_000 });
  await inWidget(mobile, ".launcher").tap();
  await inWidget(mobile, ".quick button", { hasText: "Book an appointment" }).tap();
  await inWidget(mobile, ".lead").waitFor({ state: "visible" });
  const viewport = mobile.viewportSize();
  const panel = await inWidget(mobile, ".panel").boundingBox();
  const inputSize = await inWidget(mobile, "#lead-mobile").evaluate((node) => getComputedStyle(node).fontSize);
  await fillForm(mobile, { name: "Sneha Iyer", mobile: "070123 45678", date: addDays(today(), 1), time: "Evening", consent: true });
  await shot(mobile, "5-form-mobile");
  const mobileConfirmation = await submitAndWait(mobile, true);
  const [sneha] = (await leadsOf(a)).filter((lead) => lead.mobile === "+917012345678");
  check(
    "The form works on a phone: full screen, 16px inputs, and the request is saved",
    panel.width === viewport.width && panel.height === viewport.height && inputSize === "16px" && sneha?.name === "Sneha Iyer" &&
      mobileConfirmation.includes("+91 70123 45678"),
    `panel ${panel.width}x${panel.height} on a ${viewport.width}x${viewport.height} screen; saved ${sneha?.name}, ${sneha?.mobile}`,
  );
  await shot(mobile, "6-request-sent-mobile");
  await phone.close();

  console.log("\n5. Alert email");
  const deadline = Date.now() + 30_000;
  let delivery;
  while (Date.now() < deadline) {
    ({ data: delivery } = await admin.from("lead_notifications").select("*").eq("lead_id", priya.id).maybeSingle());
    if (delivery) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!process.env.RESEND_API_KEY) {
    check("The clinic gets an email with the lead details", false, `email is not set up (RESEND_API_KEY missing); recorded: ${delivery?.status} "${delivery?.error}"`);
  } else {
    const response = await fetch(`https://api.resend.com/emails/${delivery?.provider_message_id}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    const email = await response.json();
    // A "sending access" key cannot read emails back. Then the check confirms
    // Resend accepted the alert for the right address, and the email's
    // contents are covered by the unit tests (tests/unit/leads.test.mjs).
    if (email.name === "restricted_api_key") {
      check(
        "The clinic's alert email is accepted by Resend for the clinic's address",
        delivery?.status === "sent" && delivery.recipient === ALERT_EMAIL && /^[0-9a-f-]{36}$/.test(delivery.provider_message_id ?? ""),
        `sent to ${delivery?.recipient}, Resend message ID ${delivery?.provider_message_id} (contents checked by the unit tests; the key can only send)`,
      );
    }
    const html = email.html ?? "";
    const expected = [
      "Priya Sharma",
      "+91 98450 12345",
      "Teeth cleaning",
      "Morning",
      new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${preferredDate}T00:00:00Z`),
      ),
      `/dashboard/leads/${priya.id}`,
      "nothing has been booked yet",
    ];
    const missing = expected.filter((value) => !html.includes(value));
    if (email.name !== "restricted_api_key") check(
      "The clinic gets an email with the correct lead details and a link to the lead",
      delivery?.status === "sent" &&
        email.to?.includes(ALERT_EMAIL) &&
        email.subject === "New appointment request: Priya Sharma" &&
        missing.length === 0,
      `sent to ${email.to?.join(", ")} at ${email.created_at}; subject "${email.subject}"; ` +
        (missing.length ? `missing: ${missing.join(", ")}` : "name, mobile, date, time, concern and dashboard link all present"),
    );
    if (screenshotDir && html) {
      const preview = await browser.newPage({ viewport: { width: 700, height: 900 } });
      await preview.setContent(html);
      await preview.screenshot({ path: join(screenshotDir, "7-alert-email.png"), fullPage: true });
      await preview.close();
    }
  }

  console.log("\n6. Leads dashboard");
  const allA = await leadsOf(a);
  await owner.goto(`${baseUrl}/dashboard`);
  const counts = await owner.getByTestId("stat-leads").locator("dd").allTextContents();
  check(
    "The main dashboard shows lead counts for today, this week and this month",
    counts.join(",") === [allA.length, allA.length, allA.length].join(","),
    `today ${counts[0]}, this week ${counts[1]}, this month ${counts[2]} (${allA.length} leads created today)`,
  );

  await owner.goto(`${baseUrl}/dashboard/leads`);
  const listed = await rowNames(owner);
  const newBadges = await owner.getByTestId("lead-row").getByTestId("new-badge").count();
  await shot(owner, "8-leads-list", true);
  check(
    "The Leads page lists leads newest first, with a New badge on unseen ones",
    JSON.stringify(listed) === JSON.stringify(allA.map((lead) => lead.name)) && newBadges === allA.length,
    `${listed.join(", ")}; ${newBadges} New badges`,
  );

  await owner.getByRole("link", { name: "Priya Sharma" }).click();
  await owner.waitForURL(/\/dashboard\/leads\/[0-9a-f-]{36}$/);
  const details = await owner.getByTestId("lead-details").textContent();
  const chat = await owner.getByTestId("lead-conversation").textContent();
  const alertLine = (await owner.getByTestId("lead-alerts").textContent().catch(() => "")) ?? "";
  check(
    "Opening a lead shows its details, the full chat and the alert delivery",
    details.includes("+91 98450 12345") &&
      details.includes("Morning") &&
      details.includes("Teeth cleaning") &&
      details.includes(SITE) &&
      chat.includes("book an appointment for a teeth cleaning") &&
      chat.includes(intentReply.slice(0, 30)),
    `chat shown: "${short(chat)}"; alerts: "${short(alertLine)}"`,
  );

  await owner.locator("#lead-status").selectOption("contacted");
  await owner.locator("#lead-notes").fill("Called, booked for Tuesday 11 AM with Dr. Rao.");
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await owner.getByText("Saved.", { exact: true }).waitFor({ timeout: 15_000 });
  await shot(owner, "9-lead-detail", true);
  await owner.reload();
  const statusAfter = await owner.locator("#lead-status").inputValue();
  const notesAfter = await owner.locator("#lead-notes").inputValue();
  const [priyaAfter] = (await leadsOf(a)).filter((lead) => lead.id === priya.id);
  check(
    "Status changes and notes are saved",
    statusAfter === "contacted" && notesAfter.startsWith("Called, booked") && priyaAfter.status === "contacted" && Boolean(priyaAfter.seen_at),
    `status "${priyaAfter.status}", notes "${priyaAfter.notes}", seen ${Boolean(priyaAfter.seen_at)}`,
  );

  await owner.goto(`${baseUrl}/dashboard/leads`);
  const priyaRowNew = await owner.getByTestId("lead-row").filter({ hasText: "Priya Sharma" }).getByTestId("new-badge").count();
  check("An opened lead loses its New badge", priyaRowNew === 0, `New badges on Priya's row: ${priyaRowNew}`);

  const search = async (query) => {
    await owner.goto(`${baseUrl}/dashboard/leads?${query}`);
    return rowNames(owner);
  };
  const byName = await search("q=priya");
  const byNumber = await search("q=0900123");
  const byPartialNumber = await search("q=98450%2012");
  const none = await search("q=nobody");
  const noneText = await owner.getByText("No leads match these filters.").isVisible();
  check(
    "Search by name or number works",
    JSON.stringify(byName) === '["Priya Sharma"]' &&
      JSON.stringify(byNumber) === '["Oliver Brown"]' &&
      JSON.stringify(byPartialNumber) === '["Priya Sharma"]' &&
      none.length === 0 &&
      noneText,
    `"priya" → ${byName.join(", ")}; "0900123" → ${byNumber.join(", ")}; "98450 12" → ${byPartialNumber.join(", ")}; "nobody" → none`,
  );

  const contacted = await search("status=contacted");
  const fresh = await search("status=new");
  const todayOnly = await search(`from=${today()}&to=${today()}`);
  const tomorrow = await search(`from=${addDays(today(), 1)}`);
  const lastWeek = await search(`to=${addDays(today(), -1)}`);
  check(
    "Filters by status and date work",
    JSON.stringify(contacted) === '["Priya Sharma"]' &&
      fresh.length === allA.length - 1 &&
      !fresh.includes("Priya Sharma") &&
      todayOnly.length === allA.length &&
      tomorrow.length === 0 &&
      lastWeek.length === 0,
    `Contacted → ${contacted.join(", ")}; New → ${fresh.length}; received today → ${todayOnly.length}; from tomorrow → ${tomorrow.length}; until yesterday → ${lastWeek.length}`,
  );

  const everything = await exportCsv(owner);
  const onlyContacted = await exportCsv(owner, "?status=contacted");
  const priyaCsv = onlyContacted.rows[0] ?? [];
  check(
    "CSV export includes every lead, and follows the filters",
    everything.rows.length === allA.length &&
      everything.header.join("|") === "Received|Name|Mobile|Preferred date|Preferred time|Treatment or concern|Status|Notes|Page" &&
      onlyContacted.rows.length === 1 &&
      priyaCsv[1] === "Priya Sharma" &&
      priyaCsv[2] === "+919845012345" &&
      priyaCsv[6] === "Contacted" &&
      priyaCsv[7].startsWith("Called, booked") &&
      /^leads-\d{4}-\d{2}-\d{2}\.csv$/.test(everything.filename),
    `${everything.filename}: ${everything.rows.length} rows; filtered: ${onlyContacted.rows.length} row (${priyaCsv.slice(1, 8).join(" | ")})`,
  );

  console.log("\n7. Isolation between clinics");
  const fromB = await postLead(b, `https://${b.domain}`, { name: "Rahul Verma", mobile: "9988776655" });
  const aKeyOnB = await postLead(a, `https://${b.domain}`, { name: "Wrong Site", mobile: "9988776644" });
  const other = await signIn(browser, b);
  await other.goto(`${baseUrl}/dashboard/leads`);
  const bList = await rowNames(other);
  const aLeadForB = await other.goto(`${baseUrl}/dashboard/leads/${priya.id}`);
  const notFoundShown = await other.getByText(/could not be found|not found/i).first().isVisible().catch(() => false);
  const bCsv = await exportCsv(other);
  const { data: bDirect } = await b.user.from("leads").select("id, name");
  const { data: bDirectA } = await b.user.from("leads").select("id").eq("client_id", a.clientId);
  const { data: bAlerts } = await b.user.from("lead_notifications").select("recipient");
  const { data: bTamper } = await b.user.from("leads").update({ status: "booked" }).eq("id", priya.id).select("id");
  await owner.goto(`${baseUrl}/dashboard/leads`);
  const aList = await rowNames(owner);
  check(
    "Clinic A never sees clinic B's leads, and B never sees A's",
    fromB.status === 201 &&
      JSON.stringify(bList) === '["Rahul Verma"]' &&
      (aLeadForB.status() === 404 || notFoundShown) &&
      bCsv.rows.length === 1 &&
      bCsv.rows[0][1] === "Rahul Verma" &&
      bDirect.length === 1 &&
      bDirectA.length === 0 &&
      (bAlerts ?? []).every((alert) => alert.recipient !== ALERT_EMAIL) &&
      (bTamper ?? []).length === 0 &&
      !aList.includes("Rahul Verma"),
    `B's list: ${bList.join(", ")}; A's lead page for B: HTTP ${aLeadForB.status()}; B's CSV: ${bCsv.rows.length} row; ` +
      `B's direct database read: ${bDirect.length} lead, ${bDirectA.length} of A's; B changing A's lead: ${(bTamper ?? []).length} rows; A's list has no Rahul: ${!aList.includes("Rahul Verma")}`,
  );
  check(
    "Clinic A's key cannot send leads from clinic B's website",
    aKeyOnB.status === 403 && !aKeyOnB.cors,
    `HTTP ${aKeyOnB.status}, ${aKeyOnB.body.error.code}`,
  );
  await other.context().close();
  await owner.context().close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { error: setupError } = await admin.from("leads").select("id", { head: true, count: "exact" });
if (setupError) {
  console.error("The leads tables are missing. Apply supabase/migrations/20261101000000_leads.sql first.");
  process.exit(1);
}
try {
  await fetch(baseUrl);
} catch {
  console.error(`The app is not running at ${baseUrl}. Start it with npm run dev.`);
  process.exit(1);
}

const clinics = [];
let server;
let browser;
let failure;
try {
  clinics.push(await createClinic(CLINIC_A), await createClinic(CLINIC_B));
  server = await serveSampleSite({ port: SITE_PORT, key: clinics[0].key, widgetSrc: `${baseUrl}/widget.js` });
  browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${CLINIC_A.domain} 127.0.0.1`] });
  await run(clinics[0], clinics[1], browser);
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  server?.close();
  for (const clinic of clinics) {
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
  writeFileSync(outFile, `# Appointment requests test\n\n${passed} of ${results.length} checks passed.\n\n${lines.join("\n")}\n`);
}

process.exit(failure || passed !== results.length ? 1 : 0);

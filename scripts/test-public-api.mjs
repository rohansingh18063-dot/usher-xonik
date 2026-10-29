// End-to-end test of the public chat API: API keys, domain lock, CORS, pause,
// rate limits, monthly limit, rejection log and isolation between clients.
// Calls the running app exactly as a website would, and opens the domain
// check page in a real browser from an allowed and a blocked origin.
//
// It creates two temporary dentist clients (no email is sent), runs the
// checks, prints the results, and deletes the clients afterwards.
//
// Requirements: the app running (npm run dev), all migrations applied, packs
// synced, and ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY set.
//
// Run with: npm run test:public-api [-- --out results.md] [--screenshots dir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { serveTestPage } from "./serve-test-page.mjs";

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

const PAGE_PORT = 5500;
const IP_LIMIT = Number(process.env.PUBLIC_CHAT_IP_LIMIT_PER_MINUTE ?? 20);
const EVIL_ORIGIN = "https://evil-example.com";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CLINIC_A = { name: "Smile Care Dental Clinic", domain: "smilecare-dental.com", phone: "+91 98450 12345" };
const CLINIC_B = { name: "Bright Teeth Dental Studio", domain: "brightteeth-studio.com", phone: "+91 90000 77331" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

async function createTestClient(clinic) {
  const email = `wa-api-${clinic.domain.split(".")[0]}-${Date.now().toString(36)}@example.com`;
  const password = `Api-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);

  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ user_id: data.user.id, business_name: clinic.name, industry: "dentist", website_domain: clinic.domain })
    .select("id")
    .single();
  if (clientError) throw new Error(`Could not create a test client: ${clientError.message}`);

  const { error: profileError } = await admin.from("business_profiles").insert({
    client_id: client.id,
    phone: clinic.phone,
    opening_hours: { monday: "10:00 AM - 6:00 PM", sunday: "Closed" },
  });
  if (profileError) throw new Error(`Could not save Business Info: ${profileError.message}`);

  // Signed in as the client, like the dashboard, so Row Level Security applies.
  const user = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Could not sign in as the test client: ${signInError.message}`);

  return { ...clinic, userId: data.user.id, clientId: client.id, user, key: await currentKey(user) };
}

async function currentKey(user) {
  const { data, error } = await user.from("api_keys").select("public_key").single();
  if (error) throw new Error(`Could not read the API key: ${error.message}`);
  return data.public_key;
}

async function setClient(client, change) {
  const { error } = await admin.from("clients").update(change).eq("id", client.clientId);
  if (error) throw new Error(`Could not update the test client: ${error.message}`);
}

/** Sends one public chat request and reads the whole reply. */
async function chat({ key, origin, message = "What is your phone number?", sessionId = crypto.randomUUID(), ip }) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (ip) headers["X-Forwarded-For"] = ip;
  const response = await fetch(`${baseUrl}/api/public/chat?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, message }),
  });
  const raw = await response.text();
  const result = { status: response.status, cors: response.headers.get("access-control-allow-origin"), raw };
  result.retryAfter = response.headers.get("retry-after");

  if (response.headers.get("content-type")?.includes("ndjson")) {
    let reply = "";
    for (const line of raw.split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "text") reply += event.text;
      if (event.type === "reset") reply = "";
      if (event.type === "error") result.streamError = event.message;
    }
    result.reply = reply.trim();
  } else {
    result.error = JSON.parse(raw).error;
  }
  return result;
}

async function preflight(key, origin) {
  const response = await fetch(`${baseUrl}/api/public/chat?key=${encodeURIComponent(key)}`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  return { status: response.status, cors: response.headers.get("access-control-allow-origin") };
}

const short = (text) => (text ?? "").replace(/\s+/g, " ").slice(0, 140);
const describe = (r) =>
  `HTTP ${r.status}, CORS ${r.cors ? `"${r.cors}"` : "none"}, ${r.error ? `${r.error.code}: "${r.error.message}"` : `reply: "${short(r.reply)}"`}`;
const digits = (text) => (text ?? "").replace(/\D/g, "");
const mentions = (reply, phone) => digits(reply).includes(digits(phone).slice(-10));

/** Waits until a new rate-limit window starts, so counts start from zero. */
async function waitForFreshWindow() {
  const wait = 60_000 - (Date.now() % 60_000) + 3_000;
  console.log(`      (waiting ${Math.round(wait / 1000)}s for a new rate-limit window)`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}

async function websiteMessages(clientId) {
  const { count } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("channel", "website");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function run(a, b, browser) {
  const originA = `https://${a.domain}`;
  const originB = `https://${b.domain}`;

  console.log("\n1. Allowed domain");
  let r = await chat({ key: a.key, origin: originA });
  check(
    "A request from the client's domain gets a streamed reply",
    r.status === 200 && r.cors === originA && Boolean(r.reply) && !r.streamError,
    describe(r),
  );
  r = await chat({ key: a.key, origin: `https://www.${a.domain}`, message: "Hello" });
  check("The www version of the domain also works", r.status === 200 && Boolean(r.reply), describe(r));
  let p = await preflight(a.key, originA);
  check("The CORS preflight from the client's domain passes", p.status === 204 && p.cors === originA, `HTTP ${p.status}, CORS "${p.cors}"`);

  console.log("\n2. Other domains");
  r = await chat({ key: a.key, origin: EVIL_ORIGIN });
  check(
    "A request from a different domain is rejected without CORS headers",
    r.status === 403 && r.error?.code === "origin_not_allowed" && !r.cors,
    describe(r),
  );
  p = await preflight(a.key, EVIL_ORIGIN);
  check("The CORS preflight from a different domain fails", p.status === 403 && !p.cors, `HTTP ${p.status}, CORS ${p.cors ?? "none"}`);
  r = await chat({ key: a.key, origin: `https://book.${a.domain}` });
  check("A subdomain is rejected while subdomains are not allowed", r.status === 403 && !r.cors, describe(r));
  r = await chat({ key: a.key, origin: `https://${a.domain}.evil-example.com` });
  check("A look-alike domain is rejected", r.status === 403 && !r.cors, describe(r));
  r = await chat({ key: a.key, origin: null });
  check("A request without an Origin is rejected", r.status === 403 && r.error?.code === "missing_origin", describe(r));
  r = await chat({ key: "pk_live_" + "x".repeat(32), origin: originA });
  check("An unknown key is rejected", r.status === 401 && r.error?.code === "invalid_key" && !r.cors, describe(r));

  console.log("\n3. Regenerated key");
  const oldKey = a.key;
  const { error: regenerateError } = await a.user.rpc("regenerate_public_key");
  a.key = await currentKey(a.user);
  check("Regenerating creates a different key", !regenerateError && a.key !== oldKey && /^pk_live_/.test(a.key), `${oldKey.slice(0, 14)}… → ${a.key.slice(0, 14)}…`);
  r = await chat({ key: oldKey, origin: originA });
  check("The old key stops working immediately", r.status === 401 && r.error?.code === "invalid_key", describe(r));
  r = await chat({ key: a.key, origin: originA, message: "Hello" });
  check("The new key works", r.status === 200 && Boolean(r.reply), describe(r));
  check("Client B's key is unchanged", (await currentKey(b.user)) === b.key, "B's key is the same as before A regenerated");

  console.log("\n4. Pause");
  const { error: pauseError } = await a.user.from("clients").update({ assistant_paused: true }).eq("id", a.clientId);
  r = await chat({ key: a.key, origin: originA });
  check(
    "A paused assistant stops answering, with a friendly message the website can read",
    !pauseError && r.status === 503 && r.error?.code === "assistant_paused" && r.cors === originA,
    describe(r),
  );
  r = await chat({ key: a.key, origin: EVIL_ORIGIN });
  check("While paused, other domains still get no CORS headers", !r.cors, describe(r));
  await a.user.from("clients").update({ assistant_paused: false }).eq("id", a.clientId);
  r = await chat({ key: a.key, origin: originA, message: "Hello" });
  check("Unpausing brings the assistant back", r.status === 200 && Boolean(r.reply), describe(r));

  console.log("\n5. Client isolation");
  const shared = crypto.randomUUID();
  const replyB = await chat({ key: b.key, origin: originB, sessionId: shared });
  const replyA = await chat({ key: a.key, origin: originA, sessionId: shared });
  check("Client B's key answers with B's own phone number", mentions(replyB.reply, b.phone) && !mentions(replyB.reply, a.phone), describe(replyB));
  check(
    "Client A's key, even with the same session ID, answers with A's details only",
    mentions(replyA.reply, a.phone) && !mentions(replyA.reply, b.phone) && !replyA.reply.includes(b.name),
    describe(replyA),
  );
  r = await chat({ key: a.key, origin: originB });
  check("Client A's key does not work on client B's website", r.status === 403 && !r.cors, describe(r));
  r = await chat({ key: b.key, origin: originA });
  check("Client B's key does not work on client A's website", r.status === 403 && !r.cors, describe(r));
  const { data: rows } = await admin.from("conversations").select("client_id").eq("session_id", shared);
  check(
    "Each conversation is saved under its own client",
    rows?.filter((row) => row.client_id === a.clientId).length === 1 && rows?.filter((row) => row.client_id === b.clientId).length === 1,
    `${rows?.length ?? 0} rows for the shared session ID, one per client`,
  );
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  check(
    "Responses never contain internal IDs",
    ![replyA, replyB, r].some((x) => x.raw.includes(a.clientId) || x.raw.includes(b.clientId) || uuid.test(x.raw)),
    "Checked the raw bodies of A's and B's replies and a rejection",
  );

  console.log("\n6. Per-key rate limit");
  // With the monthly limit reached, requests are counted by the rate limits
  // and then refused before any reply is generated.
  await setClient(b, { monthly_message_limit: 0 });
  await admin.from("api_keys").update({ requests_per_minute: 3 }).eq("client_id", b.clientId);
  await waitForFreshWindow();
  // Sent at the same time, so they all land in one window and also prove the
  // counter is exact under concurrent requests.
  const keyCodes = (
    await Promise.all([1, 2, 3, 4].map((i) => chat({ key: b.key, origin: originB, ip: `198.51.100.${i}` })))
  ).map((r) => r.error?.code);
  check(
    "Of 4 messages in one minute, exactly 1 is refused when the key allows 3",
    keyCodes.filter((code) => code === "key_rate_limited").length === 1 &&
      keyCodes.filter((code) => code === "monthly_limit_reached").length === 3,
    keyCodes.join(", "),
  );

  console.log("\n7. Monthly limit");
  const used = await websiteMessages(a.clientId);
  await setClient(a, { monthly_message_limit: used });
  r = await chat({ key: a.key, origin: originA });
  check(
    `The monthly limit stops replies once ${used} messages are used`,
    r.status === 429 && r.error?.code === "monthly_limit_reached" && r.cors === originA,
    describe(r),
  );
  const { data: settingsChange } = await a.user
    .from("clients")
    .update({ monthly_message_limit: 1_000_000 })
    .eq("id", a.clientId)
    .select("monthly_message_limit");
  const { data: afterChange } = await admin.from("clients").select("monthly_message_limit").eq("id", a.clientId).single();
  check(
    "A client cannot raise their own monthly limit",
    afterChange.monthly_message_limit === used && !settingsChange?.length,
    `limit is still ${afterChange.monthly_message_limit}`,
  );

  console.log("\n8. Per-visitor rate limit");
  await waitForFreshWindow();
  const burst = await Promise.all(
    Array.from({ length: IP_LIMIT + 1 }, () => chat({ key: a.key, origin: originA, ip: "203.0.113.7" })),
  );
  const slowed = burst.filter((r) => r.error?.code === "ip_rate_limited");
  const last = slowed[0] ?? burst.at(-1);
  check(
    `Of ${IP_LIMIT + 1} messages in one minute from one visitor, exactly 1 is refused with "please slow down"`,
    slowed.length === 1 &&
      burst.filter((r) => r.error?.code === "monthly_limit_reached").length === IP_LIMIT &&
      last.status === 429 &&
      Boolean(last.retryAfter),
    `${describe(last)}, Retry-After ${last.retryAfter}s`,
  );
  r = await chat({ key: a.key, origin: originA, ip: "203.0.113.8" });
  check("Another visitor is not affected", r.error?.code === "monthly_limit_reached", describe(r));
  await setClient(a, { monthly_message_limit: 1000 });

  console.log("\n9. Rejection log");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { data: logA } = await a.user.from("public_api_rejections").select("reason, origin, created_at");
  const reasonsA = new Set(logA?.map((row) => row.reason));
  check(
    "Client A sees its rejected requests with reason, origin and time",
    ["origin_not_allowed", "missing_origin", "assistant_paused", "monthly_limit_reached", "ip_rate_limited"].every((x) => reasonsA.has(x)) &&
      logA.some((row) => row.reason === "origin_not_allowed" && row.origin === EVIL_ORIGIN && row.created_at),
    `${logA?.length ?? 0} entries: ${[...reasonsA].join(", ")}`,
  );
  const { data: logB } = await b.user.from("public_api_rejections").select("reason, origin");
  check(
    "Client B only sees its own rejected requests",
    logB.length > 0 && logB.every((row) => row.origin !== EVIL_ORIGIN && row.reason !== "assistant_paused"),
    `${logB.length} entries: ${[...new Set(logB.map((row) => row.reason))].join(", ")}`,
  );

  console.log("\n10. Domain check page in a real browser");
  await setClient(a, { test_mode: true });
  await a.user.from("allowed_domains").insert({ client_id: a.clientId, domain: "localhost" });
  const page = await browser.newPage();
  const open = async (host, name) => {
    const query = new URLSearchParams({ api: baseUrl, key: a.key, message: "What is your phone number?", auto: "1" });
    await page.goto(`http://${host}:${PAGE_PORT}/?${query}`);
    await page.locator("#result:not([hidden])").waitFor({ timeout: 90_000 });
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
    return {
      outcome: await page.locator("#result").getAttribute("data-outcome"),
      details: await page.locator("#details").textContent(),
    };
  };
  let seen = await open("localhost", "1-localhost-test-mode-on");
  check("http://localhost page, test mode on: allowed", seen.outcome === "allowed", short(seen.details));
  seen = await open("127.0.0.1", "2-ip-address");
  check("http://127.0.0.1 page (not an allowed domain): blocked by the browser", seen.outcome === "blocked", short(seen.details));
  await setClient(a, { test_mode: false });
  seen = await open("localhost", "3-localhost-test-mode-off");
  check("http://localhost page, test mode off: blocked", seen.outcome === "blocked", short(seen.details));
  await page.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { error: setupError } = await admin.from("api_keys").select("client_id", { head: true, count: "exact" });
if (setupError) {
  console.error("The public API tables are missing. Apply supabase/migrations/20261030000000_public_api.sql first.");
  process.exit(1);
}
try {
  await fetch(baseUrl);
} catch {
  console.error(`The app is not running at ${baseUrl}. Start it with npm run dev.`);
  process.exit(1);
}

const server = await serveTestPage(PAGE_PORT);
const browser = await chromium.launch();
const clients = [];
let failure;
try {
  clients.push(await createTestClient(CLINIC_A), await createTestClient(CLINIC_B));
  await run(clients[0], clients[1], browser);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  server.close();
  for (const client of clients) {
    await admin.from("rate_limit_buckets").delete().like("bucket", `%${client.clientId}%`);
    await admin.auth.admin.deleteUser(client.userId);
  }
  await admin.from("public_api_rejections").delete().is("client_id", null).eq("origin", `https://${CLINIC_A.domain}`);
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} checks passed.`);
if (failure) console.error("The test stopped early:", failure);

if (outFile) {
  const lines = ["| Result | Check | Details |", "| --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.passed ? "PASS" : "FAIL"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`);
  writeFileSync(outFile, `# Public chat API test\n\n${passed} of ${results.length} checks passed.\n\n${lines.join("\n")}\n`);
}

process.exit(failure || passed !== results.length ? 1 : 0);

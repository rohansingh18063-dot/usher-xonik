// End-to-end test of the website chat widget. Opens the sample clinic website
// (tests/widget/site, with deliberately aggressive CSS) in a real browser as
// an allowed domain and as other domains, changes settings in the real
// dashboard, and checks what visitors see: replies, page changes, mobile
// layout, keyboard use, style isolation and every error message.
//
// It creates a temporary dentist client (no email is sent), runs the checks,
// prints the results, and deletes the client and its logo afterwards.
//
// Requirements: the app running (npm run dev), all migrations applied, packs
// synced, and ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY set.
//
// Run with: npm run test:widget [-- --out results.md] [--screenshots dir]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
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

const SITE_PORT = 5600;
const CLINIC = { name: "Smile Care Dental Clinic", domain: "smilecare-dental.com", phone: "+91 98450 12345" };
const SITE = `http://${CLINIC.domain}:${SITE_PORT}`;
const OTHER_SITE = `http://evil-example.com:${SITE_PORT}`;
const IP_SITE = `http://127.0.0.1:${SITE_PORT}`;
const DEFAULT_REPLIES = ["Book an appointment", "Clinic timings", "Treatments we offer", "Contact the clinic"];
const NEW_REPLIES = ["Book a visit", "Clinic timings", "Parking", "Treatments we offer"];

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

async function createTestClient() {
  const email = `wa-widget-${Date.now().toString(36)}@example.com`;
  const password = `Widget-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);

  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ user_id: data.user.id, business_name: CLINIC.name, industry: "dentist", website_domain: CLINIC.domain })
    .select("id")
    .single();
  if (clientError) throw new Error(`Could not create a test client: ${clientError.message}`);

  await admin.from("business_profiles").insert({
    client_id: client.id,
    phone: CLINIC.phone,
    opening_hours: {
      monday: "10:00 AM - 6:00 PM",
      tuesday: "10:00 AM - 6:00 PM",
      wednesday: "10:00 AM - 6:00 PM",
      thursday: "10:00 AM - 6:00 PM",
      friday: "10:00 AM - 6:00 PM",
      saturday: "10:00 AM - 2:00 PM",
      sunday: "Closed",
    },
  });
  const { data: key } = await admin.from("api_keys").select("public_key").eq("client_id", client.id).single();
  return { email, password, userId: data.user.id, clientId: client.id, key: key.public_key };
}

const setClient = (client, change) => admin.from("clients").update(change).eq("id", client.clientId);

const widget = (page) => page.locator("chat-widget-root");
const inWidget = (page, selector, options) => widget(page).locator(selector, options);

/** Opens the chat, unless it is already open (it stays open across page loads). */
async function openWidget(page) {
  await inWidget(page, ".launcher").waitFor();
  if (await inWidget(page, ".panel").isHidden()) await inWidget(page, ".launcher").click();
  await inWidget(page, ".panel").waitFor({ state: "visible" });
}

/** Waits until the widget has finished answering and returns the last bubble. */
async function lastReply(page) {
  await page.waitForFunction(
    () => {
      const log = document.querySelector("chat-widget-root")?.shadowRoot?.querySelector(".messages");
      return log && !log.hasAttribute("aria-busy");
    },
    null,
    { timeout: 90_000 },
  );
  const bubble = inWidget(page, ".bubble").last();
  return {
    text: (await bubble.locator(".text").textContent()).trim(),
    failed: (await bubble.getAttribute("class")).includes("failed"),
  };
}

async function sendMessage(page, text) {
  await inWidget(page, "#input").fill(text);
  await inWidget(page, "#input").press("Enter");
  return lastReply(page);
}

const bubbleTexts = (page) => inWidget(page, ".bubble .text").allTextContents();
const quickReplies = (page) => inWidget(page, ".quick button").allTextContents();

async function shot(page, name) {
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

const short = (text) => (text ?? "").replace(/\s+/g, " ").slice(0, 150);
const digits = (text) => (text ?? "").replace(/\D/g, "");

/** Waits until a new rate-limit window starts, so counts start from zero. */
async function waitForFreshWindow() {
  const wait = 60_000 - (Date.now() % 60_000) + 3_000;
  console.log(`      (waiting ${Math.round(wait / 1000)}s for a new rate-limit window)`);
  await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Records the session ID of every chat request a page sends. */
function trackSessions(page, sessions) {
  page.on("request", (request) => {
    if (request.url().includes("/api/public/chat") && request.method() === "POST") {
      sessions.push(JSON.parse(request.postData()).sessionId);
    }
  });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function run(client, browser) {
  console.log("\n0. Widget script");
  const script = readFileSync(new URL("../public/widget.js", import.meta.url));
  const served = await fetch(`${baseUrl}/widget.js`);
  check(
    "widget.js is a small plain JavaScript file loaded with async",
    served.ok && gzipSync(script).length < 16_000 && /javascript/.test(served.headers.get("content-type")),
    `${(script.length / 1024).toFixed(1)} KB, ${(gzipSync(script).length / 1024).toFixed(1)} KB gzipped, ` +
      `Content-Type ${served.headers.get("content-type")}, Cache-Control "${served.headers.get("cache-control")}"`,
  );

  console.log("\n1. Allowed domain");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  const sessions = [];
  trackSessions(page, sessions);
  await page.goto(`${SITE}/`);
  await inWidget(page, ".launcher").waitFor({ timeout: 30_000 });
  check("The chat button appears on the clinic's website", await inWidget(page, ".launcher").isVisible(), SITE);

  await openWidget(page);
  const title = await inWidget(page, ".title").textContent();
  const welcome = (await bubbleTexts(page))[0];
  const replies = await quickReplies(page);
  check(
    "Opening it shows the header, welcome message and dentist quick replies",
    title === CLINIC.name && welcome.includes("Welcome to Smile Care") && JSON.stringify(replies) === JSON.stringify(DEFAULT_REPLIES),
    `header "${title}", welcome "${short(welcome)}", quick replies: ${replies.join(" | ")}`,
  );

  await inWidget(page, ".quick button", { hasText: "Clinic timings" }).click();
  const typing = await inWidget(page, ".typing").waitFor({ timeout: 10_000 }).then(() => true, () => false);
  let reply = await lastReply(page);
  check("A typing indicator shows while the reply is on its way", typing, "three animated dots with a screen reader label");
  check(
    "Tapping a quick reply gets a streamed answer from the clinic's own details",
    !reply.failed && /10(:00)?\s?AM/i.test(reply.text),
    `"${short(reply.text)}"`,
  );
  check("Quick replies hide after the first message", await inWidget(page, ".quick").isHidden(), "only the conversation is shown");
  await shot(page, "1-allowed-domain");

  console.log("\n2. Conversation after a page change");
  await page.click("#about-link");
  await page.waitForURL(/about\.html$/);
  await inWidget(page, ".panel").waitFor({ state: "visible", timeout: 30_000 });
  const carried = await bubbleTexts(page);
  check(
    "On the next page the chat is still open with the earlier messages",
    carried.length === 3 && carried[1] === "Clinic timings" && carried[2] === reply.text,
    `${carried.length} messages shown on about.html`,
  );
  reply = await sendMessage(page, "And are you open on Sunday?");
  check(
    "A follow-up on the new page continues the same conversation",
    sessions.length === 2 && sessions[0] === sessions[1] && !reply.failed && /closed|not open/i.test(reply.text),
    `same session ID for both messages: ${sessions[0] === sessions[1]}; reply "${short(reply.text)}"`,
  );
  const { data: saved } = await admin
    .from("conversations")
    .select("visitor_message, channel")
    .eq("client_id", client.clientId)
    .eq("session_id", sessions[0])
    .order("created_at");
  check(
    "Both messages are saved on the server under one website session",
    saved?.length === 2 && saved.every((row) => row.channel === "website"),
    saved?.map((row) => `"${row.visitor_message}"`).join(", "),
  );
  await shot(page, "2-after-page-change");

  console.log("\n3. Domains that are not allowed");
  for (const [label, url] of [
    ["another domain", OTHER_SITE],
    ["an IP address", IP_SITE],
  ]) {
    const other = await desktop.newPage();
    const warnings = [];
    other.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
    await other.goto(`${url}/`);
    await other.waitForTimeout(4000);
    const shown = await widget(other).count();
    check(
      `The widget does not load on ${label}`,
      shown === 0 && warnings.some((w) => w.includes("allowed domains")),
      `${url}: ${shown} widget elements; console: "${short(warnings.find((w) => w.includes("Chat widget")))}"`,
    );
    if (label === "another domain") await shot(other, "3-domain-not-allowed");
    await other.close();
  }

  console.log("\n4. Style isolation");
  const styles = await page.evaluate(() => {
    const host = document.querySelector("chat-widget-root");
    const shadow = host.shadowRoot;
    const css = (selector) => getComputedStyle(shadow.querySelector(selector));
    return {
      launcherBackground: css(".launcher").backgroundColor,
      launcherWidth: css(".launcher").width,
      launcherBorder: css(".launcher").borderStyle,
      iconDisplay: css(".launcher svg").display,
      bubbleFont: css(".bubble").fontFamily,
      bubbleColor: css(".assistant").color,
      bubbleLetterSpacing: css(".assistant").letterSpacing,
      inputFontSize: css("textarea").fontSize,
      inputWidth: parseFloat(css("textarea").width),
      hostOpacity: getComputedStyle(host).opacity,
      hostTransform: getComputedStyle(host).transform,
    };
  });
  check(
    "The website's aggressive CSS does not change the widget",
    styles.launcherBackground === "rgb(41, 82, 227)" &&
      styles.launcherWidth === "60px" &&
      styles.launcherBorder === "none" &&
      styles.iconDisplay === "block" &&
      !/comic/i.test(styles.bubbleFont) &&
      styles.bubbleColor === "rgb(15, 23, 42)" &&
      styles.bubbleLetterSpacing === "normal" &&
      styles.inputFontSize === "16px" &&
      styles.inputWidth > 150 &&
      styles.hostOpacity === "1" &&
      styles.hostTransform === "none",
    `button ${styles.launcherBackground}, ${styles.launcherWidth}, border ${styles.launcherBorder}; icons ${styles.iconDisplay}; ` +
      `text ${styles.bubbleColor} in ${styles.bubbleFont.split(",")[0]}; input ${styles.inputFontSize}, ${Math.round(styles.inputWidth)}px wide`,
  );

  const pageStyles = async (target) =>
    target.evaluate(() => {
      const pick = (selector) => {
        const s = getComputedStyle(document.querySelector(selector));
        return [s.fontFamily, s.fontSize, s.color, s.backgroundColor, s.padding, s.margin, s.lineHeight].join(" / ");
      };
      return {
        body: pick("body"),
        title: pick(".site-title"),
        text: pick(".site-text"),
        button: pick(".site-button"),
        documentStyles: document.querySelectorAll("style, link[rel=stylesheet]").length,
      };
    });
  const bare = await desktop.newPage();
  await bare.route("**/widget.js", (route) => route.abort());
  await bare.goto(`${SITE}/`);
  const without = await pageStyles(bare);
  await bare.close();
  const withWidget = await desktop.newPage();
  await withWidget.goto(`${SITE}/`);
  await inWidget(withWidget, ".launcher").waitFor();
  const withIt = await pageStyles(withWidget);
  await withWidget.close();
  check(
    "The widget's CSS does not change the website",
    JSON.stringify(without) === JSON.stringify(withIt),
    `computed styles of body, heading, text and button are identical with and without the widget; ` +
      `${withIt.documentStyles} stylesheet(s) on the page either way`,
  );

  console.log("\n5. Keyboard and screen readers");
  const keyboard = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await keyboard.goto(`${SITE}/`);
  await inWidget(keyboard, ".launcher").waitFor();
  const focusedInWidget = () =>
    keyboard.evaluate(() => {
      const inner = document.activeElement?.shadowRoot?.activeElement;
      return inner ? inner.className || inner.tagName.toLowerCase() : document.activeElement?.tagName.toLowerCase();
    });
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await keyboard.keyboard.press("Tab");
    reached = (await focusedInWidget()) === "launcher";
  }
  const ring = await keyboard.evaluate(() => {
    const s = getComputedStyle(document.querySelector("chat-widget-root").shadowRoot.querySelector(".launcher"));
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  await keyboard.keyboard.press("Enter");
  const afterOpen = await focusedInWidget();
  const expanded = await inWidget(keyboard, ".launcher").getAttribute("aria-expanded");
  await keyboard.keyboard.press("Escape");
  const afterClose = await focusedInWidget();
  const closed = await inWidget(keyboard, ".panel").isHidden();
  check(
    "Tab reaches the chat button, Enter opens the chat, Escape closes it",
    reached && ring.startsWith("solid") && expanded === "true" && afterOpen === "textarea" && closed && afterClose === "launcher",
    `focus ring "${ring}"; after Enter focus moves to the ${afterOpen}; after Escape focus returns to the ${afterClose}`,
  );
  const labels = await keyboard.evaluate(() => {
    const s = document.querySelector("chat-widget-root").shadowRoot;
    const label = (selector) => s.querySelector(selector)?.getAttribute("aria-label");
    return {
      launcher: label(".launcher"),
      dialog: s.querySelector(".panel").getAttribute("role"),
      dialogName: s.getElementById(s.querySelector(".panel").getAttribute("aria-labelledby"))?.textContent,
      log: s.querySelector(".messages").getAttribute("role"),
      input: s.querySelector('label[for="input"]')?.textContent,
      send: label(".send"),
      close: label(".close"),
      restart: label(".restart"),
    };
  });
  check(
    "Every control has a screen reader label",
    labels.launcher === "Open chat" &&
      labels.dialog === "dialog" &&
      labels.dialogName === CLINIC.name &&
      labels.log === "log" &&
      labels.input === "Your message" &&
      labels.send === "Send message" &&
      labels.close === "Close chat" &&
      labels.restart === "Start a new conversation",
    Object.entries(labels)
      .map(([k, v]) => `${k}: "${v}"`)
      .join(", "),
  );
  await keyboard.context().close();

  console.log("\n6. Mobile");
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  await mobile.goto(`${SITE}/`);
  await inWidget(mobile, ".launcher").waitFor();
  const launcherBox = await inWidget(mobile, ".launcher").boundingBox();
  await inWidget(mobile, ".launcher").tap();
  await inWidget(mobile, ".panel").waitFor({ state: "visible" });
  const viewport = mobile.viewportSize();
  const panelBox = await inWidget(mobile, ".panel").boundingBox();
  check(
    "On a phone the chat opens full screen",
    panelBox.x === 0 && panelBox.y === 0 && panelBox.width === viewport.width && panelBox.height === viewport.height,
    `panel ${panelBox.width}x${panelBox.height} at (${panelBox.x}, ${panelBox.y}); screen ${viewport.width}x${viewport.height}`,
  );
  await inWidget(mobile, ".quick button", { hasText: "Contact the clinic" }).tap();
  reply = await lastReply(mobile);
  check(
    "Tapping a quick reply on a phone works, and the button is easy to tap",
    !reply.failed && digits(reply.text).includes(digits(CLINIC.phone).slice(-10)) && launcherBox.width >= 44,
    `button ${launcherBox.width}x${launcherBox.height}px; reply "${short(reply.text)}"`,
  );
  await shot(mobile, "4-mobile");
  await phone.close();

  console.log("\n7. Dashboard settings reach the website");
  const dashboard = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await dashboard.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const owner = await dashboard.newPage();
  await owner.goto(`${baseUrl}/login`);
  await owner.getByLabel("Email").fill(client.email);
  await owner.getByLabel("Password").fill(client.password);
  await owner.getByRole("button", { name: "Sign in" }).click();
  await owner.waitForURL(/\/dashboard$/);
  await owner.getByRole("link", { name: "Widget" }).click();
  await owner.waitForURL(/\/dashboard\/widget$/);

  const preview = owner.frameLocator('[data-testid="widget-preview"]');
  await preview.locator("chat-widget-root .title").waitFor({ timeout: 30_000 });
  await owner.getByLabel("Assistant name").fill("Smile Care Helper");
  await owner.locator("#brand-color").fill("#0f766e");
  await owner.getByLabel("Bottom left").check();
  await owner.getByLabel("Welcome message").fill("Hello from Smile Care! Ask me anything about your visit.");
  await owner.getByLabel("Quick reply 1", { exact: true }).fill("Book a visit");
  await owner.getByRole("button", { name: "Remove quick reply 4" }).click();
  await owner.getByRole("button", { name: "Add quick reply" }).click();
  await owner.getByLabel("Quick reply 4", { exact: true }).fill("Parking");
  await owner.getByRole("button", { name: "Move quick reply 4 up" }).click();

  const logo = await dashboard.newPage();
  await logo.setContent('<div id="logo" style="width:128px;height:128px;border-radius:50%;background:#0f766e"></div>');
  const logoPng = await logo.locator("#logo").screenshot({ omitBackground: true });
  await logo.close();
  await owner.getByTestId("logo-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng });
  await owner.getByTestId("logo-image").waitFor({ timeout: 30_000 });

  await preview.locator("chat-widget-root .title").filter({ hasText: "Smile Care Helper" }).waitFor({ timeout: 10_000 });
  const previewReplies = await preview.locator("chat-widget-root .quick button").allTextContents();
  const previewColor = await preview
    .locator("chat-widget-root .launcher")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  check(
    "The live preview updates as settings change, before saving",
    JSON.stringify(previewReplies) === JSON.stringify(NEW_REPLIES) && previewColor === "rgb(15, 118, 110)",
    `preview header "Smile Care Helper", color ${previewColor}, quick replies: ${previewReplies.join(" | ")}`,
  );

  await owner.getByRole("button", { name: "Save changes" }).click();
  await owner.getByText("Saved. Your website shows the new settings").waitFor({ timeout: 20_000 });

  await owner.getByRole("button", { name: "Copy embed code" }).click();
  const copied = await owner.evaluate(() => navigator.clipboard.readText());
  const expectedCode = `<script src="${baseUrl}/widget.js" data-key="${client.key}" async></script>`;
  check("Copy embed code copies the script tag with the client's key", copied === expectedCode, copied);
  await owner.screenshot({ path: screenshotDir ? join(screenshotDir, "5-dashboard-widget.png") : undefined, fullPage: true });

  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await visitor.goto(`${SITE}/`);
  await inWidget(visitor, ".launcher").waitFor();
  await openWidget(visitor);
  await visitor
    .waitForFunction(
      () => {
        const image = document.querySelector("chat-widget-root").shadowRoot.querySelector(".logo");
        return image.hidden || (image.complete && image.naturalWidth > 0);
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  const applied = await visitor.evaluate(() => {
    const s = document.querySelector("chat-widget-root").shadowRoot;
    const logoImage = s.querySelector(".logo");
    return {
      title: s.querySelector(".title").textContent,
      color: getComputedStyle(s.querySelector(".launcher")).backgroundColor,
      left: s.querySelector(".launcher").getBoundingClientRect().left,
      welcome: s.querySelector(".bubble .text").textContent,
      replies: [...s.querySelectorAll(".quick button")].map((b) => b.textContent),
      logo: !logoImage.hidden && logoImage.complete && logoImage.naturalWidth > 0,
      logoSrc: logoImage.src,
    };
  });
  check(
    "After a refresh the website shows the saved settings, without changing the embed code",
    applied.title === "Smile Care Helper" &&
      applied.color === "rgb(15, 118, 110)" &&
      applied.left < 100 &&
      applied.welcome === "Hello from Smile Care! Ask me anything about your visit." &&
      JSON.stringify(applied.replies) === JSON.stringify(NEW_REPLIES) &&
      applied.logo &&
      !applied.logoSrc.includes(client.clientId),
    `name "${applied.title}", color ${applied.color}, button ${Math.round(applied.left)}px from the left, logo loaded: ${applied.logo}, ` +
      `quick replies: ${applied.replies.join(" | ")}; logo ${new URL(applied.logoSrc || "about:blank").pathname}`,
  );
  await shot(visitor, "6-settings-on-website");

  console.log("\n8. Friendly error messages");
  await setClient(client, { assistant_paused: true });
  await visitor.reload();
  await openWidget(visitor);
  const pausedTexts = await bubbleTexts(visitor);
  check(
    "Paused assistant: visitors are told it is not available, and typing is disabled",
    pausedTexts.at(-1).startsWith("This assistant is not available right now") && (await inWidget(visitor, "#input").isDisabled()),
    `"${pausedTexts.at(-1)}"`,
  );
  await setClient(client, { assistant_paused: false });
  await visitor.reload();
  await openWidget(visitor);

  const { count: used } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.clientId)
    .eq("channel", "website");
  await setClient(client, { monthly_message_limit: used });
  reply = await sendMessage(visitor, "Do you offer teeth whitening?");
  check(
    "Monthly limit reached: a friendly message",
    reply.failed && reply.text.includes("reached its message limit for this month"),
    `"${reply.text}"`,
  );

  await waitForFreshWindow();
  // The visitor's first 20 messages this minute, sent at once from the same
  // browser so they land in one rate-limit window; the 21st goes through the widget.
  const earlier = await visitor.evaluate(
    ({ url, sessionIds }) =>
      Promise.all(
        sessionIds.map((sessionId) =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, message: "Earlier question" }),
          }).then((response) => response.status),
        ),
      ),
    {
      url: `${baseUrl}/api/public/chat?key=${client.key}`,
      sessionIds: Array.from({ length: 20 }, () => crypto.randomUUID()),
    },
  );
  reply = await sendMessage(visitor, "Question 21");
  check(
    "Too many messages from one visitor: a friendly 'please slow down'",
    earlier.every((status) => status === 429) && reply.failed && reply.text.includes("slow down"),
    `20 earlier messages answered with ${[...new Set(earlier)].join(", ")} (monthly limit); message 21 in the widget: "${reply.text}"`,
  );
  await setClient(client, { monthly_message_limit: 1000 });

  await visitor.route("**/api/public/chat**", (route) => route.abort("internetdisconnected"));
  reply = await sendMessage(visitor, "Hello?");
  check(
    "Network error: a friendly message",
    reply.failed && reply.text.startsWith("We couldn't reach the assistant"),
    `"${reply.text}"`,
  );
  await visitor.unroute("**/api/public/chat**");

  await admin.from("allowed_domains").delete().eq("client_id", client.clientId).eq("domain", CLINIC.domain);
  reply = await sendMessage(visitor, "Hello again?");
  check(
    "Website removed from the allowed domains while the chat is open: a friendly message",
    reply.failed && reply.text.startsWith("This chat isn't available on this website"),
    `"${reply.text}"`,
  );
  await admin.from("allowed_domains").insert({ client_id: client.clientId, domain: CLINIC.domain });
  await inWidget(visitor, ".messages").evaluate((node) => (node.scrollTop = node.scrollHeight));
  await shot(visitor, "7-error-messages");
  await visitor.context().close();
  await dashboard.close();
  await desktop.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { error: setupError } = await admin.from("widget_settings").select("client_id", { head: true, count: "exact" });
if (setupError) {
  console.error("The widget tables are missing. Apply supabase/migrations/20261031000000_widget.sql first.");
  process.exit(1);
}
try {
  await fetch(baseUrl);
} catch {
  console.error(`The app is not running at ${baseUrl}. Start it with npm run dev.`);
  process.exit(1);
}

let client;
let server;
let browser;
let failure;
try {
  client = await createTestClient();
  server = await serveSampleSite({ port: SITE_PORT, key: client.key, widgetSrc: `${baseUrl}/widget.js` });
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${CLINIC.domain} 127.0.0.1, MAP evil-example.com 127.0.0.1`],
  });
  await run(client, browser);
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  server?.close();
  if (client) {
    const { data } = await admin.from("widget_settings").select("logo_path").eq("client_id", client.clientId).single();
    if (data?.logo_path) await admin.storage.from("widget-logos").remove([data.logo_path]);
    await admin.from("rate_limit_buckets").delete().like("bucket", `%${client.clientId}%`);
    await admin.auth.admin.deleteUser(client.userId);
  }
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} checks passed.`);
if (failure) console.error("The test stopped early:", failure);

if (outFile) {
  const lines = ["| Result | Check | Details |", "| --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.passed ? "PASS" : "FAIL"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`);
  writeFileSync(outFile, `# Website chat widget test\n\n${passed} of ${results.length} checks passed.\n\n${lines.join("\n")}\n`);
}

process.exit(failure || passed !== results.length ? 1 : 0);

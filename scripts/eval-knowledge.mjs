// End-to-end test of client knowledge: Business Info, document upload and
// processing, search, priority between sources, replace, delete, and
// isolation between two clients. Drives the real dashboard in a headless
// browser, exactly as a client would.
//
// It creates two temporary dentist accounts (no email is sent), runs the
// scenarios, prints every question and answer with the checks, and deletes the
// accounts, their documents and conversations afterwards.
//
// Requirements: the app running (npm run dev), all migrations applied, packs
// synced, and ANTHROPIC_API_KEY, EMBEDDING_API_KEY and SUPABASE_SECRET_KEY set.
//
// Run with: npm run eval:knowledge [-- --out results.md] [--screenshots dir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const CLINIC_A = { name: "Smile Care Dental Clinic", domain: "smilecare-dental.com" };
const CLINIC_B = { name: "Bright Teeth Dental Studio", domain: "brightteeth-studio.com" };

const guideHtml = ({ molarRootCanal }) => `
  <style>body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.5;margin:40px} h1{font-size:20pt} h2{font-size:14pt;margin-top:24px} td{padding:4px 16px 4px 0}</style>
  <h1>Smile Care Dental Clinic - Patient Guide 2026</h1>
  <p>Welcome to Smile Care Dental Clinic. This guide explains our timings, fees and what to expect.</p>
  <h2>Clinic timings</h2>
  <p>Monday to Saturday: 10:00 AM to 2:00 PM and 5:00 PM to 8:30 PM.</p>
  <p>Sunday: closed.</p>
  <h2>Contact</h2>
  <p>Phone and WhatsApp: +91 98450 12345</p>
  <h2>Our dentists</h2>
  <p>Dr. Ananya Rao, BDS, MDS (Endodontics), root canal specialist.</p>
  <h2>Fees</h2>
  <table>
    <tr><td>Consultation</td><td>Rs. 300</td></tr>
    <tr><td>Scaling and polishing</td><td>Rs. 1,200</td></tr>
    <tr><td>Tooth-coloured filling (per tooth)</td><td>Rs. 1,500</td></tr>
    <tr><td>Root canal treatment, front tooth</td><td>Rs. 4,500</td></tr>
    <tr><td>Root canal treatment, back tooth (molar)</td><td>Rs. ${molarRootCanal}</td></tr>
    <tr><td>Ceramic crown</td><td>Rs. 7,000</td></tr>
    <tr><td>In-clinic teeth whitening</td><td>Rs. 8,000</td></tr>
  </table>
  <h2>Teeth whitening at our clinic</h2>
  <p>Our in-clinic whitening session takes about 45 minutes, using an LED-activated gel.</p>
  <h2>Payments</h2>
  <p>We accept UPI, debit and credit cards, and cash. Free parking is available behind the clinic.</p>`;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const devanagariShare = (text) => {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length ? (text.match(/[ऀ-ॿ]/g) ?? []).length / letters.length : 0;
};
const firstSentence = (text) => text.split(/(?<=[.!?।])\s/)[0] ?? text;
const MEDICINE = /\b(ibuprofen|paracetamol|acetaminophen|aspirin|amoxicillin|metronidazole|diclofenac|combiflam|ketorolac|nimesulide|naproxen|chlorhexidine|clove oil|dolo|crocin)\b|\b\d+\s?mg\b/i;
const ANY_PRICE = /₹\s?\d|\brs\.?\s?\d|\binr\s?\d|\d[\d,]*\s?(rupees?)\b|रुपये|रु\.?\s?\d/i;
const CONFIRM = /(confirm|don't have|do not have|not listed|isn't listed|not available|the clinic will|the team will|contact the clinic|पुष्टि)/i;

const check = {
  says: (label, pattern) => ({ name: `Says ${label}`, test: (reply) => pattern.test(reply) }),
  never: (label, pattern) => ({ name: `Never says ${label}`, test: (reply) => !pattern.test(reply) }),
  noPrice: () => ({ name: "Gives no price", test: (reply) => !ANY_PRICE.test(reply) }),
  confirms: () => ({ name: "Says the clinic will confirm", test: (reply) => CONFIRM.test(reply) }),
  hindi: () => ({ name: "Replies in Hindi (Devanagari)", test: (reply) => devanagariShare(reply) > 0.5 }),
  urgentFirst: () => ({
    name: "First sentence: contact the clinic immediately",
    test: (reply) =>
      /(contact|call|reach|visit|get in touch|see)/i.test(firstSentence(reply)) &&
      /(immediately|right away|as soon as|straight away|urgent|today|now)/i.test(firstSentence(reply)),
  }),
  noMedicine: () => ({ name: "Names no medicine or dose", test: (reply) => !MEDICINE.test(reply) }),
};

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function createAccount(browser, clinic) {
  const email = `wa-eval-${clinic.domain.split(".")[0]}-${Date.now().toString(36)}@example.com`;
  const password = `Eval-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/onboarding$/);
  await page.getByLabel("Business name").fill(clinic.name);
  await page.getByText("Dentist", { exact: true }).click();
  await page.getByLabel("Website domain").fill(clinic.domain);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await page.waitForURL(/\/dashboard$/);

  const { data: client } = await admin.from("clients").select("id").eq("user_id", data.user.id).single();
  return { userId: data.user.id, clientId: client.id, page, context, clinic };
}

async function pdf(browser, html) {
  const page = await browser.newPage();
  await page.setContent(html);
  const buffer = await page.pdf({ format: "A4" });
  await page.close();
  return buffer;
}

async function shot(page, name) {
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`), fullPage: true });
}

async function uploadDocument(account, name, buffer) {
  const { page } = account;
  await page.goto(`${baseUrl}/dashboard/documents`);
  await page.getByTestId("upload-input").setInputFiles({ name, mimeType: "application/pdf", buffer });
  return waitForStatus(account, name);
}

async function replaceDocument(account, currentName, name, buffer) {
  const { page } = account;
  await page.goto(`${baseUrl}/dashboard/documents`);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: `Replace ${currentName}` }).click(),
  ]);
  await chooser.setFiles({ name, mimeType: "application/pdf", buffer });
  return waitForStatus(account, name);
}

async function waitForStatus(account, name) {
  const row = account.page.getByTestId("document-row").filter({ hasText: name });
  const status = row.getByTestId("document-status");
  await status.filter({ hasText: /Ready|Failed/ }).waitFor({ timeout: 180_000 });
  const label = (await status.innerText()).trim();
  const error = label === "Failed" ? (await row.getByTestId("document-error").innerText()).trim() : null;
  return { label, error };
}

async function deleteDocument(account, name) {
  const { page } = account;
  await page.goto(`${baseUrl}/dashboard/documents`);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByTestId("document-row").filter({ hasText: name }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByTestId("document-row").filter({ hasText: name }).waitFor({ state: "detached" });
}

async function saveBusinessInfo(account, fill) {
  const { page } = account;
  await page.goto(`${baseUrl}/dashboard/business-info`);
  await fill(page);
  await page.getByRole("button", { name: "Save business info" }).click();
  await page.getByText("Saved. Your assistant now uses these details.").waitFor();
}

async function ask(account, question) {
  const { page } = account;
  if (!page.url().endsWith("/dashboard/assistant")) await page.goto(`${baseUrl}/dashboard/assistant`);
  const newConversation = page.getByRole("button", { name: "New conversation" });
  if (await newConversation.isEnabled()) await newConversation.click();

  await page.getByLabel("Message").fill(question);
  await page.keyboard.press("Enter");
  await page.getByTestId("assistant-message").last().waitFor();
  await page.getByTestId("chat-messages").and(page.locator('[aria-busy="false"]')).waitFor({ timeout: 120_000 });
  return (await page.getByTestId("assistant-message").last().innerText()).trim();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const report = [];
const results = [];

function record(section, item) {
  results.push(item);
  report.push({ section, ...item });
  const pass = item.checks.every((c) => c.pass);
  console.log(`\n[${pass ? "PASS" : "FAIL"}] ${item.title}`);
  if (item.question) console.log(`   Q: ${item.question}`);
  if (item.answer) console.log(`   A: ${item.answer.replace(/\n/g, "\n      ")}`);
  for (const c of item.checks) console.log(`      ${c.pass ? "✓" : "✗"} ${c.name}`);
}

async function askAndCheck(section, account, question, checks, title) {
  const answer = await ask(account, question);
  record(section, {
    title: title ?? `${account.clinic.name}: ${question}`,
    client: account.clinic.name,
    question,
    answer,
    checks: checks.map((c) => ({ name: c.name, pass: Boolean(c.test(answer)) })),
  });
  return answer;
}

function recordFact(section, title, checks) {
  record(section, { title, checks });
}

const browser = await chromium.launch();
const accounts = [];

try {
  await fetch(baseUrl).catch(() => {
    throw new Error(`The app is not running at ${baseUrl}. Start it with npm run dev.`);
  });

  const a = await createAccount(browser, CLINIC_A);
  accounts.push(a);
  const b = await createAccount(browser, CLINIC_B);
  accounts.push(b);

  // 1. Upload a clinic PDF with fees and timings, then ask about them.
  let section = "1. Clinic PDF with fees and timings";
  const guide = await pdf(browser, guideHtml({ molarRootCanal: "6,500" }));
  const uploaded = await uploadDocument(a, "patient-guide-2026.pdf", guide);
  const chunks = await admin.from("document_chunks").select("id", { count: "exact", head: true }).eq("client_id", a.clientId);
  recordFact(section, "The PDF is processed in the background and becomes Ready", [
    { name: `Status is Ready (got ${uploaded.label}${uploaded.error ? `: ${uploaded.error}` : ""})`, pass: uploaded.label === "Ready" },
    { name: `Chunks with embeddings were stored (${chunks.count})`, pass: chunks.count > 0 },
  ]);
  await shot(a.page, "documents-ready");

  await askAndCheck(section, a, "How much does a root canal cost for a back tooth?", [
    check.says("the listed price, Rs. 6,500", /6,?500/),
    check.never("a price that is not in the document", /7,?000|5,?000|8,?000/),
  ]);
  await askAndCheck(section, a, "What are your timings on Saturday?", [
    check.says("10:00 AM to 2:00 PM", /10(:00)?\s?(AM|am)/),
    check.says("5:00 PM to 8:30 PM", /8:30/),
  ]);
  await askAndCheck(section, a, "Are you open on Sunday?", [check.says("closed on Sunday", /closed|not open/i)]);
  await askAndCheck(
    section,
    a,
    "How long does in-clinic teeth whitening take at your clinic?",
    [check.says("45 minutes (from the clinic's document)", /45/), check.never("the general 60 to 90 minutes", /60\s?(to|-|–)\s?90/)],
    `${CLINIC_A.name}: the document overrides the industry pack (whitening time)`,
  );
  await askAndCheck(section, a, "रूट कैनाल का खर्च कितना है?", [check.hindi(), check.says("the listed prices", /4,?500|6,?500/)]);
  await askAndCheck(section, a, "How much do dental implants cost at your clinic?", [check.noPrice(), check.confirms()]);
  await askAndCheck(section, a, "My gum is swollen and bleeding a lot. What should I do?", [
    check.urgentFirst(),
    check.says("the clinic's phone number", /98450\s?12345/),
    check.noMedicine(),
  ]);
  await shot(a.page, "assistant-document-answer");

  // A file without text fails with a clear message.
  const scan = await pdf(browser, `<svg width="500" height="700"><rect width="500" height="700" fill="#ddd"/></svg>`);
  const failed = await uploadDocument(a, "scanned-receipt.pdf", scan);
  recordFact(section, "A scanned PDF without text is marked Failed with a clear message", [
    { name: `Status is Failed (got ${failed.label})`, pass: failed.label === "Failed" },
    { name: `Explains the problem: "${failed.error}"`, pass: /scanned document/.test(failed.error ?? "") },
  ]);
  await shot(a.page, "documents-failed");
  await deleteDocument(a, "scanned-receipt.pdf");

  // 2. Business Info only (no documents): client B.
  section = "2. Business Info only, no documents";
  await saveBusinessInfo(b, async (page) => {
    await page.getByLabel("Phone").fill("+91 99000 11223");
    await page.getByLabel("Monday", { exact: true }).fill("9:00 AM - 6:00 PM");
    await page.getByRole("button", { name: "Copy Monday to weekdays" }).click();
    await page.getByLabel("Saturday", { exact: true }).fill("9:00 AM - 1:00 PM");
    await page.getByLabel("Sunday", { exact: true }).fill("Closed");
    await page.getByRole("button", { name: "+ Add doctor" }).click();
    await page.getByLabel("Doctor 1 name").fill("Dr. Rohan Mehta");
    await page.getByLabel("Doctor 1 qualifications").fill("BDS, MDS (Orthodontics)");
    await page.getByRole("button", { name: "+ Add fee" }).click();
    await page.getByLabel("Fee 1 service").fill("Teeth cleaning");
    await page.getByLabel("Fee 1 price").fill("₹950");
    await page.getByRole("button", { name: "+ Add fee" }).click();
    await page.getByLabel("Fee 2 service").fill("Clear aligners consultation");
    await page.getByLabel("Fee 2 price").fill("Free");
    await page.getByLabel("Current offers").fill("Free dental check-up for children under 12 during November.");
    await page.getByLabel("Languages spoken").fill("English, Hindi, Marathi");
  });
  await shot(b.page, "business-info");
  const bDocs = await admin.from("documents").select("id", { count: "exact", head: true }).eq("client_id", b.clientId);
  recordFact(section, `${CLINIC_B.name} has no documents`, [{ name: `Document count is ${bDocs.count}`, pass: bDocs.count === 0 }]);

  await askAndCheck(section, b, "What are your clinic timings?", [
    check.says("9:00 AM to 6:00 PM on weekdays", /9(:00)?\s?(AM|am).{0,25}6(:00)?\s?(PM|pm)/),
    check.says("1:00 PM on Saturday", /1(:00)?\s?(PM|pm)/),
    check.never("Clinic A's timings", /8:30|2:00\s?PM/i),
  ]);
  await askAndCheck(section, b, "How much is teeth cleaning?", [check.says("₹950", /950/), check.never("Clinic A's Rs. 1,200", /1,?200/)]);
  await askAndCheck(section, b, "Do you have any offers for kids?", [check.says("the November check-up offer", /november/i)]);

  // Priority: Business Info beats the document when they disagree.
  section = "3. Priority between sources";
  await saveBusinessInfo(a, async (page) => {
    await page.getByLabel("Saturday", { exact: true }).fill("10:00 AM - 1:00 PM (half day)");
  });
  await askAndCheck(
    section,
    a,
    "What time do you close on Saturday?",
    [check.says("1:00 PM from Business Info", /1(:00)?\s?(PM|pm)/), check.never("the document's 8:30 PM", /8:30/)],
    `${CLINIC_A.name}: Business Info overrides the document (Saturday hours)`,
  );

  // Replace: the new file's data replaces the old one.
  section = "4. Replace and delete";
  const updatedGuide = await pdf(browser, guideHtml({ molarRootCanal: "7,200" }));
  const replaced = await replaceDocument(a, "patient-guide-2026.pdf", "patient-guide-2026-v2.pdf", updatedGuide);
  recordFact(section, "Replacing the PDF processes the new file", [{ name: `Status is ${replaced.label}`, pass: replaced.label === "Ready" }]);
  await askAndCheck(
    section,
    a,
    "How much does a root canal cost for a back tooth?",
    [check.says("the new price, Rs. 7,200", /7,?200/), check.never("the old price, Rs. 6,500", /6,?500/)],
    `${CLINIC_A.name}: after replacing the PDF, the new price is used`,
  );

  // Delete: the assistant stops using the document.
  await deleteDocument(a, "patient-guide-2026-v2.pdf");
  const [chunksAfter, docsAfter, filesAfter] = await Promise.all([
    admin.from("document_chunks").select("id", { count: "exact", head: true }).eq("client_id", a.clientId),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("client_id", a.clientId),
    admin.storage.from("documents").list(a.clientId),
  ]);
  recordFact(section, "Deleting the PDF removes its knowledge and the stored file", [
    { name: `No chunks left (${chunksAfter.count})`, pass: chunksAfter.count === 0 },
    { name: `No documents left (${docsAfter.count})`, pass: docsAfter.count === 0 },
    { name: `No files left in storage (${filesAfter.data?.length ?? "?"})`, pass: (filesAfter.data ?? []).length === 0 },
  ]);
  await askAndCheck(
    section,
    a,
    "How much does a root canal cost for a back tooth?",
    [check.noPrice(), check.confirms()],
    `${CLINIC_A.name}: after deleting the PDF, the price is no longer known`,
  );
  await askAndCheck(
    section,
    a,
    "Who is the root canal specialist at your clinic?",
    [check.never("the doctor from the deleted PDF", /Ananya|Rao/i), check.confirms()],
    `${CLINIC_A.name}: after deleting the PDF, the doctor is no longer known`,
  );

  // 5. Isolation: each client's data never appears in the other's answers.
  section = "5. Isolation between clients";
  const aGuide = await uploadDocument(a, "patient-guide-2026.pdf", guide);
  recordFact(section, `${CLINIC_A.name} uploads its PDF again`, [{ name: `Status is ${aGuide.label}`, pass: aGuide.label === "Ready" }]);
  await askAndCheck(section, b, "How much does a root canal for a back tooth cost?", [
    check.never("Clinic A's price", /6,?500|4,?500/),
    check.noPrice(),
  ]);
  await askAndCheck(section, b, "Is Dr. Ananya Rao available at your clinic?", [
    check.never("details about Clinic A's doctor", /MDS \(Endodontics\)|Endodontics|root canal specialist/i),
    check.says("its own doctor or that the clinic will confirm", /Rohan|confirm/i),
  ]);
  await askAndCheck(section, b, "What is your phone number?", [
    check.says("its own number", /99000\s?11223/),
    check.never("Clinic A's number", /98450\s?12345/),
  ]);
  await askAndCheck(section, a, "Do you have a free check-up offer for children?", [
    check.never("Clinic B's November offer", /november/i),
  ]);
  await askAndCheck(section, a, "How much is teeth cleaning?", [
    check.says("its own Rs. 1,200", /1,?200/),
    check.never("Clinic B's ₹950", /950/),
  ]);
  await shot(b.page, "assistant-isolation");

  const allChecks = results.flatMap((r) => r.checks);
  const failedChecks = allChecks.filter((c) => !c.pass).length;
  console.log(`\n${allChecks.length - failedChecks} of ${allChecks.length} checks passed.`);

  if (outFile) {
    const lines = ["# Client knowledge test results", "", `${allChecks.length - failedChecks} of ${allChecks.length} checks passed.`];
    let current = "";
    for (const item of report) {
      if (item.section !== current) {
        current = item.section;
        lines.push("", `## ${current}`);
      }
      lines.push("", `### ${item.title}`);
      if (item.question) lines.push("", `**Visitor (${item.client}):** ${item.question}`, "", `**Assistant:** ${item.answer}`);
      lines.push("", ...item.checks.map((c) => `- ${c.pass ? "✓" : "✗"} ${c.name}`));
    }
    writeFileSync(outFile, `${lines.join("\n")}\n`);
    console.log(`Results written to ${outFile}`);
  }
  process.exitCode = failedChecks ? 1 : 0;
} catch (error) {
  console.error(`\n${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  for (const account of accounts) {
    const { data: files } = await admin.storage.from("documents").list(account.clientId);
    for (const folder of files ?? []) {
      const { data: inner } = await admin.storage.from("documents").list(`${account.clientId}/${folder.name}`);
      const paths = (inner ?? []).map((file) => `${account.clientId}/${folder.name}/${file.name}`);
      if (paths.length) await admin.storage.from("documents").remove(paths);
    }
    await admin.auth.admin.deleteUser(account.userId);
  }
}

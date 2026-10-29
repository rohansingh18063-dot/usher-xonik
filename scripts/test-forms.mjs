// Checks that no dashboard form throws away what the client typed. Each form
// gets a mistake that the server refuses: the error must show and the typed
// text must still be there to correct. Forms that save successfully must
// keep (or, for "add" forms, clear) their fields as expected.
//
// It creates a temporary dentist client (no email is sent), signs in to the
// real dashboard in a headless browser, and deletes the client afterwards.
//
// Requirements: the app running (npm run dev), all migrations applied, and
// SUPABASE_SECRET_KEY set.
//
// Run with: npm run test:forms [-- --out results.md]

import { writeFileSync } from "node:fs";
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
const index = process.argv.indexOf("--out");
const outFile = index > -1 ? process.argv[index + 1] : null;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

async function createTestClient() {
  const email = `wa-forms-${Date.now().toString(36)}@example.com`;
  const password = `Forms-${Date.now().toString(36)}-Passw0rd!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`Could not create a test account: ${error.message}`);
  const { data: client, error: clientError } = await admin
    .from("clients")
    .insert({ user_id: data.user.id, business_name: "Form Check Dental", industry: "dentist", website_domain: "formcheck-dental.com" })
    .select("id")
    .single();
  if (clientError) throw new Error(`Could not create a test client: ${clientError.message}`);
  const { data: leadId } = await admin.rpc("submit_lead", {
    p_client_id: client.id,
    p_name: "Asha Nair",
    p_mobile: "+919812345670",
    p_preferred_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    p_preferred_time: "morning",
    p_concern: null,
    p_conversation_id: null,
    p_source_url: null,
  });
  return { email, password, userId: data.user.id, clientId: client.id, leadId };
}

/** Types into a field, submits, waits for the refusal and reports what is left in the field. */
async function refused(page, { field, value, submit, error }) {
  await field.fill(value);
  await submit.click();
  const shown = await page
    .getByText(error)
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true, () => false);
  // Give a late form reset the chance to happen before reading the field.
  await page.waitForTimeout(1000);
  return { shown, kept: (await field.inputValue()) === value };
}

async function run(client, browser) {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(client.email);
  await page.getByLabel("Password").fill(client.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/);

  console.log("\nAPI Key: Add a domain");
  await page.goto(`${baseUrl}/dashboard/api-key`);
  const domainField = page.getByLabel("Add a domain");
  const subdomains = page.getByLabel("Also allow all subdomains (for example book.myclinic.com)");
  await subdomains.check();
  let outcome = await refused(page, {
    field: domainField,
    value: "my clinic . com",
    submit: page.getByRole("button", { name: "Add domain" }),
    error: "Enter a valid domain, for example myclinic.com.",
  });
  const subdomainsKept = await subdomains.isChecked();
  check(
    "A refused domain stays in the field, with its subdomain choice",
    outcome.shown && outcome.kept && subdomainsKept,
    `error shown: ${outcome.shown}; "my clinic . com" still in the field: ${outcome.kept}; subdomains still ticked: ${subdomainsKept}`,
  );
  outcome = await refused(page, {
    field: domainField,
    value: "formcheck-dental.com",
    submit: page.getByRole("button", { name: "Add domain" }),
    error: "formcheck-dental.com is already in your list.",
  });
  check("A duplicate domain stays in the field too", outcome.shown && outcome.kept, `error shown: ${outcome.shown}; kept: ${outcome.kept}`);

  await domainField.fill("book-formcheck.com");
  await page.getByRole("button", { name: "Add domain" }).click();
  await page.getByTestId("domain-row").filter({ hasText: "book-formcheck.com" }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const cleared = (await domainField.inputValue()) === "" && !(await subdomains.isChecked());
  const { data: added } = await admin
    .from("allowed_domains")
    .select("include_subdomains")
    .eq("client_id", client.clientId)
    .eq("domain", "book-formcheck.com")
    .single();
  check(
    "An added domain is saved with its subdomain choice, and the fields clear for the next one",
    cleared && added?.include_subdomains === true,
    `saved with subdomains: ${added?.include_subdomains}; fields cleared: ${cleared}`,
  );

  console.log("\nBusiness Info");
  await page.goto(`${baseUrl}/dashboard/business-info`);
  outcome = await refused(page, {
    field: page.getByLabel("Email", { exact: true }),
    value: "reception-at-clinic",
    submit: page.getByRole("button", { name: "Save business info" }),
    error: "Please fix the highlighted fields.",
  });
  check("A refused clinic email stays in the Business Info form", outcome.shown && outcome.kept, `error shown: ${outcome.shown}; kept: ${outcome.kept}`);

  outcome = await refused(page, {
    field: page.getByLabel("Email addresses for lead alerts"),
    value: "frontdesk@clinic, doctor",
    submit: page.getByRole("button", { name: "Save alert addresses" }),
    error: '"frontdesk@clinic" is not a valid email address.',
  });
  check("Refused lead alert addresses stay in the field", outcome.shown && outcome.kept, `error shown: ${outcome.shown}; kept: ${outcome.kept}`);

  console.log("\nBusiness details");
  await page.goto(`${baseUrl}/dashboard/edit`);
  const nameField = page.getByLabel("Business name");
  await nameField.fill("Form Check Dental Studio");
  outcome = await refused(page, {
    field: page.getByLabel("Website domain"),
    value: "not a website",
    submit: page.getByRole("button", { name: "Save changes" }),
    error: "Enter a valid domain, for example yourbusiness.com.",
  });
  const nameKept = (await nameField.inputValue()) === "Form Check Dental Studio";
  check(
    "A refused website domain keeps every field of the business details form",
    outcome.shown && outcome.kept && nameKept,
    `error shown: ${outcome.shown}; domain kept: ${outcome.kept}; edited business name kept: ${nameKept}`,
  );

  console.log("\nWidget");
  await page.goto(`${baseUrl}/dashboard/widget`);
  await page.getByLabel("Assistant name").fill("Form Check Helper");
  outcome = await refused(page, {
    field: page.locator("#brand-color"),
    value: "#12345",
    submit: page.getByRole("button", { name: "Save changes" }),
    error: "Use a color like #2952e3.",
  });
  const widgetNameKept = (await page.getByLabel("Assistant name").inputValue()) === "Form Check Helper";
  check(
    "A refused brand color keeps every widget setting",
    outcome.shown && outcome.kept && widgetNameKept,
    `error shown: ${outcome.shown}; color kept: ${outcome.kept}; edited name kept: ${widgetNameKept}`,
  );

  console.log("\nLeads notes");
  await page.goto(`${baseUrl}/dashboard/leads/${client.leadId}`);
  const notes = page.locator("#lead-notes");
  await page.locator("#lead-status").selectOption("contacted");
  await notes.fill("Called twice, no answer. Try again after 5 PM.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  const notesKept = (await notes.inputValue()) === "Called twice, no answer. Try again after 5 PM.";
  const statusKept = (await page.locator("#lead-status").inputValue()) === "contacted";
  check(
    "Lead notes and status stay on screen after saving",
    notesKept && statusKept,
    `notes kept: ${notesKept}; status kept: ${statusKept}`,
  );
}

let client;
let browser;
let failure;
try {
  client = await createTestClient();
  browser = await chromium.launch();
  await run(client, browser);
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  if (client) await admin.auth.admin.deleteUser(client.userId);
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} checks passed.`);
if (failure) console.error("The test stopped early:", failure);

if (outFile) {
  const lines = ["| Result | Check | Details |", "| --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.passed ? "PASS" : "FAIL"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`);
  writeFileSync(outFile, `# Dashboard forms test\n\n${passed} of ${results.length} checks passed.\n\n${lines.join("\n")}\n`);
}

process.exit(failure || passed !== results.length ? 1 : 0);

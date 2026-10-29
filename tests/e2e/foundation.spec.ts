// End-to-end tests against a real Supabase project.
//
// Walks two businesses through sign up, onboarding, the dashboard and editing,
// then attacks the Supabase API directly as one business to prove it cannot
// see or change the other's data.
//
// Requirements:
// - .env.local points at your Supabase project (see README).
// - "Confirm email" is turned off in Supabase (Authentication > Sign In / Providers > Email)
//   while the tests run, so new accounts can sign in straight away.
// - Optional: SUPABASE_SECRET_KEY, so the test accounts are deleted afterwards.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const isConfigured = /^https:\/\/.+/.test(url) && !/your-project-ref|placeholder/.test(url) && publishableKey !== "";

const runId = Date.now().toString(36);
const emailDomain = process.env.E2E_EMAIL_DOMAIN ?? "example.com";
const password = `Test-${runId}-Passw0rd!`;

const alice = {
  email: `wa-e2e-alice-${runId}@${emailDomain}`,
  businessName: `Bright Smile Dental ${runId}`,
  renamedTo: `Bright Smile Family Dental ${runId}`,
  industry: "Dentist",
  domain: "https://www.BrightSmile-Dental.com/contact",
  expectedDomain: "brightsmile-dental.com",
  userId: "",
  clientId: "",
};

const bob = {
  email: `wa-e2e-bob-${runId}@${emailDomain}`,
  businessName: `Corner Pharmacy ${runId}`,
  industry: "Pharmacy",
  domain: "cornerpharmacy.co.uk",
  expectedDomain: "cornerpharmacy.co.uk",
  userId: "",
  clientId: "",
};

function apiClient(key = publishableKey) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedInApi(email: string): Promise<{ api: SupabaseClient; userId: string }> {
  const api = apiClient();
  const { data, error } = await api.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { api, userId: data.user.id };
}

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  const onboarding = page.getByRole("heading", { name: "Tell us about your business" });
  const confirmEmail = page.getByRole("heading", { name: "Check your email" });
  // Scoped to the form: Next.js keeps its own role="alert" route announcer on every page.
  const form = page.locator("form");
  const problem = form.getByRole("alert").or(form.locator("[aria-invalid=true]"));
  await expect(onboarding.or(confirmEmail).or(problem).first()).toBeVisible();

  if (await confirmEmail.isVisible()) {
    throw new Error('Supabase requires email confirmation. Turn off "Confirm email" while running these tests.');
  }
  if (!(await onboarding.isVisible())) {
    throw new Error(`Sign up failed: ${await page.locator("form").innerText()}`);
  }
  await expect(page).toHaveURL(/\/onboarding$/);
}

// By role, not label: Next.js keeps recently visited pages mounted but hidden,
// so after leaving Settings its own "Business name" field is still in the DOM.
function businessName(page: Page) {
  return page.getByRole("textbox", { name: "Business name" });
}

async function fillBusinessForm(page: Page, business: { businessName: string; industry: string; domain: string }) {
  await businessName(page).fill(business.businessName);
  await page.getByText(business.industry, { exact: true }).click();
  await page.getByLabel("Website domain").fill(business.domain);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe("with a live Supabase project", () => {
  test.skip(!isConfigured, "Set your Supabase project settings in .env.local to run these tests.");
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    if (!secretKey) return;
    const admin = apiClient(secretKey);
    // The IDs are only recorded by the API test, so look up accounts by email
    // when an earlier test failed.
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const account of [alice, bob]) {
      const userId = account.userId || data?.users.find((user) => user.email === account.email)?.id;
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a new client can sign up, describe their business and see it on the dashboard", async ({ page }) => {
    await signUp(page, alice.email);

    // Validation runs before anything is saved.
    await page.getByRole("button", { name: "Continue to dashboard" }).click();
    await expect(page.getByText("Business name must be at least 2 characters.")).toBeVisible();
    await expect(page.getByText("Choose your industry.")).toBeVisible();
    await expect(page.getByText("Enter your website domain.")).toBeVisible();

    await fillBusinessForm(page, { ...alice, domain: "not a domain" });
    await page.getByRole("button", { name: "Continue to dashboard" }).click();
    await expect(page.getByText("Enter a valid domain, for example yourbusiness.com.")).toBeVisible();
    await expect(businessName(page)).toHaveValue(alice.businessName);

    await page.getByLabel("Website domain").fill(alice.domain);
    await page.getByRole("button", { name: "Continue to dashboard" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("business-title")).toHaveText(alice.businessName);

    // Business details live in Settings.
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    await expect(page.getByTestId("business-name")).toHaveText(alice.businessName);
    await expect(page.getByTestId("industry")).toHaveText(alice.industry);
    await expect(page.getByTestId("website-domain")).toHaveText(alice.expectedDomain);
    await expect(page.getByTestId("account-email")).toHaveText(alice.email);
    await expect(page.getByTestId("created-at")).not.toBeEmpty();

    // Onboarding is only shown once.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a client can edit their business details", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(alice.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/dashboard/settings");
    await page.getByRole("link", { name: "Edit details" }).click();
    await expect(page).toHaveURL(/\/dashboard\/edit$/);
    await expect(businessName(page)).toHaveValue(alice.businessName);
    await expect(page.getByLabel("Website domain")).toHaveValue(alice.expectedDomain);
    await expect(page.getByRole("radio", { name: /Dentist/ })).toBeChecked();

    await businessName(page).fill(alice.renamedTo);
    await page.getByText("Other", { exact: true }).click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/dashboard\/settings\?saved=1$/);
    await expect(page.getByText("Your business details have been updated.")).toBeVisible();
    await expect(page.getByTestId("business-name")).toHaveText(alice.renamedTo);
    await expect(page.getByTestId("industry")).toHaveText("Other");

    // Cancelling an edit keeps the saved values.
    await page.getByRole("link", { name: "Edit details" }).click();
    await businessName(page).fill("Should not be saved");
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByTestId("business-name")).toHaveText(alice.renamedTo);
  });

  test("a client can sign out and sign back in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(alice.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await signOut(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(alice.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("business-title")).toHaveText(alice.renamedTo);

    // Signed-in clients skip the sign-in and sign-up pages.
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a client can chat with their own assistant on the Test Assistant page", async ({ page }) => {
    test.skip(!process.env.ANTHROPIC_API_KEY, "Set ANTHROPIC_API_KEY to test the assistant.");
    test.setTimeout(120_000);

    await page.goto("/login");
    await page.getByLabel("Email").fill(alice.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("link", { name: "Test Assistant" }).click();
    await expect(page).toHaveURL(/\/dashboard\/assistant$/);
    await expect(page.getByText(alice.renamedTo).first()).toBeVisible();

    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Do you offer teeth cleaning?");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("visitor-message")).toHaveText("Do you offer teeth cleaning?");

    const reply = page.getByTestId("assistant-message").last();
    await expect(reply).not.toBeEmpty({ timeout: 60_000 });
    await expect(page.getByTestId("chat-messages")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    await expect(reply).not.toHaveClass(/bg-red-50/);

    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  });

  test("a second client only ever sees their own business in the app", async ({ page }) => {
    await signUp(page, bob.email);
    await fillBusinessForm(page, bob);
    await page.getByRole("button", { name: "Continue to dashboard" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("business-title")).toHaveText(bob.businessName);
    await expect(page.locator("body")).not.toContainText(alice.renamedTo);
    await expect(page.locator("body")).not.toContainText(alice.expectedDomain);

    await page.goto("/dashboard/settings");
    await expect(page.getByTestId("business-name")).toHaveText(bob.businessName);
    await expect(page.getByTestId("industry")).toHaveText(bob.industry);
    await expect(page.getByTestId("website-domain")).toHaveText(bob.expectedDomain);
    await expect(page.locator("body")).not.toContainText(alice.renamedTo);
    await expect(page.locator("body")).not.toContainText(alice.expectedDomain);

    await page.goto("/dashboard/edit");
    await expect(businessName(page)).toHaveValue(bob.businessName);
  });

  test("the Supabase API never lets one client read or change another client's data", async () => {
    const asAlice = await signedInApi(alice.email);
    const asBob = await signedInApi(bob.email);
    alice.userId = asAlice.userId;
    bob.userId = asBob.userId;

    const aliceRows = await asAlice.api.from("clients").select("*");
    expect(aliceRows.error).toBeNull();
    expect(aliceRows.data).toHaveLength(1);
    alice.clientId = aliceRows.data![0].id;

    // Bob can list only his own business.
    const bobRows = await asBob.api.from("clients").select("*");
    expect(bobRows.error).toBeNull();
    expect(bobRows.data).toHaveLength(1);
    expect(bobRows.data![0].business_name).toBe(bob.businessName);
    bob.clientId = bobRows.data![0].id;

    // Asking for Alice's business by id returns nothing.
    const byId = await asBob.api.from("clients").select("*").eq("id", alice.clientId);
    expect(byId.data).toEqual([]);

    // Bob cannot change, delete or impersonate Alice's business.
    const update = await asBob.api
      .from("clients")
      .update({ business_name: "Hacked" })
      .eq("id", alice.clientId)
      .select();
    expect(update.data ?? []).toEqual([]);

    const remove = await asBob.api.from("clients").delete().eq("id", alice.clientId);
    expect(remove.error?.code).toBe("42501");

    const impersonate = await asBob.api.from("clients").insert({
      user_id: alice.userId,
      business_name: "Fake Business",
      industry: "other",
      website_domain: "fake-business.com",
    });
    expect(impersonate.error?.code).toBe("42501");

    const reassign = await asBob.api.from("clients").update({ user_id: alice.userId }).eq("id", bob.clientId);
    expect(reassign.error?.code).toBe("42501");

    const aliceAfter = await asAlice.api.from("clients").select("business_name").single();
    expect(aliceAfter.data?.business_name).toBe(alice.renamedTo);

    // Signed-out visitors cannot read any business.
    const anonymous = await apiClient().from("clients").select("*");
    expect(anonymous.error?.code).toBe("42501");
  });

  test("document storage is isolated per client", async () => {
    const asAlice = await signedInApi(alice.email);
    const asBob = await signedInApi(bob.email);
    const file = new Blob(["Opening hours: Mon-Fri 9:00-17:00"], { type: "text/plain" });

    const own = await asAlice.api.storage.from("documents").upload(`${alice.clientId}/opening-hours.txt`, file);
    expect(own.error).toBeNull();

    const planted = await asBob.api.storage.from("documents").upload(`${alice.clientId}/planted.txt`, file);
    expect(planted.error).not.toBeNull();

    const listed = await asBob.api.storage.from("documents").list(alice.clientId);
    expect(listed.data ?? []).toEqual([]);

    const download = await asBob.api.storage.from("documents").download(`${alice.clientId}/opening-hours.txt`);
    expect(download.data).toBeNull();

    const removed = await asAlice.api.storage.from("documents").remove([`${alice.clientId}/opening-hours.txt`]);
    expect(removed.error).toBeNull();
  });
});

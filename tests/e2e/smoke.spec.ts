// Checks that work without a Supabase project: pages render, signed-out
// visitors are kept out of the app, and forms validate input.

import { expect, test } from "@playwright/test";

test("home page introduces the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("assistant on your website");
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
});

for (const path of ["/dashboard", "/dashboard/edit", "/onboarding"]) {
  test(`signed-out visitors are sent from ${path} to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
}

test("sign-up form validates email and password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
});

test("sign-in form requires a password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@business.test");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});

test("an invalid confirmation link shows a clear message", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=invalid");
  await expect(page).toHaveURL(/\/login\?error=confirmation$/);
  await expect(page.getByText("That confirmation link is invalid or has expired.")).toBeVisible();
});

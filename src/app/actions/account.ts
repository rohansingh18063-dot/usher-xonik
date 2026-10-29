"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DELETE_CONFIRMATION } from "@/lib/account";
import { getCurrentBusiness, requireUser } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { LOGO_BUCKET } from "@/lib/widget";

export type AccountFormState = { error?: string; fieldErrors?: Record<string, string>; saved?: boolean; message?: string };

const DOCUMENTS_BUCKET = "documents";

/**
 * Checks the signed-in user's current password with a separate sign-in that
 * does not touch the browser's session, then ends that extra session.
 */
async function passwordMatches(email: string, password: string) {
  if (!password) return false;
  const { url, key } = getSupabaseConfig();
  const check = createStatelessClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return false;
  await check.auth.signOut({ scope: "local" });
  return true;
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Profile and business name
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  fullName: z.string().trim().max(80, "Use 80 characters or fewer."),
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(120, "Business name must be 120 characters or fewer."),
});

export async function updateProfile(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const [, business] = await Promise.all([requireUser(), getCurrentBusiness()]);
  if (!business) return { error: "Please finish setting up your business first." };

  const parsed = profileSchema.safeParse({ fullName: formData.get("fullName") ?? "", businessName: formData.get("businessName") ?? "" });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const [user, client] = await Promise.all([
    supabase.auth.updateUser({ data: { full_name: parsed.data.fullName } }),
    supabase.from("clients").update({ business_name: parsed.data.businessName }).eq("id", business.id).select("id"),
  ]);
  if (user.error || client.error || client.data.length === 0) {
    return { error: "We couldn't save your profile. Please try again." };
  }

  revalidatePath("/dashboard", "layout");
  return { saved: true, message: "Profile saved." };
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function changePassword(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!current) fieldErrors.currentPassword = "Enter your current password.";
  if (next.length < 8) fieldErrors.newPassword = "Use at least 8 characters.";
  else if (next.length > 72) fieldErrors.newPassword = "Use 72 characters or fewer.";
  else if (next === current) fieldErrors.newPassword = "Choose a password different from your current one.";
  if (confirm !== next) fieldErrors.confirmPassword = "The two new passwords do not match.";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors };

  if (!(await passwordMatches(user.email, current))) {
    return { error: "Your current password is not correct.", fieldErrors: { currentPassword: "This password is not correct." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return {
      error:
        error.code === "weak_password"
          ? "That password is too easy to guess. Please choose a stronger one."
          : "We couldn't change your password. Please try again.",
    };
  }
  return { saved: true, message: "Password changed. Use your new password the next time you sign in." };
}

// ---------------------------------------------------------------------------
// Login email
// ---------------------------------------------------------------------------

export async function changeEmail(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!z.email().safeParse(email).success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: { email: "Enter a valid email address." } };
  }
  if (email === user.email.toLowerCase()) {
    return { error: "Please fix the highlighted fields.", fieldErrors: { email: "This is already your login email." } };
  }
  if (!(await passwordMatches(user.email, password))) {
    return { error: "Your password is not correct.", fieldErrors: { password: "This password is not correct." } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${siteUrl()}/auth/confirm` });
  if (error) {
    if (error.code === "email_exists") return { error: "Another account already uses this email address." };
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Too many emails were sent recently. Please try again in an hour." };
    }
    return { error: "We couldn't change your login email. Please try again." };
  }

  if (data.user?.email?.toLowerCase() === email) {
    revalidatePath("/dashboard", "layout");
    return { saved: true, message: `Your login email is now ${email}.` };
  }
  return {
    saved: true,
    message: `We sent a confirmation link to ${email}. Your login email changes once you open it.`,
  };
}

// ---------------------------------------------------------------------------
// Delete account
// ---------------------------------------------------------------------------

/**
 * Deletes the account and everything that belongs to it: stored documents
 * and the widget logo first, then the user. Deleting the user removes the
 * business, and with it (by cascade) its conversations, leads, documents,
 * search chunks, keys, domains, widget settings, alerts and knowledge gaps.
 */
export async function deleteAccount(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser();
  const business = await getCurrentBusiness();

  if (String(formData.get("confirmation") ?? "").trim() !== DELETE_CONFIRMATION) {
    return { fieldErrors: { confirmation: `Type ${DELETE_CONFIRMATION} to confirm.` }, error: "Please confirm the deletion." };
  }
  if (!(await passwordMatches(user.email, String(formData.get("password") ?? "")))) {
    return { error: "Your password is not correct.", fieldErrors: { password: "This password is not correct." } };
  }

  const admin = createAdminClient();
  try {
    if (business) await removeStoredFiles(admin, business.id);
  } catch (error) {
    console.error("Removing stored files failed:", error);
    return { error: "We couldn't delete your files. Nothing was deleted; please try again." };
  }

  if (business) await admin.from("rate_limit_buckets").delete().like("bucket", `%${business.id}%`);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("Deleting the account failed:", error);
    return { error: "We couldn't delete your account. Please try again." };
  }

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  redirect("/?account=deleted");
}

async function removeStoredFiles(admin: ReturnType<typeof createAdminClient>, clientId: string) {
  const [documents, widget] = await Promise.all([
    admin.from("documents").select("storage_path").eq("client_id", clientId),
    admin.from("widget_settings").select("logo_path").eq("client_id", clientId).maybeSingle(),
  ]);
  if (documents.error || widget.error) throw new Error("Could not list stored files.");

  // Every file is stored under <client id>/<document id>/; list the folders
  // too, so nothing is left behind even if a database row is missing.
  const paths = new Set(documents.data.map((document) => document.storage_path));
  const folders = await admin.storage.from(DOCUMENTS_BUCKET).list(clientId, { limit: 1000 });
  if (folders.error) throw folders.error;
  for (const folder of folders.data) {
    const files = await admin.storage.from(DOCUMENTS_BUCKET).list(`${clientId}/${folder.name}`, { limit: 1000 });
    if (files.error) throw files.error;
    for (const file of files.data) paths.add(`${clientId}/${folder.name}/${file.name}`);
  }

  const all = [...paths];
  for (let start = 0; start < all.length; start += 100) {
    const removed = await admin.storage.from(DOCUMENTS_BUCKET).remove(all.slice(start, start + 100));
    if (removed.error) throw removed.error;
  }
  if (widget.data?.logo_path) {
    const removed = await admin.storage.from(LOGO_BUCKET).remove([widget.data.logo_path]);
    if (removed.error) throw removed.error;
  }
}

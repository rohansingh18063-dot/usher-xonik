"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { firstErrors } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
  email?: string;
  confirmationSentTo?: string;
};

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

const signUpSchema = z.object({
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be 72 characters or fewer."),
});

const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  return headerList.get("origin") ?? `${protocol}://${host}`;
}

export async function signUp(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readCredentials(formData);
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error), email: input.email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
  });

  if (error) {
    if (error.code === "user_already_exists") {
      return { error: "An account with this email already exists. Please sign in instead.", email: input.email };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: error.message }, email: input.email };
    }
    if (error.code === "email_address_invalid") {
      return { fieldErrors: { email: "This email address can't be used. Please try another." }, email: input.email };
    }
    if (error.code === "over_email_send_rate_limit") {
      return {
        error: "We can't send confirmation emails right now. Please try again in about an hour.",
        email: input.email,
      };
    }
    if (error.status === 429) {
      return { error: "Too many attempts. Please wait a few minutes and try again.", email: input.email };
    }
    return { error: "We couldn't create your account. Please try again.", email: input.email };
  }

  // Email confirmation is enabled in Supabase: the user must click the link
  // in their inbox before they can sign in.
  if (!data.session) {
    return { confirmationSentTo: parsed.data.email };
  }

  redirect("/onboarding");
}

export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = readCredentials(formData);
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error), email: input.email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error: "Please confirm your email address first. Check your inbox for the link we sent you.",
        email: input.email,
      };
    }
    if (error.status === 429) {
      return { error: "Too many attempts. Please wait a few minutes and try again.", email: input.email };
    }
    if (error.code !== "invalid_credentials") {
      return { error: "We couldn't sign you in right now. Please try again.", email: input.email };
    }
    return { error: "Incorrect email or password.", email: input.email };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

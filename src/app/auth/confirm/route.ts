import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Target of the link in the sign-up confirmation email. Supports both the
 * token-hash link (recommended email template) and the default code link.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let confirmed = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    confirmed = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }

  if (confirmed && type === "email_change") redirect("/dashboard/settings?email=changed");
  redirect(confirmed ? "/onboarding" : "/login?error=confirmation");
}

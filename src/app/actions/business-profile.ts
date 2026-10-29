"use server";

import { revalidatePath } from "next/cache";
import { profileSchema, toRow, type ProfileFormState } from "@/lib/business-profile";
import { getCurrentBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export async function saveBusinessProfile(_previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please finish setting up your business first." };

  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("profile") ?? ""));
  } catch {
    return { error: "We couldn't read the form. Please try again." };
  }

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      fieldErrors[path] ??= issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  const row = toRow(parsed.data);
  const supabase = await createClient();

  // Row Level Security limits both statements to the signed-in client's row.
  const updated = await supabase.from("business_profiles").update(row).eq("client_id", business.id).select("client_id");
  if (updated.error) return { error: "We couldn't save your business info. Please try again." };

  if (updated.data.length === 0) {
    const inserted = await supabase.from("business_profiles").insert({ client_id: business.id, ...row });
    if (inserted.error) return { error: "We couldn't save your business info. Please try again." };
  }

  revalidatePath("/dashboard/business-info");
  return { saved: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { businessSchema, firstErrors, readBusinessForm, type BusinessFormState } from "@/lib/business";
import { requireUser } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const UNIQUE_VIOLATION = "23505";

export async function createBusiness(_previous: BusinessFormState, formData: FormData): Promise<BusinessFormState> {
  await requireUser();

  const values = readBusinessForm(formData);
  const parsed = businessSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error), values };
  }

  const supabase = await createClient();
  // user_id is filled in by the database from the session.
  const { error } = await supabase.from("clients").insert(parsed.data);

  if (error && error.code !== UNIQUE_VIOLATION) {
    return { error: "We couldn't save your business details. Please try again.", values };
  }

  // On a unique violation the business already exists (for example the form
  // was submitted twice), so continue to the dashboard either way.
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function updateBusiness(_previous: BusinessFormState, formData: FormData): Promise<BusinessFormState> {
  const user = await requireUser();

  const values = readBusinessForm(formData);
  const parsed = businessSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: firstErrors(parsed.error), values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .update(parsed.data)
    .eq("user_id", user.id)
    .select("id");

  if (error || data.length === 0) {
    return { error: "We couldn't update your business details. Please try again.", values };
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/settings?saved=1");
}

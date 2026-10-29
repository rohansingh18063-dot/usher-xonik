"use server";

import { getCurrentBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { widgetSettingsSchema, type WidgetFormState, type WidgetSettingsInput } from "@/lib/widget";

export async function saveWidgetSettings(input: WidgetSettingsInput): Promise<WidgetFormState> {
  const business = await getCurrentBusiness();
  if (!business) return { error: "Please finish setting up your business first." };

  const parsed = widgetSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  const { assistantName, brandColor, position, welcomeMessage, quickReplies } = parsed.data;
  const supabase = await createClient();

  // Row Level Security limits the update to the signed-in client's settings.
  const { data, error } = await supabase
    .from("widget_settings")
    .update({
      assistant_name: assistantName,
      brand_color: brandColor,
      position,
      welcome_message: welcomeMessage,
      quick_replies: quickReplies,
    })
    .eq("client_id", business.id)
    .select("client_id");
  if (error || data.length === 0) return { error: "We couldn't save your widget settings. Please try again." };

  // The form already shows the saved values, and the page loads fresh on every visit.
  return { saved: true };
}

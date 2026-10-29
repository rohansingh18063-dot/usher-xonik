import "server-only";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { LOGO_BUCKET, type WidgetConfig } from "@/lib/widget";

type WidgetRow = Database["public"]["Tables"]["widget_settings"]["Row"];

/** Public address of a stored logo. The file name is random and reveals nothing about the client. */
export function logoUrl(path: string | null) {
  if (!path) return null;
  return `${getSupabaseConfig().url}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}

export function toWidgetConfig(row: WidgetRow, business: { name: string; available: boolean }): WidgetConfig {
  return {
    businessName: business.name,
    assistantName: row.assistant_name,
    logoUrl: logoUrl(row.logo_path),
    brandColor: row.brand_color,
    position: row.position,
    welcomeMessage: row.welcome_message,
    quickReplies: row.quick_replies,
    available: business.available,
  };
}

/** The address the widget script is served from, used in the embed code. */
export function widgetScriptUrl() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${site}/widget.js`;
}

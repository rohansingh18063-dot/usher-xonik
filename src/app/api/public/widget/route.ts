import { after } from "next/server";
import { visitorIpHash, withinRateLimit } from "@/lib/public-api/guard";
import { LOCALHOST, originHostname } from "@/lib/public-api/origin";
import { checkAccess, hasCors, reject, unavailable, type Checked } from "@/lib/public-api/http";
import { toWidgetConfig } from "@/lib/widget-server";

/**
 * Widget settings for a client's website, loaded by widget.js on every page.
 *
 *   GET /api/public/widget?key=pk_live_...
 *
 * Only the client's allowed domains get a readable answer (CORS), so the
 * widget does not appear on any other website. A paused assistant still
 * returns its settings with "available": false, so the widget can tell
 * visitors it is not answering right now. Nothing is cached, so changes made
 * in the dashboard show on the next page load. The first answer to a real
 * website marks the widget as installed.
 */

/** Page loads per minute from one visitor IP; generous, as every page view loads the settings. */
const PAGE_LOADS_PER_MINUTE = 120;

export async function GET(request: Request) {
  let checked: Checked;
  try {
    checked = await checkAccess(request);
  } catch (error) {
    console.error("Widget settings lookup failed:", error);
    return unavailable({});
  }

  const { admin, client, origin, cors } = checked;
  if (!client) return reject(checked, "invalid_key");
  if (!origin) return reject(checked, "missing_origin");
  if (!hasCors(checked)) return reject(checked, "origin_not_allowed");

  try {
    if (!(await withinRateLimit(admin, `widget:${client.id}:${visitorIpHash(request)}`, PAGE_LOADS_PER_MINUTE))) {
      return reject(checked, "ip_rate_limited");
    }

    const { data, error } = await admin.from("widget_settings").select("*").eq("client_id", client.id).single();
    if (error) throw new Error(error.message);

    // The first page view on a real allowed website (not localhost in test
    // mode) means the widget is installed.
    if (!data.installed_at && originHostname(origin) !== LOCALHOST) {
      after(async () => {
        const { error: markError } = await admin
          .from("widget_settings")
          .update({ installed_at: new Date().toISOString(), installed_origin: origin.slice(0, 255) })
          .eq("client_id", client.id)
          .is("installed_at", null);
        if (markError) console.error("Marking the widget as installed failed:", markError);
      });
    }

    return Response.json(toWidgetConfig(data, { name: client.business_name, available: !client.assistant_paused }), {
      headers: { ...cors, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Widget settings failed:", error);
    return unavailable(cors);
  }
}

import { after } from "next/server";
import { addDays, formatMobile, leadRequestSchema, leadsTimeZone, todayIn } from "@/lib/leads";
import { notifyNewLead } from "@/lib/notifications";
import { visitorIpHash, withinRateLimit } from "@/lib/public-api/guard";
import {
  accessProblem,
  checkAccess,
  errorResponse,
  preflight,
  reject,
  unavailable,
  type Checked,
} from "@/lib/public-api/http";

/**
 * Appointment and callback requests from the website widget.
 *
 *   POST /api/public/leads?key=pk_live_...
 *   Content-Type: application/json
 *   { "sessionId": "<uuid>", "name": "...", "mobile": "...", "preferredDate": "YYYY-MM-DD",
 *     "preferredTime": "morning" | "afternoon" | "evening", "concern": "...",
 *     "consent": true, "pageUrl": "https://..." }
 *
 * Same key, pause and domain checks as the chat API. Requests are not counted
 * against the monthly message limit: they are what the clinic pays for. The
 * same number can send one request per clinic every 10 minutes. Alerts go
 * out right after the response is sent.
 */

/** Requests per minute from one visitor IP, against form spam. */
const LEADS_PER_MINUTE = 5;

const DUPLICATE_MESSAGE =
  "We already have your request from the last few minutes. The clinic will call you soon to confirm a time.";

export const OPTIONS = preflight;

export async function POST(request: Request) {
  let checked: Checked;
  try {
    checked = await checkAccess(request);
  } catch (error) {
    console.error("Lead request lookup failed:", error);
    return unavailable({});
  }

  const problem = accessProblem(checked);
  if (problem) return reject(checked, problem);
  const client = checked.client!;
  const { admin, cors } = checked;

  // Yesterday in the clinic's time zone, so visitors in other time zones are never refused for "today".
  const schema = leadRequestSchema(addDays(todayIn(leadsTimeZone()), -1));
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".")] ??= issue.message;
    return Response.json(
      { error: { code: "invalid_lead", message: "Please check the highlighted details.", fields } },
      { status: 400, headers: { ...cors, "Cache-Control": "no-store", Vary: "Origin" } },
    );
  }
  const lead = parsed.data;

  try {
    if (!(await withinRateLimit(admin, `lead:${client.id}:${visitorIpHash(request)}`, LEADS_PER_MINUTE))) {
      return reject(checked, "ip_rate_limited");
    }

    const { data: leadId, error } = await admin.rpc("submit_lead", {
      p_client_id: client.id,
      p_name: lead.name,
      p_mobile: lead.mobile,
      p_preferred_date: lead.preferredDate,
      p_preferred_time: lead.preferredTime,
      p_concern: lead.concern,
      p_conversation_id: lead.sessionId ?? null,
      p_source_url: lead.pageUrl,
    });
    if (error) throw new Error(error.message);
    if (!leadId) return errorResponse("duplicate_lead", DUPLICATE_MESSAGE, 409, cors);

    after(() => notifyNewLead(admin, leadId));

    return Response.json(
      {
        lead: {
          name: lead.name,
          mobile: formatMobile(lead.mobile),
          preferredDate: lead.preferredDate,
          preferredTime: lead.preferredTime,
        },
      },
      { status: 201, headers: { ...cors, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Saving a lead failed:", error);
    return unavailable(cors);
  }
}

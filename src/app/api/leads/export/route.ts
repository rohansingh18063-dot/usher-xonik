import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { LEAD_STATUS_LABELS, leadsTimeZone, PREFERRED_TIME_LABELS, todayIn } from "@/lib/leads";
import { leadsQuery, MAX_EXPORT_ROWS, parseLeadFilters } from "@/lib/leads-query";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in client's leads as a CSV file, with the same search and
 * filters as the Leads page (?q=&status=&from=&to=).
 */
export async function GET(request: Request) {
  const business = (await getCurrentUser()) ? await getCurrentBusiness() : null;
  if (!business) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseLeadFilters(params);
  const supabase = await createClient();
  const { data, error } = await leadsQuery(supabase, business.id, filters).limit(MAX_EXPORT_ROWS);
  if (error) return Response.json({ error: "Could not export your leads." }, { status: 500 });

  const received = new Intl.DateTimeFormat("en-CA", {
    timeZone: leadsTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const rows = [
    ["Received", "Name", "Mobile", "Preferred date", "Preferred time", "Treatment or concern", "Status", "Notes", "Page"],
    ...data.map((lead) => [
      received.format(new Date(lead.created_at)).replace(",", ""),
      text(lead.name),
      lead.mobile,
      lead.preferred_date,
      PREFERRED_TIME_LABELS[lead.preferred_time],
      text(lead.concern),
      LEAD_STATUS_LABELS[lead.status],
      text(lead.notes),
      text(lead.source_url),
    ]),
  ];
  // The byte order mark lets spreadsheet apps read names in any language correctly.
  const csv = "﻿" + rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${todayIn(leadsTimeZone())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Free text typed by visitors or staff; a leading formula character is neutralized so spreadsheets show it as text. */
function text(value: string | null) {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

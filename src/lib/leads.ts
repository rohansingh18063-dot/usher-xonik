// Appointment requests (leads): validation and labels shared by the public
// API, the dashboard and the tests. The widget repeats the mobile number and
// date checks in plain JavaScript for instant feedback; the server decides.

import { z } from "zod";

export const PREFERRED_TIMES = ["morning", "afternoon", "evening"] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

export const PREFERRED_TIME_LABELS: Record<PreferredTime, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export const LEAD_STATUSES = ["new", "contacted", "booked", "not_interested"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  booked: "Booked",
  not_interested: "Not interested",
};

export const MAX_LEAD_NAME = 80;
export const MAX_CONCERN = 500;
export const MAX_NOTES = 5000;
/** How far ahead a visitor may ask for an appointment. */
export const MAX_DAYS_AHEAD = 180;

/**
 * Turns what a visitor typed into an international number (+919845012345).
 * Without a country code it must be an Indian mobile number: 10 digits
 * starting with 6 to 9, optionally written with a leading 0 or 91. With a
 * "+" (or "00") and a country code, any number of 8 to 15 digits is accepted.
 */
export function normalizeMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^(\+|00)?\d+$/.test(compact)) return null;

  if (compact.startsWith("+") || compact.startsWith("00")) {
    const digits = compact.replace(/^(\+|00)/, "");
    if (digits.startsWith("91")) return isIndianMobile(digits.slice(2)) ? `+${digits}` : null;
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  const local = compact.length === 11 && compact.startsWith("0") ? compact.slice(1) : compact;
  if (isIndianMobile(local)) return `+91${local}`;
  if (local.length === 12 && local.startsWith("91") && isIndianMobile(local.slice(2))) return `+${local}`;
  return null;
}

function isIndianMobile(digits: string) {
  return /^[6-9]\d{9}$/.test(digits);
}

/** +919845012345 → +91 98450 12345; other countries are shown as stored. */
export function formatMobile(mobile: string) {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(mobile);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : mobile;
}

export const MOBILE_ERROR =
  "Enter a valid mobile number: 10 digits, or your country code and number (for example +44 7700 900123).";

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * What the widget sends. `earliest` is yesterday in the clinic's time zone,
 * so a visitor a few hours ahead of or behind the clinic is never refused.
 */
export function leadRequestSchema(earliest: string) {
  const latest = addDays(earliest, MAX_DAYS_AHEAD + 1);
  return z.object({
    sessionId: z.uuid().optional(),
    name: z
      .string()
      .trim()
      .min(2, "Enter your name.")
      .max(MAX_LEAD_NAME, `Use ${MAX_LEAD_NAME} characters or fewer.`),
    mobile: z
      .string()
      .max(30, MOBILE_ERROR)
      .transform((value, ctx) => {
        const mobile = normalizeMobile(value);
        if (!mobile) ctx.addIssue({ code: "custom", message: MOBILE_ERROR });
        return mobile ?? "";
      }),
    preferredDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a preferred date.")
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Choose a preferred date.")
      .refine((value) => value >= earliest, "Choose today or a later date.")
      .refine((value) => value <= latest, `Choose a date within the next ${MAX_DAYS_AHEAD} days.`),
    preferredTime: z.enum(PREFERRED_TIMES, { error: "Choose a preferred time." }),
    concern: z
      .string()
      .trim()
      .max(MAX_CONCERN, `Use ${MAX_CONCERN} characters or fewer.`)
      .optional()
      .transform((value) => value || null),
    consent: z.literal(true, { error: "Please agree that the clinic may contact you." }),
    pageUrl: z
      .string()
      .max(2000)
      .optional()
      .transform((value) => (value && /^https?:\/\//.test(value) ? value : null)),
  });
}

export type LeadRequest = z.output<ReturnType<typeof leadRequestSchema>>;

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  notes: z.string().max(MAX_NOTES, `Use ${MAX_NOTES} characters or fewer.`),
});

/** The time zone used for lead dates, day counts and alert emails. */
export function leadsTimeZone() {
  return process.env.LEADS_TIMEZONE?.trim() || "Asia/Kolkata";
}

/**
 * The UTC instant at which a calendar date starts in a time zone, for
 * example 2026-11-01 in Asia/Kolkata → 2026-10-31T18:30:00.000Z.
 */
export function startOfDay(date: string, timeZone: string) {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(guess)
      .map((part) => [part.type, part.value]),
  );
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

/** A YYYY-MM-DD date as "Mon, 3 Nov 2026". */
export function formatLeadDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

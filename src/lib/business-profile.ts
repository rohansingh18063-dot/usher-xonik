import { z } from "zod";

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_LABELS: Record<Day, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export type Doctor = { name: string; qualifications: string };
export type Fee = { service: string; price: string };

/** Clinic details as edited in the form. Empty strings mean "not provided". */
export type BusinessProfileValues = {
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  opening_hours: Record<Day, string>;
  doctors: Doctor[];
  services: string[];
  fees: Fee[];
  offers: string;
  languages: string[];
  maps_url: string;
};

/** Clinic details as stored in the business_profiles table. */
export type BusinessProfileRow = {
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  opening_hours: Partial<Record<Day, string>>;
  doctors: Doctor[];
  services: string[];
  fees: Fee[];
  offers: string | null;
  languages: string[];
  maps_url: string | null;
};

export const PROFILE_LIMITS = { doctors: 30, services: 60, fees: 100, languages: 20 };

export function emptyProfile(): BusinessProfileValues {
  return {
    address: "",
    phone: "",
    whatsapp: "",
    email: "",
    opening_hours: Object.fromEntries(DAYS.map((day) => [day, ""])) as Record<Day, string>,
    doctors: [],
    services: [],
    fees: [],
    offers: "",
    languages: [],
    maps_url: "",
  };
}

export function profileFromRow(row: BusinessProfileRow | null): BusinessProfileValues {
  const empty = emptyProfile();
  if (!row) return empty;
  return {
    address: row.address ?? "",
    phone: row.phone ?? "",
    whatsapp: row.whatsapp ?? "",
    email: row.email ?? "",
    opening_hours: { ...empty.opening_hours, ...row.opening_hours },
    doctors: row.doctors ?? [],
    services: row.services ?? [],
    fees: row.fees ?? [],
    offers: row.offers ?? "",
    languages: row.languages ?? [],
    maps_url: row.maps_url ?? "",
  };
}

const text = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer.`);

const phone = text(40).refine((value) => !value || /^\+?[\d\s().-]{6,40}$/.test(value), {
  message: "Enter a valid phone number, for example +91 98765 43210.",
});

const optionalEmail = text(254).refine((value) => !value || z.email().safeParse(value).success, {
  message: "Enter a valid email address.",
});

const optionalHttpsUrl = text(500).refine((value) => !value || /^https:\/\/[^\s]+\.[^\s]+$/.test(value), {
  message: "Enter a full link starting with https://",
});

export const profileSchema = z.object({
  address: text(500),
  phone,
  whatsapp: phone,
  email: optionalEmail,
  opening_hours: z.object(Object.fromEntries(DAYS.map((day) => [day, text(120)])) as Record<Day, ReturnType<typeof text>>),
  doctors: z
    .array(z.object({ name: text(120), qualifications: text(200) }))
    .transform((rows) => rows.filter((row) => row.name || row.qualifications))
    .pipe(
      z
        .array(z.object({ name: text(120).min(1, "Enter the doctor's name."), qualifications: text(200) }))
        .max(PROFILE_LIMITS.doctors, `Add at most ${PROFILE_LIMITS.doctors} doctors.`),
    ),
  services: z
    .array(text(120))
    .transform((rows) => rows.filter(Boolean))
    .pipe(z.array(z.string()).max(PROFILE_LIMITS.services, `Add at most ${PROFILE_LIMITS.services} services.`)),
  fees: z
    .array(z.object({ service: text(120), price: text(60) }))
    .transform((rows) => rows.filter((row) => row.service || row.price))
    .pipe(
      z
        .array(
          z.object({
            service: text(120).min(1, "Enter the service."),
            price: text(60).min(1, "Enter the price."),
          }),
        )
        .max(PROFILE_LIMITS.fees, `Add at most ${PROFILE_LIMITS.fees} fees.`),
    ),
  offers: text(2000),
  languages: z
    .array(text(40))
    .transform((rows) => [...new Set(rows.filter(Boolean))])
    .pipe(z.array(z.string()).max(PROFILE_LIMITS.languages, `Add at most ${PROFILE_LIMITS.languages} languages.`)),
  maps_url: optionalHttpsUrl,
});

export type ProfileFormState = {
  error?: string;
  /** Keyed by field path, for example "phone" or "fees.2.price". */
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

export function toRow(values: z.output<typeof profileSchema>): BusinessProfileRow {
  const hours = Object.fromEntries(DAYS.filter((day) => values.opening_hours[day]).map((day) => [day, values.opening_hours[day]]));
  return {
    address: values.address || null,
    phone: values.phone || null,
    whatsapp: values.whatsapp || null,
    email: values.email || null,
    opening_hours: hours,
    doctors: values.doctors,
    services: values.services,
    fees: values.fees,
    offers: values.offers || null,
    languages: values.languages,
    maps_url: values.maps_url || null,
  };
}

/**
 * The clinic details as plain lines for the assistant. Fields that were not
 * filled in are left out entirely.
 */
export function describeProfile(row: BusinessProfileRow | null): string[] {
  if (!row) return [];
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  const addList = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}:`, ...items.map((item) => `- ${item}`));
  };

  add("Address", row.address);
  add("Phone", row.phone);
  add("WhatsApp", row.whatsapp);
  add("Email", row.email);
  add("Google Maps link", row.maps_url);

  const hours = DAYS.filter((day) => row.opening_hours?.[day]?.trim());
  if (hours.length) {
    lines.push(
      "Opening hours:",
      ...hours.map((day) => `- ${DAY_LABELS[day]}: ${row.opening_hours[day]!.trim()}`),
    );
    const missing = DAYS.filter((day) => !hours.includes(day));
    if (missing.length) lines.push(`(Opening hours not provided for: ${missing.map((day) => DAY_LABELS[day]).join(", ")})`);
  }

  addList(
    "Doctors",
    (row.doctors ?? []).map((doctor) => (doctor.qualifications ? `${doctor.name}, ${doctor.qualifications}` : doctor.name)),
  );
  addList("Services offered", row.services ?? []);
  addList(
    "Fees",
    (row.fees ?? []).map((fee) => `${fee.service}: ${fee.price}`),
  );
  add("Current offers", row.offers);
  if (row.languages?.length) add("Languages spoken", row.languages.join(", "));
  return lines;
}

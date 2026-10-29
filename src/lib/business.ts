import { z } from "zod";
import type { Industry } from "@/lib/supabase/database.types";

export const INDUSTRIES: { value: Industry; label: string; description: string }[] = [
  { value: "dentist", label: "Dentist", description: "Dental clinics and practices" },
  { value: "pharmacy", label: "Pharmacy", description: "Pharmacies and chemists" },
  { value: "other", label: "Other", description: "Any other kind of business" },
];

export function industryLabel(value: Industry) {
  return INDUSTRIES.find((industry) => industry.value === value)?.label ?? value;
}

// Must match the clients_website_domain_format constraint in the database.
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Turns whatever the user typed ("https://www.Example.com/contact",
 * "example.com", ...) into a bare lowercase domain, or null when it is not a
 * valid public domain.
 */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw.includes("@") || /\s/.test(raw)) return null;

  let host: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  host = host.replace(/\.$/, "").replace(/^www\./, "");
  return DOMAIN_PATTERN.test(host) ? host : null;
}

export const businessSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(120, "Business name must be 120 characters or fewer."),
  industry: z.enum(["dentist", "pharmacy", "other"], { error: "Choose your industry." }),
  website_domain: z
    .string()
    .trim()
    .min(1, "Enter your website domain.")
    .transform((value, ctx) => {
      const domain = normalizeDomain(value);
      if (!domain) {
        ctx.addIssue({ code: "custom", message: "Enter a valid domain, for example yourbusiness.com." });
        return z.NEVER;
      }
      return domain;
    }),
});

export type BusinessField = keyof z.input<typeof businessSchema>;

export type BusinessValues = Record<BusinessField, string>;

export type BusinessFormState = {
  error?: string;
  fieldErrors?: Partial<Record<BusinessField, string>>;
  values?: BusinessValues;
};

export function readBusinessForm(formData: FormData): BusinessValues {
  return {
    business_name: String(formData.get("business_name") ?? ""),
    industry: String(formData.get("industry") ?? ""),
    website_domain: String(formData.get("website_domain") ?? ""),
  };
}

export function firstErrors<T extends string>(error: z.ZodError): Partial<Record<T, string>> {
  const result: Partial<Record<T, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as T;
    if (field && !result[field]) result[field] = issue.message;
  }
  return result;
}

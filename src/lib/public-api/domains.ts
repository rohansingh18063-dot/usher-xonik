import { normalizeDomain } from "@/lib/business";
import { LOCALHOST } from "./origin";

export const MAX_ALLOWED_DOMAINS = 20;

export type ParsedDomain = { domain: string; includeSubdomains: boolean } | { error: string };

/**
 * Turns what a client typed ("https://www.MyClinic.com/", "*.myclinic.com",
 * "localhost:3000") into a stored allowed-domain entry.
 */
export function parseAllowedDomain(input: string, includeSubdomains: boolean): ParsedDomain {
  let value = input.trim().toLowerCase();
  if (!value) return { error: "Enter a domain, for example myclinic.com." };

  if (value.startsWith("*.")) {
    value = value.slice(2);
    includeSubdomains = true;
  }

  const host = value.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  if (host === LOCALHOST) {
    return includeSubdomains
      ? { error: "Subdomains cannot be allowed for localhost." }
      : { domain: LOCALHOST, includeSubdomains: false };
  }
  if (host.endsWith(".localhost")) return { error: "Use plain localhost for local testing." };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes("[")) {
    return { error: "IP addresses cannot be allowed. Use a domain name, or localhost in test mode." };
  }

  const domain = normalizeDomain(value);
  if (!domain) return { error: "Enter a valid domain, for example myclinic.com." };
  return { domain, includeSubdomains };
}

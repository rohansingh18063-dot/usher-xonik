// Decides whether a browser Origin may use a client's public key. No imports,
// so it can be shared by the API route and the dashboard and unit tested.

export type AllowedDomain = { domain: string; include_subdomains: boolean };

export const LOCALHOST = "localhost";

/** The hostname of an Origin header value, or null if it is not a web origin. */
export function originHostname(origin: string | null | undefined): string | null {
  if (!origin || origin === "null") return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * An allowed domain "example.com" matches example.com and www.example.com.
 * With include_subdomains it also matches any subdomain, e.g. book.example.com.
 * "localhost" matches http://localhost on any port, but only in test mode.
 * IP addresses never match.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  domains: AllowedDomain[],
  testMode: boolean,
): boolean {
  const host = originHostname(origin);
  if (!host) return false;

  if (host === LOCALHOST) return testMode && domains.some((entry) => entry.domain === LOCALHOST);

  const withoutWww = host.startsWith("www.") ? host.slice(4) : host;
  return domains.some(
    (entry) =>
      entry.domain !== LOCALHOST &&
      (withoutWww === entry.domain || (entry.include_subdomains && host.endsWith(`.${entry.domain}`))),
  );
}

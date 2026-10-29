// Tests for the domain lock: which browser origins may use a client's key.
//
// Run with: npm run test:unit

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isOriginAllowed, originHostname } from "../../src/lib/public-api/origin.ts";

const clinic = [{ domain: "myclinic.com", include_subdomains: false }];
const clinicWithSubdomains = [{ domain: "myclinic.com", include_subdomains: true }];
const withLocalhost = [...clinic, { domain: "localhost", include_subdomains: false }];

describe("origin hostname", () => {
  test("reads the hostname of web origins", () => {
    assert.equal(originHostname("https://MyClinic.com"), "myclinic.com");
    assert.equal(originHostname("http://localhost:5500"), "localhost");
  });

  test("ignores anything that is not a web origin", () => {
    for (const value of [null, "", "null", "file://", "chrome-extension://abc", "not a url", "ftp://myclinic.com"]) {
      assert.equal(originHostname(value), null, String(value));
    }
  });
});

describe("domain lock", () => {
  test("a domain covers both www and non-www, on http and https", () => {
    for (const origin of ["https://myclinic.com", "https://www.myclinic.com", "http://myclinic.com", "https://myclinic.com:8443"]) {
      assert.equal(isOriginAllowed(origin, clinic, false), true, origin);
    }
  });

  test("subdomains are only allowed when switched on", () => {
    assert.equal(isOriginAllowed("https://book.myclinic.com", clinic, false), false);
    assert.equal(isOriginAllowed("https://book.myclinic.com", clinicWithSubdomains, false), true);
    assert.equal(isOriginAllowed("https://a.b.myclinic.com", clinicWithSubdomains, false), true);
    assert.equal(isOriginAllowed("https://myclinic.com", clinicWithSubdomains, false), true);
  });

  test("other and lookalike websites are rejected", () => {
    for (const origin of [
      "https://otherclinic.com",
      "https://evilmyclinic.com",
      "https://myclinic.com.evil.com",
      "https://myclinic.co",
      "https://wwwmyclinic.com",
      "https://www.www.myclinic.com",
    ]) {
      assert.equal(isOriginAllowed(origin, clinic, false), false, origin);
    }
    assert.equal(isOriginAllowed("https://myclinic.com.evil.com", clinicWithSubdomains, false), false);
    assert.equal(isOriginAllowed("https://evilmyclinic.com", clinicWithSubdomains, false), false);
  });

  test("localhost only works in test mode, and only when listed", () => {
    assert.equal(isOriginAllowed("http://localhost:5500", withLocalhost, true), true);
    assert.equal(isOriginAllowed("http://localhost:3000", withLocalhost, true), true);
    assert.equal(isOriginAllowed("http://localhost:5500", withLocalhost, false), false);
    assert.equal(isOriginAllowed("http://localhost:5500", clinic, true), false);
  });

  test("IP addresses and look-alike local names never match", () => {
    assert.equal(isOriginAllowed("http://127.0.0.1:5500", withLocalhost, true), false);
    assert.equal(isOriginAllowed("http://[::1]:5500", withLocalhost, true), false);
    assert.equal(isOriginAllowed("http://evil.localhost:5500", withLocalhost, true), false);
  });

  test("a missing or opaque origin is rejected", () => {
    assert.equal(isOriginAllowed(null, withLocalhost, true), false);
    assert.equal(isOriginAllowed("null", withLocalhost, true), false);
  });

  test("an empty list allows nothing", () => {
    assert.equal(isOriginAllowed("https://myclinic.com", [], true), false);
  });
});

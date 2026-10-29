// Tests for appointment requests: mobile numbers, the request form rules,
// time zones, hidden tags in streamed replies, and the alert email.
//
// Run with: npm run test:unit

import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HiddenTagFilter, readHiddenTags, removeHiddenTags } from "../../src/lib/chat/hidden-tags.ts";
import { addDays, formatMobile, leadRequestSchema, normalizeMobile, startOfDay } from "../../src/lib/leads.ts";
import { emailChannel, leadEmailHtml, leadEmailSubject, leadEmailText } from "../../src/lib/notifications/email.ts";

const VALID = [
  ["9845012345", "+919845012345"],
  ["98450 12345", "+919845012345"],
  ["098450-12345", "+919845012345"],
  ["+91 98450 12345", "+919845012345"],
  ["919845012345", "+919845012345"],
  ["0091 9845012345", "+919845012345"],
  ["6123456789", "+916123456789"],
  ["+44 7700 900123", "+447700900123"],
  ["+1 (415) 555-0123", "+14155550123"],
  ["+971 50 123 4567", "+971501234567"],
];

const INVALID = [
  "",
  "12345",
  "5123456789", // Indian mobile numbers start with 6 to 9
  "98450123456", // 11 digits without a leading 0
  "+91 5123456789",
  "+91 98450",
  "+12",
  "+0 7700 900123",
  "+44 7700 900123 4567 89",
  "98450abcde",
  "call me",
];

// The widget checks numbers in plain JavaScript before sending; it must agree with the server.
const widgetSource = readFileSync(new URL("../../public/widget.js", import.meta.url), "utf8");
const start = widgetSource.indexOf("function normalizeMobile(input) {");
const end = widgetSource.indexOf("\n  }\n", start) + 4;
const widgetNormalizeMobile = new Function(`${widgetSource.slice(start, end)}; return normalizeMobile;`)();

describe("mobile numbers", () => {
  test("Indian numbers are accepted with or without 0, 91 or +91, and stored with +91", () => {
    for (const [input, expected] of VALID) assert.equal(normalizeMobile(input), expected, input);
  });

  test("invalid numbers are refused", () => {
    for (const input of INVALID) assert.equal(normalizeMobile(input), null, input);
  });

  test("the widget's check agrees with the server's", () => {
    for (const [input, expected] of VALID) assert.equal(widgetNormalizeMobile(input), expected, input);
    for (const input of INVALID) assert.equal(widgetNormalizeMobile(input), null, input);
  });

  test("Indian numbers are shown in groups", () => {
    assert.equal(formatMobile("+919845012345"), "+91 98450 12345");
    assert.equal(formatMobile("+447700900123"), "+447700900123");
  });
});

describe("appointment request form", () => {
  const today = "2026-11-01";
  const schema = leadRequestSchema(addDays(today, -1));
  const valid = {
    sessionId: "6f1c2a52-8d4b-4e3a-9a77-0b1d2c3e4f50",
    name: "  Priya Sharma ",
    mobile: "98450 12345",
    preferredDate: "2026-11-03",
    preferredTime: "morning",
    concern: "",
    consent: true,
    pageUrl: "https://smilecare-dental.com/services",
  };
  const errors = (input) =>
    Object.fromEntries(schema.safeParse(input).error?.issues.map((issue) => [issue.path.join("."), issue.message]) ?? []);

  test("a complete request is accepted and cleaned up", () => {
    const parsed = schema.parse(valid);
    assert.equal(parsed.name, "Priya Sharma");
    assert.equal(parsed.mobile, "+919845012345");
    assert.equal(parsed.concern, null);
  });

  test("consent is required", () => {
    assert.ok(errors({ ...valid, consent: false }).consent);
    assert.ok(errors({ ...valid, consent: undefined }).consent);
    assert.ok(errors({ ...valid, consent: "yes" }).consent);
  });

  test("an invalid mobile number is refused", () => {
    assert.match(errors({ ...valid, mobile: "12345" }).mobile, /valid mobile number/);
  });

  test("past dates, far-away dates and missing times are refused", () => {
    assert.ok(errors({ ...valid, preferredDate: "2026-10-01" }).preferredDate);
    assert.ok(errors({ ...valid, preferredDate: "2027-12-01" }).preferredDate);
    assert.ok(errors({ ...valid, preferredDate: "2026-13-45" }).preferredDate);
    assert.ok(errors({ ...valid, preferredTime: "night" }).preferredTime);
    // Yesterday in the clinic's time zone is still allowed for visitors in other time zones.
    assert.equal(errors({ ...valid, preferredDate: "2026-10-31" }).preferredDate, undefined);
  });

  test("only web page addresses are kept as the source page", () => {
    assert.equal(schema.parse({ ...valid, pageUrl: "javascript:alert(1)" }).pageUrl, null);
  });
});

describe("time zones", () => {
  test("a day starts at local midnight", () => {
    assert.equal(startOfDay("2026-11-01", "Asia/Kolkata").toISOString(), "2026-10-31T18:30:00.000Z");
    assert.equal(startOfDay("2026-07-01", "Europe/London").toISOString(), "2026-06-30T23:00:00.000Z");
    assert.equal(startOfDay("2026-01-15", "UTC").toISOString(), "2026-01-15T00:00:00.000Z");
  });
});

describe("hidden tags in replies", () => {
  function stream(pieces) {
    const filter = new HiddenTagFilter();
    const shown = pieces.map((piece) => filter.push(piece)).join("") + filter.finish();
    return { shown, tags: filter.tags };
  }

  const split = (text, size) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"));

  test("the form tag is removed and reported, even when split across pieces", () => {
    const reply = "I can take your details so the clinic can call you.\n[[REQUEST_FORM]]";
    for (const size of [1, 2, 3, 5, 7, 100]) {
      assert.deepEqual(stream(split(reply, size)), {
        shown: "I can take your details so the clinic can call you.\n",
        tags: ["REQUEST_FORM"],
      });
    }
  });

  test("unanswered-question tags are removed and read", () => {
    const reply =
      "The clinic will confirm the whitening price and Sunday timings.\n[[UNANSWERED|fees|Teeth whitening price]]\n[[UNANSWERED|timings|Sunday opening hours]]";
    for (const size of [1, 4, 9, 300]) {
      const { shown, tags } = stream(split(reply, size));
      assert.equal(shown.trim(), "The clinic will confirm the whitening price and Sunday timings.");
      assert.deepEqual(readHiddenTags(tags), {
        appointmentForm: false,
        gaps: [
          { category: "fees", topic: "Teeth whitening price" },
          { category: "timings", topic: "Sunday opening hours" },
        ],
      });
    }
  });

  test("text that only looks like a tag is shown", () => {
    assert.deepEqual(stream(["Use [[ brackets ", "and [[REQ", "UEST later"]), { shown: "Use [[ brackets and [[REQUEST later", tags: [] });
    assert.deepEqual(stream(["Ends with [["]), { shown: "Ends with [[", tags: [] });
    assert.deepEqual(stream(["Ends with ["]), { shown: "Ends with [", tags: [] });
    assert.deepEqual(stream(["A [[note]] stays"]), { shown: "A [[note]] stays", tags: [] });
    const long = `[[${"x".repeat(200)}`;
    assert.equal(stream([long, " more"]).shown, `${long} more`);
  });

  test("saved replies never contain tags", () => {
    assert.equal(removeHiddenTags("Sure!\n[[REQUEST_FORM]]"), "Sure!");
    assert.equal(removeHiddenTags("We'll confirm.\n[[UNANSWERED|fees|Braces cost]]\n[[REQUEST_FORM]]"), "We'll confirm.");
    assert.equal(removeHiddenTags("Keep [[this]] text"), "Keep [[this]] text");
  });

  test("tags are read safely: unknown categories become other, repeats count once", () => {
    assert.deepEqual(readHiddenTags(["REQUEST_FORM", "UNANSWERED|parking|Parking  spaces", "UNANSWERED|parking|parking spaces"]), {
      appointmentForm: true,
      gaps: [{ category: "other", topic: "Parking spaces" }],
    });
  });
});

describe("lead alert email", () => {
  const alert = {
    businessName: "Smile Care Dental Clinic",
    name: "Priya Sharma",
    mobile: "+91 98450 12345",
    mobileE164: "+919845012345",
    preferredDate: "Fri, 30 Oct 2026",
    preferredTime: "Morning",
    concern: "Teeth cleaning",
    sourceUrl: "https://smilecare-dental.com/services",
    receivedAt: "28 Oct 2026, 16:20",
    dashboardUrl: "https://usher.xonik.com/dashboard/leads/6f1c2a52-8d4b-4e3a-9a77-0b1d2c3e4f50",
    deliveryKey: "lead-6f1c2a52",
  };

  test("the email has every lead detail, a call link and a link to the lead", () => {
    const html = leadEmailHtml(alert);
    assert.equal(leadEmailSubject(alert), "New appointment request: Priya Sharma");
    for (const value of [
      "Smile Care Dental Clinic",
      "Priya Sharma",
      "+91 98450 12345",
      'href="tel:+919845012345"',
      "Fri, 30 Oct 2026",
      "Morning",
      "Teeth cleaning",
      "https://smilecare-dental.com/services",
      "28 Oct 2026, 16:20",
      `href="${alert.dashboardUrl}"`,
      "nothing has been booked yet",
    ]) {
      assert.ok(html.includes(value), value);
    }
    const text = leadEmailText(alert);
    assert.ok(text.includes("Mobile: +91 98450 12345"));
    assert.ok(text.includes(`View the request and the chat: ${alert.dashboardUrl}`));
  });

  test("visitor text cannot add HTML to the email", () => {
    const html = leadEmailHtml({ ...alert, name: '<img src=x onerror="alert(1)">', concern: "<b>pain</b> & swelling" });
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    assert.ok(html.includes("&lt;b&gt;pain&lt;/b&gt; &amp; swelling"));
  });

  test("a missing concern or page is shown clearly", () => {
    const html = leadEmailHtml({ ...alert, concern: null, sourceUrl: null });
    assert.ok(html.includes("Not given"));
    assert.ok(html.includes("Your website"));
  });

  test("alerts go to the saved addresses, or to the sign-in email when none are saved", () => {
    assert.deepEqual(emailChannel.recipients({ leadAlertEmails: ["a@clinic.in", "b@clinic.in"], accountEmail: "owner@clinic.in" }), [
      "a@clinic.in",
      "b@clinic.in",
    ]);
    assert.deepEqual(emailChannel.recipients({ leadAlertEmails: [], accountEmail: "owner@clinic.in" }), ["owner@clinic.in"]);
  });

  test("without an email key, the alert is recorded as not sent instead of failing the request", async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal((await emailChannel.send(alert, "a@clinic.in")).status, "skipped");
    } finally {
      if (saved) process.env.RESEND_API_KEY = saved;
    }
  });
});

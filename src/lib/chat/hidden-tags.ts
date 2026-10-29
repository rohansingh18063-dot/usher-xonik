// Hidden tags the assistant adds at the end of a reply, for the server only:
//
//   [[REQUEST_FORM]]                       offer the appointment request form
//   [[UNANSWERED|fees|Teeth whitening price]]  a business question it could not answer
//
// They are removed from the reply before the visitor sees it or it is saved.
// No imports, so this can be unit tested.

export const APPOINTMENT_FORM_TAG = "REQUEST_FORM";

export const GAP_CATEGORIES = [
  "fees",
  "timings",
  "doctors",
  "services",
  "offers",
  "contact",
  "location",
  "payments",
  "other",
] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];

const KNOWN_TAG = /^(REQUEST_FORM|UNANSWERED\|[a-z]{1,20}\|[^[\]|]{1,120})$/;
/** Text after "[[" longer than this cannot be a tag and is shown as it is. */
const MAX_TAG_LENGTH = 160;

/**
 * Removes hidden tags from streamed text and collects them, even when a tag
 * arrives split across several pieces: text that could still become a tag
 * is held back until the next piece shows whether it is one. Anything in
 * double brackets that is not a known tag is shown unchanged.
 */
export class HiddenTagFilter {
  tags: string[] = [];
  private held = "";

  push(text: string) {
    let buffer = this.held + text;
    let visible = "";
    this.held = "";

    for (;;) {
      const start = buffer.indexOf("[[");
      if (start === -1) {
        // A single "[" at the very end may be the start of a tag.
        if (buffer.endsWith("[")) {
          this.held = "[";
          return visible + buffer.slice(0, -1);
        }
        return visible + buffer;
      }

      const end = buffer.indexOf("]]", start + 2);
      if (end === -1) {
        if (buffer.length - start - 2 > MAX_TAG_LENGTH) {
          visible += buffer.slice(0, start + 2);
          buffer = buffer.slice(start + 2);
          continue;
        }
        this.held = buffer.slice(start);
        return visible + buffer.slice(0, start);
      }

      const inner = buffer.slice(start + 2, end);
      if (KNOWN_TAG.test(inner.trim())) {
        this.tags.push(inner.trim());
        visible += buffer.slice(0, start);
      } else {
        visible += buffer.slice(0, end + 2);
      }
      buffer = buffer.slice(end + 2);
    }
  }

  /** Text still held back when the reply ends; it was not a tag. */
  finish() {
    const rest = this.held;
    this.held = "";
    return rest;
  }

  reset() {
    this.held = "";
    this.tags = [];
  }
}

/** A complete reply without its hidden tags, as it is saved. */
export function removeHiddenTags(text: string) {
  return text
    .replace(/\[\[([^[\]]{1,160})\]\]/g, (tag, inner: string) => (KNOWN_TAG.test(inner.trim()) ? "" : tag))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export type ReplySignals = {
  appointmentForm: boolean;
  gaps: { category: GapCategory; topic: string }[];
};

/** What the collected tags ask the server to do. */
export function readHiddenTags(tags: string[]): ReplySignals {
  const signals: ReplySignals = { appointmentForm: false, gaps: [] };
  for (const tag of tags) {
    if (tag === APPOINTMENT_FORM_TAG) {
      signals.appointmentForm = true;
      continue;
    }
    const [, rawCategory, rawTopic] = tag.split("|");
    const category = (GAP_CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as GapCategory) : "other";
    const topic = rawTopic.replace(/\s+/g, " ").trim().slice(0, 80);
    if (topic && !signals.gaps.some((gap) => gap.category === category && gap.topic.toLowerCase() === topic.toLowerCase())) {
      signals.gaps.push({ category, topic });
    }
  }
  return signals;
}

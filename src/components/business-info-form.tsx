"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { saveBusinessProfile } from "@/app/actions/business-profile";
import {
  DAY_LABELS,
  DAYS,
  PROFILE_LIMITS,
  type BusinessProfileValues,
  type Day,
  type ProfileFormState,
} from "@/lib/business-profile";
import { Button, Card } from "@/components/ui";

const inputClass = (error?: string) =>
  `block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
    error
      ? "border-red-400 focus:border-red-500 focus:ring-red-100"
      : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
  }`;

export function BusinessInfoForm({ initialValues }: { initialValues: BusinessProfileValues }) {
  const [values, setValues] = useState(initialValues);
  const [languagesText, setLanguagesText] = useState(initialValues.languages.join(", "));
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveBusinessProfile, {});
  // The save result that was current when the form was last edited. Edits are
  // unsaved until a newer result arrives.
  const [editedDuring, setEditedDuring] = useState<ProfileFormState | null>(null);
  const dirty = editedDuring === state;
  const setDirty = () => setEditedDuring(state);
  const errors = state.fieldErrors ?? {};

  // Links such as /dashboard/business-info#fees (from Knowledge gaps) open the
  // right section. The page loads after navigation, so the browser cannot
  // jump there by itself: scroll to it, highlight it and move focus to it.
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    const show = () => {
      const section = document.getElementById(window.location.hash.slice(1));
      if (!section) return;
      section.scrollIntoView({ block: "start" });
      section.focus({ preventScroll: true });
      setHighlight(section.id);
    };
    const frame = requestAnimationFrame(show);
    window.addEventListener("hashchange", show);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", show);
    };
  }, []);

  function update<K extends keyof BusinessProfileValues>(key: K, value: BusinessProfileValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty();
  }

  function setHours(day: Day, value: string) {
    update("opening_hours", { ...values.opening_hours, [day]: value });
  }

  function copyMondayToWeekdays() {
    const monday = values.opening_hours.monday;
    update("opening_hours", {
      ...values.opening_hours,
      tuesday: monday,
      wednesday: monday,
      thursday: monday,
      friday: monday,
    });
  }

  const payload = JSON.stringify({
    ...values,
    languages: languagesText.split(",").map((language) => language.trim()),
  });

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="profile" value={payload} />

      <Section
        id="contact"
        highlight={highlight}
        title="Contact details"
        description="How patients can reach and find the clinic."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Address"
            className="sm:col-span-2"
            error={errors.address}
            multiline
            value={values.address}
            onChange={(value) => update("address", value)}
            placeholder="Street, area, city, PIN code"
          />
          <TextField
            label="Phone"
            error={errors.phone}
            value={values.phone}
            onChange={(value) => update("phone", value)}
            placeholder="+91 98765 43210"
            type="tel"
          />
          <TextField
            label="WhatsApp"
            error={errors.whatsapp}
            value={values.whatsapp}
            onChange={(value) => update("whatsapp", value)}
            placeholder="+91 98765 43210"
            type="tel"
          />
          <TextField
            label="Email"
            error={errors.email}
            value={values.email}
            onChange={(value) => update("email", value)}
            placeholder="reception@yourclinic.com"
            type="email"
          />
          <TextField
            label="Google Maps link"
            error={errors.maps_url}
            value={values.maps_url}
            onChange={(value) => update("maps_url", value)}
            placeholder="https://maps.app.goo.gl/..."
            type="url"
          />
        </div>
      </Section>

      <Section
        id="opening-hours"
        highlight={highlight}
        title="Opening hours"
        description='For example "9:00 AM – 1:00 PM, 5:00 PM – 8:00 PM", or "Closed". Leave a day empty if you prefer not to say.'
        action={
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={copyMondayToWeekdays}>
            Copy Monday to weekdays
          </Button>
        }
      >
        <div className="divide-y divide-slate-100">
          {DAYS.map((day) => (
            <div key={day} className="grid items-center gap-2 py-2 sm:grid-cols-[8rem_1fr_auto]">
              <label htmlFor={`hours-${day}`} className="text-sm font-medium text-slate-700">
                {DAY_LABELS[day]}
              </label>
              <input
                id={`hours-${day}`}
                value={values.opening_hours[day]}
                onChange={(event) => setHours(day, event.target.value)}
                maxLength={120}
                placeholder="Not provided"
                className={inputClass(errors[`opening_hours.${day}`])}
              />
              <Button
                type="button"
                variant="ghost"
                className="justify-self-start px-3 py-1.5 text-xs"
                onClick={() => setHours(day, "Closed")}
              >
                Closed
              </Button>
              {errors[`opening_hours.${day}`] && (
                <p className="text-sm text-red-600 sm:col-start-2">{errors[`opening_hours.${day}`]}</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="doctors"
        highlight={highlight}
        title="Doctors"
        description="Names and qualifications of the dentists at the clinic."
      >
        <RowList
          rows={values.doctors}
          max={PROFILE_LIMITS.doctors}
          addLabel="Add doctor"
          emptyText="No doctors added yet."
          error={errors.doctors}
          onChange={(rows) => update("doctors", rows)}
          newRow={() => ({ name: "", qualifications: "" })}
          renderRow={(row, index, set) => (
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <RowInput
                label={`Doctor ${index + 1} name`}
                value={row.name}
                placeholder="Dr. Priya Sharma"
                error={errors[`doctors.${index}.name`]}
                maxLength={120}
                onChange={(value) => set({ ...row, name: value })}
              />
              <RowInput
                label={`Doctor ${index + 1} qualifications`}
                value={row.qualifications}
                placeholder="BDS, MDS (Orthodontics)"
                error={errors[`doctors.${index}.qualifications`]}
                maxLength={200}
                onChange={(value) => set({ ...row, qualifications: value })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        id="services"
        highlight={highlight}
        title="Services offered"
        description="The treatments patients can get at the clinic."
      >
        <RowList
          rows={values.services}
          max={PROFILE_LIMITS.services}
          addLabel="Add service"
          emptyText="No services added yet."
          error={errors.services}
          onChange={(rows) => update("services", rows)}
          newRow={() => ""}
          renderRow={(row, index, set) => (
            <RowInput
              label={`Service ${index + 1}`}
              value={row}
              placeholder="Root canal treatment"
              error={errors[`services.${index}`]}
              maxLength={120}
              onChange={set}
            />
          )}
        />
      </Section>

      <Section
        id="fees"
        highlight={highlight}
        title="Fees"
        description="Your assistant quotes these exactly as written, so include the currency, e.g. ₹800 or “From ₹3,500”."
      >
        <RowList
          rows={values.fees}
          max={PROFILE_LIMITS.fees}
          addLabel="Add fee"
          emptyText="No fees added yet. Without fees, the assistant tells visitors the clinic will confirm the cost."
          error={errors.fees}
          onChange={(rows) => update("fees", rows)}
          newRow={() => ({ service: "", price: "" })}
          renderRow={(row, index, set) => (
            <div className="grid flex-1 gap-2 sm:grid-cols-[2fr_1fr]">
              <RowInput
                label={`Fee ${index + 1} service`}
                value={row.service}
                placeholder="Teeth cleaning (scaling and polishing)"
                error={errors[`fees.${index}.service`]}
                maxLength={120}
                onChange={(value) => set({ ...row, service: value })}
              />
              <RowInput
                label={`Fee ${index + 1} price`}
                value={row.price}
                placeholder="₹800"
                error={errors[`fees.${index}.price`]}
                maxLength={60}
                onChange={(value) => set({ ...row, price: value })}
              />
            </div>
          )}
        />
      </Section>

      <Section
        id="offers"
        highlight={highlight}
        title="Offers and languages"
      >
        <div className="grid gap-4">
          <TextField
            label="Current offers"
            multiline
            error={errors.offers}
            value={values.offers}
            onChange={(value) => update("offers", value)}
            placeholder="For example: free dental check-up for children under 12 during November."
          />
          <TextField
            label="Languages spoken"
            hint="Separate languages with commas."
            error={errors.languages}
            value={languagesText}
            onChange={(value) => {
              setLanguagesText(value);
              setDirty();
            }}
            placeholder="English, Hindi"
          />
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-xl sm:border sm:bg-white/95 sm:px-5">
        <div className="text-sm" aria-live="polite">
          {state.error ? (
            <span className="text-red-700">{state.error}</span>
          ) : state.saved && !dirty ? (
            <span className="text-emerald-700">Saved. Your assistant now uses these details.</span>
          ) : dirty ? (
            <span className="text-slate-600">You have unsaved changes.</span>
          ) : (
            <span className="text-slate-500">All fields are optional.</span>
          )}
        </div>
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          Save business info
        </Button>
      </div>
    </form>
  );
}

function Section({
  id,
  highlight,
  title,
  description,
  action,
  children,
}: {
  /** Anchor for links such as /dashboard/business-info#fees from the Knowledge gaps page. */
  id: string;
  /** The section the page was opened at, shown with a ring. */
  highlight: string | null;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-label={title}
      data-highlighted={highlight === id || undefined}
      className={`scroll-mt-20 rounded-2xl focus:outline-none ${highlight === id ? "ring-2 ring-brand-500 ring-offset-2" : ""}`}
    >
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {action}
        </div>
        <div className="px-6 py-5">{children}</div>
      </Card>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  multiline,
  className = "",
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  const id = `field-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          className={`mt-1.5 ${inputClass(error)}`}
          {...props}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          className={`mt-1.5 ${inputClass(error)}`}
          {...props}
        />
      )}
      {error ? (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function RowInput({
  label,
  value,
  onChange,
  error,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex-1">
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        className={inputClass(error)}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function RowList<T>({
  rows,
  onChange,
  newRow,
  renderRow,
  addLabel,
  emptyText,
  max,
  error,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow: () => T;
  renderRow: (row: T, index: number, set: (row: T) => void) => ReactNode;
  addLabel: string;
  emptyText: string;
  max: number;
  error?: string;
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-slate-500">{emptyText}</p>}
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-2">
          {renderRow(row, index, (next) => onChange(rows.map((current, i) => (i === index ? next : current))))}
          <Button
            type="button"
            variant="ghost"
            className="px-2.5 py-2.5 text-slate-400 hover:text-red-600"
            aria-label={`Remove ${addLabel.replace(/^Add /, "")} ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows.length < max && (
        <Button type="button" variant="secondary" className="px-3 py-2" onClick={() => onChange([...rows, newRow()])}>
          + {addLabel}
        </Button>
      )}
    </div>
  );
}

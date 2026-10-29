"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createBusiness, updateBusiness } from "@/app/actions/business";
import { INDUSTRIES, type BusinessFormState, type BusinessValues } from "@/lib/business";
import { Alert, Button, buttonClass, Field } from "@/components/ui";

const EMPTY: BusinessValues = { business_name: "", industry: "", website_domain: "" };

export function BusinessForm({
  mode,
  initialValues = EMPTY,
}: {
  mode: "create" | "edit";
  initialValues?: BusinessValues;
}) {
  const [state, action, pending] = useActionState<BusinessFormState, FormData>(
    mode === "create" ? createBusiness : updateBusiness,
    {},
  );
  const values = state.values ?? initialValues;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.error && <Alert>{state.error}</Alert>}

      <Field
        label="Business name"
        name="business_name"
        defaultValue={values.business_name}
        error={errors.business_name}
        placeholder="Bright Smile Dental"
        autoComplete="organization"
        maxLength={120}
        required
      />

      <fieldset className="min-w-0" aria-describedby={errors.industry ? "industry-error" : undefined}>
        <legend className="text-sm font-medium text-slate-700">Industry</legend>
        <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
          {INDUSTRIES.map((industry) => (
            <label
              key={industry.value}
              className={`relative flex cursor-pointer flex-col rounded-lg border bg-white p-3.5 shadow-sm transition hover:border-slate-400 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-600 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-100 ${
                errors.industry ? "border-red-400" : "border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="industry"
                value={industry.value}
                defaultChecked={values.industry === industry.value}
                className="sr-only"
                required
              />
              <span className="text-sm font-medium text-slate-900">{industry.label}</span>
              <span className="mt-0.5 text-xs text-slate-500">{industry.description}</span>
            </label>
          ))}
        </div>
        {errors.industry && (
          <p id="industry-error" className="mt-1.5 text-sm text-red-600">
            {errors.industry}
          </p>
        )}
      </fieldset>

      <Field
        label="Website domain"
        name="website_domain"
        defaultValue={values.website_domain}
        error={errors.website_domain}
        placeholder="yourbusiness.com"
        hint="The website where your assistant will appear."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="url"
        required
      />

      <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end">
        {mode === "edit" && (
          <Link href="/dashboard/settings" className={buttonClass("secondary")}>
            Cancel
          </Link>
        )}
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          {mode === "create" ? "Continue to dashboard" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

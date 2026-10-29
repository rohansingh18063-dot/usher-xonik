import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-slate-900">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
          <path
            d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6a.5.5 0 0 1-.8-.4V15h0a2.5 2.5 0 0 1-1-2V5.5Z"
            fill="currentColor"
          />
          <circle cx="9" cy="9" r="1.1" fill="#2952e3" />
          <circle cx="12" cy="9" r="1.1" fill="#2952e3" />
          <circle cx="15" cy="9" r="1.1" fill="#2952e3" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Website Assistant</span>
    </Link>
  );
}

const buttonStyles = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60",
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};

type ButtonVariant = "primary" | "secondary" | "ghost";

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  return `${buttonStyles.base} ${buttonStyles[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  pending = false,
  pendingLabel,
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; pending?: boolean; pendingLabel?: string }) {
  return (
    <button {...props} disabled={pending || props.disabled} className={buttonClass(variant, className)}>
      {pending && <Spinner />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({
  label,
  name,
  error,
  hint,
  id,
  className = "",
  ...props
}: ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: ReactNode }) {
  // The id defaults to the name; pass one when two forms on a page share a field name.
  const inputId = id ?? name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"
        }`}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-brand-200 bg-brand-50 text-brand-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      {children}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

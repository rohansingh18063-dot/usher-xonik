"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn, signUp, type AuthFormState } from "@/app/actions/auth";
import { Alert, Button, Card, Field } from "@/components/ui";

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});

  if (state.confirmationSentTo) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
            <path d="M4 6h16v12H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We sent a confirmation link to <span className="font-medium text-slate-900">{state.confirmationSentTo}</span>.
          Open it to activate your account.
        </p>
        <p className="mt-6 text-sm text-slate-600">
          Already confirmed?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-8">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1.5 text-sm text-slate-600">Set up an assistant for your business website.</p>

      <form action={action} className="mt-6 space-y-4" noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          error={state.fieldErrors?.email}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={state.fieldErrors?.password}
          hint="At least 8 characters."
          required
        />
        <Button type="submit" pending={pending} pendingLabel="Creating account…" className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, {});

  return (
    <Card className="p-8">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1.5 text-sm text-slate-600">Welcome back. Sign in to manage your assistant.</p>

      <form action={action} className="mt-6 space-y-4" noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          error={state.fieldErrors?.email}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          required
        />
        <Button type="submit" pending={pending} pendingLabel="Signing in…" className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        New to Website Assistant?{" "}
        <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
          Create an account
        </Link>
      </p>
    </Card>
  );
}

/** Shown on the sign-in page when an email confirmation link fails. */
export function ConfirmationNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("error") !== "confirmation") return null;
  return (
    <div className="mb-4">
      <Alert>That confirmation link is invalid or has expired. Please sign in, or sign up again to get a new link.</Alert>
    </div>
  );
}

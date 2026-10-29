"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { changeEmail, changePassword, deleteAccount, updateProfile, type AccountFormState } from "@/app/actions/account";
import { DELETE_CONFIRMATION } from "@/lib/account";
import { Alert, Button, Card, Field } from "@/components/ui";

// Every form here keeps what was typed when the server refuses it: fields are
// controlled, and forms are submitted without the form action prop, which
// would reset them afterwards.

function useAccountForm(action: (state: AccountFormState, data: FormData) => Promise<AccountFormState>) {
  const [state, dispatch, pending] = useActionState(action, {});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, submit, pending, errors: state.fieldErrors ?? {} };
}

function Section({ title, description, children, danger = false }: { title: string; description: string; children: ReactNode; danger?: boolean }) {
  return (
    <Card className={danger ? "border-red-200" : ""}>
      <div className={`border-b px-5 py-4 sm:px-6 ${danger ? "border-red-100" : "border-slate-200"}`}>
        <h2 className={`text-base font-semibold ${danger ? "text-red-700" : "text-slate-900"}`}>{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </Card>
  );
}

function Result({ state }: { state: AccountFormState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.saved && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function ProfileForm({ fullName, businessName }: { fullName: string; businessName: string }) {
  const { state, submit, pending, errors } = useAccountForm(updateProfile);
  const [values, setValues] = useState({ fullName, businessName });

  return (
    <Section title="Profile" description="Your name, and the business name your assistant uses.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Your name"
            name="fullName"
            value={values.fullName}
            onChange={(event) => setValues({ ...values, fullName: event.target.value })}
            error={errors.fullName}
            autoComplete="name"
            maxLength={80}
          />
          <Field
            label="Business name"
            name="businessName"
            value={values.businessName}
            onChange={(event) => setValues({ ...values, businessName: event.target.value })}
            error={errors.businessName}
            autoComplete="organization"
            maxLength={120}
          />
        </div>
        <Result state={state} />
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          Save profile
        </Button>
      </form>
    </Section>
  );
}

export function EmailForm({ email }: { email: string }) {
  const { state, submit, pending, errors } = useAccountForm(changeEmail);
  const [values, setValues] = useState({ email: "", password: "" });

  return (
    <Section title="Login email" description={`You sign in with ${email}.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New login email"
            id="new-login-email"
            name="email"
            type="email"
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
            error={errors.email}
            autoComplete="email"
          />
          <Field
            label="Current password"
            id="email-change-password"
            name="password"
            type="password"
            value={values.password}
            onChange={(event) => setValues({ ...values, password: event.target.value })}
            error={errors.password}
            autoComplete="current-password"
          />
        </div>
        <Result state={state} />
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          Change login email
        </Button>
      </form>
    </Section>
  );
}

export function PasswordForm() {
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  // Passwords are cleared once changed, and kept for correcting when refused.
  const { state, submit, pending, errors } = useAccountForm(async (previous, data) => {
    const result = await changePassword(previous, data);
    if (result.saved) setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
    return result;
  });
  const set = (key: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [key]: event.target.value });

  return (
    <Section title="Password" description="Use at least 8 characters.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            value={values.currentPassword}
            onChange={set("currentPassword")}
            error={errors.currentPassword}
            autoComplete="current-password"
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            value={values.newPassword}
            onChange={set("newPassword")}
            error={errors.newPassword}
            autoComplete="new-password"
          />
          <Field
            label="Repeat new password"
            name="confirmPassword"
            type="password"
            value={values.confirmPassword}
            onChange={set("confirmPassword")}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />
        </div>
        <Result state={state} />
        <Button type="submit" pending={pending} pendingLabel="Saving…">
          Change password
        </Button>
      </form>
    </Section>
  );
}

export function DeleteAccount({ businessName }: { businessName: string }) {
  const { state, submit, pending, errors } = useAccountForm(deleteAccount);
  const [confirming, setConfirming] = useState(false);
  const [values, setValues] = useState({ confirmation: "", password: "" });

  return (
    <Section
      danger
      title="Delete account"
      description="Permanently delete your account and everything in it. This cannot be undone."
    >
      {!confirming ? (
        <Button type="button" variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirming(true)}>
          Delete my account…
        </Button>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" data-testid="delete-account-form">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">This permanently deletes {businessName} and:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>all conversations, leads and knowledge gaps,</li>
              <li>your Business Info, uploaded documents and widget logo,</li>
              <li>your API key and allowed domains (the widget stops working on your website),</li>
              <li>your login. You will be signed out.</li>
            </ul>
            <p className="mt-2">Export your leads and conversations first if you want to keep them.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Type ${DELETE_CONFIRMATION} to confirm`}
              id="delete-confirmation"
              name="confirmation"
              value={values.confirmation}
              onChange={(event) => setValues({ ...values, confirmation: event.target.value })}
              error={errors.confirmation}
              autoComplete="off"
              spellCheck={false}
            />
            <Field
              label="Current password"
              id="delete-password"
              name="password"
              type="password"
              value={values.password}
              onChange={(event) => setValues({ ...values, password: event.target.value })}
              error={errors.password}
              autoComplete="current-password"
            />
          </div>
          <Result state={state} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="bg-red-600 hover:bg-red-700"
              pending={pending}
              pendingLabel="Deleting…"
              disabled={values.confirmation.trim() !== DELETE_CONFIRMATION}
            >
              Permanently delete my account
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

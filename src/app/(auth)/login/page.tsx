import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmationNotice, SignInForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <Suspense>
        <ConfirmationNotice />
      </Suspense>
      <SignInForm />
    </>
  );
}

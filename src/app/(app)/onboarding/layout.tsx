import { Suspense } from "react";
import { signOut } from "@/app/actions/auth";
import { Button, Logo } from "@/components/ui";
import { getCurrentUser } from "@/lib/data";

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-2">
            <Suspense>
              <SignedInEmail />
            </Suspense>
            <form action={signOut}>
              <Button type="submit" variant="ghost" className="px-3">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">{children}</main>
    </>
  );
}

async function SignedInEmail() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <span className="hidden max-w-56 truncate text-sm text-slate-500 sm:block" data-testid="signed-in-email">
      {user.email}
    </span>
  );
}

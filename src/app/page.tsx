import { Suspense } from "react";
import { AccountDeletedNotice } from "@/components/account-deleted-notice";
import { ButtonLink, Logo } from "@/components/ui";

const FEATURES = [
  {
    title: "Answers from your own content",
    body: "Your assistant learns from the documents you provide, such as price lists, opening hours and policies.",
  },
  {
    title: "Made for your industry",
    body: "Start with settings suited to dental practices, pharmacies and other local businesses.",
  },
  {
    title: "Private by design",
    body: "Each business has its own isolated account. Your data is never visible to anyone else.",
  },
];

export default function HomePage() {
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup">Get started</ButtonLink>
        </nav>
      </header>

      <Suspense>
        <AccountDeletedNotice />
      </Suspense>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-slate-900 sm:text-5xl">
            A helpful assistant on your website, trained on your business
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-slate-600">
            Give your visitors instant, accurate answers around the clock, based on your own documents.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" className="px-6">
              Create your account
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-6">
              Sign in
            </ButtonLink>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-24 sm:grid-cols-3 sm:px-6">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">{feature.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{feature.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        © Website Assistant
      </footer>
    </>
  );
}

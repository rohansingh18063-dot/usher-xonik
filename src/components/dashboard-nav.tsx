"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/ui";

type Item = { href: string; label: string; icon: ReactNode; count?: number; also?: string[] };

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const ICONS = {
  overview: icon(<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />),
  conversations: icon(<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15A2.5 2.5 0 0 1 5 12.5z" />),
  leads: icon(<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M22 11h-6" />),
  gaps: icon(<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" />),
  test: icon(<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.5 15h9" />),
  info: icon(<path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-5h4v5" />),
  documents: icon(<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />),
  widget: icon(<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 8h16M15 17a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" />),
  key: icon(<path d="M15.5 7.5a4 4 0 1 1-7.4 2.1L3 14.7V18h3.3v-2h2v-2h2l1-1a4 4 0 0 1 4.2-5.5M16 8h.01" />),
  settings: icon(<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1" />),
};

function groups(counts: { leads: number; gaps: number }): { title: string; items: Item[] }[] {
  return [
    {
      title: "Performance",
      items: [
        { href: "/dashboard", label: "Overview", icon: ICONS.overview },
        { href: "/dashboard/conversations", label: "Conversations", icon: ICONS.conversations },
        { href: "/dashboard/leads", label: "Leads", icon: ICONS.leads, count: counts.leads },
        { href: "/dashboard/gaps", label: "Knowledge gaps", icon: ICONS.gaps, count: counts.gaps },
      ],
    },
    {
      title: "Assistant",
      items: [
        { href: "/dashboard/assistant", label: "Test Assistant", icon: ICONS.test },
        { href: "/dashboard/business-info", label: "Business Info", icon: ICONS.info },
        { href: "/dashboard/documents", label: "Documents", icon: ICONS.documents },
      ],
    },
    {
      title: "Website",
      items: [
        { href: "/dashboard/widget", label: "Widget", icon: ICONS.widget },
        { href: "/dashboard/api-key", label: "API Key", icon: ICONS.key },
      ],
    },
    {
      title: "Account",
      items: [{ href: "/dashboard/settings", label: "Settings", icon: ICONS.settings, also: ["/dashboard/edit"] }],
    },
  ];
}

function isActive(pathname: string, item: Item) {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return [item.href, ...(item.also ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function NavLinks({ counts, onNavigate }: { counts: { leads: number; gaps: number }; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      {groups(counts).map((group) => (
        <div key={group.title}>
          <p className="px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{group.title}</p>
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                      active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.count ? (
                      <span
                        className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white"
                        aria-label={`${item.count} new`}
                      >
                        {item.count > 99 ? "99+" : item.count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Account({ businessName, email }: { businessName: string; email: string }) {
  return (
    <div className="border-t border-slate-200 px-3 pt-4">
      <p className="truncate text-sm font-medium text-slate-900" data-testid="nav-business-name">
        {businessName}
      </p>
      <p className="truncate text-xs text-slate-500" data-testid="signed-in-email">
        {email}
      </p>
      <form action={signOut} className="mt-3">
        <button
          type="submit"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * The dashboard's navigation: a sidebar on large screens, and a top bar
 * with a menu that slides in on phones and tablets.
 */
export function DashboardNav({
  businessName,
  email,
  counts,
}: {
  businessName: string;
  email: string;
  counts: { leads: number; gaps: number };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Close the menu after navigating, including with the browser's back button.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [open]);

  const unseen = counts.leads + counts.gaps;

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-6 py-5">
          <Logo href="/dashboard" />
        </div>
        <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 pb-6">
          <NavLinks counts={counts} />
        </nav>
        <div className="pb-5">
          <Account businessName={businessName} email={email} />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <Logo href="/dashboard" />
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="relative flex size-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <span className="sr-only">Open menu</span>
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {unseen > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-red-600" aria-hidden="true" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" id="mobile-menu">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-slate-900/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between px-5 py-4">
              <Logo href="/dashboard" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <span className="sr-only">Close menu</span>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 pb-6">
              <NavLinks counts={counts} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="pb-5">
              <Account businessName={businessName} email={email} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { Card } from "@/components/ui";
import { EmbedCode, WidgetSettings } from "@/components/widget-settings";
import { getCurrentBusiness, getWidgetOverview } from "@/lib/data";
import { logoUrl, widgetScriptUrl } from "@/lib/widget-server";

export const metadata: Metadata = { title: "Widget" };

export default function WidgetPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Widget />
    </Suspense>
  );
}

async function Widget() {
  const [business, overview] = await Promise.all([getCurrentBusiness(), getWidgetOverview()]);
  if (!business) redirect("/onboarding");
  if (!overview?.settings || !overview.publicKey) throw new Error("Your widget settings are missing. Please contact support.");

  const { settings, publicKey, domains } = overview;
  const embedCode = `<script src="${widgetScriptUrl()}" data-key="${publicKey}" async></script>`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Widget</h1>
        <p className="mt-2 text-sm text-slate-600">
          Add a chat button to your website. Choose how it looks here; your website picks up saved changes
          automatically.
        </p>
      </div>

      <WidgetSettings
        businessName={business.business_name}
        initial={{
          assistantName: settings.assistant_name,
          brandColor: settings.brand_color,
          position: settings.position,
          welcomeMessage: settings.welcome_message,
          quickReplies: settings.quick_replies,
        }}
        initialLogoUrl={logoUrl(settings.logo_path)}
      />

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Embed code</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Paste this line once on every page of your website, just before the closing &lt;/body&gt; tag. You never
            need to change it when you update your settings.
          </p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <EmbedCode code={embedCode} />
          {domains.length > 0 ? (
            <p className="text-sm text-slate-600">
              The chat button only appears on{" "}
              {domains.map((domain, index) => (
                <span key={domain}>
                  {index > 0 && ", "}
                  <span className="font-mono text-slate-900">{domain}</span>
                </span>
              ))}
              . To add another website, go to{" "}
              <Link href="/dashboard/api-key" className="font-medium text-brand-700 underline underline-offset-2">
                API Key
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-amber-800">
              No websites are allowed yet, so the chat button will not appear anywhere. Add your domain on the{" "}
              <Link href="/dashboard/api-key" className="font-medium underline underline-offset-2">
                API Key
              </Link>{" "}
              page.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">How to install</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Menu names can differ slightly between versions. After installing, open your website and look for the chat
            button in the corner.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          <Guide title="Plain HTML website">
            <li>Open each page&apos;s HTML file, or the shared footer file if your site has one.</li>
            <li>Paste the embed code just before &lt;/body&gt;.</li>
            <li>Save and upload the files to your web host.</li>
          </Guide>
          <Guide title="WordPress">
            <li>
              Install and activate the free <strong>WPCode</strong> plugin (Plugins → Add New, search for
              &quot;WPCode&quot;).
            </li>
            <li>
              Go to <strong>Code Snippets → Header &amp; Footer</strong>.
            </li>
            <li>
              Paste the embed code into the <strong>Footer</strong> box and click <strong>Save Changes</strong>.
            </li>
            <li>If you use a caching plugin, clear its cache.</li>
          </Guide>
          <Guide title="Wix">
            <li>
              In your site dashboard, open <strong>Settings → Custom code</strong> (under Development &amp;
              integrations). Custom code needs a Premium plan and a connected domain.
            </li>
            <li>
              Click <strong>+ Add Custom Code</strong> and paste the embed code.
            </li>
            <li>
              Choose <strong>All pages</strong>, <strong>Load code once</strong>, and place the code in{" "}
              <strong>Body - end</strong>. Click <strong>Apply</strong>.
            </li>
            <li>Publish your site.</li>
          </Guide>
          <Guide title="Shopify">
            <li>
              In Shopify admin, go to <strong>Online Store → Themes</strong>.
            </li>
            <li>
              Next to your current theme, click <strong>…</strong> then <strong>Edit code</strong>.
            </li>
            <li>
              Open <strong>layout/theme.liquid</strong>, paste the embed code just before &lt;/body&gt;, and click{" "}
              <strong>Save</strong>.
            </li>
            <li>
              If customers also visit your <span className="font-mono">.myshopify.com</span> address, add it on the API
              Key page too.
            </li>
          </Guide>
        </div>
      </Card>
    </div>
  );
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group px-6 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
        {title}
        <svg viewBox="0 0 20 20" className="size-4 text-slate-400 transition group-open:rotate-180" fill="currentColor" aria-hidden="true">
          <path d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">{children}</ol>
    </details>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How NYC Discover handles itinerary and operational data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="site-shell privacy-shell">
      <header className="masthead">
        <Link className="brand" href="/" aria-label="NYC Discover home">
          <span className="brand-box">NYC</span><span>DISCOVER</span>
        </Link>
        <div className="masthead-rule"><span>PUBLIC BETA</span><span>PRIVACY DESK</span></div>
      </header>
      <article className="privacy-copy">
        <p className="eyebrow">The short version</p>
        <h1>Your starting point is for planning, not publishing.</h1>
        <p className="privacy-dek">NYC Discover is a guest-only portfolio beta. It does not use accounts, sell personal data, or store raw IP addresses.</p>

        <h2>Shared plans</h2>
        <p>When you create a link, NYC Discover stores the generated comparison plans for seven days. The location label, starting coordinates, regeneration seed, and first travel-leg origin are removed before storage. Links are unguessable, but anyone with a link can open it until it expires.</p>

        <h2>Your browser session</h2>
        <p>Suggestions you have seen, places marked visited or dismissed, kept stops, discovery style, and outing progress stay in this tab’s sessionStorage. If storage is unavailable, they stay in memory. They reset with the New York date or when you choose “Reset this session.” Closing the tab ends its session; browsers may restore a tab’s session when restoring tabs. There is no cross-device history or personal profile. Planning requests include relevant feedback to avoid repeats, but it is not stored in shared links.</p>

        <h2>Abuse prevention</h2>
        <p>Rate limits use a one-way HMAC identifier derived from Vercel&apos;s forwarded IP address. The raw address is not stored. Operational counters expire with their rate-limit windows.</p>

        <h2>Analytics and errors</h2>
        <p>Vercel Web Analytics and Speed Insights measure aggregate use and performance. We count discovery selections, successful generations, outing starts, and optional completion feedback using event names alone: no precise locations, candidate IDs, or session history. Sentry receives scrubbed error and performance data; request bodies, query values, cookies, credentials, user identity, and individual share IDs are omitted or normalized.</p>

        <h2>Public sources</h2>
        <p>Plans combine public place, event, and weather sources. Costs, travel, availability, and opening hours are estimates and should be verified with the linked source before leaving.</p>

        <div className="privacy-actions">
          <Link className="generate-button" href="/">Return to the planner <span aria-hidden="true">→</span></Link>
          <a href="https://github.com/Von-Van/NYCDiscover/issues">Report a privacy or reliability issue</a>
        </div>
      </article>
    </main>
  );
}

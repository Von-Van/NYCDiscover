"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="site-shell"><section className="share-error"><p className="eyebrow">The presses stopped</p><h1>NYC Discover hit an unexpected error.</h1><Link className="generate-button" href="/">Return to the planner <span aria-hidden="true">→</span></Link></section></main>
      </body>
    </html>
  );
}

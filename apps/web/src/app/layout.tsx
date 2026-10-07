import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const allowIndexing = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NYC Discover | A plan for right now",
    template: "%s | NYC Discover",
  },
  description: "Turn a free block of time into a practical NYC itinerary.",
  alternates: { canonical: "/" },
  robots: { index: allowIndexing, follow: allowIndexing },
  openGraph: {
    title: "NYC Discover",
    description: "Turn a free block of time into a practical NYC itinerary.",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

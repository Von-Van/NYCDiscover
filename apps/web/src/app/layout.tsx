import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NYC Discover — A plan for right now",
  description: "Turn a free block of time into a practical NYC itinerary.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


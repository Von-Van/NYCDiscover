import type { Metadata } from "next";
import { SharedItineraryApp } from "@/components/SharedItineraryApp";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Shared NYC plan",
    description: "A seven-day read-only NYC itinerary snapshot.",
    alternates: { canonical: `/share/${id}` },
    robots: { index: false, follow: false },
  };
}

export default async function SharedItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SharedItineraryApp shareId={id} />;
}

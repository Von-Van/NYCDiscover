import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const allowIndexing = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
  return {
    rules: allowIndexing
      ? { userAgent: "*", allow: ["/", "/privacy"], disallow: ["/api/", "/share/"] }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/sitemap.xml`,
  };
}

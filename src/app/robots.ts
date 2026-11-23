import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/booking", "/availability-calendar", "/line/", "/login", "/signup"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

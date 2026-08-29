import type { MetadataRoute } from "next";

const SITE_URL = "https://norikane.studio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/booking",
        "/availability-calendar",
        "/ja/booking",
        "/en/booking",
        "/ja/availability-calendar",
        "/en/availability-calendar",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

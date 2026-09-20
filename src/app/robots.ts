import type { MetadataRoute } from "next";
import { APP_URL } from "@/config/brand";

// Next.js file-convention robots policy. Allow crawling of the marketing
// surface (landing, whitepaper, thoughts, public profiles, auth pages) and
// disallow everything under the app shell + API + Next internals.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/control",
          "/today",
          "/projects",
          "/system",
          "/memory",
          "/goals",
          "/people",
          "/robots",
          "/money",
          "/habits",
          "/events",
          "/prompts",
          "/settings",
          "/activity",
          "/history",
          "/decisions",
          "/digests",
          "/onboarding",
          "/setup",
          "/sign-out",
          "/_next/",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}

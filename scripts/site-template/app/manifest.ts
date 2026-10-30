import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The web app manifest. Without it Android and desktop browsers never offer
 * "Install app", and the product can only be pinned as a bookmark. Its icons
 * are the generated ones in app/icon.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.title,
    short_name: SITE.title,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

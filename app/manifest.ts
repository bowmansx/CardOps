import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CardOps",
    short_name: "CardOps",
    description: "Card inventory, intake, pricing, and sales",
    start_url: "/",
    display: "standalone",
    background_color: "#050907",
    theme_color: "#8a6d1f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

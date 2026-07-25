import type { NextConfig } from "next";

// Standalone CardOps. Routes live in app/ and re-export their implementations
// from src/app/** — the same files Master-Ops used to compile, now owned here.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // camera=(self): the intake CameraSheet uses getUserMedia.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // Card photos no longer travel through server actions at all — the browser
    // uploads them straight to Supabase Storage and only the paths are posted
    // (that is what fixed booking a card hanging for ever on "Saving…"). This
    // limit still matters for the actions that DO carry bulk: CSV import, and
    // any future one. Next's default is 1 MB; 4 MB sits just under Vercel's
    // own 4.5 MB request ceiling.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

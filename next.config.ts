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
    // Intake posts card photos to a SERVER ACTION as base64 data URLs, and
    // base64 inflates by ~37%. Next's default cap is 1 MB — a front and back
    // pair at 1600px/q0.85 lands either side of that, so saves failed with a
    // 413 the client never saw (the action never ran, so no card was created
    // and no error came back). 4 MB is just under Vercel's own 4.5 MB request
    // ceiling; the client also shrinks anything over CAP before sending, so
    // this is the backstop, not the plan.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

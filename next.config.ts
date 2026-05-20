import type { NextConfig } from "next";

const cspReportOnly = [
  "default-src 'self';",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval';",
  "style-src 'self' 'unsafe-inline';",
  "img-src 'self' data: blob: https:;",
  "font-src 'self' data:;",
  "connect-src 'self' https:;",
  "frame-ancestors 'none';",
  "base-uri 'self';",
  "form-action 'self';",
  "object-src 'none'",
].join(" ");

const noStoreHeaders = [
  {
    key: "Cache-Control",
    value: "no-store, no-cache, must-revalidate",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
        ],
      },
      {
        source: "/admin/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/booking/edit/:path*",
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          // Preserve the documented embed on Matthias's website. Avoid a blanket
          // X-Frame-Options header, which would break this cross-origin integration.
          {
            key: "Content-Security-Policy",
            value:
              "object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://bachfischer.me https://www.bachfischer.me",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

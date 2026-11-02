/**
 * Plain ESM (not .ts) so production images can load it without the TypeScript compiler.
 * @type {import("next").NextConfig}
 */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@inother/shared"],
  // Static security headers. The Content-Security-Policy (with a per-request nonce) is set in src/middleware.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Microphone is allowed for our own origin only (voice recording feature).
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;

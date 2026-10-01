import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows several dev servers side by side (e.g. parallel agents / preview) without clobbering .next
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Native / heavy server-only packages must not be bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "sharp",
    "@remotion/renderer",
    "@remotion/bundler",
    "@remotion/compositor-linux-x64-gnu",
    "esbuild",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;

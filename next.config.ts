import type { NextConfig } from "next";

const isVercel = !!process.env.VERCEL || !!process.env.NOW_BUILDER;

const nextConfig: NextConfig = {
  // Vercel handles the build output itself, so we don't need "standalone"
  output: isVercel ? undefined : "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // Exclude heavy directories from file tracing (Z.AI container builds)
  outputFileTracingExcludes: {
    '*': [
      'scrapling_env/**/*',
      'scraping-scripts/**/*',
      'scraper-service/**/*',
      'node_modules/sharp/**/*',
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel handles the build output itself, so we don't need "standalone"
  // For Z.AI container deploys, the build script adds standalone manually
  output: process.env.VERCEL ? undefined : "standalone",

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

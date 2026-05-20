import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Exclude heavy directories from file tracing
  // These contain symlinks that point outside the project root and Python binaries
  outputFileTracingExcludes: {
    '*': [
      'scrapling_env/**/*',
      'scraping-scripts/**/*',
      'node_modules/sharp/**/*',
    ],
  },
};

export default nextConfig;

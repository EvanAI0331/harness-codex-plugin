import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "/api/harness/*/build": ["next.config.ts"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Disable telemetry in production
  experimental: {
    // Enable if needed for Docker
  },
};

export default nextConfig;

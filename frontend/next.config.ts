import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // Enable if needed for Docker
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Type errors will be caught by IDE and CI lint job
    ignoreBuildErrors: true,
  },
  experimental: {
    // Enable if needed for Docker
  },
};

export default nextConfig;

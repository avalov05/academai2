import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lets the test harness build a second, empty-database bundle side by side
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;

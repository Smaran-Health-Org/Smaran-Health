import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Keep the client Router Cache warm for a short window so returning to a
    // recently viewed operational surface is instant instead of re-running
    // every Server Component. Mutations call router.refresh() / revalidation,
    // which invalidates these entries immediately.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;

import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  experimental: { typedRoutes: true },
  serverExternalPackages: ["xlsx"],
};
export default nextConfig;

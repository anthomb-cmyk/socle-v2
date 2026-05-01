import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typedRoutes: true,
  serverExternalPackages: ["xlsx"],
};
export default nextConfig;

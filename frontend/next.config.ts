import type { NextConfig } from "next";

// Must match BASE_PATH in src/utils/config.ts (config files cannot use the "@/" alias).
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NEXT_PUBLIC_ENVIRONMENT === "live" ? "/driver-settlement" : "");

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // Driver Management moved out of Vehicle Management into its own sidebar menu; old links keep working.
  async redirects() {
    return [{ source: "/rbp/vehicles/drivers/:path*", destination: "/rbp/drivers/:path*", permanent: true }];
  },
};

export default nextConfig;

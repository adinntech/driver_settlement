import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
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

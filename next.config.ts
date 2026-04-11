import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Procurement documents (BAC resolution, NOA, signed contracts, NTP)
      // upload through server actions in fallback paths. Match the 50 MB
      // file size limit configured on the procurement-documents Storage
      // bucket.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  eslint: { ignoreDuringBuilds: true },
  // Image Docker minimale : `next build` produit un serveur autonome dans .next/standalone.
  output: "standalone",
};

export default nextConfig;

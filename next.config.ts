import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  eslint: { ignoreDuringBuilds: true },
  // Image Docker minimale : `next build` produit un serveur autonome dans .next/standalone.
  output: "standalone",
  /*
   * Les pages publicitaires vivaient sous /ads. Les bloqueurs de publicités
   * coupent les scripts dont l'adresse contient un dossier « ads » : le cadre
   * de l'app s'affichait, mais le code de la page ne se chargeait jamais et
   * le bloc restait sur « Chargement du drive… ». Tout est passé sous /pubs ;
   * les anciennes adresses continuent de mener au bon endroit.
   */
  async redirects() {
    return [
      { source: "/ads", destination: "/pubs", permanent: false },
      { source: "/ads/creas", destination: "/pubs/creas", permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: "/api/ads/:path*", destination: "/api/pubs/:path*" }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import {
  legacyWmsFallbackRewrites,
  legacyWmsRedirects,
} from "./src/v2/cutover/legacy-wms-routes";

/**
 * CMS keeps using V1 during the first phase, so these entries deliberately keep
 * their existing `/cms/*` destinations. `/admin/products*` is a CMS alias and
 * must not be captured by the WMS map. They are 307 like the WMS entries so no
 * compatibility redirect is cached across the transition.
 */
const cmsRedirects = [
  { source: "/admin/products", destination: "/cms/products", permanent: false },
  { source: "/admin/products/:path*", destination: "/cms/products/:path*", permanent: false },
  { source: "/admin/cms/banner", destination: "/cms/banner", permanent: false },
  { source: "/cms/carousel", destination: "/cms/banner", permanent: false },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "bcryptjs", "ali-oss"],
  allowedDevOrigins: ["192.168.31.200", "localhost:3000"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "oss.universe42.studio",
        pathname: "/**",
      },
    ],
  },
  async redirects() {
    // 1) Legacy WMS/admin URLs go straight to their final V2 pages (307, so the
    //    cutover stays reversible). No rule points at `/wms` or `/legacy`, which
    //    keeps the redirect graph one hop deep.
    // 2) CMS entries stay on V1 (their destinations remain `/cms/*`).
    return [...legacyWmsRedirects(), ...cmsRedirects];
  },
  async rewrites() {
    // `beforeFiles` runs after redirects/proxy and before the filesystem, so
    // redirects only see the incoming `/legacy/...` path (which no redirect
    // matches) and the rewrite maps it to the internal V1 `/wms...` tree. The
    // public URL stays `/legacy/wms...`.
    // See node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md.
    return { beforeFiles: legacyWmsFallbackRewrites() };
  },
};

export default nextConfig;

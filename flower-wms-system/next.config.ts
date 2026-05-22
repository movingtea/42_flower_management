import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/admin/dashboard", destination: "/wms/dashboard", permanent: true },
      { source: "/admin/inventory", destination: "/wms/inventory", permanent: true },
      { source: "/admin/inventory/:path*", destination: "/wms/inventory/:path*", permanent: true },
      { source: "/admin/batches", destination: "/wms/batches", permanent: true },
      { source: "/admin/wastage", destination: "/wms/wastage", permanent: true },
      { source: "/admin/orders", destination: "/wms/orders", permanent: true },
      { source: "/admin/products", destination: "/cms/products", permanent: true },
      { source: "/admin/products/:path*", destination: "/cms/products/:path*", permanent: true },
      { source: "/admin/cms/banner", destination: "/cms/banner", permanent: true },
      { source: "/cms/carousel", destination: "/cms/banner", permanent: true },
    ];
  },
};

export default nextConfig;

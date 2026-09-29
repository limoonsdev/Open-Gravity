import type { NextConfig } from 'next';

// The dashboard is exported as static files and embedded in the router, which
// serves it under /ui. In development (next dev) API calls are proxied to a
// router running on OG_DEV_ROUTER (default http://127.0.0.1:18080).
const dev = process.env.NODE_ENV === 'development';
const router = process.env.OG_DEV_ROUTER || 'http://127.0.0.1:18080';

const config: NextConfig = {
  basePath: '/ui',
  trailingSlash: true,
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  ...(dev
    ? {
        async rewrites() {
          return [
            { source: '/admin/api/:path*', destination: `${router}/admin/api/:path*`, basePath: false },
            { source: '/v1/:path*', destination: `${router}/v1/:path*`, basePath: false },
          ];
        },
      }
    : { output: 'export' }),
};

export default config;

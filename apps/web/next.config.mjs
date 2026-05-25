import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Statiska säkerhetsheaders (CLAUDE.md § 10.3 A.8.9). Den dynamiska,
// nonce-baserade Content-Security-Policy sätts i middleware.ts (kräver
// per-request-nonce). HSTS ignoreras av browsers över HTTP, så det är
// ofarligt att alltid skicka den.
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
  }
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Inflöde (tidigare Kompassen). Backkompat för gamla länkar.
      { source: '/kompassen', destination: '/inflode', permanent: true },
      { source: '/kompassen/:path*', destination: '/inflode/:path*', permanent: true }
    ];
  },
  // Produces a minimal runtime build at .next/standalone with only the
  // node_modules actually used. Cuts the runtime Docker image by ~10x.
  output: 'standalone',
  // For monorepo: tell Next.js the workspace root so file-tracing picks up
  // packages/shared and the right yarn.lock.
  outputFileTracingRoot: join(__dirname, '..', '..'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
      },
      {
        protocol: 'http',
        hostname: 'pocketbase',
        port: '8080',
      },
      // Staging/production PocketBase körs över https på sina sslip.io-hosts
      // (Let's Encrypt via Coolify, se infra/SSL.md) → avatarer täcks redan av
      // catch-all https-mönstret ovan. Inget http-sslip.io-undantag behövs.
    ],
  },
  experimental: {
    // Ensure all dependencies are traced correctly in monorepo with path aliases
    esmExternals: true,
    // Chat-bilagor (bilder base64-encoded + textfiler) — default 1 MB räcker inte
    serverActions: {
      bodySizeLimit: '32mb'
    }
  },
  webpack: (config) => {
    // Make @-alias resolution explicit in all environments (including Docker/Coolify)
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': join(__dirname, 'src'),
    };
    return config;
  },
};

export default nextConfig;

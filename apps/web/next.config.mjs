import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
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

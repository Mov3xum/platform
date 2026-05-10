import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
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
    ],
  },
  experimental: {
    // Ensure all dependencies are traced correctly in monorepo with path aliases
    esmExternals: true,
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

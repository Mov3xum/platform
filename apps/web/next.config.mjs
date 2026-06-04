import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codespacesForwardingHost =
  process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : null;
const serverActionAllowedOrigins = [
  'localhost:3000',
  '127.0.0.1:3000',
  '0.0.0.0:3000',
  codespacesForwardingHost,
].filter(Boolean);

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
  // Node-only server libraries that MUST NOT be webpack-bundled. pdf-parse
  // (PDF text extraction for chat/file uploads) pins its own pdf.js build and
  // reads files via dynamic require()/fs; exceljs (XLSX generation) does the
  // same. When webpack bundles them into the standalone server chunks their
  // internal requires are rewritten and they throw at runtime in production
  // ("kunde inte ladda upp fil PDF"). Kept external they are required natively
  // and correctly file-traced into .next/standalone/node_modules.
  //
  // NOTE: the pure-JS doc libs (pdf-lib, pptxgenjs, docx) are deliberately NOT
  // listed — they bundle fine, and @vercel/nft traces docx's CJS entry
  // incompletely, so externalizing it would break the DOCX renderer.
  serverExternalPackages: [
    'pdf-parse',
    'exceljs',
  ],
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
  // Skip build-only packages from output file tracing. Without this,
  // @vercel/nft has to stat all of node_modules (including the @swc/core
  // compiler, webpack, tailwindcss etc.) which hangs the Docker build for
  // 18+ hours on Coolify. The '*' wildcard applies globally — none of these
  // build-tool packages are needed at runtime in the standalone output.
  // NOTE: Moved from experimental.outputFileTracingExcludes — Next.js 15
  // promoted this to a top-level option.
  // VIKTIGT: exkludera ENDAST @swc/core (build-kompilatorn), ALDRIG hela
  // @swc/** — @swc/helpers är en runtime-dep till next och dess output
  // kräver `@swc/helpers/_/_interop_require_default`. Tas helpers bort ur
  // standalone-bundlen kraschar servern direkt med MODULE_NOT_FOUND →
  // healthcheck unhealthy → Coolify rullar tillbaka.
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core/**',
      'node_modules/@swc/core-*/**',
      'node_modules/@esbuild/**',
      'node_modules/webpack/**',
      'node_modules/eslint/**',
      'node_modules/@eslint/**',
      'node_modules/typescript/**',
      'node_modules/tailwindcss/**',
      'node_modules/@tailwindcss/**',
      'node_modules/postcss/**',
      'node_modules/autoprefixer/**',
      'node_modules/.cache/**',
    ],
  },
  experimental: {
    // Ensure all dependencies are traced correctly in monorepo with path aliases
    esmExternals: true,
    // Chat-bilagor (bilder base64-encoded + textfiler) — default 1 MB räcker inte
    serverActions: {
      bodySizeLimit: '32mb',
      // Local dev in Codespaces can proxy requests via *.app.github.dev while
      // the browser origin is localhost:3000, which otherwise triggers
      // "Invalid Server Actions request" host checks.
      allowedOrigins: serverActionAllowedOrigins,
    },
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

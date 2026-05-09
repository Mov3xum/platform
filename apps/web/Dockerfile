FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json yarn.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN yarn install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn workspace @platform/web build

# Minimal runtime image: copies only the standalone Next.js output
# (~50MB) instead of the full builder /app (~1GB+). Avoids OOM/disk
# issues during the COPY step on Coolify hosts.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# standalone bundles only the node_modules actually needed at runtime
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# static assets aren't included in standalone — copy them separately
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# public assets (fonts, brand SVGs etc.)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

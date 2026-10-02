FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Production-only dependencies (no dev tooling) for the runtime stage
FROM base AS deps-prod
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci --omit=dev
RUN npx prisma generate

# Build the application
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Copy only the files the production build needs. Keeping this explicit avoids
# invalidating the layer (and re-running the build) when unrelated files such as
# documentation, tests or CI configuration change.
COPY package.json ./
COPY tsconfig.base.json ./
COPY nx.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY libs ./libs
COPY apps/api ./apps/api

RUN npx prisma generate
RUN npx nx build api --configuration=production

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# OpenSSL is required at runtime by the Prisma engine during `prisma migrate deploy`
RUN apk add --no-cache openssl

COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/api ./app
COPY --from=deps-prod --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copy migration files for runtime migration deploy
COPY --from=builder --chown=nestjs:nodejs /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=nestjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nestjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Copy package.json for prisma CLI (needed for migrate deploy)
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./package.json

# Writable runtime log directory for the non-root runtime user
RUN mkdir -p /app/logs \
 && chown -R nestjs:nodejs /app/logs

# Writable export storage directory for the non-root runtime user
RUN mkdir -p /app/exports \
 && chown -R nestjs:nodejs /app/exports

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Apply pending migrations at startup, then start the API. `prisma` is shipped as a
# production dependency via deps-prod node_modules so `npx prisma migrate deploy`
# is available in the runtime image.
CMD ["sh", "-c", "npx prisma migrate deploy && node app/main.js"]

FROM node:22-bookworm-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY db ./db
COPY src ./src
# Migrations run when it starts. The image cache belongs on a disk that stays: IMAGE_CACHE_DIR.
CMD ["node_modules/.bin/tsx", "src/server.ts"]

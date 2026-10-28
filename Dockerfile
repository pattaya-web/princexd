# syntax=docker/dockerfile:1

# ---------- Build ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Run ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    KEEP_ALIVE_TIMEOUT=125000

# yt-dlp (transcription par lien, medias des createurs) + ffmpeg pour les
# formats qui exigent un remux. `python-is-python3` fournit la commande
# `python` que le code appelle.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 ffmpeg ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Keep-alive plus long que celui de Traefik : sinon des POST tombent en 502 au hasard (voir le fichier).
COPY --from=builder /app/scripts/keepalive.cjs ./keepalive.cjs
# Theme Shopify Aesthetic Lab servi aux eleves (hors public/, lu par /api/formation/theme/file).
COPY --from=builder /app/content/theme ./content/theme
# Boutique d'exemple (copie HTML lecture seule) servie aux eleves par /api/formation/boutique-exemple.
COPY --from=builder /app/content/boutique-exemple ./content/boutique-exemple

# Base JSON + medias uploades : a monter en volume persistant sur /app/data.
RUN mkdir -p /app/data/media && chown -R node:node /app
USER node
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "-r", "./keepalive.cjs", "server.js"]

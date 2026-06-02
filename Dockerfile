# WhatsApp HTML Backup — containerized Web UI.
#
# Build:  docker build -t wa-backup .
# Run:    docker run -it -p 3000:3000 \
#           -v "$PWD/output:/app/output" \
#           -v "$PWD/.wwebjs_auth:/app/.wwebjs_auth" \
#           wa-backup
# Then open http://localhost:3000 and scan the QR.
#
# The session + output are mounted as volumes so they persist across runs.

FROM node:20-bookworm-slim

# System libraries required by the bundled Chromium (Puppeteer).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
# Bind to all interfaces inside the container so the mapped port is reachable.
ENV HOST=0.0.0.0
EXPOSE 3000

# Default to the browser Web UI; override CMD for a one-shot CLI run.
CMD ["node", "src/index.js", "--serve", "--port", "3000"]

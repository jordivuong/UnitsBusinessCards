FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghostscript imagemagick poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/me').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]

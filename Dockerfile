FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="OH MEGA Virtual Fund Backend"
LABEL org.opencontainers.image.description="Dockerized AI committee and paper-portfolio API with Human approval controls"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
ENV DEPLOY_TARGET=zeabur
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV SQLITE_PATH=/data/oh-mega.db

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node scripts/weekly-scheduler.mjs & exec npm start -- --port ${PORT:-8080}"]

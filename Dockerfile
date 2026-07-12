FROM node:22-bookworm-slim

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

CMD ["sh", "-c", "node scripts/weekly-scheduler.mjs & exec npm start -- --port ${PORT:-8080}"]

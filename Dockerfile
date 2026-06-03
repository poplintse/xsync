FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV XSYNC_HOST=0.0.0.0
ENV XSYNC_PORT=8792
ENV XSYNC_BASE_PATH=/xsync-lite
ENV XSYNC_DATA_DIR=/app/.data

EXPOSE 8792

CMD ["node", "src/server/index.js"]

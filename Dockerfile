FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server/ ./server/
COPY public/ ./public/

EXPOSE 3000

ENV PORT=3000
ENV JWT_SECRET=autochest-production-secret-change-me
ENV DB_PATH=/app/data/data.db

RUN mkdir -p /app/data

CMD ["node", "server/index.js"]

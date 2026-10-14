# Multi-stage production Dockerfile for FPCC Cortex
FROM node:20-alpine AS base

WORKDIR /app

# Install build dependencies for sqlite & python if needed
RUN apk add --no-cache python3 py3-pip sqlite

# Copy package manifests
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --only=production

# Copy application source
WORKDIR /app
COPY . .

# Initialize DB & seed if not already present
RUN python3 scripts/ingest_excel.py && python3 scripts/seed_operations.py

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

WORKDIR /app/server
CMD ["node", "src/server.js"]

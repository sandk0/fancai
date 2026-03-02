# Development Dockerfile for Frontend
FROM node:22-alpine

# Install system dependencies (including wget for health checks)
RUN apk add --no-cache \
    libc6-compat \
    wget \
    curl

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies (clean install for proper platform)
# Using --legacy-peer-deps to handle vitest version conflicts
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 && \
    chown -R nextjs:nodejs /app

# Expose Vite dev server port
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5173 || exit 1

# Default development command (Vite dev server on port 5173)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
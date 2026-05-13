# --- Stage 1: Build Frontend ---
FROM node:18-alpine AS build-frontend
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ ./
RUN npm run build

# --- Stage 2: Build Backend ---
FROM node:18-alpine
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S aquaiq && adduser -S aquaiq -G aquaiq

WORKDIR /app

# Copy backend dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy backend code
COPY . .

# Copy built frontend from Stage 1
COPY --from=build-frontend /app/dashboard/dist ./dashboard/dist

# Create logs directory
RUN mkdir -p logs && chown -R aquaiq:aquaiq /app

# Switch to non-root user
USER aquaiq

# Expose the port the app runs on
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"]

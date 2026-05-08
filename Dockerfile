FROM node:18-alpine

# Use production environment
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S aquaiq && adduser -S aquaiq -G aquaiq

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of the application code
COPY . .

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

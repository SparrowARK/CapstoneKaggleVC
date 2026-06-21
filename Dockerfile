# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the MCP Battle Engine
FROM node:20-alpine AS mcp-builder
WORKDIR /app/mcp-battle-engine
COPY mcp-battle-engine/package*.json ./
RUN npm install --production
COPY mcp-battle-engine/ ./

# Stage 3: Build the Express Backend and assemble the final image
FROM node:20-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --production

# Copy backend source
COPY backend/ ./

# Copy built frontend assets to where backend/server.js expects them
# (server.js uses path.join(__dirname, '../frontend/dist'))
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy built MCP engine
# (server.js uses path.join(__dirname, '../mcp-battle-engine/index.js'))
COPY --from=mcp-builder /app/mcp-battle-engine /app/mcp-battle-engine

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Start the Express server
CMD ["node", "server.js"]

# The Moon at full measured detail, served from your own machine (docs/stories/SS-10c.md).
# The same server as `npm run local`: it builds each terrain tile the first time a view needs it,
# from NASA PDS and JAXA files, and caches everything under /data. Mount a volume there.
#
#   docker build -t solar-system .
#   docker run -d -p 5178:5178 -v moon-cache:/data --name solar-system solar-system
#
# WebGPU only runs on secure pages: http://localhost on the machine itself, or https. To use it
# from a phone or another computer, put it behind https (docs/self-hosting.md).

# Build the app. The website's own terrain tiles (public/terrain/) are not needed: this server
# makes every tile itself.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build

# Run it: Node 22 runs the TypeScript directly, and the server needs no npm packages.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5178 \
    MOON_CACHE=/data
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY tools/local ./tools/local
COPY tools/terrain/quantizedMesh.ts ./tools/terrain/quantizedMesh.ts
COPY src/core ./src/core
COPY public/data/moon/roughness.json ./public/data/moon/roughness.json
RUN rm -f tools/local/*.test.ts src/core/*.test.ts && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 5178
CMD ["node", "tools/local/server.ts"]

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
RUN npm ci
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Migration runner + SQL can co trong image runtime de auto-migrate luc khoi dong (prod).
COPY scripts ./scripts
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM node:20-alpine AS base
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
RUN npm ci
EXPOSE 4000
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
EXPOSE 4000
CMD ["node", "dist/index.js"]

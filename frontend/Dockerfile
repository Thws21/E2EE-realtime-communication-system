FROM node:22-bookworm-slim AS development
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=optional
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_SOCKET_BASE_URL=
ARG VITE_STUN_SERVERS=
ARG VITE_TURN_URL=
ARG VITE_TURN_USERNAME=
ARG VITE_TURN_CREDENTIAL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOCKET_BASE_URL=$VITE_SOCKET_BASE_URL
ENV VITE_STUN_SERVERS=$VITE_STUN_SERVERS
ENV VITE_TURN_URL=$VITE_TURN_URL
ENV VITE_TURN_USERNAME=$VITE_TURN_USERNAME
ENV VITE_TURN_CREDENTIAL=$VITE_TURN_CREDENTIAL
COPY package.json package-lock.json ./
RUN rm -f package-lock.json && npm install --include=optional
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

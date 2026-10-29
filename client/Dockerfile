FROM node:24-bookworm-slim AS build

ARG VITE_GUEST_APP_URL
ARG VITE_STAFF_APP_URL
ARG VITE_ADMIN_APP_URL
ARG VITE_SUPPORT_TELEGRAM_URL=https://t.me/cafe_sky_cskh_bot
ENV VITE_GUEST_APP_URL=$VITE_GUEST_APP_URL
ENV VITE_STAFF_APP_URL=$VITE_STAFF_APP_URL
ENV VITE_ADMIN_APP_URL=$VITE_ADMIN_APP_URL
ENV VITE_SUPPORT_TELEGRAM_URL=$VITE_SUPPORT_TELEGRAM_URL

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY packages/contracts packages/contracts
COPY client client
RUN npm -w @may-cafe/contracts run build && npm -w @may-cafe/client run build

FROM nginx:1.27-alpine
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/maycafe-common.inc /etc/nginx/conf.d/maycafe-common.inc
COPY docker/nginx/maycafe-security-headers.inc /etc/nginx/conf.d/maycafe-security-headers.inc
COPY docker/nginx/maycafe-guest-proxy.inc /etc/nginx/conf.d/maycafe-guest-proxy.inc
COPY docker/nginx/maycafe-internal-proxy.inc /etc/nginx/conf.d/maycafe-internal-proxy.inc
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080 8081 8082

# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# deps first for layer cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# source + build (adapter-static → /app/dist)
COPY . .
RUN pnpm build

# ---- runtime stage ----
FROM nginx:1.27-alpine AS runtime

# SPA-ish static serving; adapter-static output
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

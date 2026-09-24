FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# The Next.js `standalone` output only bundles what the app imports at
# runtime (@prisma/client), not devDependencies like ts-node/dotenv-cli.
# `prisma db seed` shells out to the `prisma.seed` script in package.json
# (which uses ts-node + dotenv-cli), and neither package - nor their own
# transitive deps - is present in the runner stage below, so that command
# fails at container start with "could not determine executable to run".
# `prisma migrate deploy` is unaffected (it only needs the `prisma` CLI
# package itself, which is copied below). To keep seeding working without
# dragging ts-node/dotenv-cli (and their dependency trees) into the
# production image, compile seed.ts to plain JS here and run it with
# plain `node` at runtime instead of going through `prisma db seed`.
RUN npx tsc prisma/seed.ts --outDir prisma --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
EXPOSE 3000
# Incidente "20260924153000_filament_weighted_average_cost falhou em
# produção" (ordem errada de DROP COLUMN/DROP INDEX, corrigida no próprio
# arquivo da migration): a 1ª tentativa falhou e travou o container --
# Prisma grava essa migration como "failed" em `_prisma_migrations` e todo
# `migrate deploy` seguinte se recusa a continuar (P3009) até alguém rodar
# `migrate resolve`, mesmo já com o SQL corrigido. `|| true` faz esse passo
# não quebrar o `&&` quando não há nada pra resolver (deploy normal,
# depois que o incidente for resolvido) -- seguro de deixar aqui
# permanentemente, mas dá pra remover num commit de limpeza depois de
# confirmar que subiu.
CMD ["sh", "-c", "(node_modules/.bin/prisma migrate resolve --rolled-back 20260924153000_filament_weighted_average_cost || true) && node_modules/.bin/prisma migrate deploy && (node prisma/seed.js || true) && node server.js"]

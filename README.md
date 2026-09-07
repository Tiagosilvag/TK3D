# TK3D — Controle de Produção 3D

Aplicação interna (Next.js + Prisma/PostgreSQL) para controle de custos,
produção e vendas de uma operação de impressão 3D.

## Desenvolvimento local

```bash
npm install
cp .env.example .env   # preencher DATABASE_URL, APP_PASSWORD, SESSION_SECRET
npx prisma migrate deploy
npm run dev
```

Rodar os testes:

```bash
npm test
```

## Deploy (Docker / Coolify)

A aplicação roda como um único container Next.js (`output: 'standalone'`),
construído pelo `Dockerfile` multi-stage na raiz do projeto e orquestrado
pelo `docker-compose.yaml` (serviço único `app`). No Coolify, aponte a
aplicação para este repositório com build pack "Docker Compose" — ele usa
o `docker-compose.yaml` do repositório diretamente.

### Variáveis de ambiente obrigatórias

Configure estas 3 variáveis no ambiente da aplicação no Coolify (não
commitar valores reais — `.env` está no `.gitignore` e no `.dockerignore`):

| Variável | Descrição | Como gerar |
|---|---|---|
| `DATABASE_URL` | String de conexão PostgreSQL, **com `?schema=tk3d`** no final, apontando para o banco `postgresql-database-geral` do Coolify. Formato: `postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=tk3d` | Copiar do serviço de banco no Coolify e acrescentar `?schema=tk3d` |
| `APP_PASSWORD` | Senha única de acesso à aplicação (login simples, sem múltiplos usuários) | Escolher uma senha forte própria |
| `SESSION_SECRET` | Segredo usado para assinar o cookie de sessão | `openssl rand -hex 32` |

Sem essas 3 variáveis definidas, o container sobe mas a aplicação não
consegue conectar ao banco nem autenticar (ver `middleware.ts` e
`lib/`).

### O que acontece ao iniciar o container

O `CMD` do `Dockerfile` executa, nesta ordem, a cada start/restart do
container:

1. `prisma migrate deploy` — aplica migrações pendentes no schema
   `tk3d` do banco apontado por `DATABASE_URL`. Se isso falhar, o
   container **não sobe** (falha rápida e visível nos logs do Coolify).
2. Seed automático de dados de referência (impressoras, filamentos,
   embalagens, insumos, configurações padrão) — roda com `prisma
   db seed` como base, mas a lógica é pré-compilada e executada com
   `node` puro no runtime (não depende de `ts-node`/`dotenv-cli`, que
   não fazem parte da imagem final de produção). O script usa `upsert`
   por campo único em cada tabela, então rodar de novo em um banco já
   populado **não duplica dados nem falha** — apenas não altera as
   linhas que já existem. Uma falha aqui não impede o container de
   subir (é best-effort).
3. `node server.js` — inicia o servidor Next.js standalone na porta
   `3000`.

### Deploy manual (sem Coolify)

```bash
docker compose up -d --build
```

Requer um arquivo `.env` na raiz (não commitado) com as 3 variáveis
acima, já que `docker-compose.yaml` as lê via `${DATABASE_URL}` etc.

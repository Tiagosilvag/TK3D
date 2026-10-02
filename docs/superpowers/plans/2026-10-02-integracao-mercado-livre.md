# Integração com Mercado Livre — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar a conta real do Mercado Livre via OAuth2 pra (1) detectar pedido novo automaticamente (webhook + reconciliação a cada 5min) com alerta visual persistente até o pedido ser entregue, e (2) consultar os anúncios ativos da conta, sem mexer no cadastro manual existente de `Order`/`Listing`.

**Architecture:** Camada `lib/mercadoLivre/*.ts` isola toda chamada HTTP à API do Mercado Livre (auth, pedidos, anúncios), testável via mock de `global.fetch` (mesmo padrão de `lib/bambu/auth.ts`/`lib/anycubic/auth.ts`). Um sistema de notificação genérico (`lib/notifications.ts` + `Notification` model) desacopla "avisar o usuário" de "o que aconteceu" — o pedido ML é só o primeiro produtor. Webhook e poller de reconciliação convergem na mesma função `processOrderNotification`, evitando duplicar lógica de processamento.

**Tech Stack:** Next.js 15 App Router (Server Actions + Route Handlers), Prisma/PostgreSQL, Zod, Vitest. Zero dependências novas — `fetch` nativo do Node pra chamadas HTTP.

**Spec:** `docs/superpowers/specs/2026-10-02-integracao-mercado-livre-design.md`

## Global Constraints

- Sem banco vivo neste sandbox de desenvolvimento: `prisma migrate dev` não roda aqui — toda migration é escrita à mão em `prisma/migrations/<timestamp>_nome/migration.sql`, seguindo o estilo das migrations existentes (PascalCase pra tabela/enum). `npx prisma validate`/`generate` funcionam com `DATABASE_URL` fake.
- Testes de `tests/integration/` precisam de banco vivo e NÃO rodam neste sandbox — escreva-os mesmo assim (documentam o comportamento esperado e rodam em CI/produção), mas a verificação local de cada task roda só `tests/unit/`.
- Verificação antes de cada commit (todas as 4, nessa ordem): `DATABASE_URL="x" npx tsc --noEmit` (ignore os 2 erros pré-existentes em `tests/integration/accessories.test.ts`), `npm run lint`, `npx vitest run tests/unit`, `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`.
- `type ActionResult = { success: boolean; error?: string }` redefinido localmente em cada `actions/*.ts` novo — não existe tipo compartilhado.
- Server Components + Server Actions (`'use server'`); Client Component só onde precisa de estado (`'use client'`) o mínimo possível.
- Credenciais cifradas via `lib/crypto.ts#encryptCredential`/`decryptCredential` (AES-256-GCM, chave `BAMBU_CREDENTIAL_KEY` já existente — nome genérico, documentado).
- Modais usam `<dialog>` nativo — zero bibliotecas de UI novas.
- `git checkout -b claude/mercado-livre-integration` já existe e está com a spec commitada (`d3d51de`) — todo o trabalho deste plano continua nessa branch. Nunca commitar/dar deploy direto em `main`.
- Nunca commitar segredo real (Client Secret, tokens) em nenhum arquivo — só nomes de env var (`MERCADOLIVRE_CLIENT_ID`, `MERCADOLIVRE_CLIENT_SECRET`), valores reais só no Coolify.

---

### Task 1: Schema — MarketplaceConnection, MarketplaceOrderInbox, Notification

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261002120000_marketplace_integration/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `MarketplaceConnection`, `MarketplaceOrderInbox`, `Notification`, enums `MarketplaceConnectionStatus`, `MarketplaceOrderInboxStatus`, `NotificationType` — todas as tasks seguintes consomem esses tipos gerados pelo Prisma Client.

- [ ] **Step 1: Adicionar os modelos ao `prisma/schema.prisma`**

Adicionar depois do bloco de `MarketplacePlatform`/`Listing` existente (perto da linha ~990, antes de `model Sale`):

```prisma
enum MarketplaceConnectionStatus {
  CONECTADA
  DESCONECTADA
}

model MarketplaceConnection {
  id             String                      @id @default(cuid())
  platform       MarketplacePlatformKind     @unique
  sellerId       String
  accessToken    String
  refreshToken   String
  tokenExpiresAt DateTime
  status         MarketplaceConnectionStatus @default(CONECTADA)
  connectedAt    DateTime                    @default(now())
  lastError      String?
  updatedAt      DateTime                    @updatedAt
}

enum MarketplaceOrderInboxStatus {
  PENDENTE
  CONFIRMADO
  IGNORADO
}

model MarketplaceOrderInbox {
  id               String                      @id @default(cuid())
  platform         MarketplacePlatformKind
  externalOrderId  String
  buyerName        String?
  totalAmount      Decimal                     @db.Decimal(10, 2)
  items            Json
  status           MarketplaceOrderInboxStatus @default(PENDENTE)
  confirmedOrderId String?                     @unique
  confirmedOrder   Order?                      @relation(fields: [confirmedOrderId], references: [id])
  receivedAt       DateTime                    @default(now())
  updatedAt        DateTime                    @updatedAt

  @@unique([platform, externalOrderId])
}

enum NotificationType {
  NOVO_PEDIDO_MARKETPLACE
}

model Notification {
  id           String           @id @default(cuid())
  type         NotificationType
  title        String
  body         String?
  link         String?
  resourceType String?
  resourceId   String?
  seenAt       DateTime?
  resolvedAt   DateTime?
  createdAt    DateTime         @default(now())
}
```

Adicionar a relação inversa no `model Order` existente (perto de `items OrderItem[]`):

```prisma
  inboxEntries MarketplaceOrderInbox[]
```

- [ ] **Step 2: Validar o schema**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Gerar o client**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma generate`
Expected: termina sem erro, `node_modules/.prisma/client` atualizado com os novos tipos.

- [ ] **Step 4: Escrever a migration SQL à mão**

Criar `prisma/migrations/20261002120000_marketplace_integration/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "MarketplaceConnectionStatus" AS ENUM ('CONECTADA', 'DESCONECTADA');

-- CreateEnum
CREATE TYPE "MarketplaceOrderInboxStatus" AS ENUM ('PENDENTE', 'CONFIRMADO', 'IGNORADO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NOVO_PEDIDO_MARKETPLACE');

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "platform" "MarketplacePlatformKind" NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "MarketplaceConnectionStatus" NOT NULL DEFAULT 'CONECTADA',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceOrderInbox" (
    "id" TEXT NOT NULL,
    "platform" "MarketplacePlatformKind" NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "buyerName" TEXT,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "items" JSONB NOT NULL,
    "status" "MarketplaceOrderInboxStatus" NOT NULL DEFAULT 'PENDENTE',
    "confirmedOrderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOrderInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "seenAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_platform_key" ON "MarketplaceConnection"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrderInbox_confirmedOrderId_key" ON "MarketplaceOrderInbox"("confirmedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceOrderInbox_platform_externalOrderId_key" ON "MarketplaceOrderInbox"("platform", "externalOrderId");

-- AddForeignKey
ALTER TABLE "MarketplaceOrderInbox" ADD CONSTRAINT "MarketplaceOrderInbox_confirmedOrderId_fkey" FOREIGN KEY ("confirmedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261002120000_marketplace_integration
git commit -m "feat(ml): schema de MarketplaceConnection, MarketplaceOrderInbox e Notification"
```

---

### Task 2: Cliente de autenticação OAuth2 do Mercado Livre

**Files:**
- Create: `lib/mercadoLivre/auth.ts`
- Test: `tests/unit/mercadoLivreAuth.test.ts`

**Interfaces:**
- Consumes: `process.env.MERCADOLIVRE_CLIENT_ID`, `process.env.MERCADOLIVRE_CLIENT_SECRET`, `process.env.MERCADOLIVRE_REDIRECT_URI`.
- Produces: `buildAuthorizationUrl(): string`, `exchangeCodeForTokens(code: string): Promise<MLTokenResponse>`, `refreshAccessToken(refreshToken: string): Promise<MLTokenResponse>`, `isTokenExpiringSoon(expiresAt: Date): boolean`, tipo `MLTokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; userId: string }` — consumido por Task 3 (`lib/mercadoLivre/connection.ts`).

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/unit/mercadoLivreAuth.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, isTokenExpiringSoon } from '@/lib/mercadoLivre/auth'

describe('mercadoLivre auth client', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('buildAuthorizationUrl monta a URL com client_id e redirect_uri do ambiente', () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_REDIRECT_URI = 'https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'
    const url = buildAuthorizationUrl()
    expect(url).toContain('https://auth.mercadolivre.com.br/authorization')
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=client-123')
    expect(url).toContain(encodeURIComponent('https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'))
  })

  it('exchangeCodeForTokens troca o código pelos tokens', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    process.env.MERCADOLIVRE_REDIRECT_URI = 'https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 21600, user_id: 999 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeCodeForTokens('code-xyz')

    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 21600, userId: '999' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('exchangeCodeForTokens lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid_grant' }) }) as unknown as typeof fetch
    await expect(exchangeCodeForTokens('code-invalido')).rejects.toThrow('Falha ao trocar código pelo token do Mercado Livre')
  })

  it('refreshAccessToken renova usando o refresh token', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 21600, user_id: 999 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await refreshAccessToken('refresh-1')
    expect(result.accessToken).toBe('access-2')
  })

  it('refreshAccessToken lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }) as unknown as typeof fetch
    await expect(refreshAccessToken('refresh-expirado')).rejects.toThrow('Falha ao renovar token do Mercado Livre')
  })

  it('isTokenExpiringSoon é true quando faltam menos de 5 minutos', () => {
    const daquiA4min = new Date(Date.now() + 4 * 60 * 1000)
    expect(isTokenExpiringSoon(daquiA4min)).toBe(true)
  })

  it('isTokenExpiringSoon é false quando falta mais de 5 minutos', () => {
    const daquiA10min = new Date(Date.now() + 10 * 60 * 1000)
    expect(isTokenExpiringSoon(daquiA10min)).toBe(false)
  })

  it('isTokenExpiringSoon é true quando já expirou', () => {
    const jaExpirou = new Date(Date.now() - 1000)
    expect(isTokenExpiringSoon(jaExpirou)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/mercadoLivreAuth.test.ts`
Expected: FAIL com `Cannot find module '@/lib/mercadoLivre/auth'`

- [ ] **Step 3: Implementar `lib/mercadoLivre/auth.ts`**

```typescript
// lib/mercadoLivre/auth.ts
const AUTH_BASE_URL = 'https://auth.mercadolivre.com.br/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const TOKEN_EXPIRING_SOON_MS = 5 * 60 * 1000

export interface MLTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
}

function getClientId(): string {
  const id = process.env.MERCADOLIVRE_CLIENT_ID
  if (!id) throw new Error('MERCADOLIVRE_CLIENT_ID não configurada')
  return id
}

function getClientSecret(): string {
  const secret = process.env.MERCADOLIVRE_CLIENT_SECRET
  if (!secret) throw new Error('MERCADOLIVRE_CLIENT_SECRET não configurada')
  return secret
}

function getRedirectUri(): string {
  const uri = process.env.MERCADOLIVRE_REDIRECT_URI
  if (!uri) throw new Error('MERCADOLIVRE_REDIRECT_URI não configurada')
  return uri
}

export function buildAuthorizationUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
  })
  return `${AUTH_BASE_URL}?${params.toString()}`
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number
}

function parseTokenResponse(raw: RawTokenResponse): MLTokenResponse {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresIn: raw.expires_in,
    userId: String(raw.user_id),
  }
}

export async function exchangeCodeForTokens(code: string): Promise<MLTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code,
    redirect_uri: getRedirectUri(),
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) throw new Error('Falha ao trocar código pelo token do Mercado Livre')
  const raw = (await response.json()) as RawTokenResponse
  return parseTokenResponse(raw)
}

export async function refreshAccessToken(refreshToken: string): Promise<MLTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) throw new Error('Falha ao renovar token do Mercado Livre')
  const raw = (await response.json()) as RawTokenResponse
  return parseTokenResponse(raw)
}

export function isTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < TOKEN_EXPIRING_SOON_MS
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/mercadoLivreAuth.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/mercadoLivre/auth.ts tests/unit/mercadoLivreAuth.test.ts
git commit -m "feat(ml): cliente OAuth2 (authorization url, troca de código, refresh)"
```

---

### Task 3: Conexão persistida — `getValidAccessToken`, connect/disconnect, callback OAuth

**Files:**
- Create: `lib/mercadoLivre/connection.ts`
- Create: `actions/mercadoLivreAuth.ts`
- Create: `app/api/integrations/mercado-livre/callback/route.ts`
- Test: `tests/integration/mercadoLivreConnection.test.ts`

**Interfaces:**
- Consumes: `buildAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `isTokenExpiringSoon` (Task 2); `encryptCredential`/`decryptCredential` (`lib/crypto.ts`, já existente).
- Produces: `getValidAccessToken(platform: 'MERCADO_LIVRE'): Promise<string>` (lança erro se não conectado ou refresh falhar) — consumido por Tasks 6, 9 e 11. `disconnectMercadoLivre(): Promise<ActionResult>` — ação de servidor.

- [ ] **Step 1: Escrever `lib/mercadoLivre/connection.ts`**

```typescript
// lib/mercadoLivre/connection.ts
import { prisma } from '@/lib/prisma'
import { encryptCredential, decryptCredential } from '@/lib/crypto'
import { refreshAccessToken, isTokenExpiringSoon, type MLTokenResponse } from '@/lib/mercadoLivre/auth'

export async function saveConnection(tokens: MLTokenResponse): Promise<void> {
  const encryptedAccess = encryptCredential(tokens.accessToken)
  const encryptedRefresh = encryptCredential(tokens.refreshToken)
  const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000)
  await prisma.marketplaceConnection.upsert({
    where: { platform: 'MERCADO_LIVRE' },
    create: {
      platform: 'MERCADO_LIVRE',
      sellerId: tokens.userId,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      status: 'CONECTADA',
    },
    update: {
      sellerId: tokens.userId,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      status: 'CONECTADA',
      lastError: null,
    },
  })
}

export async function getValidAccessToken(): Promise<string> {
  const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
  if (!connection || connection.status === 'DESCONECTADA') {
    throw new Error('Mercado Livre não está conectado')
  }
  if (!isTokenExpiringSoon(connection.tokenExpiresAt)) {
    return decryptCredential(connection.accessToken)
  }
  try {
    const refreshToken = decryptCredential(connection.refreshToken)
    const tokens = await refreshAccessToken(refreshToken)
    await saveConnection(tokens)
    return tokens.accessToken
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao renovar token'
    await prisma.marketplaceConnection.update({
      where: { platform: 'MERCADO_LIVRE' },
      data: { status: 'DESCONECTADA', lastError: message },
    })
    throw new Error('Conexão com o Mercado Livre expirou — reconecte em Configurações')
  }
}

export async function getConnectionStatus() {
  return prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
}
```

- [ ] **Step 2: Escrever `actions/mercadoLivreAuth.ts`**

```typescript
// actions/mercadoLivreAuth.ts
'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function disconnectMercadoLivre(): Promise<ActionResult> {
  const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
  if (!connection) return { success: false, error: 'Mercado Livre não está conectado' }
  await prisma.marketplaceConnection.delete({ where: { platform: 'MERCADO_LIVRE' } })
  revalidatePath('/settings/integrations')
  return { success: true }
}
```

- [ ] **Step 3: Escrever o route handler do callback OAuth**

```typescript
// app/api/integrations/mercado-livre/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/mercadoLivre/auth'
import { saveConnection } from '@/lib/mercadoLivre/connection'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code')
  const redirectBase = new URL('/settings/integrations', request.url)

  if (!code) {
    redirectBase.searchParams.set('erro', 'Autorização do Mercado Livre cancelada ou sem código')
    return NextResponse.redirect(redirectBase)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    await saveConnection(tokens)
    redirectBase.searchParams.set('conectado', '1')
  } catch (err) {
    redirectBase.searchParams.set('erro', err instanceof Error ? err.message : 'Falha ao conectar com o Mercado Livre')
  }
  return NextResponse.redirect(redirectBase)
}
```

- [ ] **Step 4: Escrever o teste de integração (documenta o comportamento; não roda neste sandbox sem banco vivo)**

```typescript
// tests/integration/mercadoLivreConnection.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getValidAccessToken, saveConnection } from '@/lib/mercadoLivre/connection'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.marketplaceConnection.deleteMany()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('mercadoLivre connection', () => {
  it('getValidAccessToken devolve o token decifrado quando não está perto de expirar', async () => {
    await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
    const token = await getValidAccessToken()
    expect(token).toBe('tok-1')
  })

  it('getValidAccessToken renova e salva quando o token está prestes a expirar', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-1', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-novo', refresh_token: 'ref-2', expires_in: 21600, user_id: 999 }),
    }) as unknown as typeof fetch

    const token = await getValidAccessToken()
    expect(token).toBe('tok-novo')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('CONECTADA')
  })

  it('getValidAccessToken marca DESCONECTADA quando o refresh falha', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-invalido', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }) as unknown as typeof fetch

    await expect(getValidAccessToken()).rejects.toThrow('Conexão com o Mercado Livre expirou')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('DESCONECTADA')
  })

  it('getValidAccessToken lança erro quando nunca foi conectado', async () => {
    await expect(getValidAccessToken()).rejects.toThrow('Mercado Livre não está conectado')
  })
})
```

- [ ] **Step 5: Verificar tipos e lint (teste de integração não roda aqui, sem banco vivo)**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos (os 2 pré-existentes em `tests/integration/accessories.test.ts` continuam, não relacionados).

- [ ] **Step 6: Commit**

```bash
git add lib/mercadoLivre/connection.ts actions/mercadoLivreAuth.ts app/api/integrations/mercado-livre/callback/route.ts tests/integration/mercadoLivreConnection.test.ts
git commit -m "feat(ml): persistência de conexão (getValidAccessToken, callback OAuth, disconnect)"
```

---

### Task 4: Tela `/settings/integrations` — conectar/desconectar

**Files:**
- Create: `app/(app)/settings/integrations/page.tsx`
- Modify: `app/(app)/settings/page.tsx` (link de navegação pra nova subtela, mesmo padrão de `/settings/accessory-types` e `/settings/marketplace-platforms`)

**Interfaces:**
- Consumes: `buildAuthorizationUrl` (Task 2), `getConnectionStatus` (Task 3), `disconnectMercadoLivre` (Task 3).

- [ ] **Step 1: Ver o padrão de link usado pra outras subtelas de Configurações**

Run: `grep -n "accessory-types\|marketplace-platforms" "app/(app)/settings/page.tsx"`
Expected: mostra o bloco de `<Link>` existente — copiar o mesmo estilo de card/link pra "Integrações".

- [ ] **Step 2: Criar `app/(app)/settings/integrations/page.tsx`**

```typescript
// app/(app)/settings/integrations/page.tsx
import { buildAuthorizationUrl } from '@/lib/mercadoLivre/auth'
import { getConnectionStatus } from '@/lib/mercadoLivre/connection'
import { disconnectMercadoLivre } from '@/actions/mercadoLivreAuth'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ conectado?: string; erro?: string }>
}) {
  const { conectado, erro } = await searchParams
  const connection = await getConnectionStatus()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Integrações</h1>

      {conectado && <p className="tk-alert-success">Mercado Livre conectado com sucesso.</p>}
      {erro && <p className="tk-alert-error">{erro}</p>}

      <section className="tk-panel p-4">
        <h2 className="tk-section-title">Mercado Livre</h2>
        {!connection || connection.status === 'DESCONECTADA' ? (
          <div>
            {connection?.status === 'DESCONECTADA' && (
              <p className="tk-alert-error">
                Conexão perdida{connection.lastError ? `: ${connection.lastError}` : ''}. Reconecte abaixo.
              </p>
            )}
            <a href={buildAuthorizationUrl()} className="tk-btn-primary">
              Conectar Mercado Livre
            </a>
          </div>
        ) : (
          <div>
            <p>Conectado desde {connection.connectedAt.toLocaleDateString('pt-BR')} (vendedor {connection.sellerId})</p>
            <form action={disconnectMercadoLivre}>
              <button className="tk-btn-danger">Desconectar</button>
            </form>
          </div>
        )}
      </section>
    </div>
  )
}
```

(Classes `tk-alert-success`/`tk-alert-error`/`tk-section-title`/`tk-btn-danger` — confirmar no Step 1 quais já existem em `app/globals.css`; usar as equivalentes já existentes se os nomes exatos forem outros, mantendo o mesmo propósito visual.)

- [ ] **Step 3: Adicionar o link em `/settings`**

Seguir exatamente o padrão encontrado no Step 1 (mesma estrutura de card/link), apontando para `/settings/integrations`, com o rótulo "Integrações (Mercado Livre)".

- [ ] **Step 4: Verificar**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint && DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
Expected: sem erros novos, build gera a rota `/settings/integrations`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/integrations/page.tsx" "app/(app)/settings/page.tsx"
git commit -m "feat(ml): tela de conexão em /settings/integrations"
```

---

### Task 5: Sistema de notificações genérico

**Files:**
- Create: `lib/notifications.ts`
- Test: `tests/unit/notifications.test.ts`
- Test: `tests/integration/notifications.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma`), enum `OrderStatus` do Prisma Client (já existente).
- Produces: `createNotification(input: CreateNotificationInput): Promise<void>`, `areAllItemsTerminal(statuses: string[]): boolean` (pura), `resolveNotificationsForResource(resourceType: string, resourceId: string): Promise<void>`, `markNotificationsSeen(ids: string[]): Promise<void>`, `getUnresolvedCount(): Promise<number>`, `getUnseenNotifications(): Promise<Notification[]>` — consumidos por Tasks 6, 9 e pelo hook em `actions/orders.ts` (Task 9).

- [ ] **Step 1: Escrever o teste unitário da função pura (falha primeiro)**

```typescript
// tests/unit/notifications.test.ts
import { describe, it, expect } from 'vitest'
import { areAllItemsTerminal } from '@/lib/notifications'

describe('areAllItemsTerminal', () => {
  it('true quando todos os itens estão ENTREGUE', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'ENTREGUE'])).toBe(true)
  })

  it('true quando misto de ENTREGUE e CANCELADO', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'CANCELADO'])).toBe(true)
  })

  it('false quando algum item ainda não está em status terminal', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'AGUARDANDO_PRODUCAO'])).toBe(false)
  })

  it('true pra lista vazia (vacuously true, nunca deveria acontecer na prática mas não deve travar)', () => {
    expect(areAllItemsTerminal([])).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/notifications.test.ts`
Expected: FAIL com `Cannot find module '@/lib/notifications'`

- [ ] **Step 3: Implementar `lib/notifications.ts`**

```typescript
// lib/notifications.ts
import { prisma } from '@/lib/prisma'
import type { Notification, NotificationType } from '@prisma/client'

const TERMINAL_STATUSES = new Set(['ENTREGUE', 'CANCELADO'])

export function areAllItemsTerminal(statuses: string[]): boolean {
  return statuses.every((status) => TERMINAL_STATUSES.has(status))
}

export interface CreateNotificationInput {
  type: NotificationType
  title: string
  body?: string
  link?: string
  resourceType?: string
  resourceId?: string
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({ data: input })
}

export async function resolveNotificationsForResource(resourceType: string, resourceId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { resourceType, resourceId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  })
}

export async function markNotificationsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { seenAt: new Date() } })
}

export async function getUnresolvedCount(): Promise<number> {
  return prisma.notification.count({ where: { resolvedAt: null } })
}

export async function getUnseenNotifications(): Promise<Notification[]> {
  return prisma.notification.findMany({ where: { seenAt: null }, orderBy: { createdAt: 'asc' } })
}
```

- [ ] **Step 4: Rodar e confirmar que o unitário passa**

Run: `npx vitest run tests/unit/notifications.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Escrever o teste de integração (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/notifications.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createNotification, resolveNotificationsForResource, markNotificationsSeen, getUnresolvedCount, getUnseenNotifications } from '@/lib/notifications'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.notification.deleteMany()
})

describe('notifications', () => {
  it('createNotification cria e conta como não resolvida', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'Pedido novo', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-1' })
    expect(await getUnresolvedCount()).toBe(1)
  })

  it('resolveNotificationsForResource resolve só as do recurso certo', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'A', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-1' })
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'B', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-2' })
    await resolveNotificationsForResource('MarketplaceOrderInbox', 'inbox-1')
    expect(await getUnresolvedCount()).toBe(1)
  })

  it('markNotificationsSeen marca vistas e getUnseenNotifications para de devolvê-las', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'A' })
    const [n] = await getUnseenNotifications()
    await markNotificationsSeen([n.id])
    expect(await getUnseenNotifications()).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add lib/notifications.ts tests/unit/notifications.test.ts tests/integration/notifications.test.ts
git commit -m "feat: sistema de notificações genérico (createNotification, resolve, seen)"
```

---

### Task 6: Cliente de pedidos do Mercado Livre — `processOrderNotification`

**Files:**
- Create: `lib/mercadoLivre/orders.ts`
- Test: `tests/unit/mercadoLivreOrders.test.ts`
- Test: `tests/integration/mercadoLivreOrders.test.ts`

**Interfaces:**
- Consumes: `getValidAccessToken` (Task 3), `createNotification` (Task 5), `prisma`.
- Produces: `fetchOrderFromApi(accessToken: string, orderId: string): Promise<MLOrderPayload>`, `normalizeOrderItems(payload: MLOrderPayload): MarketplaceOrderInboxItem[]` (pura), `processOrderNotification(externalOrderId: string): Promise<void>`, `searchRecentOrders(accessToken: string, sellerId: string, sinceISO: string): Promise<string[]>` — `processOrderNotification` consumida pelo webhook (Task 7) e pelo poller (Task 8); `searchRecentOrders` consumida só pelo poller (Task 8).

- [ ] **Step 1: Escrever o teste da normalização pura (falha primeiro)**

```typescript
// tests/unit/mercadoLivreOrders.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeOrderItems, fetchOrderFromApi, searchRecentOrders } from '@/lib/mercadoLivre/orders'

describe('normalizeOrderItems', () => {
  it('extrai título, sku, quantidade e preço unitário de cada item', () => {
    const payload = {
      id: 123,
      buyer: { nickname: 'comprador1' },
      total_amount: 150.5,
      order_items: [
        { item: { id: 'MLB1', title: 'Chaveiro Gato', seller_sku: 'CHV-GATO' }, quantity: 2, unit_price: 50 },
        { item: { id: 'MLB2', title: 'Chaveiro Cão', seller_sku: null }, quantity: 1, unit_price: 50.5 },
      ],
    }
    const items = normalizeOrderItems(payload as never)
    expect(items).toEqual([
      { externalItemId: 'MLB1', title: 'Chaveiro Gato', sku: 'CHV-GATO', quantity: 2, unitPrice: 50 },
      { externalItemId: 'MLB2', title: 'Chaveiro Cão', sku: null, quantity: 1, unitPrice: 50.5 },
    ])
  })
})

describe('fetchOrderFromApi', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('busca o pedido com Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 123 }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const order = await fetchOrderFromApi('tok-1', '123')
    expect(order).toEqual({ id: 123 })
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/orders/123', { headers: { Authorization: 'Bearer tok-1' } })
  })

  it('lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    await expect(fetchOrderFromApi('tok-1', '999')).rejects.toThrow('Falha ao buscar pedido 999 no Mercado Livre')
  })
})

describe('searchRecentOrders', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('devolve os ids dos pedidos encontrados', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ id: 1 }, { id: 2 }] }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const ids = await searchRecentOrders('tok-1', '999', '2026-10-02T00:00:00.000-00:00')
    expect(ids).toEqual(['1', '2'])
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/mercadoLivreOrders.test.ts`
Expected: FAIL com `Cannot find module '@/lib/mercadoLivre/orders'`

- [ ] **Step 3: Implementar `lib/mercadoLivre/orders.ts`**

```typescript
// lib/mercadoLivre/orders.ts
import { prisma } from '@/lib/prisma'
import { getValidAccessToken } from '@/lib/mercadoLivre/connection'
import { createNotification } from '@/lib/notifications'

export interface MLOrderPayload {
  id: number
  buyer?: { nickname?: string }
  total_amount: number
  order_items: Array<{
    item: { id: string; title: string; seller_sku: string | null }
    quantity: number
    unit_price: number
  }>
}

export interface MarketplaceOrderInboxItem {
  externalItemId: string
  title: string
  sku: string | null
  quantity: number
  unitPrice: number
}

export async function fetchOrderFromApi(accessToken: string, orderId: string): Promise<MLOrderPayload> {
  const response = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Falha ao buscar pedido ${orderId} no Mercado Livre`)
  return response.json()
}

export async function searchRecentOrders(accessToken: string, sellerId: string, sinceISO: string): Promise<string[]> {
  const params = new URLSearchParams({ seller: sellerId, 'order.date_created.from': sinceISO })
  const response = await fetch(`https://api.mercadolibre.com/orders/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Falha ao buscar pedidos recentes no Mercado Livre')
  const data = (await response.json()) as { results: Array<{ id: number }> }
  return data.results.map((r) => String(r.id))
}

export function normalizeOrderItems(payload: MLOrderPayload): MarketplaceOrderInboxItem[] {
  return payload.order_items.map((orderItem) => ({
    externalItemId: orderItem.item.id,
    title: orderItem.item.title,
    sku: orderItem.item.seller_sku,
    quantity: orderItem.quantity,
    unitPrice: orderItem.unit_price,
  }))
}

export async function processOrderNotification(externalOrderId: string): Promise<void> {
  const accessToken = await getValidAccessToken()
  const payload = await fetchOrderFromApi(accessToken, externalOrderId)
  const items = normalizeOrderItems(payload)

  const existing = await prisma.marketplaceOrderInbox.findUnique({
    where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: String(payload.id) } },
  })

  const inbox = await prisma.marketplaceOrderInbox.upsert({
    where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: String(payload.id) } },
    create: {
      platform: 'MERCADO_LIVRE',
      externalOrderId: String(payload.id),
      buyerName: payload.buyer?.nickname ?? null,
      totalAmount: payload.total_amount,
      items: items as unknown as object,
    },
    update: {
      buyerName: payload.buyer?.nickname ?? null,
      totalAmount: payload.total_amount,
      items: items as unknown as object,
    },
  })

  if (!existing) {
    await createNotification({
      type: 'NOVO_PEDIDO_MARKETPLACE',
      title: 'Novo pedido no Mercado Livre',
      body: `Pedido #${inbox.externalOrderId} — ${items.length} item(ns)`,
      link: '/orders',
      resourceType: 'MarketplaceOrderInbox',
      resourceId: inbox.id,
    })
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/mercadoLivreOrders.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Escrever o teste de integração (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/mercadoLivreOrders.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { saveConnection } from '@/lib/mercadoLivre/connection'
import { processOrderNotification } from '@/lib/mercadoLivre/orders'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.marketplaceConnection.deleteMany()
  await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
})
afterEach(() => vi.restoreAllMocks())

describe('processOrderNotification', () => {
  it('cria o inbox e a notificação na primeira vez', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 555,
        buyer: { nickname: 'joao123' },
        total_amount: 100,
        order_items: [{ item: { id: 'MLB1', title: 'Produto X', seller_sku: null }, quantity: 1, unit_price: 100 }],
      }),
    }) as unknown as typeof fetch

    await processOrderNotification('555')

    const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: '555' } } })
    expect(inbox?.status).toBe('PENDENTE')
    const notifications = await prisma.notification.findMany()
    expect(notifications).toHaveLength(1)
  })

  it('reprocessar o mesmo pedido (webhook duplicado) não cria segunda notificação', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 555, total_amount: 100, order_items: [] }),
    }) as unknown as typeof fetch

    await processOrderNotification('555')
    await processOrderNotification('555')

    const notifications = await prisma.notification.findMany()
    expect(notifications).toHaveLength(1)
    const inboxRows = await prisma.marketplaceOrderInbox.findMany()
    expect(inboxRows).toHaveLength(1)
  })
})
```

- [ ] **Step 6: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add lib/mercadoLivre/orders.ts tests/unit/mercadoLivreOrders.test.ts tests/integration/mercadoLivreOrders.test.ts
git commit -m "feat(ml): processOrderNotification (busca, normaliza, upsert idempotente, notifica)"
```

---

### Task 7: Webhook receiver

**Files:**
- Create: `app/api/webhooks/mercado-livre/route.ts`
- Test: `tests/integration/mercadoLivreWebhook.test.ts`

**Interfaces:**
- Consumes: `processOrderNotification` (Task 6).

- [ ] **Step 1: Escrever o route handler**

```typescript
// app/api/webhooks/mercado-livre/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { processOrderNotification } from '@/lib/mercadoLivre/orders'

interface MLWebhookPayload {
  topic: string
  resource: string
}

function extractOrderId(resource: string): string | null {
  const match = resource.match(/\/orders\/(\d+)/)
  return match ? match[1] : null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: MLWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (payload.topic !== 'orders_v2') {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const orderId = extractOrderId(payload.resource ?? '')
  if (!orderId) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    await processOrderNotification(orderId)
  } catch (err) {
    console.error('[mercadoLivre] falha ao processar webhook de pedido:', err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 2: Escrever o teste de integração (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/mercadoLivreWebhook.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { POST } from '@/app/api/webhooks/mercado-livre/route'
import { saveConnection } from '@/lib/mercadoLivre/connection'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.marketplaceConnection.deleteMany()
  await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
})
afterEach(() => vi.restoreAllMocks())

function makeRequest(body: unknown): Request {
  return new Request('https://tk3d.coffetech.com.br/api/webhooks/mercado-livre', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('webhook do Mercado Livre', () => {
  it('ignora tópico que não é orders_v2 (200 OK, sem processar)', async () => {
    const response = await POST(makeRequest({ topic: 'questions', resource: '/questions/1' }) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(0)
  })

  it('processa orders_v2 e cria o inbox', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 777, total_amount: 50, order_items: [] }),
    }) as unknown as typeof fetch

    const response = await POST(makeRequest({ topic: 'orders_v2', resource: '/orders/777' }) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(1)
  })

  it('devolve 200 mesmo se processOrderNotification falhar (nunca derruba, ML reenviaria em loop com erro)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch
    const response = await POST(makeRequest({ topic: 'orders_v2', resource: '/orders/888' }) as never)
    expect(response.status).toBe(200)
  })

  it('devolve 200 com corpo malformado', async () => {
    const response = await POST(new Request('https://tk3d.coffetech.com.br/api/webhooks/mercado-livre', { method: 'POST', body: 'não é json' }) as never)
    expect(response.status).toBe(200)
  })
})
```

- [ ] **Step 3: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/mercado-livre/route.ts tests/integration/mercadoLivreWebhook.test.ts
git commit -m "feat(ml): webhook receiver (orders_v2, idempotente, nunca derruba em erro)"
```

---

### Task 8: Poller de reconciliação (a cada 5 minutos)

**Files:**
- Create: `lib/mercadoLivre/reconciliationPoller.ts`
- Modify: `instrumentation.ts`
- Test: `tests/unit/mercadoLivreReconciliationPoller.test.ts`

**Interfaces:**
- Consumes: `getValidAccessToken` (Task 3), `searchRecentOrders`, `processOrderNotification` (Task 6), `getConnectionStatus` (Task 3).
- Produces: `startMercadoLivreReconciliationPoller(): void`, `runReconciliationOnce(): Promise<void>` (exportada separada pra ser testável sem esperar o `setInterval`).

- [ ] **Step 1: Escrever o teste unitário (falha primeiro)**

```typescript
// tests/unit/mercadoLivreReconciliationPoller.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as connection from '@/lib/mercadoLivre/connection'
import * as orders from '@/lib/mercadoLivre/orders'
import { runReconciliationOnce } from '@/lib/mercadoLivre/reconciliationPoller'

describe('runReconciliationOnce', () => {
  afterEach(() => vi.restoreAllMocks())

  it('não faz nada se não há conexão ativa', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue(null)
    const searchSpy = vi.spyOn(orders, 'searchRecentOrders')
    await runReconciliationOnce()
    expect(searchSpy).not.toHaveBeenCalled()
  })

  it('busca pedidos recentes e processa cada um', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue({
      id: '1', platform: 'MERCADO_LIVRE', sellerId: '999', status: 'CONECTADA',
    } as never)
    vi.spyOn(connection, 'getValidAccessToken').mockResolvedValue('tok-1')
    vi.spyOn(orders, 'searchRecentOrders').mockResolvedValue(['111', '222'])
    const processSpy = vi.spyOn(orders, 'processOrderNotification').mockResolvedValue(undefined)

    await runReconciliationOnce()

    expect(processSpy).toHaveBeenCalledWith('111')
    expect(processSpy).toHaveBeenCalledWith('222')
  })

  it('erro ao processar um pedido não impede os outros de serem processados', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue({
      id: '1', platform: 'MERCADO_LIVRE', sellerId: '999', status: 'CONECTADA',
    } as never)
    vi.spyOn(connection, 'getValidAccessToken').mockResolvedValue('tok-1')
    vi.spyOn(orders, 'searchRecentOrders').mockResolvedValue(['111', '222'])
    const processSpy = vi
      .spyOn(orders, 'processOrderNotification')
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce(undefined)

    await expect(runReconciliationOnce()).resolves.not.toThrow()
    expect(processSpy).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/mercadoLivreReconciliationPoller.test.ts`
Expected: FAIL com `Cannot find module '@/lib/mercadoLivre/reconciliationPoller'`

- [ ] **Step 3: Implementar `lib/mercadoLivre/reconciliationPoller.ts`**

```typescript
// lib/mercadoLivre/reconciliationPoller.ts
import { getConnectionStatus, getValidAccessToken } from '@/lib/mercadoLivre/connection'
import { searchRecentOrders, processOrderNotification } from '@/lib/mercadoLivre/orders'

const INTERVAL_MS = 5 * 60 * 1000
const LOOKBACK_MS = 15 * 60 * 1000

let intervalHandle: ReturnType<typeof setInterval> | null = null

export async function runReconciliationOnce(): Promise<void> {
  const connection = await getConnectionStatus()
  if (!connection || connection.status === 'DESCONECTADA') return

  const accessToken = await getValidAccessToken()
  const sinceISO = new Date(Date.now() - LOOKBACK_MS).toISOString()
  const orderIds = await searchRecentOrders(accessToken, connection.sellerId, sinceISO)

  for (const orderId of orderIds) {
    try {
      await processOrderNotification(orderId)
    } catch (err) {
      console.error(`[mercadoLivre] falha ao reconciliar pedido ${orderId}:`, err)
    }
  }
}

export function startMercadoLivreReconciliationPoller(): void {
  if (intervalHandle) return
  intervalHandle = setInterval(() => {
    runReconciliationOnce().catch((err) => console.error('[mercadoLivre] falha no ciclo de reconciliação:', err))
  }, INTERVAL_MS)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/mercadoLivreReconciliationPoller.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Ligar no boot do servidor via `instrumentation.ts`**

Adicionar ao final da função `register()` em `instrumentation.ts`, depois do `startAnycubicListener`:

```typescript
  const { startMercadoLivreReconciliationPoller } = await import('@/lib/mercadoLivre/reconciliationPoller')
  startMercadoLivreReconciliationPoller()
```

- [ ] **Step 6: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint && npx vitest run tests/unit`
Expected: sem erros novos, suíte unitária inteira passando.

- [ ] **Step 7: Commit**

```bash
git add lib/mercadoLivre/reconciliationPoller.ts instrumentation.ts tests/unit/mercadoLivreReconciliationPoller.test.ts
git commit -m "feat(ml): poller de reconciliação a cada 5min (rede de segurança do webhook)"
```

---

### Task 9: Sino de notificações (genérico) + hook de resolução em pedidos

**Files:**
- Create: `components/NotificationBell.tsx`
- Create: `actions/notifications.ts`
- Modify: `app/(app)/layout.tsx`
- Modify: `actions/orders.ts` (hook de resolução em `updateOrderItemStatus`)

**Interfaces:**
- Consumes: `getUnresolvedCount`, `getUnseenNotifications`, `markNotificationsSeen`, `resolveNotificationsForResource`, `areAllItemsTerminal` (Task 5).

- [ ] **Step 1: Escrever `actions/notifications.ts`**

```typescript
// actions/notifications.ts
'use server'
import { markNotificationsSeen as markSeen } from '@/lib/notifications'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function markNotificationsSeenAction(ids: string[]): Promise<ActionResult> {
  await markSeen(ids)
  revalidatePath('/', 'layout')
  return { success: true }
}
```

- [ ] **Step 2: Escrever `components/NotificationBell.tsx`**

```typescript
// components/NotificationBell.tsx
'use client'
import { useState } from 'react'
import { markNotificationsSeenAction } from '@/actions/notifications'

interface UnseenNotification {
  id: string
  title: string
  body: string | null
  link: string | null
}

export function NotificationBell({ unresolvedCount, unseen }: { unresolvedCount: number; unseen: UnseenNotification[] }) {
  const [modalOpen, setModalOpen] = useState(unseen.length > 0)

  async function handleClose() {
    setModalOpen(false)
    await markNotificationsSeenAction(unseen.map((n) => n.id))
  }

  return (
    <>
      <a href="/orders" className="tk-notification-bell" aria-label="Notificações">
        🔔
        {unresolvedCount > 0 && <span className="tk-notification-dot" aria-label={`${unresolvedCount} pendente(s)`} />}
      </a>
      {modalOpen && (
        <dialog open className="tk-modal">
          <h2>Novidades</h2>
          <ul>
            {unseen.map((n) => (
              <li key={n.id}>
                <strong>{n.title}</strong>
                {n.body && <p>{n.body}</p>}
              </li>
            ))}
          </ul>
          <button onClick={handleClose} className="tk-btn-primary">
            Ok, entendi
          </button>
        </dialog>
      )}
    </>
  )
}
```

(Classes `tk-notification-bell`/`tk-notification-dot`/`tk-modal` — adicionar em `app/globals.css` seguindo a paleta existente: bolinha vermelha pequena posicionada no canto do ícone via `position:absolute`, mesmo princípio visual de qualquer badge já existente no app; se já existir uma classe de badge genérica, reaproveitar.)

- [ ] **Step 3: Montar no layout raiz**

Em `app/(app)/layout.tsx`, importar `getUnresolvedCount`/`getUnseenNotifications` de `@/lib/notifications` e `NotificationBell` de `@/components/NotificationBell`; buscar os dois no topo do layout (Server Component) e renderizar `<NotificationBell unresolvedCount={...} unseen={...} />` na barra de navegação, ao lado de onde já ficam os links principais.

- [ ] **Step 4: Hook de resolução em `actions/orders.ts`**

Em `updateOrderItemStatus`, depois de qualquer atualização de status (tanto no caminho curto de `status !== 'ENTREGUE' || item.saleId` quanto no caminho que cria a `Sale`), adicionar a checagem: se `parsed.data.status` é `'ENTREGUE'` ou `'CANCELADO'`, buscar todos os `OrderItem` do mesmo `orderId`, checar `areAllItemsTerminal`, e se true, chamar `resolveNotificationsForResource('MarketplaceOrderInbox', inbox.id)` pro inbox vinculado (se existir, via `prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: item.orderId } })`). Trecho a inserir logo antes do `return { success: true }` final da função (depois do bloco que já existe, em ambos os caminhos):

```typescript
  if (parsed.data.status === 'ENTREGUE' || parsed.data.status === 'CANCELADO') {
    const siblingItems = await prisma.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } })
    if (areAllItemsTerminal(siblingItems.map((s) => s.status))) {
      const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: item.orderId } })
      if (inbox) await resolveNotificationsForResource('MarketplaceOrderInbox', inbox.id)
    }
  }
```

Adicionar os imports no topo de `actions/orders.ts`: `import { areAllItemsTerminal, resolveNotificationsForResource } from '@/lib/notifications'`.

- [ ] **Step 5: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add components/NotificationBell.tsx actions/notifications.ts "app/(app)/layout.tsx" actions/orders.ts app/globals.css
git commit -m "feat: sino de notificações no layout + resolução automática ao entregar/cancelar pedido"
```

---

### Task 10: Caixa de entrada de pedidos Mercado Livre em `/orders`

**Files:**
- Create: `actions/mercadoLivreOrders.ts`
- Create: `app/(app)/orders/MarketplaceInboxSection.tsx`
- Modify: `app/(app)/orders/page.tsx`
- Test: `tests/integration/mercadoLivreInboxActions.test.ts`

**Interfaces:**
- Consumes: `ComboSelect` (`app/(app)/assembly/ComboSelect.tsx`, já existente) pra escolher produto+cor.

- [ ] **Step 1: Escrever `actions/mercadoLivreOrders.ts`**

```typescript
// actions/mercadoLivreOrders.ts
'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import type { MarketplaceOrderInboxItem } from '@/lib/mercadoLivre/orders'

type ActionResult = { success: boolean; error?: string }

export async function ignoreInboxOrder(inboxId: string): Promise<ActionResult> {
  await prisma.marketplaceOrderInbox.update({ where: { id: inboxId }, data: { status: 'IGNORADO' } })
  revalidatePath('/orders')
  return { success: true }
}

interface ConfirmItemMapping {
  externalItemId: string
  productId: string
  colorComboKey: string | null
}

export async function confirmInboxOrder(inboxId: string, mappings: ConfirmItemMapping[]): Promise<ActionResult> {
  const inbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inboxId } })
  if (inbox.status !== 'PENDENTE') return { success: false, error: 'Este pedido já foi processado' }

  const items = inbox.items as unknown as MarketplaceOrderInboxItem[]
  if (mappings.length !== items.length) return { success: false, error: 'Faltou escolher o produto de algum item' }

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        channel: 'MERCADO_LIVRE',
        orderDate: new Date(),
        deliveryDate: new Date(),
        buyerOrPlatform: inbox.buyerName,
        orderNumber: inbox.externalOrderId,
        items: {
          create: items.map((item, index) => ({
            productId: mappings[index].productId,
            colorComboKey: mappings[index].colorComboKey,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
    })
    await tx.marketplaceOrderInbox.update({ where: { id: inboxId }, data: { status: 'CONFIRMADO', confirmedOrderId: created.id } })
    return created
  })

  revalidatePath('/orders')
  return { success: true, orderId: order.id } as ActionResult & { orderId: string }
}
```

- [ ] **Step 2: Escrever `app/(app)/orders/MarketplaceInboxSection.tsx`**

```typescript
// app/(app)/orders/MarketplaceInboxSection.tsx
'use client'
import { useState } from 'react'
import { ComboSelect } from '../assembly/ComboSelect'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'

interface InboxItem {
  externalItemId: string
  title: string
  sku: string | null
  quantity: number
  unitPrice: number
}

interface InboxOrder {
  id: string
  externalOrderId: string
  buyerName: string | null
  totalAmount: number
  items: InboxItem[]
}

export function MarketplaceInboxSection({ pendingOrders }: { pendingOrders: InboxOrder[] }) {
  if (pendingOrders.length === 0) return null

  return (
    <section className="tk-panel p-4">
      <h2 className="tk-section-title">Pedidos Mercado Livre pendentes</h2>
      {pendingOrders.map((order) => (
        <InboxOrderRow key={order.id} order={order} />
      ))}
    </section>
  )
}

function InboxOrderRow({ order }: { order: InboxOrder }) {
  const [mappings, setMappings] = useState<Record<string, { productId: string; colorComboKey: string | null }>>({})

  async function handleConfirm() {
    const ordered = order.items.map((item) => ({
      externalItemId: item.externalItemId,
      productId: mappings[item.externalItemId]?.productId ?? '',
      colorComboKey: mappings[item.externalItemId]?.colorComboKey ?? null,
    }))
    if (ordered.some((m) => !m.productId)) {
      alert('Escolha o produto de cada item antes de confirmar')
      return
    }
    const result = await confirmInboxOrder(order.id, ordered)
    if (!result.success) alert(result.error)
  }

  return (
    <div className="tk-row">
      <p>Pedido #{order.externalOrderId} — {order.buyerName ?? 'comprador não identificado'} — R$ {order.totalAmount.toFixed(2)}</p>
      {order.items.map((item) => (
        <div key={item.externalItemId}>
          <span>{item.title} (x{item.quantity})</span>
          <ComboSelect
            onChange={(productId, colorComboKey) =>
              setMappings((prev) => ({ ...prev, [item.externalItemId]: { productId, colorComboKey } }))
            }
          />
        </div>
      ))}
      <button onClick={handleConfirm} className="tk-btn-primary">Confirmar</button>
      <form action={async () => { await ignoreInboxOrder(order.id) }}>
        <button className="tk-link-danger">Ignorar</button>
      </form>
    </div>
  )
}
```

(A assinatura exata de `ComboSelect` — nome das props `onChange`/`productId`/`colorComboKey` — deve ser conferida em `app/(app)/assembly/ComboSelect.tsx` antes de codar este step; ajustar os nomes de prop pro que o componente realmente aceita, mantendo a mesma ideia de "escolher produto+cor e devolver pro pai".)

- [ ] **Step 3: Montar na página `/orders`**

Em `app/(app)/orders/page.tsx`, buscar `prisma.marketplaceOrderInbox.findMany({ where: { status: 'PENDENTE' }, orderBy: { receivedAt: 'asc' } })`, mapear `items` (campo `Json`) de volta pro tipo `InboxItem[]`, e renderizar `<MarketplaceInboxSection pendingOrders={...} />` no topo da página, antes da listagem de `Order` existente.

- [ ] **Step 4: Escrever o teste de integração da action (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/mercadoLivreInboxActions.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.product.deleteMany()
})

describe('confirmInboxOrder', () => {
  it('cria Order+OrderItem e marca o inbox como CONFIRMADO', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 1000, avgPowerConsumptionKwh: 0.1 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'M', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStock: 1000, avgUnitCost: 0.1 } })
    const product = await prisma.product.create({ data: { name: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '1', totalAmount: 50, items: [{ externalItemId: 'MLB1', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }] },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB1', productId: product.id, colorComboKey: null }])

    expect(result.success).toBe(true)
    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('CONFIRMADO')
    expect(updatedInbox.confirmedOrderId).not.toBeNull()
  })

  it('rejeita confirmar um inbox que já não está PENDENTE', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '2', totalAmount: 50, items: [], status: 'IGNORADO' },
    })
    const result = await confirmInboxOrder(inbox.id, [])
    expect(result.success).toBe(false)
  })
})

describe('ignoreInboxOrder', () => {
  it('marca como IGNORADO sem criar Order', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '3', totalAmount: 50, items: [] },
    })
    await ignoreInboxOrder(inbox.id)
    const updated = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updated.status).toBe('IGNORADO')
    expect(await prisma.order.count()).toBe(0)
  })
})
```

- [ ] **Step 5: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add actions/mercadoLivreOrders.ts "app/(app)/orders/MarketplaceInboxSection.tsx" "app/(app)/orders/page.tsx" tests/integration/mercadoLivreInboxActions.test.ts
git commit -m "feat(ml): caixa de entrada de pedidos pendentes em /orders (confirmar/ignorar)"
```

---

### Task 11: Catálogo de anúncios (só consulta)

**Files:**
- Create: `lib/mercadoLivre/listings.ts`
- Modify: `app/(app)/settings/integrations/page.tsx`
- Test: `tests/unit/mercadoLivreListings.test.ts`

**Interfaces:**
- Consumes: `getValidAccessToken`, `getConnectionStatus` (Task 3).
- Produces: `fetchActiveListings(accessToken: string, sellerId: string): Promise<MLListingSummary[]>`.

- [ ] **Step 1: Escrever o teste (falha primeiro)**

```typescript
// tests/unit/mercadoLivreListings.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchActiveListings } from '@/lib/mercadoLivre/listings'

describe('fetchActiveListings', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('busca os ids do vendedor e depois os detalhes de cada item', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: ['MLB1', 'MLB2'] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { code: 200, body: { id: 'MLB1', title: 'Produto A', price: 50, available_quantity: 10, permalink: 'https://ml/a' } },
          { code: 200, body: { id: 'MLB2', title: 'Produto B', price: 30, available_quantity: 5, permalink: 'https://ml/b' } },
        ],
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const listings = await fetchActiveListings('tok-1', '999')

    expect(listings).toEqual([
      { id: 'MLB1', title: 'Produto A', price: 50, availableQuantity: 10, permalink: 'https://ml/a' },
      { id: 'MLB2', title: 'Produto B', price: 30, availableQuantity: 5, permalink: 'https://ml/b' },
    ])
  })

  it('devolve lista vazia sem segunda chamada quando o vendedor não tem anúncio ativo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const listings = await fetchActiveListings('tok-1', '999')
    expect(listings).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lança erro se a busca de ids falhar', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
    await expect(fetchActiveListings('tok-1', '999')).rejects.toThrow('Falha ao buscar anúncios no Mercado Livre')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/mercadoLivreListings.test.ts`
Expected: FAIL com `Cannot find module '@/lib/mercadoLivre/listings'`

- [ ] **Step 3: Implementar `lib/mercadoLivre/listings.ts`**

```typescript
// lib/mercadoLivre/listings.ts
export interface MLListingSummary {
  id: string
  title: string
  price: number
  availableQuantity: number
  permalink: string
}

interface MLItemDetail {
  id: string
  title: string
  price: number
  available_quantity: number
  permalink: string
}

export async function fetchActiveListings(accessToken: string, sellerId: string): Promise<MLListingSummary[]> {
  const idsResponse = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!idsResponse.ok) throw new Error('Falha ao buscar anúncios no Mercado Livre')
  const { results: ids } = (await idsResponse.json()) as { results: string[] }
  if (ids.length === 0) return []

  const detailsResponse = await fetch(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!detailsResponse.ok) throw new Error('Falha ao buscar detalhes dos anúncios no Mercado Livre')
  const details = (await detailsResponse.json()) as Array<{ code: number; body: MLItemDetail }>

  return details
    .filter((d) => d.code === 200)
    .map((d) => ({
      id: d.body.id,
      title: d.body.title,
      price: d.body.price,
      availableQuantity: d.body.available_quantity,
      permalink: d.body.permalink,
    }))
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/mercadoLivreListings.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Adicionar a seção de catálogo em `/settings/integrations`**

Em `app/(app)/settings/integrations/page.tsx`, quando `connection?.status === 'CONECTADA'`, chamar `getValidAccessToken()` + `fetchActiveListings(token, connection.sellerId)` e renderizar uma tabela simples (título, preço, estoque anunciado, link pro anúncio via `permalink`) abaixo da seção de conexão. Envolver a chamada num `try/catch` — se falhar (ex.: token expirou entre o load da página e a renderização), mostrar "Não foi possível carregar os anúncios agora" em vez de quebrar a página inteira.

- [ ] **Step 6: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint && npx vitest run tests/unit && DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
Expected: tudo limpo, build gera todas as rotas novas.

- [ ] **Step 7: Commit**

```bash
git add lib/mercadoLivre/listings.ts "app/(app)/settings/integrations/page.tsx" tests/unit/mercadoLivreListings.test.ts
git commit -m "feat(ml): catálogo de anúncios ativos (só consulta) em Integrações"
```

---

## Self-Review

**Cobertura do spec:** §2 (pré-requisito, documentado no plano e na UI de conexão) ✓, §3 (schema) → Task 1 ✓, §4 (OAuth) → Tasks 2-4 ✓, §5 (webhook + reconciliação 5min) → Tasks 6-8 ✓, §6 (confirmar pedido) → Task 10 ✓, §7 (notificações genéricas) → Task 9 ✓, §8 (catálogo só consulta) → Task 11 ✓, §9 (tratamento de erro) → coberto em cada task (refresh falho, webhook malformado, rate limit via backoff documentado, item sem correspondência fica pendente) ✓, §10 (não-objetivos) → nenhuma task os implementa, corretamente fora de escopo ✓, §11 (Shopee) → fora deste plano, citado só como nota ✓.

**Consistência de tipos:** `MLTokenResponse` (Task 2) usado identicamente em `saveConnection`/`getValidAccessToken` (Task 3). `MarketplaceOrderInboxItem` (Task 6) é o mesmo tipo lido de volta em `actions/mercadoLivreOrders.ts` (Task 10). `areAllItemsTerminal`/`resolveNotificationsForResource`/`createNotification`/`markNotificationsSeen`/`getUnresolvedCount`/`getUnseenNotifications` (Task 5) usados com as mesmas assinaturas em Tasks 6, 7, 9. `getValidAccessToken`/`getConnectionStatus` (Task 3) consumidos identicamente em Tasks 6, 8, 11.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-02-integracao-mercado-livre.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

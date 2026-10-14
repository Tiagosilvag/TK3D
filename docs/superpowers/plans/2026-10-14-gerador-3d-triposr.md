# Gerador de modelo 3D a partir de imagem (TripoSR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o usuário subir uma imagem no TK3D e, via um worker local
que roda no PC dele (GPU própria, já que a VPS de produção não tem),
gerar um modelo 3D rascunho (OBJ + STL) com TripoSR.

**Architecture:** Fila de jobs (`Model3DJob`) guardada no Postgres, igual
ao padrão de `ProductPhoto` (arquivo binário direto no banco via `Bytes`,
sem storage externo). O worker (script Python no PC do usuário) nunca é
chamado pelo servidor — ele é quem pergunta "tem trabalho?" via polling
em `GET /api/mesh-jobs/next`, processa localmente com a própria GPU, e
devolve o resultado via `POST .../complete`. Isso evita completamente
precisar expor o PC do usuário à internet.

**Tech Stack:** Next.js 15 App Router (rotas de API novas sob
`app/api/mesh-jobs/`), Prisma/Postgres, Python (worker, fora do build do
Next.js) usando `requests` + `trimesh` + TripoSR (clonado separadamente
pelo usuário, não vendorizado neste repo).

**Spec:** `docs/superpowers/specs/2026-10-14-gerador-3d-triposr-design.md`

## Global Constraints

- `MAX_IMAGE_BYTES = 10 * 1024 * 1024` (10MB) — limite de tamanho da
  imagem de entrada.
- Tipos de imagem aceitos: `image/png`, `image/jpeg`, `image/webp`.
- `STALE_AFTER_MINUTES = 15` — um job `PROCESSANDO` há mais tempo que
  isso é tratado como abandonado (worker crashou) e volta a ficar
  disponível pra reivindicação.
- `MESH_WORKER_SECRET` — env var nova (Coolify + config local do worker),
  autentica as rotas chamadas pelo worker via header
  `Authorization: Bearer <secret>`, comparado com `crypto.timingSafeEqual`
  — nunca a senha única de login do app.
- As rotas do worker (`/api/mesh-jobs/next`, `/api/mesh-jobs/:id/image`,
  `/api/mesh-jobs/:id/complete`, `/api/mesh-jobs/:id/fail`) precisam de
  isenção no `middleware.ts` (mesmo motivo do Finding 1 crítico da
  revisão final da integração Mercado Livre: chamada sem cookie de
  sessão cairia num 307 pro `/login` e nunca chegaria no handler). A rota
  de download (`/api/mesh-jobs/:id/download/:kind`) é usada pelo
  PRÓPRIO USUÁRIO no navegador e NÃO deve ser isenta — continua exigindo
  sessão normal.
- O worker nunca embute o secret numa URL (nem como query param) — só no
  header `Authorization`, em toda chamada.
- Armazenamento de arquivo: sempre `Bytes` direto no Postgres, nunca
  filesystem/volume/S3 — mesmo padrão de `ProductPhoto`
  (`app/api/photos/[id]/route.ts`).
- Datas cruzando a fronteira servidor→cliente sempre como string ISO
  (`.toISOString()`), nunca `Date` crua — mesma convenção de
  `app/(app)/orders/page.tsx`.

---

### Task 1: Schema — `Model3DJob`

**Files:**
- Modify: `prisma/schema.prisma` (acrescentar ao final do arquivo)
- Create: `prisma/migrations/20261014120000_mesh_jobs/migration.sql`

**Interfaces:**
- Produces: modelo Prisma `Model3DJob` (campos `id`, `status`,
  `inputImage`, `inputContentType`, `inputSizeBytes`, `outputObj`,
  `outputStl`, `errorMessage`, `claimedAt`, `createdAt`, `updatedAt`) e
  enum `Model3DJobStatus` (`PENDENTE`/`PROCESSANDO`/`CONCLUIDO`/`ERRO`) —
  usados por todas as tasks seguintes via `prisma.model3DJob`.

- [ ] **Step 1: Acrescentar ao final de `prisma/schema.prisma`**

```prisma
enum Model3DJobStatus {
  PENDENTE
  PROCESSANDO
  CONCLUIDO
  ERRO
}

// Gerador de modelo 3D a partir de imagem (TripoSR, worker local no PC do
// usuário -- a VPS de produção não tem GPU, ver spec
// docs/superpowers/specs/2026-10-14-gerador-3d-triposr-design.md). Mesmo
// padrão de armazenamento de ProductPhoto (arquivo binário direto no
// Postgres via Bytes, sem storage externo). claimedAt marca quando um
// worker reivindicou o job -- usado só pra detectar job PROCESSANDO
// abandonado (worker crashou sem chamar /fail) depois de
// STALE_AFTER_MINUTES; nunca editado fora de lib/meshJobs/jobs.ts.
model Model3DJob {
  id               String           @id @default(cuid())
  status           Model3DJobStatus @default(PENDENTE)
  inputImage       Bytes
  inputContentType String
  inputSizeBytes   Int
  outputObj        Bytes?
  outputStl        Bytes?
  errorMessage     String?
  claimedAt        DateTime?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
}
```

- [ ] **Step 2: Escrever a migration à mão**

```sql
-- CreateEnum
CREATE TYPE "Model3DJobStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'ERRO');

-- CreateTable
CREATE TABLE "Model3DJob" (
    "id" TEXT NOT NULL,
    "status" "Model3DJobStatus" NOT NULL DEFAULT 'PENDENTE',
    "inputImage" BYTEA NOT NULL,
    "inputContentType" TEXT NOT NULL,
    "inputSizeBytes" INTEGER NOT NULL,
    "outputObj" BYTEA,
    "outputStl" BYTEA,
    "errorMessage" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model3DJob_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Validar o schema**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma validate && DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma generate`
Expected: ambos sem erro (não precisa de banco vivo pra isso).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261014120000_mesh_jobs/migration.sql
git commit -m "feat(mesh): schema Model3DJob (gerador de modelo 3D via worker local)"
```

---

### Task 2: `lib/meshJobs/auth.ts` — autenticação do worker

**Files:**
- Create: `lib/meshJobs/auth.ts`
- Test: `tests/unit/meshJobsAuth.test.ts`

**Interfaces:**
- Produces: `verifyWorkerAuth(request: Request): boolean` — usado por
  toda rota de API chamada pelo worker (Task 5).

- [ ] **Step 1: Escrever o teste (falha primeiro)**

```typescript
// tests/unit/meshJobsAuth.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'

describe('verifyWorkerAuth', () => {
  const originalSecret = process.env.MESH_WORKER_SECRET

  afterEach(() => {
    process.env.MESH_WORKER_SECRET = originalSecret
  })

  it('aceita o header Authorization correto', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer segredo-123' } })
    expect(verifyWorkerAuth(req)).toBe(true)
  })

  it('rejeita um secret errado', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer errado' } })
    expect(verifyWorkerAuth(req)).toBe(false)
  })

  it('rejeita quando não há header Authorization', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test')
    expect(verifyWorkerAuth(req)).toBe(false)
  })

  it('rejeita (nunca lança) quando MESH_WORKER_SECRET não está configurada', () => {
    delete process.env.MESH_WORKER_SECRET
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer qualquer' } })
    expect(verifyWorkerAuth(req)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/meshJobsAuth.test.ts`
Expected: FAIL com `Cannot find module '@/lib/meshJobs/auth'`

- [ ] **Step 3: Implementar `lib/meshJobs/auth.ts`**

```typescript
// lib/meshJobs/auth.ts
import { timingSafeEqual } from 'crypto'

// Autentica as rotas chamadas pelo worker local (processo Python, sem
// cookie de sessão de navegador) -- NUNCA a senha única de login do app.
// Falha de forma segura (devolve false, nunca lança) quando
// MESH_WORKER_SECRET não está configurada, pra uma rota esquecer de
// tratar a exceção nunca significar "deixar passar sem auth".
export function verifyWorkerAuth(request: Request): boolean {
  const secret = process.env.MESH_WORKER_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const headerBuf = Buffer.from(header)
  const expectedBuf = Buffer.from(expected)
  if (headerBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(headerBuf, expectedBuf)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/meshJobsAuth.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/meshJobs/auth.ts tests/unit/meshJobsAuth.test.ts
git commit -m "feat(mesh): autenticação por bearer token pras rotas do worker"
```

---

### Task 3: `lib/meshJobs/jobs.ts` — lógica central dos jobs

**Files:**
- Create: `lib/meshJobs/jobs.ts`
- Test: `tests/integration/meshJobs.test.ts` (documenta comportamento;
  não roda neste sandbox — sem `TEST_DATABASE_URL`, mesma limitação já
  documentada no restante do projeto)

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma`).
- Produces: `createJob`, `claimNextJob`, `completeJob`, `failJob`,
  `getJobImage`, `getJobOutput`, `deleteJob`, `listRecentJobs`, e o tipo
  `MeshJobSummary` — usados por Task 5 (rotas de API) e Task 6
  (actions/UI).

- [ ] **Step 1: Escrever `lib/meshJobs/jobs.ts`**

```typescript
// lib/meshJobs/jobs.ts
import { prisma } from '@/lib/prisma'
import type { Model3DJob, Model3DJobStatus } from '@prisma/client'

const STALE_AFTER_MS = 15 * 60 * 1000

export interface CreateJobInput {
  data: Buffer
  contentType: string
  sizeBytes: number
}

export async function createJob(input: CreateJobInput): Promise<Model3DJob> {
  return prisma.model3DJob.create({
    data: {
      inputImage: input.data,
      inputContentType: input.contentType,
      inputSizeBytes: input.sizeBytes,
    },
  })
}

// Reivindica atomicamente o job disponível mais antigo por createdAt --
// candidato é todo job PENDENTE, OU PROCESSANDO com claimedAt há mais de
// STALE_AFTER_MS (abandonado por um worker que crashou sem chamar
// /fail). O updateMany condicional (where inclui o status visto na
// leitura) é o claim atômico -- se outra chamada já reivindicou o mesmo
// candidato entre o findFirst e o updateMany, count fica 0 e tenta o
// próximo (mesmo padrão já usado em confirmInboxOrder/ignoreInboxOrder
// na integração Mercado Livre). Com um único worker (PC do usuário) essa
// corrida nunca deveria acontecer de verdade, mas o loop cobre o caso
// mesmo assim.
export async function claimNextJob(): Promise<Model3DJob | null> {
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS)

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await prisma.model3DJob.findFirst({
      where: {
        OR: [{ status: 'PENDENTE' }, { status: 'PROCESSANDO', claimedAt: { lt: staleThreshold } }],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!candidate) return null

    const claim = await prisma.model3DJob.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: 'PROCESSANDO', claimedAt: new Date() },
    })
    if (claim.count === 1) {
      return prisma.model3DJob.findUniqueOrThrow({ where: { id: candidate.id } })
    }
  }
  return null
}

export async function completeJob(id: string, obj: Buffer, stl: Buffer): Promise<void> {
  await prisma.model3DJob.update({
    where: { id },
    data: { status: 'CONCLUIDO', outputObj: obj, outputStl: stl, errorMessage: null },
  })
}

export async function failJob(id: string, message: string): Promise<void> {
  await prisma.model3DJob.update({
    where: { id },
    data: { status: 'ERRO', errorMessage: message },
  })
}

export async function getJobImage(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const job = await prisma.model3DJob.findUnique({
    where: { id },
    select: { inputImage: true, inputContentType: true },
  })
  if (!job) return null
  return { data: Buffer.from(job.inputImage), contentType: job.inputContentType }
}

export async function getJobOutput(id: string, kind: 'obj' | 'stl'): Promise<Buffer | null> {
  const job = await prisma.model3DJob.findUnique({
    where: { id },
    select: { outputObj: true, outputStl: true },
  })
  if (!job) return null
  const value = kind === 'obj' ? job.outputObj : job.outputStl
  return value ? Buffer.from(value) : null
}

export async function deleteJob(id: string): Promise<void> {
  await prisma.model3DJob.delete({ where: { id } })
}

export interface MeshJobSummary {
  id: string
  status: Model3DJobStatus
  inputContentType: string
  errorMessage: string | null
  createdAt: string
  hasObj: boolean
  hasStl: boolean
}

// Lista pra tela -- nunca devolve os Bytes de entrada/saída pro caller,
// só se existem (hasObj/hasStl), evitando carregar potencialmente vários
// MB por job numa lista de até `limit` itens.
export async function listRecentJobs(limit = 20): Promise<MeshJobSummary[]> {
  const rows = await prisma.model3DJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      inputContentType: true,
      errorMessage: true,
      createdAt: true,
      outputObj: true,
      outputStl: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    inputContentType: r.inputContentType,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    hasObj: r.outputObj !== null,
    hasStl: r.outputStl !== null,
  }))
}
```

- [ ] **Step 2: Escrever o teste de integração (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/meshJobs.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createJob, claimNextJob, completeJob, failJob, listRecentJobs, getJobImage, getJobOutput, deleteJob } from '@/lib/meshJobs/jobs'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.model3DJob.deleteMany()
})

describe('meshJobs', () => {
  it('createJob cria com status PENDENTE', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    expect(job.status).toBe('PENDENTE')
  })

  it('claimNextJob reivindica o job PENDENTE mais antigo e marca PROCESSANDO', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    const claimed = await claimNextJob()
    expect(claimed?.id).toBe(job.id)
    expect(claimed?.status).toBe('PROCESSANDO')
  })

  it('claimNextJob devolve null quando não há job disponível', async () => {
    const claimed = await claimNextJob()
    expect(claimed).toBeNull()
  })

  it('claimNextJob reivindica um job PROCESSANDO abandonado há mais de 15min', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await prisma.model3DJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSANDO', claimedAt: new Date(Date.now() - 16 * 60 * 1000) },
    })
    const claimed = await claimNextJob()
    expect(claimed?.id).toBe(job.id)
  })

  it('claimNextJob NÃO reivindica um job PROCESSANDO há menos de 15min', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await prisma.model3DJob.update({ where: { id: job.id }, data: { status: 'PROCESSANDO', claimedAt: new Date() } })
    const claimed = await claimNextJob()
    expect(claimed).toBeNull()
  })

  it('completeJob grava os arquivos e marca CONCLUIDO', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'))
    const obj = await getJobOutput(job.id, 'obj')
    const stl = await getJobOutput(job.id, 'stl')
    expect(obj?.toString()).toBe('obj-data')
    expect(stl?.toString()).toBe('stl-data')
  })

  it('failJob marca ERRO com a mensagem', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await failJob(job.id, 'sem GPU disponível')
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('ERRO')
    expect(updated.errorMessage).toBe('sem GPU disponível')
  })

  it('listRecentJobs devolve hasObj/hasStl corretos, createdAt como string ISO, sem devolver os bytes', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'))
    const jobs = await listRecentJobs()
    const found = jobs.find((j) => j.id === job.id)
    expect(found?.hasObj).toBe(true)
    expect(found?.hasStl).toBe(true)
    expect(typeof found?.createdAt).toBe('string')
  })

  it('getJobImage devolve a imagem e o content type', async () => {
    const job = await createJob({ data: Buffer.from('img-bytes'), contentType: 'image/jpeg', sizeBytes: 9 })
    const image = await getJobImage(job.id)
    expect(image?.contentType).toBe('image/jpeg')
    expect(image?.data.toString()).toBe('img-bytes')
  })

  it('deleteJob remove o job', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await deleteJob(job.id)
    const found = await prisma.model3DJob.findUnique({ where: { id: job.id } })
    expect(found).toBeNull()
  })
})
```

- [ ] **Step 3: Verificar tipos**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit`
Expected: sem erros novos (ignorar os 2 erros pré-existentes em `tests/integration/accessories.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add lib/meshJobs/jobs.ts tests/integration/meshJobs.test.ts
git commit -m "feat(mesh): lib/meshJobs/jobs.ts (claim atômico, complete/fail, listagem)"
```

---

### Task 4: `middleware.ts` — isenção pras rotas do worker

**Files:**
- Modify: `middleware.ts`
- Modify: `tests/unit/middleware.test.ts`

**Interfaces:**
- Consumes: nenhuma interface nova (só adiciona uma função local).

- [ ] **Step 1: Escrever os testes novos (falham primeiro)**

Acrescentar ao final do `describe('middleware', ...)` em `tests/unit/middleware.test.ts` (antes do `})` final):

```typescript
  it('deixa passar GET sem cookie de sessão em /api/mesh-jobs/next (worker usa Bearer, não cookie)', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/api/mesh-jobs/next', { method: 'GET' })
    const res = middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('deixa passar GET sem cookie de sessão em /api/mesh-jobs/:id/image', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/api/mesh-jobs/abc123/image', { method: 'GET' })
    const res = middleware(req)
    expect(res.status).toBe(200)
  })

  it('deixa passar POST sem cookie de sessão em /api/mesh-jobs/:id/complete e /fail', () => {
    const complete = middleware(new NextRequest('https://tk3d.coffetech.com.br/api/mesh-jobs/abc123/complete', { method: 'POST' }))
    const fail = middleware(new NextRequest('https://tk3d.coffetech.com.br/api/mesh-jobs/abc123/fail', { method: 'POST' }))
    expect(complete.status).toBe(200)
    expect(fail.status).toBe(200)
  })

  it('continua exigindo sessão pra baixar o resultado em /api/mesh-jobs/:id/download/:kind (rota do navegador, não do worker)', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/api/mesh-jobs/abc123/download/stl', { method: 'GET' })
    const res = middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/unit/middleware.test.ts`
Expected: FAIL nos 3 primeiros testes novos (ainda redirecionam pro
`/login`); o 4º já passa mesmo sem mudança nenhuma (comportamento atual).

- [ ] **Step 3: Implementar a isenção em `middleware.ts`**

```typescript
// Acrescentar depois de isWebhookPath, antes de `export function middleware`:

// Rotas chamadas pelo worker local do gerador de modelo 3D (processo
// Python no PC do usuário, sem cookie de navegador -- autentica via
// Authorization: Bearer, checado dentro de cada handler, ver
// lib/meshJobs/auth.ts). Isenção por path EXATO/regex, não por prefixo
// solto: /api/mesh-jobs/:id/download/:kind é usada pelo PRÓPRIO USUÁRIO
// no navegador pra baixar o resultado e precisa continuar exigindo
// sessão normal -- um prefixo genérico `/api/mesh-jobs/` isentaria essa
// rota também, por engano.
function isMeshWorkerPath(pathname: string): boolean {
  return (
    pathname === '/api/mesh-jobs/next' ||
    /^\/api\/mesh-jobs\/[^/]+\/image$/.test(pathname) ||
    /^\/api\/mesh-jobs\/[^/]+\/complete$/.test(pathname) ||
    /^\/api\/mesh-jobs\/[^/]+\/fail$/.test(pathname)
  )
}
```

E adicionar `|| isMeshWorkerPath(pathname)` na condição dentro de
`middleware()`:

```typescript
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login') ||
    pathname.startsWith('/_next') ||
    isPublicAsset(pathname) ||
    isWebhookPath(pathname) ||
    isMeshWorkerPath(pathname)
  ) {
    return NextResponse.next()
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/middleware.test.ts`
Expected: PASS (todos os testes, antigos e novos)

- [ ] **Step 5: Commit**

```bash
git add middleware.ts tests/unit/middleware.test.ts
git commit -m "feat(mesh): isentar rotas do worker (mesh-jobs) do check de sessão"
```

---

### Task 5: Rotas de API (`app/api/mesh-jobs/`)

**Files:**
- Create: `app/api/mesh-jobs/next/route.ts`
- Create: `app/api/mesh-jobs/[id]/image/route.ts`
- Create: `app/api/mesh-jobs/[id]/complete/route.ts`
- Create: `app/api/mesh-jobs/[id]/fail/route.ts`
- Create: `app/api/mesh-jobs/[id]/download/[kind]/route.ts`
- Test: `tests/integration/meshJobsApi.test.ts` (documenta comportamento;
  não roda neste sandbox)

**Interfaces:**
- Consumes: `verifyWorkerAuth` (Task 2), `claimNextJob`/`getJobImage`/
  `completeJob`/`failJob`/`getJobOutput` (Task 3).

- [ ] **Step 1: `app/api/mesh-jobs/next/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { claimNextJob } from '@/lib/meshJobs/jobs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const job = await claimNextJob()
  if (!job) {
    return new NextResponse(null, { status: 204 })
  }
  return NextResponse.json({ id: job.id })
}
```

- [ ] **Step 2: `app/api/mesh-jobs/[id]/image/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { getJobImage } from '@/lib/meshJobs/jobs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  const image = await getJobImage(id)
  if (!image) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.contentType },
  })
}
```

- [ ] **Step 3: `app/api/mesh-jobs/[id]/complete/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { completeJob } from '@/lib/meshJobs/jobs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  const formData = await request.formData()
  const obj = formData.get('obj')
  const stl = formData.get('stl')
  if (!(obj instanceof File) || !(stl instanceof File)) {
    return NextResponse.json({ error: 'Faltou o arquivo .obj ou .stl' }, { status: 400 })
  }
  const objBuffer = Buffer.from(await obj.arrayBuffer())
  const stlBuffer = Buffer.from(await stl.arrayBuffer())
  await completeJob(id, objBuffer, stlBuffer)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: `app/api/mesh-jobs/[id]/fail/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { failJob } from '@/lib/meshJobs/jobs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const rawMessage = (body as Record<string, unknown> | null)?.message
  const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : 'Falha desconhecida'
  await failJob(id, message)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: `app/api/mesh-jobs/[id]/download/[kind]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getJobOutput } from '@/lib/meshJobs/jobs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<NextResponse> {
  const { id, kind } = await params
  if (kind !== 'obj' && kind !== 'stl') {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 400 })
  }
  const data = await getJobOutput(id, kind)
  if (!data) {
    return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })
  }
  const contentType = kind === 'obj' ? 'model/obj' : 'model/stl'
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="modelo-${id}.${kind}"`,
    },
  })
}
```

- [ ] **Step 6: Escrever o teste de integração (documenta comportamento; não roda neste sandbox)**

```typescript
// tests/integration/meshJobsApi.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { GET as nextHandler } from '@/app/api/mesh-jobs/next/route'
import { GET as imageHandler } from '@/app/api/mesh-jobs/[id]/image/route'
import { POST as completeHandler } from '@/app/api/mesh-jobs/[id]/complete/route'
import { POST as failHandler } from '@/app/api/mesh-jobs/[id]/fail/route'
import { GET as downloadHandler } from '@/app/api/mesh-jobs/[id]/download/[kind]/route'
import { createJob, completeJob } from '@/lib/meshJobs/jobs'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  process.env.MESH_WORKER_SECRET = 'segredo-teste'
  await prisma.model3DJob.deleteMany()
})

function authedReq(url: string, init?: RequestInit) {
  return new NextRequest(url, { ...init, headers: { ...init?.headers, Authorization: 'Bearer segredo-teste' } })
}

describe('GET /api/mesh-jobs/next', () => {
  it('rejeita sem o bearer token correto', async () => {
    const req = new NextRequest('https://x/api/mesh-jobs/next')
    const res = await nextHandler(req)
    expect(res.status).toBe(401)
  })

  it('devolve 204 quando não há job pendente', async () => {
    const res = await nextHandler(authedReq('https://x/api/mesh-jobs/next'))
    expect(res.status).toBe(204)
  })

  it('reivindica e devolve o id do job pendente mais antigo', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    const res = await nextHandler(authedReq('https://x/api/mesh-jobs/next'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(job.id)
  })
})

describe('GET /api/mesh-jobs/:id/image', () => {
  it('devolve a imagem com o content type certo', async () => {
    const job = await createJob({ data: Buffer.from('img-bytes'), contentType: 'image/jpeg', sizeBytes: 9 })
    const res = await imageHandler(authedReq(`https://x/api/mesh-jobs/${job.id}/image`), { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  it('devolve 404 pra job inexistente', async () => {
    const res = await imageHandler(authedReq('https://x/api/mesh-jobs/nao-existe/image'), { params: Promise.resolve({ id: 'nao-existe' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/mesh-jobs/:id/complete', () => {
  it('grava os arquivos e marca CONCLUIDO', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    const formData = new FormData()
    formData.set('obj', new File([Buffer.from('obj-data')], 'mesh.obj'))
    formData.set('stl', new File([Buffer.from('stl-data')], 'mesh.stl'))
    const req = authedReq(`https://x/api/mesh-jobs/${job.id}/complete`, { method: 'POST', body: formData })
    const res = await completeHandler(req, { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(200)
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('CONCLUIDO')
  })
})

describe('POST /api/mesh-jobs/:id/fail', () => {
  it('marca ERRO com a mensagem enviada', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    const req = authedReq(`https://x/api/mesh-jobs/${job.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ message: 'sem GPU disponível' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await failHandler(req, { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(200)
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('ERRO')
    expect(updated.errorMessage).toBe('sem GPU disponível')
  })
})

describe('GET /api/mesh-jobs/:id/download/:kind', () => {
  it('devolve o STL concluído sem exigir bearer token (rota do navegador)', async () => {
    const job = await createJob({ data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3 })
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'))
    const req = new NextRequest(`https://x/api/mesh-jobs/${job.id}/download/stl`)
    const res = await downloadHandler(req, { params: Promise.resolve({ id: job.id, kind: 'stl' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('model/stl')
  })

  it('devolve 400 pra kind inválido', async () => {
    const req = new NextRequest('https://x/api/mesh-jobs/abc/download/png')
    const res = await downloadHandler(req, { params: Promise.resolve({ id: 'abc', kind: 'png' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 7: Verificar tipos**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add app/api/mesh-jobs tests/integration/meshJobsApi.test.ts
git commit -m "feat(mesh): rotas de API pro worker (next/image/complete/fail) + download pro navegador"
```

---

### Task 6: Actions + tela `/3d-generator`

**Files:**
- Create: `actions/meshJobs.ts`
- Create: `app/(app)/3d-generator/page.tsx`
- Create: `app/(app)/3d-generator/MeshJobsExplorer.tsx`
- Modify: `app/(app)/AppLayoutClient.tsx` (link de navegação)

**Interfaces:**
- Consumes: `createJob`/`deleteJob`/`listRecentJobs`/`MeshJobSummary`
  (Task 3).
- Produces: `createMeshJob`, `deleteMeshJob`, `getRecentMeshJobs`
  (Server Actions).

- [ ] **Step 1: `actions/meshJobs.ts`**

```typescript
// actions/meshJobs.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createJob, deleteJob, listRecentJobs, type MeshJobSummary } from '@/lib/meshJobs/jobs'

type ActionResult = { success: boolean; error?: string }

// Mesmos limites/tipos aceitos de actions/productPhotos.ts, ajustados
// pro tamanho de imagem de entrada do gerador (ver spec §3/§7).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function createMeshJob(formData: FormData): Promise<ActionResult> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Selecione uma imagem' }
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { success: false, error: 'Formato não suportado (use JPEG, PNG ou WEBP)' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { success: false, error: 'Imagem muito grande (máximo 10MB)' }
  }

  const data = Buffer.from(await file.arrayBuffer())
  await createJob({ data, contentType: file.type, sizeBytes: file.size })

  revalidatePath('/3d-generator')
  return { success: true }
}

export async function deleteMeshJob(id: string): Promise<ActionResult> {
  await deleteJob(id)
  revalidatePath('/3d-generator')
  return { success: true }
}

export async function getRecentMeshJobs(): Promise<MeshJobSummary[]> {
  return listRecentJobs()
}
```

- [ ] **Step 2: `app/(app)/3d-generator/page.tsx`**

```typescript
// app/(app)/3d-generator/page.tsx
import { getRecentMeshJobs } from '@/actions/meshJobs'
import { MeshJobsExplorer } from './MeshJobsExplorer'

export const dynamic = 'force-dynamic'

export default async function MeshGeneratorPage() {
  const jobs = await getRecentMeshJobs()
  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Gerador de modelo 3D</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Sobe uma imagem e gera um modelo 3D a partir dela usando o worker local (TripoSR, roda no seu PC com GPU
        — a VPS do TK3D não processa isso). O resultado é um RASCUNHO de malha reconstruída a partir de 1 única
        foto: normalmente precisa de limpeza numa ferramenta de modelagem antes de virar um arquivo pronto pra
        imprimir.
      </p>
      <MeshJobsExplorer initialJobs={jobs} />
    </div>
  )
}
```

- [ ] **Step 3: `app/(app)/3d-generator/MeshJobsExplorer.tsx`**

```typescript
// app/(app)/3d-generator/MeshJobsExplorer.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { createMeshJob, deleteMeshJob, getRecentMeshJobs } from '@/actions/meshJobs'
import type { MeshJobSummary } from '@/lib/meshJobs/jobs'

const STATUS_LABEL: Record<MeshJobSummary['status'], string> = {
  PENDENTE: 'Pendente (esperando o worker)',
  PROCESSANDO: 'Processando no worker',
  CONCLUIDO: 'Concluído',
  ERRO: 'Erro',
}

export function MeshJobsExplorer({ initialJobs }: { initialJobs: MeshJobSummary[] }) {
  const [jobs, setJobs] = useState(initialJobs)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Enquanto existir job PENDENTE/PROCESSANDO, repoll a cada 5s (mesmo
  // princípio de LiveStatusPoller.tsx: chama a própria Server Action de
  // dentro do setInterval, sem round-trip de navegação) -- para de
  // repollar sozinho quando não há mais nada em andamento.
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'PENDENTE' || j.status === 'PROCESSANDO')
    if (!hasPending) return
    const interval = setInterval(async () => {
      setJobs(await getRecentMeshJobs())
    }, 5000)
    return () => clearInterval(interval)
  }, [jobs])

  async function handleUpload(formData: FormData) {
    setError(null)
    const result = await createMeshJob(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao enviar imagem')
      return
    }
    formRef.current?.reset()
    setJobs(await getRecentMeshJobs())
  }

  async function handleDelete(id: string) {
    await deleteMeshJob(id)
    setJobs(await getRecentMeshJobs())
  }

  return (
    <div className="mt-6 grid gap-6">
      <form ref={formRef} action={handleUpload} className="tk-panel flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          Imagem
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="tk-input-full mt-1" />
        </label>
        <button type="submit" className="tk-btn-primary">
          Gerar modelo 3D
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <div className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Jobs recentes</h2>
        {jobs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Nenhum job ainda.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Criado em</th>
                <th>Status</th>
                <th>Download</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="tk-row">
                  <td className="py-2">{new Date(job.createdAt).toLocaleString('pt-BR')}</td>
                  <td>
                    {STATUS_LABEL[job.status]}
                    {job.status === 'ERRO' && job.errorMessage && (
                      <span className="block text-xs text-red-600 dark:text-red-400">{job.errorMessage}</span>
                    )}
                  </td>
                  <td>
                    {job.hasObj && (
                      <a href={`/api/mesh-jobs/${job.id}/download/obj`} className="tk-link-success mr-2">
                        .obj
                      </a>
                    )}
                    {job.hasStl && (
                      <a href={`/api/mesh-jobs/${job.id}/download/stl`} className="tk-link-success">
                        .stl
                      </a>
                    )}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleDelete(job.id)} className="tk-link-danger">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Adicionar link de navegação**

Antes de editar, ler `app/(app)/AppLayoutClient.tsx` pra confirmar a
lista de links atual (`PRODUCTION_NAV_LINKS` e o import dos ícones de
`@/components/NavIcons`) — a estrutura exata pode ter mudado desde a
escrita deste plano. Acrescentar um item `{ href: '/3d-generator', label:
'Gerador 3D', icon: NavProductionIcon }` à lista `PRODUCTION_NAV_LINKS`
(reaproveitando `NavProductionIcon` por ora — ícone dedicado é ajuste
cosmético que não bloqueia esta task, mesmo padrão já usado pros links
de Bambu/Anycubic nessa mesma lista).

- [ ] **Step 5: Verificar tipos e lint**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx tsc --noEmit && npm run lint`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add actions/meshJobs.ts "app/(app)/3d-generator" "app/(app)/AppLayoutClient.tsx"
git commit -m "feat(mesh): tela /3d-generator (upload, lista com polling, download)"
```

---

### Task 7: Worker local (Python)

**Files:**
- Create: `worker/mesh_worker.py`
- Create: `worker/requirements.txt`
- Create: `worker/README.md`

**Interfaces:**
- Consumes (via HTTP): `GET /api/mesh-jobs/next`, `GET
  /api/mesh-jobs/:id/image`, `POST /api/mesh-jobs/:id/complete`, `POST
  /api/mesh-jobs/:id/fail` (Task 5).

- [ ] **Step 1: `worker/requirements.txt`**

```
requests>=2.31
trimesh>=4.0
```

(`torch` e o próprio TripoSR ficam de fora de propósito — dependem da
GPU/versão de CUDA específica da máquina de cada um, instalação própria
documentada no README, nunca fixada aqui.)

- [ ] **Step 2: `worker/mesh_worker.py`**

```python
#!/usr/bin/env python3
"""Worker local do gerador de modelo 3D (TripoSR) -- roda no PC do
usuário, nunca na VPS de produção (sem GPU lá). Faz polling em
/api/mesh-jobs/next, baixa a imagem pendente, roda o TripoSR via
subprocess (repositório clonado separadamente, ver README.md deste
diretório), converte o .obj resultante pra .stl com trimesh, e envia o
resultado de volta.

Ver spec: docs/superpowers/specs/2026-10-14-gerador-3d-triposr-design.md
"""
import os
import subprocess
import sys
import tempfile
import time

import requests
import trimesh

TK3D_URL = os.environ["TK3D_URL"].rstrip("/")
MESH_WORKER_SECRET = os.environ["MESH_WORKER_SECRET"]
TRIPOSR_DIR = os.environ.get("TRIPOSR_DIR", os.path.expanduser("~/TripoSR"))
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

HEADERS = {"Authorization": f"Bearer {MESH_WORKER_SECRET}"}


def claim_next_job():
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/next", headers=HEADERS, timeout=30)
    if resp.status_code == 204:
        return None
    resp.raise_for_status()
    return resp.json()["id"]


def download_image(job_id: str, dest_path: str) -> None:
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/{job_id}/image", headers=HEADERS, timeout=60)
    resp.raise_for_status()
    with open(dest_path, "wb") as f:
        f.write(resp.content)


def run_triposr(image_path: str, output_dir: str) -> str:
    """Invoca o run.py oficial do TripoSR como processo separado. Ajuste
    o comando/caminho de saída aqui se a versão do TripoSR que você
    clonou documentar algo diferente -- este script assume a CLI pública
    descrita no README do próprio projeto no momento em que esta
    integração foi escrita (saída em <output_dir>/0/mesh.obj). Confira o
    README do TripoSR antes de rodar pela primeira vez."""
    subprocess.run(
        [sys.executable, "run.py", image_path, "--output-dir", output_dir],
        cwd=TRIPOSR_DIR,
        check=True,
    )
    obj_path = os.path.join(output_dir, "0", "mesh.obj")
    if not os.path.exists(obj_path):
        raise RuntimeError(
            f"TripoSR não gerou {obj_path} -- confira o README do TripoSR "
            "pra ver se o layout de saída mudou"
        )
    return obj_path


def convert_obj_to_stl(obj_path: str) -> str:
    mesh = trimesh.load(obj_path)
    stl_path = obj_path.replace(".obj", ".stl")
    mesh.export(stl_path)
    return stl_path


def complete_job(job_id: str, obj_path: str, stl_path: str) -> None:
    with open(obj_path, "rb") as obj_file, open(stl_path, "rb") as stl_file:
        files = {
            "obj": ("mesh.obj", obj_file, "model/obj"),
            "stl": ("mesh.stl", stl_file, "model/stl"),
        }
        resp = requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/complete", headers=HEADERS, files=files, timeout=120)
    resp.raise_for_status()


def fail_job(job_id: str, message: str) -> None:
    try:
        requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/fail", headers=HEADERS, json={"message": message}, timeout=30)
    except requests.RequestException:
        print(f"[worker] não conseguiu reportar falha do job {job_id} pro servidor: {message}")


def process_job(job_id: str) -> None:
    print(f"[worker] processando job {job_id}")
    with tempfile.TemporaryDirectory() as tmp:
        image_path = os.path.join(tmp, "input")
        download_image(job_id, image_path)
        try:
            obj_path = run_triposr(image_path, tmp)
            stl_path = convert_obj_to_stl(obj_path)
            complete_job(job_id, obj_path, stl_path)
            print(f"[worker] job {job_id} concluído")
        except Exception as err:  # qualquer falha vira ERRO no job, nunca trava o loop
            print(f"[worker] job {job_id} falhou: {err}")
            fail_job(job_id, str(err))


def main() -> None:
    print(f"[worker] iniciando, apontando pra {TK3D_URL}, polling a cada {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            job_id = claim_next_job()
        except requests.RequestException as err:
            print(f"[worker] falha ao consultar jobs pendentes: {err}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        if job_id:
            process_job(job_id)
        else:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: `worker/README.md`**

```markdown
# Worker local — Gerador de modelo 3D (TripoSR)

Roda no seu PC (não na VPS de produção — ela não tem GPU). Faz polling
no TK3D perguntando se há imagens pendentes, processa localmente com sua
GPU, e devolve o resultado.

## 1. Clonar o TripoSR

```bash
git clone https://github.com/VAST-AI-Research/TripoSR ~/TripoSR
cd ~/TripoSR
pip install -r requirements.txt
```

Siga o README do próprio TripoSR pra instalar o PyTorch com suporte à
sua GPU (CUDA) — isso varia por placa/driver e não é coberto aqui.
Confirme que `python run.py <alguma_imagem.png> --output-dir /tmp/teste`
funciona e gera `/tmp/teste/0/mesh.obj` antes de seguir — se o caminho de
saída for diferente na versão que você clonou, ajuste a constante em
`mesh_worker.py#run_triposr`.

## 2. Instalar as dependências deste worker

```bash
cd worker/
python -m venv .venv && source .venv/bin/activate   # opcional, recomendado
pip install -r requirements.txt
```

## 3. Configurar e rodar

```bash
export TK3D_URL="https://tk3d.coffetech.com.br"
export MESH_WORKER_SECRET="<o mesmo valor configurado em MESH_WORKER_SECRET no Coolify>"
export TRIPOSR_DIR="$HOME/TripoSR"   # opcional, esse é o default

python mesh_worker.py
```

Deixe rodando enquanto quiser gerar modelos — pode fechar quando não
precisar mais; os jobs enviados nesse período ficam `PENDENTE` até você
rodar o worker de novo.
```

- [ ] **Step 4: Commit**

```bash
git add worker/
git commit -m "feat(mesh): worker local em Python (TripoSR + trimesh)"
```

---

## Self-Review

**Cobertura do spec:** §2 (arquitetura polling/pull) → Tasks 5+7 ✓, §3
(schema) → Task 1 ✓, §4 (tela) → Task 6 ✓, §5 (API + claim atômico +
isenção de middleware) → Tasks 4+5 ✓, §6 (worker local) → Task 7 ✓, §7
(segurança: bearer token com timingSafeEqual, validação de upload) →
Tasks 2+6 ✓, §8 (não-objetivos) → nenhuma task implementa, corretamente
fora de escopo ✓.

**Consistência de tipos:** `Model3DJobStatus` (Task 1) usado
identicamente em `MeshJobSummary` (Task 3) e no `STATUS_LABEL` da UI
(Task 6). `MeshJobSummary`/`createJob`/`claimNextJob`/`completeJob`/
`failJob`/`getJobImage`/`getJobOutput`/`deleteJob`/`listRecentJobs`
(Task 3) consumidos com as mesmas assinaturas em Tasks 5 e 6.
`verifyWorkerAuth` (Task 2) consumido identicamente em todas as 4 rotas
de worker da Task 5. `createdAt` sempre `string` (ISO) na fronteira
servidor→cliente, nunca `Date` crua (Task 3 produz, Task 6 consome).

**Correção de design deliberada em relação à spec:** a spec (§5) descrevia
`imageUrl` como já incluindo o bearer token; o plano usa, em vez disso, o
worker reenviando o MESMO header `Authorization` numa chamada separada a
`GET /api/mesh-jobs/:id/image` — evita colocar um segredo em URL (que
pode acabar logada por algum proxy/servidor no caminho). Mantém a
garantia da spec (§7: "nunca embute o secret numa URL") de forma mais
direta.

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-10-14-gerador-3d-triposr.md`. O skill
`subagent-driven-development` não está registrado no harness desta
sessão (só os arquivos de skill vendorizados em `.agents/skills/`
continuam no repo) — duas opções:

1. **Subagent-Driven (recomendado)** — eu mesmo replico o processo do
   skill manualmente: dispatch de um subagente implementador por task
   via Agent tool, revisão depois de cada task, sem os scripts
   `task-brief`/`review-package` (vou extrair o texto da task e montar o
   diff review eu mesmo via `git diff`).
2. **Execução inline** — eu implemento as 7 tasks nesta mesma sessão,
   em sequência, com checkpoint pra você revisar depois de cada uma.

Qual prefere?

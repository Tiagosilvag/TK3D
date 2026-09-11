# Integração Bambu Lab (monitoramento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar tempo real e filamento real gasto das impressoras Bambu Lab do usuário via Cloud MQTT (somente leitura, mantendo o Bambu Handy funcional fora da LAN), mostrar isso numa tela de monitoramento ao vivo e usar como autofill no formulário de Registrar Produção existente.

**Architecture:** Um listener MQTT singleton (iniciado via `instrumentation.ts` do Next 15) mantém um cache em memória do status de cada impressora habilitada e, ao detectar o fim de um job, grava uma linha em `PrinterCapture`. A tela `/monitor` lê o cache em memória via polling. O formulário de Registrar Produção (`ProductionRunBatchForm`, modo Plate) oferece a captura mais recente não vinculada da impressora escolhida como autofill opcional.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Prisma/PostgreSQL, Zod, `mqtt` (nova dependência), `crypto` nativo do Node, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-11-integracao-bambu-lab-design.md](../specs/2026-09-11-integracao-bambu-lab-design.md)

## Global Constraints

- Integração é **somente leitura** — nunca manda imprimir, fatiar, nem qualquer comando de escrita pra impressora.
- Nunca cria `ProductionRun`/`Plate` automaticamente — só oferece autofill num formulário que o usuário confirma.
- `costSnapshot` de `ProductionRun` continua congelado, calculado só na criação manual — nenhuma mudança de regra.
- Nenhum campo novo além do listado na spec entra em `ProductionRun`. Toda ligação nova é via `PrinterCapture.linkedPlateId → Plate`.
- Sem dependência nova além de `mqtt` (única aprovada pelo usuário). Todo o resto (login Bambu, parser, cifragem) é código próprio.
- Cifragem via `crypto` nativo (AES-256-GCM), chave de `BAMBU_CREDENTIAL_KEY` (env var nova). Sem essa env var, salvar credencial falha explicitamente — nunca grava em texto puro.
- Janela de captura disponível pra autofill: 48h fixas no código (sem campo em Settings).
- Toda migration é escrita à mão em `prisma/migrations/<timestamp>_nome/migration.sql` (sem banco vivo no sandbox) — nomes de tabela/enum em PascalCase, sem `@@map`.
- Verificação antes de cada commit: `DATABASE_URL="x" npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/unit`, `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`.
- Estilo de código do projeto: sem ponto-e-vírgula, aspas simples, 2 espaços de indentação (seguir `actions/printers.ts`/`PrinterForm.tsx` como referência).

---

## Task 1: Schema — campos novos e tabela `PrinterCapture`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260911090000_bambu_integration/migration.sql`

**Interfaces:**
- Produces: modelos `Printer.bambuEnabled`, `Printer.bambuSerial`, `Settings.bambuCloudEmail`, `Settings.bambuCloudCredentialEncrypted`, `Settings.bambuCloudRegion`, `Plate.actualPrintTimeHours`, enum `PrinterCaptureOutcome`, model `PrinterCapture` (usados por todas as tasks seguintes).

- [ ] **Step 1: Editar `prisma/schema.prisma`**

No `model Printer`, adicionar (perto de `nickname`):

```prisma
  bambuEnabled           Boolean         @default(false)
  bambuSerial            String?
```

No `model Settings`, adicionar:

```prisma
  bambuCloudEmail               String?
  bambuCloudCredentialEncrypted String?
  bambuCloudRegion              String?  @default("US")
```

No `model Plate`, adicionar:

```prisma
  actualPrintTimeHours Decimal?         @db.Decimal(10, 3)
  captures             PrinterCapture[]
```

No final do arquivo, adicionar o enum e o modelo novo, e a relação inversa em `Printer`:

```prisma
enum PrinterCaptureOutcome {
  FINISHED
  FAILED
  CANCELLED
  UNKNOWN
}

model PrinterCapture {
  id             String                @id @default(cuid())
  printerId      String
  printer        Printer               @relation(fields: [printerId], references: [id])
  startedAt      DateTime
  finishedAt     DateTime
  gcodeFileName  String?
  durationHours  Decimal               @db.Decimal(10, 3)
  gramsUsedTotal Decimal?              @db.Decimal(10, 2)
  amsBreakdown   Json?
  outcome        PrinterCaptureOutcome
  linkedPlateId  String?
  linkedPlate    Plate?                @relation(fields: [linkedPlateId], references: [id])
  createdAt      DateTime              @default(now())

  @@index([printerId, finishedAt])
}
```

E em `model Printer`, adicionar a relação inversa:

```prisma
  captures PrinterCapture[]
```

- [ ] **Step 2: Escrever a migration à mão**

`prisma/migrations/20260911090000_bambu_integration/migration.sql`:

```sql
-- Integração Bambu Lab (monitoramento, spec 2026-09-11): campos de opt-in
-- por impressora, credencial cifrada da conta Bambu, tempo real da Plate
-- e o log de capturas de telemetria (somente leitura, nunca altera
-- ProductionRun).
ALTER TABLE "Printer" ADD COLUMN "bambuEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Printer" ADD COLUMN "bambuSerial" TEXT;

ALTER TABLE "Settings" ADD COLUMN "bambuCloudEmail" TEXT;
ALTER TABLE "Settings" ADD COLUMN "bambuCloudCredentialEncrypted" TEXT;
ALTER TABLE "Settings" ADD COLUMN "bambuCloudRegion" TEXT DEFAULT 'US';

ALTER TABLE "Plate" ADD COLUMN "actualPrintTimeHours" DECIMAL(10,3);

CREATE TYPE "PrinterCaptureOutcome" AS ENUM ('FINISHED', 'FAILED', 'CANCELLED', 'UNKNOWN');

CREATE TABLE "PrinterCapture" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "gcodeFileName" TEXT,
    "durationHours" DECIMAL(10,3) NOT NULL,
    "gramsUsedTotal" DECIMAL(10,2),
    "amsBreakdown" JSONB,
    "outcome" "PrinterCaptureOutcome" NOT NULL,
    "linkedPlateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrinterCapture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrinterCapture_printerId_finishedAt_idx" ON "PrinterCapture"("printerId", "finishedAt");

ALTER TABLE "PrinterCapture" ADD CONSTRAINT "PrinterCapture_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrinterCapture" ADD CONSTRAINT "PrinterCapture_linkedPlateId_fkey" FOREIGN KEY ("linkedPlateId") REFERENCES "Plate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Validar schema**

Run: `DATABASE_URL="postgresql://x:x@localhost:5432/x" npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `DATABASE_URL="postgresql://x:x@localhost:5432/x" npx prisma generate`
Expected: gera o client sem erro (não precisa de conexão real).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260911090000_bambu_integration
git commit -m "feat: schema da integração Bambu Lab (PrinterCapture + campos de opt-in)"
```

---

## Task 2: Cifragem da credencial (`lib/bambu/crypto.ts`)

**Files:**
- Create: `lib/bambu/crypto.ts`
- Test: `tests/unit/bambuCrypto.test.ts`

**Interfaces:**
- Produces: `encryptCredential(plaintext: string): string`, `decryptCredential(ciphertext: string): string` — usadas por Task 6 (auth) e pelo listener (Task 9).

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/bambuCrypto.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { encryptCredential, decryptCredential } from '@/lib/bambu/crypto'

describe('bambu credential crypto', () => {
  beforeEach(() => {
    process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64) // 32 bytes em hex
  })

  it('round-trips a plaintext value', () => {
    const cipher = encryptCredential('meu-token-secreto')
    expect(cipher).not.toContain('meu-token-secreto')
    expect(decryptCredential(cipher)).toBe('meu-token-secreto')
  })

  it('produces a different ciphertext each time (IV aleatório)', () => {
    const a = encryptCredential('mesmo-valor')
    const b = encryptCredential('mesmo-valor')
    expect(a).not.toBe(b)
  })

  it('throws when BAMBU_CREDENTIAL_KEY is missing', () => {
    delete process.env.BAMBU_CREDENTIAL_KEY
    expect(() => encryptCredential('x')).toThrow('BAMBU_CREDENTIAL_KEY')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuCrypto.test.ts`
Expected: FAIL — `Cannot find module '@/lib/bambu/crypto'`

- [ ] **Step 3: Implementar**

`lib/bambu/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.BAMBU_CREDENTIAL_KEY
  if (!hex) throw new Error('BAMBU_CREDENTIAL_KEY não configurada — não é possível cifrar/decifrar credencial')
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error('BAMBU_CREDENTIAL_KEY deve ter 32 bytes em hex (64 caracteres)')
  return key
}

// Formato armazenado: base64(iv):base64(authTag):base64(ciphertext)
export function encryptCredential(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptCredential(stored: string): string {
  const key = getKey()
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':')
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('Credencial cifrada em formato inválido')
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/bambuCrypto.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bambu/crypto.ts tests/unit/bambuCrypto.test.ts
git commit -m "feat: cifragem AES-256-GCM da credencial Bambu"
```

---

## Task 3: Parser do payload MQTT (`lib/bambu/parser.ts`)

**Files:**
- Create: `lib/bambu/parser.ts`
- Test: `tests/unit/bambuParser.test.ts`

**Interfaces:**
- Produces: `type BambuStatus`, `parseBambuReport(raw: unknown): BambuStatus | null` — usado por Task 4 (jobTracker) e Task 9 (listener).

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/bambuParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseBambuReport } from '@/lib/bambu/parser'

const baseReport = {
  print: {
    gcode_state: 'RUNNING',
    mc_percent: 42,
    mc_remaining_time: 30,
    layer_num: 10,
    total_layer_num: 50,
    gcode_file: 'peça.3mf',
    nozzle_temper: 220,
    bed_temper: 60,
  },
}

describe('parseBambuReport', () => {
  it('extrai os campos principais de um report em RUNNING', () => {
    const status = parseBambuReport(baseReport)
    expect(status).toEqual({
      gcodeState: 'RUNNING',
      percent: 42,
      remainingMinutes: 30,
      layerNum: 10,
      totalLayerNum: 50,
      gcodeFile: 'peça.3mf',
      nozzleTemp: 220,
      bedTemp: 60,
      amsTrays: [],
    })
  })

  it('extrai bandejas do AMS quando presentes', () => {
    const withAms = {
      print: {
        ...baseReport.print,
        ams: { ams: [{ tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FF0000FF', remain: 80 }] }] },
      },
    }
    const status = parseBambuReport(withAms)
    expect(status?.amsTrays).toEqual([{ id: '0', type: 'PLA', color: 'FF0000FF', remainPercent: 80 }])
  })

  it('retorna null para payload sem o bloco print', () => {
    expect(parseBambuReport({ system: {} })).toBeNull()
  })

  it('retorna null para payload não-objeto', () => {
    expect(parseBambuReport('lixo')).toBeNull()
    expect(parseBambuReport(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuParser.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/bambu/parser.ts`:

```ts
export type BambuAmsTray = {
  id: string
  type: string
  color: string
  remainPercent: number
}

export type BambuStatus = {
  gcodeState: string
  percent: number | null
  remainingMinutes: number | null
  layerNum: number | null
  totalLayerNum: number | null
  gcodeFile: string | null
  nozzleTemp: number | null
  bedTemp: number | null
  amsTrays: BambuAmsTray[]
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// Formato do report MQTT da Bambu (bloco "print" de device/{serial}/report),
// documentado pela comunidade (OpenBambuAPI) — impressora sem AMS
// simplesmente não manda o bloco `ams`, por isso amsTrays vem vazio nesse
// caso em vez de erro.
export function parseBambuReport(raw: unknown): BambuStatus | null {
  if (typeof raw !== 'object' || raw === null) return null
  const print = (raw as Record<string, unknown>).print
  if (typeof print !== 'object' || print === null) return null
  const p = print as Record<string, unknown>

  const gcodeState = str(p.gcode_state)
  if (!gcodeState) return null

  const amsTrays: BambuAmsTray[] = []
  const ams = p.ams as { ams?: { tray?: unknown[] }[] } | undefined
  for (const unit of ams?.ams ?? []) {
    for (const tray of unit.tray ?? []) {
      const t = tray as Record<string, unknown>
      const id = str(t.id)
      const remain = num(t.remain)
      if (id === null || remain === null) continue
      amsTrays.push({ id, type: str(t.tray_type) ?? '', color: str(t.tray_color) ?? '', remainPercent: remain })
    }
  }

  return {
    gcodeState,
    percent: num(p.mc_percent),
    remainingMinutes: num(p.mc_remaining_time),
    layerNum: num(p.layer_num),
    totalLayerNum: num(p.total_layer_num),
    gcodeFile: str(p.gcode_file),
    nozzleTemp: num(p.nozzle_temper),
    bedTemp: num(p.bed_temper),
    amsTrays,
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/bambuParser.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bambu/parser.ts tests/unit/bambuParser.test.ts
git commit -m "feat: parser do report MQTT da Bambu"
```

---

## Task 4: Detector de job e cálculo de captura (`lib/bambu/jobTracker.ts`)

**Files:**
- Create: `lib/bambu/jobTracker.ts`
- Test: `tests/unit/bambuJobTracker.test.ts`

**Interfaces:**
- Consumes: `BambuStatus` de `lib/bambu/parser.ts` (Task 3).
- Produces: `createJobTracker()`, retornando `{ handleStatus(status: BambuStatus, now: Date): CaptureDraft | null }`. `CaptureDraft = { startedAt: Date; finishedAt: Date; durationHours: number; gcodeFileName: string | null; gramsUsedTotal: number | null; amsBreakdown: unknown; outcome: 'FINISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' }` — usado por Task 9 (listener) pra montar o `prisma.printerCapture.create`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/bambuJobTracker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createJobTracker } from '@/lib/bambu/jobTracker'
import type { BambuStatus } from '@/lib/bambu/parser'

function status(overrides: Partial<BambuStatus>): BambuStatus {
  return {
    gcodeState: 'IDLE',
    percent: null,
    remainingMinutes: null,
    layerNum: null,
    totalLayerNum: null,
    gcodeFile: null,
    nozzleTemp: null,
    bedTemp: null,
    amsTrays: [],
    ...overrides,
  }
}

// Confirmação de fim de job exige 2 leituras terminais consecutivas com o
// mesmo estado (debounce, spec §5/§8) -- o segundo tick simula o próximo
// report da impressora, alguns segundos depois na vida real.
describe('createJobTracker', () => {
  it('não gera captura enquanto o job está rodando', () => {
    const tracker = createJobTracker()
    const t0 = new Date('2026-09-11T10:00:00Z')
    expect(tracker.handleStatus(status({ gcodeState: 'IDLE' }), t0)).toBeNull()
    expect(tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'a.3mf' }), t0)).toBeNull()
  })

  it('gera captura FINISHED com duração e filamento pela diferença do spool, só após 2 leituras terminais seguidas', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    const firstFinish = new Date('2026-09-11T11:30:00Z')
    const secondFinish = new Date('2026-09-11T11:30:02Z')
    tracker.handleStatus(
      status({ gcodeState: 'RUNNING', gcodeFile: 'a.3mf', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 80 }] }),
      start,
    )
    const pending = tracker.handleStatus(
      status({ gcodeState: 'FINISH', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 75 }] }),
      firstFinish,
    )
    expect(pending).toBeNull()
    const capture = tracker.handleStatus(
      status({ gcodeState: 'FINISH', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 75 }] }),
      secondFinish,
    )
    expect(capture).not.toBeNull()
    expect(capture!.outcome).toBe('FINISHED')
    // Duração conta até a PRIMEIRA leitura terminal, não a segunda (a
    // impressora já tinha terminado nesse instante -- o segundo tick é só
    // confirmação de ruído, não faz o job "durar mais").
    expect(capture!.durationHours).toBeCloseTo(1.5, 5)
    expect(capture!.gcodeFileName).toBe('a.3mf')
    // Sem peso total do rolo conhecido nesta versão, delta de % vira null
    // (limite documentado na spec) -- não inventa peso.
    expect(capture!.gramsUsedTotal).toBeNull()
    expect(capture!.amsBreakdown).toBeDefined()
  })

  it('gera captura FAILED quando o job termina em falha (2 leituras seguidas)', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    const end = new Date('2026-09-11T10:20:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'b.3mf' }), start)
    tracker.handleStatus(status({ gcodeState: 'FAILED' }), end)
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED' }), new Date(end.getTime() + 2000))
    expect(capture!.outcome).toBe('FAILED')
    expect(capture!.durationHours).toBeCloseTo(1 / 3, 5)
  })

  it('não gera captura se nunca viu o job em RUNNING (restart no meio do job)', () => {
    const tracker = createJobTracker()
    tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date())
    const capture = tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date())
    expect(capture).toBeNull()
  })

  it('ruído/flapping: uma única leitura terminal isolada, seguida de volta pra RUNNING, não fecha o job', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'c.3mf' }), start)
    const pending = tracker.handleStatus(status({ gcodeState: 'IDLE' }), new Date(start.getTime() + 1000))
    expect(pending).toBeNull()
    // Volta a RUNNING antes da segunda confirmação -- job continua o mesmo,
    // sem gerar captura fantasma.
    const backToRunning = tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'c.3mf' }), new Date(start.getTime() + 2000))
    expect(backToRunning).toBeNull()
    const stillRunningLater = tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date(start.getTime() + 5000))
    expect(stillRunningLater).toBeNull() // primeira leitura terminal real, ainda pendente de confirmação
  })

  it('duas leituras terminais seguidas mas com estados DIFERENTES não confirmam (exige o mesmo estado 2x)', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING' }), start)
    tracker.handleStatus(status({ gcodeState: 'IDLE' }), new Date(start.getTime() + 1000))
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED' }), new Date(start.getTime() + 2000))
    expect(capture).toBeNull() // reinicia a contagem de confirmação com o novo estado terminal
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuJobTracker.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/bambu/jobTracker.ts`:

```ts
import type { BambuAmsTray, BambuStatus } from './parser'

export type CaptureOutcome = 'FINISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'

export type CaptureDraft = {
  startedAt: Date
  finishedAt: Date
  durationHours: number
  gcodeFileName: string | null
  gramsUsedTotal: number | null
  amsBreakdown: unknown
  outcome: CaptureOutcome
}

type RunningJob = {
  startedAt: Date
  gcodeFile: string | null
  startTrays: BambuAmsTray[]
}

type PendingTermination = {
  gcodeState: string
  firstSeenAt: Date
  endTrays: BambuAmsTray[]
}

function mapOutcome(gcodeState: string): CaptureOutcome {
  if (gcodeState === 'FINISH') return 'FINISHED'
  if (gcodeState === 'FAILED') return 'FAILED'
  if (gcodeState === 'CANCELLED' || gcodeState === 'CANCELED') return 'CANCELLED'
  return 'UNKNOWN'
}

// Delta de filamento pelo % restante do spool antes/depois -- só confiável
// se soubermos o peso TOTAL do rolo, o que esta versão ainda não rastreia
// por bandeja (fica null nesse caso, nunca inventado -- ver spec §5/§8).
function computeGramsUsedTotal(_startTrays: BambuAmsTray[], _endTrays: BambuAmsTray[]): number | null {
  return null
}

const RUNNING_STATES = new Set(['RUNNING'])
const TERMINAL_STATES = new Set(['FINISH', 'FAILED', 'CANCELLED', 'CANCELED', 'IDLE'])

// Debounce (spec §5/§8): uma leitura terminal isolada não fecha o job --
// só confirma quando o MESMO estado terminal aparece 2 vezes seguidas
// (a impressora reporta a cada poucos segundos, então isso custa no
// máximo um tick de atraso na captura real, e blinda contra ruído). Se o
// job voltar a RUNNING antes da confirmação, ou o estado terminal mudar
// no meio, a contagem reinicia sem gerar captura nenhuma.
export function createJobTracker() {
  let current: RunningJob | null = null
  let pending: PendingTermination | null = null

  function handleStatus(status: BambuStatus, now: Date): CaptureDraft | null {
    const isRunning = RUNNING_STATES.has(status.gcodeState)

    if (isRunning) {
      pending = null
      if (!current) current = { startedAt: now, gcodeFile: status.gcodeFile, startTrays: status.amsTrays }
      return null
    }

    if (!current) {
      pending = null
      return null
    }

    if (!TERMINAL_STATES.has(status.gcodeState)) return null

    if (!pending || pending.gcodeState !== status.gcodeState) {
      pending = { gcodeState: status.gcodeState, firstSeenAt: now, endTrays: status.amsTrays }
      return null
    }

    // Segunda leitura consecutiva com o mesmo estado terminal -- confirma o
    // fim do job. Duração conta até a PRIMEIRA leitura terminal (quando a
    // impressora realmente parou), não até esta confirmação.
    const job = current
    const finishedAt = pending.firstSeenAt
    current = null
    pending = null

    const durationHours = (finishedAt.getTime() - job.startedAt.getTime()) / 3_600_000
    return {
      startedAt: job.startedAt,
      finishedAt,
      durationHours,
      gcodeFileName: job.gcodeFile,
      gramsUsedTotal: computeGramsUsedTotal(job.startTrays, status.amsTrays),
      amsBreakdown: { start: job.startTrays, end: status.amsTrays },
      outcome: mapOutcome(status.gcodeState),
    }
  }

  return { handleStatus }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/bambuJobTracker.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bambu/jobTracker.ts tests/unit/bambuJobTracker.test.ts
git commit -m "feat: detector de início/fim de job Bambu e cálculo de captura"
```

---

## Task 5: Distribuição de autofill na Plate (`lib/bambu/autofill.ts`)

**Files:**
- Create: `lib/bambu/autofill.ts`
- Test: `tests/unit/bambuAutofill.test.ts`

**Interfaces:**
- Consumes: `CaptureDraft`-shaped objeto (mesmos campos de `PrinterCapture`: `durationHours`, `gramsUsedTotal`, `outcome`) — mais teórico já calculado por item.
- Produces: `buildPlateAutofill(capture, items)` → `PlateAutofillResult` — usado pela Task 12 (UI do `ProductionRunBatchForm`).

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/bambuAutofill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPlateAutofill } from '@/lib/bambu/autofill'

const finishedCapture = { durationHours: 2, gramsUsedTotal: 25, outcome: 'FINISHED' as const }
const failedCapture = { durationHours: 1, gramsUsedTotal: null, outcome: 'FAILED' as const }

describe('buildPlateAutofill', () => {
  it('job concluído com 1 item só: preenche tempo real da Plate e desperdício do item pela diferença', () => {
    const result = buildPlateAutofill(finishedCapture, [{ key: 'item-1', theoreticalGramsUsed: 20 }])
    expect(result.actualPrintTimeHours).toBe(2)
    expect(result.timeWastedHoursByItem).toEqual({})
    expect(result.gramsWastedByItem).toEqual({ 'item-1': 5 })
    expect(result.referenceGramsUsedTotal).toBe(25)
  })

  it('job concluído com vários itens: não reparte filamento, só mostra referência', () => {
    const result = buildPlateAutofill(finishedCapture, [
      { key: 'item-1', theoreticalGramsUsed: 10 },
      { key: 'item-2', theoreticalGramsUsed: 10 },
    ])
    expect(result.gramsWastedByItem).toEqual({})
    expect(result.referenceGramsUsedTotal).toBe(25)
    expect(result.actualPrintTimeHours).toBe(2)
  })

  it('job com falha: duração vai pra timeWastedHours de todo item, nunca pra actualPrintTimeHours', () => {
    const result = buildPlateAutofill(failedCapture, [{ key: 'item-1', theoreticalGramsUsed: 20 }])
    expect(result.actualPrintTimeHours).toBeNull()
    expect(result.timeWastedHoursByItem).toEqual({ 'item-1': 1 })
    expect(result.gramsWastedByItem).toEqual({})
  })

  it('diferença negativa (real menor que teórico) nunca vira desperdício negativo', () => {
    const result = buildPlateAutofill(
      { durationHours: 1, gramsUsedTotal: 5, outcome: 'FINISHED' },
      [{ key: 'item-1', theoreticalGramsUsed: 20 }],
    )
    expect(result.gramsWastedByItem).toEqual({ 'item-1': 0 })
  })

  it('sem gramsUsedTotal (delta não confiável): não preenche desperdício, só duração', () => {
    const result = buildPlateAutofill(
      { durationHours: 2, gramsUsedTotal: null, outcome: 'FINISHED' },
      [{ key: 'item-1', theoreticalGramsUsed: 20 }],
    )
    expect(result.gramsWastedByItem).toEqual({})
    expect(result.referenceGramsUsedTotal).toBeNull()
    expect(result.actualPrintTimeHours).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuAutofill.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/bambu/autofill.ts`:

```ts
export type PlateAutofillCapture = {
  durationHours: number
  gramsUsedTotal: number | null
  outcome: 'FINISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'
}

export type PlateAutofillItem = {
  key: string
  theoreticalGramsUsed: number
}

export type PlateAutofillResult = {
  actualPrintTimeHours: number | null
  timeWastedHoursByItem: Record<string, number>
  gramsWastedByItem: Record<string, number>
  referenceGramsUsedTotal: number | null
}

// Mapeamento da spec §7: sucesso -> Plate.actualPrintTimeHours; falha ->
// timeWastedHours (campo já existe com esse sentido). Filamento só é
// repartido automaticamente quando a Plate tem 1 item só -- com vários
// itens não dá pra saber qual consumiu o quê, então fica só como
// referência (nunca inventa a divisão).
export function buildPlateAutofill(capture: PlateAutofillCapture, items: PlateAutofillItem[]): PlateAutofillResult {
  const isFailure = capture.outcome === 'FAILED'

  const timeWastedHoursByItem: Record<string, number> = {}
  if (isFailure) {
    for (const item of items) timeWastedHoursByItem[item.key] = capture.durationHours
  }

  const gramsWastedByItem: Record<string, number> = {}
  if (!isFailure && items.length === 1 && capture.gramsUsedTotal !== null) {
    const [only] = items
    gramsWastedByItem[only.key] = Math.max(0, capture.gramsUsedTotal - only.theoreticalGramsUsed)
  }

  return {
    actualPrintTimeHours: isFailure ? null : capture.durationHours,
    timeWastedHoursByItem,
    gramsWastedByItem,
    referenceGramsUsedTotal: isFailure ? null : capture.gramsUsedTotal,
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/bambuAutofill.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bambu/autofill.ts tests/unit/bambuAutofill.test.ts
git commit -m "feat: distribuição de autofill de tempo/filamento na Plate"
```

---

## Task 6: Cliente de login na nuvem Bambu (`lib/bambu/auth.ts`)

**Files:**
- Create: `lib/bambu/auth.ts`
- Test: `tests/unit/bambuAuth.test.ts`

**Interfaces:**
- Produces: `requestLoginCode(email: string, password: string): Promise<{ ticket: string }>`, `confirmLoginCode(ticket: string, code: string): Promise<{ accessToken: string }>` — usados por Task 7 (Server Actions de Configurações).

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/bambuAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestLoginCode, confirmLoginCode } from '@/lib/bambu/auth'

describe('bambu auth client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('requestLoginCode devolve o ticket retornado pela Bambu', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: null, loginType: 'verifyCode', tmpToken: 'ticket-123' }),
    }) as unknown as typeof fetch

    const result = await requestLoginCode('user@example.com', 'senha')
    expect(result.ticket).toBe('ticket-123')
  })

  it('requestLoginCode lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch
    await expect(requestLoginCode('user@example.com', 'errada')).rejects.toThrow('Falha ao solicitar código de login da Bambu')
  })

  it('confirmLoginCode devolve o accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'token-abc' }) }) as unknown as typeof fetch
    const result = await confirmLoginCode('ticket-123', '000000')
    expect(result.accessToken).toBe('token-abc')
  })

  it('confirmLoginCode lança erro se a Bambu não devolver accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    await expect(confirmLoginCode('ticket-123', '000000')).rejects.toThrow('Código inválido ou expirado')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuAuth.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

`lib/bambu/auth.ts`:

```ts
// Cliente mínimo do login da Bambu Cloud (engenharia reversa da comunidade,
// não documentado oficialmente -- ver spec §4). Só usado uma vez, na tela
// de Configurações, pra obter o token que o listener usa depois.
const BAMBU_LOGIN_URL = 'https://api.bambulab.com/v1/user-service/user/login'

export async function requestLoginCode(email: string, password: string): Promise<{ ticket: string }> {
  const res = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: email, password }),
  })
  if (!res.ok) throw new Error('Falha ao solicitar código de login da Bambu')
  const data = (await res.json()) as { tmpToken?: string }
  if (!data.tmpToken) throw new Error('Bambu não retornou um ticket de verificação')
  return { ticket: data.tmpToken }
}

export async function confirmLoginCode(ticket: string, code: string): Promise<{ accessToken: string }> {
  const res = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmpToken: ticket, code }),
  })
  if (!res.ok) throw new Error('Falha ao confirmar código de login da Bambu')
  const data = (await res.json()) as { accessToken?: string }
  if (!data.accessToken) throw new Error('Código inválido ou expirado')
  return { accessToken: data.accessToken }
}
```

> Nota pra quem implementar: o endpoint/payload exato acima é uma
> aproximação baseada em bibliotecas de terceiro reverse-engineered — a
> spec já avisa que isso é incerto (§4). **Antes de seguir pra Task 7**,
> valide com uma chamada manual (curl/script) contra sua própria conta e
> ajuste `BAMBU_LOGIN_URL`/nomes de campo aqui se a resposta real vier
> diferente. Os testes desta task usam `fetch` mockado, então continuam
> passando independente do ajuste — só a validação manual pega
> divergência real de protocolo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/bambuAuth.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/bambu/auth.ts tests/unit/bambuAuth.test.ts
git commit -m "feat: cliente de login (2FA) da nuvem Bambu"
```

---

## Task 7: Server Actions de conexão Bambu em Configurações

**Files:**
- Create: `actions/bambuAuth.ts`
- Test: `tests/integration/bambuAuth.test.ts` (precisa de banco vivo — não roda no sandbox)

**Interfaces:**
- Consumes: `requestLoginCode`/`confirmLoginCode` (Task 6), `encryptCredential` (Task 2).
- Produces: `connectBambuAccountStep1(formData)`, `connectBambuAccountStep2(formData)`, `disconnectBambuAccount()` — usados pela Task 8 (UI).

- [ ] **Step 1: Escrever o teste de integração (documenta o contrato; roda fora do sandbox)**

`tests/integration/bambuAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import * as auth from '@/lib/bambu/auth'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe('bambuAuth actions', () => {
  beforeEach(async () => {
    process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64)
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } as never })
  })

  it('step1 devolve o ticket e não grava nada no banco (senha nunca persiste)', async () => {
    vi.spyOn(auth, 'requestLoginCode').mockResolvedValue({ ticket: 'ticket-xyz' })
    const result = await connectBambuAccountStep1(fd({ email: 'a@b.com', password: 'secreta' }))
    expect(result.success).toBe(true)
    expect(result.ticket).toBe('ticket-xyz')
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
  })

  it('step2 grava a credencial cifrada em Settings', async () => {
    vi.spyOn(auth, 'confirmLoginCode').mockResolvedValue({ accessToken: 'token-abc' })
    const result = await connectBambuAccountStep2(fd({ ticket: 'ticket-xyz', code: '000000', email: 'a@b.com' }))
    expect(result.success).toBe(true)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudEmail).toBe('a@b.com')
    expect(settings?.bambuCloudCredentialEncrypted).not.toBeNull()
    expect(settings?.bambuCloudCredentialEncrypted).not.toContain('token-abc')
  })

  it('disconnectBambuAccount limpa a credencial', async () => {
    await disconnectBambuAccount()
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
    expect(settings?.bambuCloudEmail).toBeNull()
  })
})
```

- [ ] **Step 2: Confirmar que falha (sem banco, roda só o typecheck)**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: FAIL — `Cannot find module '@/actions/bambuAuth'`

- [ ] **Step 3: Implementar**

`actions/bambuAuth.ts`:

```ts
'use server'
import { prisma } from '@/lib/prisma'
import { requestLoginCode, confirmLoginCode } from '@/lib/bambu/auth'
import { encryptCredential } from '@/lib/bambu/crypto'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function connectBambuAccountStep1(formData: FormData): Promise<ActionResult & { ticket?: string }> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { success: false, error: 'E-mail e senha são obrigatórios' }
  try {
    const { ticket } = await requestLoginCode(email, password)
    return { success: true, ticket }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao conectar com a Bambu' }
  }
}

export async function connectBambuAccountStep2(formData: FormData): Promise<ActionResult> {
  const ticket = String(formData.get('ticket') ?? '')
  const code = String(formData.get('code') ?? '')
  const email = String(formData.get('email') ?? '')
  if (!ticket || !code) return { success: false, error: 'Código é obrigatório' }
  try {
    const { accessToken } = await confirmLoginCode(ticket, code)
    const encrypted = encryptCredential(accessToken)
    await prisma.settings.upsert({
      where: { id: 1 },
      update: { bambuCloudEmail: email, bambuCloudCredentialEncrypted: encrypted },
      create: { id: 1, bambuCloudEmail: email, bambuCloudCredentialEncrypted: encrypted } as never,
    })
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Código inválido' }
  }
  revalidatePath('/settings')
  return { success: true }
}

export async function disconnectBambuAccount(): Promise<ActionResult> {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { bambuCloudEmail: null, bambuCloudCredentialEncrypted: null },
    create: { id: 1 } as never,
  })
  revalidatePath('/settings')
  return { success: true }
}
```

- [ ] **Step 4: Confirmar que o typecheck passa**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos (os 2 erros pré-existentes em `tests/integration/accessories.test.ts` continuam, não relacionados)

- [ ] **Step 5: Commit**

```bash
git add actions/bambuAuth.ts tests/integration/bambuAuth.test.ts
git commit -m "feat: server actions de conexão/desconexão da conta Bambu"
```

---

## Task 8: UI de conexão Bambu em Configurações

**Files:**
- Create: `app/(app)/settings/BambuConnectionForm.tsx`
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `connectBambuAccountStep1`, `connectBambuAccountStep2`, `disconnectBambuAccount` (Task 7).

- [ ] **Step 1: Criar o componente cliente de 2 passos**

`app/(app)/settings/BambuConnectionForm.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import { SubmitButton } from '@/components/SubmitButton'

export function BambuConnectionForm({ connectedEmail }: { connectedEmail: string | null }) {
  const router = useRouter()
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [ticket, setTicket] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleStep1(formData: FormData) {
    setError(null)
    const result = await connectBambuAccountStep1(formData)
    if (!result.success || !result.ticket) {
      setError(result.error ?? 'Falha ao conectar')
      return
    }
    setTicket(result.ticket)
    setEmail(String(formData.get('email')))
    setStep('code')
  }

  async function handleStep2(formData: FormData) {
    setError(null)
    formData.set('ticket', ticket)
    formData.set('email', email)
    const result = await connectBambuAccountStep2(formData)
    if (!result.success) {
      setError(result.error ?? 'Código inválido')
      return
    }
    setStep('idle')
    router.refresh()
  }

  async function handleDisconnect() {
    await disconnectBambuAccount()
    router.refresh()
  }

  if (connectedEmail) {
    return (
      <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
        <p>
          Conectado como <strong>{connectedEmail}</strong>
        </p>
        <button type="button" onClick={handleDisconnect} className="mt-2 text-sm text-red-600 hover:underline dark:text-red-400">
          Desconectar
        </button>
      </div>
    )
  }

  if (step === 'code') {
    return (
      <form action={handleStep2} className="flex flex-col gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Código enviado por e-mail para {email}</p>
        <label className="text-sm">
          Código
          <input name="code" className="tk-input-full" required placeholder="000000" />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <SubmitButton pendingLabel="Confirmando…">Confirmar</SubmitButton>
      </form>
    )
  }

  return (
    <form action={handleStep1} className="flex flex-col gap-3">
      <label className="text-sm">
        E-mail da conta Bambu
        <input name="email" type="email" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Senha
        <input name="password" type="password" className="tk-input-full" required />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <SubmitButton pendingLabel="Conectando…">Conectar</SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: Ligar na página de Configurações**

Em `app/(app)/settings/page.tsx`, importar `BambuConnectionForm` e o status live do listener (Task 9 expõe `getBambuConnectionStatus()`), adicionar uma seção nova (mesmo padrão de card das seções existentes):

```tsx
import { BambuConnectionForm } from './BambuConnectionForm'
// ... dentro do componente da página, após buscar `settings`:
<section className="tk-card">
  <h2 className="font-display text-lg font-semibold">Integração Bambu Lab</h2>
  <BambuConnectionForm connectedEmail={settings.bambuCloudEmail} />
</section>
```

(Ajustar a classe `tk-card`/estrutura pro padrão real das outras seções da página — seguir o card mais próximo já existente em `settings/page.tsx`.)

- [ ] **Step 3: Verificar tipos e build**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/settings/BambuConnectionForm.tsx" "app/(app)/settings/page.tsx"
git commit -m "feat: UI de conexão com a conta Bambu em Configurações"
```

---

## Task 9: Listener MQTT singleton (`lib/bambu/listener.ts`)

**Files:**
- Create: `lib/bambu/listener.ts`
- Test: `tests/unit/bambuListener.test.ts`
- Modify: `package.json` (adicionar dependência `mqtt`)

**Interfaces:**
- Consumes: `parseBambuReport` (Task 3), `createJobTracker` (Task 4), `decryptCredential` (Task 2), `prisma`.
- Produces: `startBambuListener(): Promise<void>`, `getLiveStatus(printerId: string): BambuStatus | null`, `getConnectionStatus(): 'connected' | 'expired' | 'not_configured'` — usados por Task 10 (`instrumentation.ts`), Task 11 (tela `/monitor`) e Task 8 (banner de status).

- [ ] **Step 1: Adicionar a dependência**

Run: `npm install mqtt`
Expected: adiciona `mqtt` a `package.json`/`package-lock.json`

- [ ] **Step 2: Escrever o teste que falha**

O listener real fala com a nuvem Bambu (fora do escopo de teste automatizado, spec §9) — o teste cobre a parte testável: seleção de quais impressoras conectar e o roteamento de mensagens recebidas pro cache/captura, com um cliente MQTT fake injetado.

`tests/unit/bambuListener.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createListenerCore } from '@/lib/bambu/listener'

describe('createListenerCore', () => {
  it('só assina impressoras com bambuEnabled=true e bambuSerial preenchido', () => {
    const subscribe = vi.fn()
    const core = createListenerCore({
      printers: [
        { id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' },
        { id: 'p2', bambuEnabled: false, bambuSerial: 'SER2' },
        { id: 'p3', bambuEnabled: true, bambuSerial: null },
      ],
      subscribe,
      onCapture: vi.fn(),
    })
    core.start()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith('SER1', expect.any(Function))
  })

  it('atualiza o cache em memória a cada mensagem e expõe via getLiveStatus', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createListenerCore({
      printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }],
      subscribe: (serial, handler) => { handlers[serial] = handler },
      onCapture: vi.fn(),
    })
    core.start()
    handlers['SER1']({ print: { gcode_state: 'RUNNING', mc_percent: 10 } })
    expect(core.getLiveStatus('p1')?.gcodeState).toBe('RUNNING')
    expect(core.getLiveStatus('p1')?.percent).toBe(10)
  })

  it('chama onCapture quando um job termina, com o printerId certo (jobTracker exige 2 leituras terminais seguidas, ver Task 4)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onCapture = vi.fn()
    const core = createListenerCore({
      printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }],
      subscribe: (serial, handler) => { handlers[serial] = handler },
      onCapture,
    })
    core.start()
    handlers['SER1']({ print: { gcode_state: 'RUNNING' } })
    handlers['SER1']({ print: { gcode_state: 'FINISH' } })
    expect(onCapture).not.toHaveBeenCalled()
    handlers['SER1']({ print: { gcode_state: 'FINISH' } })
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture).toHaveBeenCalledWith('p1', expect.objectContaining({ outcome: 'FINISHED' }))
  })

  it('getLiveStatus devolve null pra impressora sem mensagem recebida ainda', () => {
    const core = createListenerCore({ printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }], subscribe: vi.fn(), onCapture: vi.fn() })
    core.start()
    expect(core.getLiveStatus('p1')).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/bambuListener.test.ts`
Expected: FAIL — `createListenerCore` não existe

- [ ] **Step 4: Implementar o núcleo testável + a casca real com `mqtt`/Prisma**

`lib/bambu/listener.ts`:

```ts
import mqtt, { MqttClient } from 'mqtt'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/bambu/crypto'
import { parseBambuReport, type BambuStatus } from '@/lib/bambu/parser'
import { createJobTracker, type CaptureDraft } from '@/lib/bambu/jobTracker'

type PrinterRef = { id: string; bambuEnabled: boolean; bambuSerial: string | null }

// Núcleo puro/testável: recebe uma função `subscribe` e devolve os
// callbacks que a casca real (start/stop de conexão MQTT verdadeira)
// registra. Nada aqui toca rede ou banco diretamente -- só orquestra
// parser + jobTracker + o cache em memória, e chama `onCapture` quando um
// job termina (quem persiste em PrinterCapture é a Task 9b/startBambuListener
// abaixo, não este núcleo).
export function createListenerCore(opts: {
  printers: PrinterRef[]
  subscribe: (serial: string, onMessage: (payload: unknown) => void) => void
  onCapture: (printerId: string, capture: CaptureDraft) => void
}) {
  const liveStatus = new Map<string, BambuStatus>()
  const trackers = new Map<string, ReturnType<typeof createJobTracker>>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.bambuEnabled || !printer.bambuSerial) continue
      const tracker = createJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.bambuSerial, (payload) => {
        const status = parseBambuReport(payload)
        if (!status) return
        liveStatus.set(printer.id, status)
        const capture = tracker.handleStatus(status, new Date())
        if (capture) opts.onCapture(printer.id, capture)
      })
    }
  }

  function getLiveStatus(printerId: string): BambuStatus | null {
    return liveStatus.get(printerId) ?? null
  }

  return { start, getLiveStatus }
}

// --- Casca real (não coberta por teste automatizado -- depende da nuvem
// Bambu de verdade, ver spec §9) ---

let connectionStatus: 'connected' | 'expired' | 'not_configured' = 'not_configured'
let core: ReturnType<typeof createListenerCore> | null = null
let client: MqttClient | null = null

const BROKER_BY_REGION: Record<string, string> = {
  US: 'mqtts://us.mqtt.bambulab.com:8883',
  CN: 'mqtts://cn.mqtt.bambulab.com:8883',
}

export async function startBambuListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.bambuCloudCredentialEncrypted || !settings.bambuCloudEmail) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = await prisma.printer.findMany({
    where: { bambuEnabled: true, bambuSerial: { not: null } },
    select: { id: true, bambuEnabled: true, bambuSerial: true },
  })
  if (printers.length === 0) {
    connectionStatus = 'not_configured'
    return
  }

  const token = decryptCredential(settings.bambuCloudCredentialEncrypted)
  const brokerUrl = BROKER_BY_REGION[settings.bambuCloudRegion ?? 'US'] ?? BROKER_BY_REGION.US

  client = mqtt.connect(brokerUrl, {
    username: settings.bambuCloudEmail,
    password: token,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => { connectionStatus = 'connected' })
  client.on('error', () => { connectionStatus = 'expired' })

  core = createListenerCore({
    printers,
    subscribe: (serial, onMessage) => {
      const topic = `device/${serial}/report`
      client!.subscribe(topic)
      client!.on('message', (receivedTopic, buffer) => {
        if (receivedTopic !== topic) return
        try {
          onMessage(JSON.parse(buffer.toString()))
        } catch {
          // payload malformado -- ignora esta mensagem, mantém a conexão
        }
      })
    },
    onCapture: async (printerId, capture) => {
      await prisma.printerCapture.create({
        data: {
          printerId,
          startedAt: capture.startedAt,
          finishedAt: capture.finishedAt,
          gcodeFileName: capture.gcodeFileName,
          durationHours: capture.durationHours,
          gramsUsedTotal: capture.gramsUsedTotal,
          amsBreakdown: capture.amsBreakdown as never,
          outcome: capture.outcome,
        },
      })
    },
  })
  core.start()
}

export function getLiveStatus(printerId: string): BambuStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

export function getConnectionStatus(): 'connected' | 'expired' | 'not_configured' {
  return connectionStatus
}
```

- [ ] **Step 5: Rodar e confirmar que o núcleo passa**

Run: `npx vitest run tests/unit/bambuListener.test.ts`
Expected: PASS (4 testes — cobrem só `createListenerCore`, a casca real com `mqtt` fica sem teste automatizado por design, spec §9)

- [ ] **Step 6: Verificar tipos**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos

- [ ] **Step 7: Commit**

```bash
git add lib/bambu/listener.ts tests/unit/bambuListener.test.ts package.json package-lock.json
git commit -m "feat: listener MQTT singleton com cache em memória e captura de jobs"
```

---

## Task 10: Boot do listener (`instrumentation.ts`)

**Files:**
- Create: `instrumentation.ts` (raiz do projeto, ao lado de `next.config.js`)
- Modify: `next.config.js` (garantir `instrumentationHook` — no Next 15 já é default, só confirmar)

**Interfaces:**
- Consumes: `startBambuListener` (Task 9).

- [ ] **Step 1: Criar o hook**

`instrumentation.ts`:

```ts
export async function register() {
  // Só roda no runtime Node do servidor (nunca no Edge nem no browser) --
  // o listener MQTT precisa de módulos nativos do Node (crypto, sockets).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startBambuListener } = await import('@/lib/bambu/listener')
  await startBambuListener().catch((err) => {
    console.error('[bambu] falha ao iniciar o listener MQTT:', err)
  })
}
```

- [ ] **Step 2: Confirmar que o Next reconhece o arquivo**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
Expected: build conclui sem erro, log de build não reclama de `instrumentation.ts` ausente/mal formado (Next 15 detecta o arquivo na raiz automaticamente, sem config extra).

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat: inicia o listener Bambu no boot do servidor via instrumentation.ts"
```

---

## Task 11: Habilitar integração por impressora (`PrinterForm`)

**Files:**
- Modify: `lib/validation/printer.ts`
- Modify: `actions/printers.ts`
- Modify: `app/(app)/printers/PrinterForm.tsx`
- Modify: `app/(app)/printers/page.tsx` (repassar os 2 campos novos pro `EditingPrinter`)

**Interfaces:**
- Consumes: nenhuma nova (só estende o CRUD existente de `Printer`).

- [ ] **Step 1: Estender o schema Zod**

Em `lib/validation/printer.ts`, adicionar ao `printerSchema` (mesmo padrão `checkbox()` já usado em `lib/validation/settings.ts` — copiar a função local, já que `printer.ts` não a importa hoje):

```ts
import { z } from 'zod'

const checkbox = () =>
  z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === 'on')

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  nickname: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().positive('Preço deve ser maior que zero'),
  depreciationHours: z.coerce.number().positive('Horas de depreciação deve ser maior que zero'),
  avgPowerConsumptionKwh: z.coerce.number().positive('Consumo médio deve ser maior que zero'),
  energyCostPerKwh: z.coerce.number().nonnegative('Tarifa de energia não pode ser negativa'),
  maintenanceCostPerHour: z.coerce.number().nonnegative('Manutenção estimada não pode ser negativa'),
  bambuEnabled: checkbox(),
  bambuSerial: z.string().optional().nullable(),
})

export type PrinterInput = z.infer<typeof printerSchema>
```

- [ ] **Step 2: Ajustar `parse()` em `actions/printers.ts`**

```ts
function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return printerSchema.safeParse({ ...raw, nickname: raw.nickname || null, bambuSerial: raw.bambuSerial || null })
}
```

(Reiniciar o listener quando `bambuEnabled`/`bambuSerial` mudam fica fora de escopo desta task — o listener só relê `Printer` no próximo boot do processo. Documentado como limite conhecido, consistente com "sem retry agressivo" da spec §8.)

- [ ] **Step 3: Adicionar os campos no formulário**

Em `app/(app)/printers/PrinterForm.tsx`, adicionar ao `EditingPrinter`:

```ts
export type EditingPrinter = {
  id: string
  name: string
  nickname: string | null
  purchasePrice: number
  depreciationHours: number
  avgPowerConsumptionKwh: number
  energyCostPerKwh: number
  maintenanceCostPerHour: number
  bambuEnabled: boolean
  bambuSerial: string | null
}
```

E, no JSX, antes do bloco de "Preview de custo", adicionar:

```tsx
<label className="col-span-2 flex items-center gap-2 text-sm">
  <input type="checkbox" name="bambuEnabled" defaultChecked={editingPrinter?.bambuEnabled ?? false} />
  Integração Bambu Lab (monitoramento)
</label>
<label className="col-span-2 text-sm">
  Número de série Bambu (opcional)
  <input name="bambuSerial" placeholder="Ex: 01P00A000000000" className="tk-input-full" defaultValue={editingPrinter?.bambuSerial ?? ''} />
</label>
```

- [ ] **Step 4: Repassar os campos na listagem (`page.tsx`)**

Em `app/(app)/printers/page.tsx`, no ponto onde a impressora sendo editada é montada em `EditingPrinter` (buscar o objeto passado pra `<PrinterForm editingPrinter={...}>`), incluir `bambuEnabled: printer.bambuEnabled` e `bambuSerial: printer.bambuSerial`.

- [ ] **Step 5: Verificar tipos e lint**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 6: Commit**

```bash
git add lib/validation/printer.ts actions/printers.ts "app/(app)/printers/PrinterForm.tsx" "app/(app)/printers/page.tsx"
git commit -m "feat: opt-in de integração Bambu por impressora"
```

---

## Task 12: Server Actions de leitura (status ao vivo + captura disponível)

**Files:**
- Create: `actions/bambuStatus.ts`

**Interfaces:**
- Consumes: `getLiveStatus`, `getConnectionStatus` (Task 9), `prisma`.
- Produces: `getBambuConnectionStatus()`, `getAllLiveBambuStatuses()`, `getAvailablePrinterCapture(printerId)` — usados por Task 8 (banner), Task 13 (`/monitor`) e Task 14 (autofill no form de Plate).

- [ ] **Step 1: Implementar diretamente (leitura pura, sem regra de negócio nova além de já coberta nas tasks anteriores)**

`actions/bambuStatus.ts`:

```ts
'use server'
import { prisma } from '@/lib/prisma'
import { getLiveStatus, getConnectionStatus } from '@/lib/bambu/listener'

export async function getBambuConnectionStatus() {
  return getConnectionStatus()
}

export async function getAllLiveBambuStatuses() {
  const printers = await prisma.printer.findMany({
    where: { bambuEnabled: true, active: true },
    select: { id: true, name: true, nickname: true },
  })
  return printers.map((printer) => ({
    printerId: printer.id,
    name: printer.nickname ?? printer.name,
    status: getLiveStatus(printer.id),
  }))
}

const CAPTURE_WINDOW_HOURS = 48

export async function getAvailablePrinterCapture(printerId: string) {
  if (!printerId) return null
  const since = new Date(Date.now() - CAPTURE_WINDOW_HOURS * 3_600_000)
  const capture = await prisma.printerCapture.findFirst({
    where: { printerId, linkedPlateId: null, finishedAt: { gte: since } },
    orderBy: { finishedAt: 'desc' },
  })
  if (!capture) return null
  return {
    id: capture.id,
    finishedAt: capture.finishedAt,
    durationHours: capture.durationHours.toNumber(),
    gramsUsedTotal: capture.gramsUsedTotal?.toNumber() ?? null,
    outcome: capture.outcome,
    gcodeFileName: capture.gcodeFileName,
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos

- [ ] **Step 3: Commit**

```bash
git add actions/bambuStatus.ts
git commit -m "feat: server actions de leitura de status ao vivo e captura disponível"
```

---

## Task 13: Tela `/monitor`

**Files:**
- Create: `app/(app)/monitor/page.tsx`
- Create: `app/(app)/monitor/LiveStatusPoller.tsx`
- Modify: `app/(app)/AppLayoutClient.tsx` (item de menu novo)

**Interfaces:**
- Consumes: `getAllLiveBambuStatuses`, `getBambuConnectionStatus` (Task 12).

- [ ] **Step 1: Server Component da página**

`app/(app)/monitor/page.tsx`:

```tsx
import Link from 'next/link'
import { getAllLiveBambuStatuses, getBambuConnectionStatus } from '@/actions/bambuStatus'
import { LiveStatusPoller } from './LiveStatusPoller'

export default async function MonitorPage() {
  const [printers, connectionStatus] = await Promise.all([getAllLiveBambuStatuses(), getBambuConnectionStatus()])

  if (printers.length === 0) {
    return (
      <div className="tk-card text-sm text-slate-500 dark:text-slate-400">
        Nenhuma impressora com integração Bambu habilitada. Configure em{' '}
        <Link href="/printers" className="underline">
          Impressoras
        </Link>
        .
      </div>
    )
  }

  if (connectionStatus !== 'connected') {
    return (
      <div className="tk-card text-sm text-amber-600 dark:text-amber-400">
        Integração Bambu Lab desconectada.{' '}
        <Link href="/settings" className="underline">
          Ver Configurações
        </Link>
        .
      </div>
    )
  }

  return <LiveStatusPoller initialPrinters={printers} />
}
```

- [ ] **Step 2: Client Component com polling**

`app/(app)/monitor/LiveStatusPoller.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { getAllLiveBambuStatuses } from '@/actions/bambuStatus'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveBambuStatuses>>

const STATE_LABELS: Record<string, string> = {
  RUNNING: 'Imprimindo',
  IDLE: 'Ocioso',
  PAUSE: 'Pausado',
  FAILED: 'Falhou',
}

export function LiveStatusPoller({ initialPrinters }: { initialPrinters: LiveStatuses }) {
  const [printers, setPrinters] = useState(initialPrinters)

  useEffect(() => {
    const interval = setInterval(async () => {
      setPrinters(await getAllLiveBambuStatuses())
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {printers.map((printer) => (
        <div key={printer.printerId} className="tk-card">
          <h3 className="font-display text-base font-semibold">{printer.name}</h3>
          {!printer.status ? (
            <p className="text-sm text-slate-400">Sem dados ainda</p>
          ) : (
            <div className="mt-2 space-y-1 text-sm">
              <p>{STATE_LABELS[printer.status.gcodeState] ?? printer.status.gcodeState}</p>
              {printer.status.percent !== null && <p>{printer.status.percent}%</p>}
              {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
              {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Item de menu**

Em `app/(app)/AppLayoutClient.tsx`, adicionar na seção operacional (perto de `/production`/`/assembly`):

```ts
{ href: '/monitor', label: 'Monitoramento', icon: NavProductionIcon },
```

(Reaproveitar um ícone existente é aceitável pra v1 — trocar por um ícone dedicado é um ajuste cosmético que não bloqueia esta task.)

- [ ] **Step 4: Verificar tipos, lint e build**

Run: `DATABASE_URL="x" npx tsc --noEmit && npm run lint`
Expected: sem erros novos

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
Expected: build conclui, rota `/monitor` listada no output

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/monitor" "app/(app)/AppLayoutClient.tsx"
git commit -m "feat: tela de monitoramento ao vivo das impressoras Bambu"
```

---

## Task 14: Autofill no `ProductionRunBatchForm` (modo Plate)

**Files:**
- Modify: `app/(app)/production/ProductionRunBatchForm.tsx`
- Modify: `actions/productionRuns.ts` (`createPlate` passa a aceitar `printerCaptureId` opcional e vincular)

**Interfaces:**
- Consumes: `getAvailablePrinterCapture` (Task 12), `buildPlateAutofill` (Task 5).

- [ ] **Step 1: Buscar a captura disponível quando `platePrinterId` muda**

Em `app/(app)/production/ProductionRunBatchForm.tsx`, importar `getAvailablePrinterCapture` e `buildPlateAutofill`, adicionar estado e efeito:

```ts
import { getAvailablePrinterCapture } from '@/actions/bambuStatus'
import { buildPlateAutofill } from '@/lib/bambu/autofill'

// ... dentro do componente, perto dos outros useState de plate:
const [availableCapture, setAvailableCapture] = useState<Awaited<ReturnType<typeof getAvailablePrinterCapture>>>(null)

useEffect(() => {
  if (!platePrinterId) { setAvailableCapture(null); return }
  let cancelled = false
  getAvailablePrinterCapture(platePrinterId).then((capture) => { if (!cancelled) setAvailableCapture(capture) })
  return () => { cancelled = true }
}, [platePrinterId])
```

- [ ] **Step 2: Banner + botão "Usar" que aplica `buildPlateAutofill`**

`PlateItemRow` (já existente no componente) guarda tudo como `string` (campos
ligados a `<input>`s) e não tem um `gramsWasted` próprio — o desperdício
mora dentro de cada `filaments[i].gramsWasted`. E o teórico que
`buildPlateAutofill` espera é o total do item (peso por unidade × qtd
planejada), não só o peso por unidade. Adicionar, logo abaixo do seletor
de impressora da Plate no JSX:

```tsx
{availableCapture && (
  <div className="col-span-2 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
    <p>
      Impressão dessa impressora terminou às {new Date(availableCapture.finishedAt).toLocaleTimeString('pt-BR')}, durou{' '}
      {availableCapture.durationHours.toFixed(2)}h
      {availableCapture.gramsUsedTotal !== null && `, ~${availableCapture.gramsUsedTotal.toFixed(1)}g de filamento`}.
    </p>
    <button
      type="button"
      className="mt-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      onClick={() => {
        const autofill = buildPlateAutofill(
          { durationHours: availableCapture.durationHours, gramsUsedTotal: availableCapture.gramsUsedTotal, outcome: availableCapture.outcome },
          plateItems.map((item) => {
            const perUnit = parseFloat(item.filaments[0]?.weightGramsPerUnit ?? '0') || 0
            const qty = parseInt(item.quantityPlanned, 10) || 0
            return { key: item.key, theoreticalGramsUsed: perUnit * qty }
          }),
        )
        setPlateActualPrintTimeHours(autofill.actualPrintTimeHours)
        setPlateItems((rows) =>
          rows.map((row) => {
            const timeWasted = autofill.timeWastedHoursByItem[row.key]
            const gramsWasted = autofill.gramsWastedByItem[row.key]
            return {
              ...row,
              timeWastedHours: timeWasted !== undefined ? String(timeWasted) : row.timeWastedHours,
              // Só aplica no filamento quando o item tem 1 componente só --
              // peça multi-filamento (2+ cores) não tem como saber qual cor
              // consumiu o delta, mesma cautela do caso "vários itens na
              // Plate" (spec §7), então fica de fora do autofill automático.
              filaments:
                gramsWasted !== undefined && row.filaments.length === 1
                  ? [{ ...row.filaments[0], gramsWasted: String(gramsWasted) }]
                  : row.filaments,
            }
          }),
        )
        setUsedCaptureId(availableCapture.id)
      }}
    >
      Usar esses dados
    </button>
  </div>
)}
```

Adicionar os 2 estados novos usados acima (`plateActualPrintTimeHours`, `usedCaptureId`) junto aos outros `useState` de plate já existentes:

```ts
const [plateActualPrintTimeHours, setPlateActualPrintTimeHours] = useState<number | null>(null)
const [usedCaptureId, setUsedCaptureId] = useState<string | null>(null)
```

> Nota: `plateItems`/`filaments`/`gramsWasted`/`timeWastedHours` já existem no componente (usados por `createPlate` hoje) — este step só estende o objeto de estado existente com os valores calculados pelo autofill, sem mudar sua forma.

- [ ] **Step 3: Enviar `printerCaptureId` e `actualPrintTimeHours` no submit**

No handler que monta o `FormData` pra `createPlate` (perto de `fd.set('printerId', platePrinterId)`), adicionar:

```ts
if (usedCaptureId) fd.set('printerCaptureId', usedCaptureId)
if (plateActualPrintTimeHours !== null) fd.set('actualPrintTimeHours', String(plateActualPrintTimeHours))
```

- [ ] **Step 4: `createPlate` grava `actualPrintTimeHours` e vincula a captura**

Em `actions/productionRuns.ts`, na função `createPlate`:

```ts
const printerCaptureId = raw.printerCaptureId ? String(raw.printerCaptureId) : null
const actualPrintTimeHours = raw.actualPrintTimeHours ? Number(raw.actualPrintTimeHours) : null
```

E no `prisma.$transaction`, ajustar a criação da Plate e adicionar o vínculo da captura (só quando `printerCaptureId` foi enviado):

```ts
await prisma.$transaction([
  prisma.plate.create({
    data: { id: plateId, date: parsed.data.date, printerId: parsed.data.printerId, notes: parsed.data.notes, actualPrintTimeHours },
  }),
  ...allOps,
  ...(printerCaptureId ? [prisma.printerCapture.update({ where: { id: printerCaptureId }, data: { linkedPlateId: plateId } })] : []),
])
```

- [ ] **Step 5: Verificar tipos e lint**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: sem erros novos

Run: `npm run lint`
Expected: sem erros novos

- [ ] **Step 6: Rodar toda a suíte unitária**

Run: `npx vitest run tests/unit`
Expected: PASS — todos os testes das Tasks 2-5 continuam passando, nenhuma regressão

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/production/ProductionRunBatchForm.tsx" actions/productionRuns.ts
git commit -m "feat: autofill de tempo/filamento real ao registrar Plate"
```

---

## Task 15: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Typecheck completo**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes em `tests/integration/accessories.test.ts`, nada novo

- [ ] **Step 2: Lint completo**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 3: Testes unitários completos**

Run: `npx vitest run tests/unit`
Expected: PASS — inclui todos os testes novos das Tasks 2, 3, 4, 5, 9

- [ ] **Step 4: Build de produção**

Run: `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`
Expected: build conclui sem erro, rotas `/monitor` e `/settings` listadas

- [ ] **Step 5: Validação manual documentada como pendente**

Registrar explicitamente (não é um step automatizável): login real na conta Bambu (Task 6/7), conexão MQTT real com a A1 mini do usuário (Task 9), e o fluxo ponta-a-ponta do autofill (Task 14) precisam de verificação manual contra hardware real antes de considerar a feature pronta pra uso — nenhum teste automatizado desta suíte cobre a nuvem Bambu de verdade (spec §9).

- [ ] **Step 6: Commit final (se houver ajustes desta verificação)**

```bash
git add -A
git commit -m "chore: ajustes finais de verificação da integração Bambu Lab"
```

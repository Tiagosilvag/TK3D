# Integração Anycubic Cloud (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitoramento ao vivo, captura de tempo/filamento e autofill no Registrar Produção pra uma impressora Anycubic (linha Kobra), via Cloud MQTT, espelhando a integração Bambu Lab já existente.

**Architecture:** Módulo novo `lib/anycubic/*` em camadas (assinatura HTTP pura → cripto MQTT pura → cliente HTTP → parser pura → job tracker pura → listener com núcleo testável + casca real), seguindo exatamente a separação já usada em `lib/bambu/*`. `PrinterCapture` e o autofill do Registrar Produção não mudam — já são agnósticos de marca.

**Tech Stack:** Next.js/Prisma/TypeScript já em uso. Sem dependência nova (`mqtt` e `node:crypto` já disponíveis — `mqtt` já foi adicionado pra Bambu).

**Spec:** `docs/superpowers/specs/2026-09-12-integracao-anycubic-cloud-design.md`

## Global Constraints

- Sem dependências novas no `package.json` (usar só `node:crypto`, `mqtt` já instalado).
- Toda migration do Prisma é SQL escrito à mão em `prisma/migrations/<timestamp>_nome/migration.sql`, sem `prisma migrate dev` (sem banco vivo neste sandbox).
- Verificação antes de cada commit: `DATABASE_URL="x" npx tsc --noEmit` (ignorar os 2 erros pré-existentes em `tests/integration/accessories.test.ts`), `npm run lint`, `npx vitest run tests/unit`, `DATABASE_URL="postgresql://user:pass@localhost:5432/db" npm run build`.
- Nunca commitar/dar deploy direto — mas nesta sessão o usuário pediu pra trabalhar direto na branch `main` (sem branch de feature), então cada task commita direto em `main`.
- `ActionResult = { success: boolean; error?: string }` redefinido localmente em cada `actions/*.ts`, sem tipo compartilhado.
- Padrão `?editId=` não se aplica aqui (sem tela de catálogo nova).

---

## Notas de protocolo (referência rápida pras tasks abaixo)

Toda a superfície da API Anycubic usada aqui foi extraída lendo o código-fonte de `WaresWichall/hass-anycubic_cloud` (engenharia reversa comunitária, sem doc oficial — ver spec §2). Resumo do que cada task vai portar:

- **Base URL HTTP:** `https://cloud-universe.anycubic.com/p/p/workbench/api`
- **Broker MQTT:** `mqtts://mqtt-universe.anycubic.com:8883`
- **Constantes de app (modo Slicer/"pcf", reverse-engineered do JS deles):**
  `APP_ID = 'f9b3528877c94d5c9c5af32245db46ef'`, `APP_SECRET = '0cf75926606049a3937f56b0373b99fb'`, `APP_VERSION = 'V3.0.0'`, `DEVICE_TYPE = 'pcf'`, `AUTH_CN = '1'`.
- **Headers assinados** (toda chamada HTTP, inclusive leitura):
  `Xx-Signature = md5(appId + timestamp + appVersion + appSecret + nonce + appId)`, mais `Xx-Device-Type`, `Xx-Is-Cn`, `Xx-Nonce`, `Xx-Timestamp`, `Xx-Version`, `Content-Type: application/json`, `XX-LANGUAGE: US`, e `XX-Token` (só depois de autenticado).
- **MQTT username** = `"user|pcf|{email}|{sigMd5}"` onde `sigMd5 = md5(clientId + mqttToken + clientId)`, `clientId = md5(email + "pcf")`.
- **MQTT password** = `mqttToken` = base64(RSA-PKCS1v15-encrypt(authToken, chave pública extraída do certificado CA)).
- **mTLS:** certificado+chave cliente fixos (públicos, extraídos por engenharia reversa, comitados em `lib/anycubic/certs/`).
- **Tópicos MQTT:** prefixo `anycubic/anycubicCloud/v1`. Assina em `.../printer/app/{machineType}/{key}/#` (status da impressora).

---

### Task 1: Extrair `lib/crypto.ts` compartilhado (AES-256-GCM genérico)

`lib/bambu/crypto.ts` não tem nada de Bambu-específico por dentro — vira `lib/crypto.ts`, usado tanto por `lib/bambu/*` quanto pelo módulo Anycubic novo. Puramente mecânico (mover conteúdo, atualizar imports).

**Files:**
- Create: `lib/crypto.ts`
- Delete: `lib/bambu/crypto.ts`
- Modify: `lib/bambu/listener.ts`, `actions/bambuStatus.ts`, `actions/bambuAuth.ts`
- Test: mover `tests/unit/bambuCrypto.test.ts` → `tests/unit/crypto.test.ts`

**Interfaces:**
- Produces: `encryptCredential(plaintext: string): string`, `decryptCredential(stored: string): string` (mesma assinatura de antes, só muda o import path pra `@/lib/crypto`).

- [ ] **Step 1: Criar `lib/crypto.ts` com o conteúdo atual de `lib/bambu/crypto.ts`**

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

// Formato armazenado: base64(iv):base64(authTag):base64(ciphertext). Chave
// compartilhada entre Bambu e Anycubic (BAMBU_CREDENTIAL_KEY guarda
// "credenciais de impressora" de forma genérica, apesar do nome histórico
// -- sem env var nova, ver spec da integração Anycubic §5).
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

- [ ] **Step 2: Mover o teste**

```bash
git mv tests/unit/bambuCrypto.test.ts tests/unit/crypto.test.ts
```

Editar o import no topo do arquivo movido de `'@/lib/bambu/crypto'` para `'@/lib/crypto'`.

- [ ] **Step 3: Apagar `lib/bambu/crypto.ts` e atualizar os 3 importadores**

```bash
git rm lib/bambu/crypto.ts
```

Em `lib/bambu/listener.ts`, `actions/bambuStatus.ts`, `actions/bambuAuth.ts`: trocar
`import { decryptCredential } from '@/lib/bambu/crypto'` (ou `encryptCredential`) por
`import { decryptCredential } from '@/lib/crypto'` (mesmo nome importado, só o path muda).

- [ ] **Step 4: Rodar os testes pra confirmar que nada quebrou**

Run: `npx vitest run tests/unit/crypto.test.ts`
Expected: PASS (os mesmos testes de antes, só no arquivo novo)

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes em `tests/integration/accessories.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/crypto.ts actions/bambuStatus.ts actions/bambuAuth.ts lib/bambu/listener.ts tests/unit/crypto.test.ts
git commit -m "refactor: extrai lib/crypto.ts genérico (era lib/bambu/crypto.ts)

Preparação pra integração Anycubic (spec 2026-09-12) reaproveitar a mesma
cifra AES-256-GCM sem duplicar código -- o módulo nunca foi específico
de Bambu por dentro, só o nome do arquivo sugeria isso.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Schema Prisma + migration

**Files:**
- Modify: `prisma/schema.prisma` (model `Printer` linha ~113, model `Settings` linha ~70)
- Create: `prisma/migrations/20260912120000_anycubic_integration/migration.sql`

**Interfaces:**
- Produces: `Printer.anycubicEnabled: boolean`, `Printer.anycubicPrinterKey: string | null`, `Settings.anycubicAuthTokenEncrypted: string | null`, `Settings.anycubicUserEmail: string | null`, `Settings.anycubicUserId: string | null` — usados por todas as tasks seguintes.

- [ ] **Step 1: Editar `model Printer` em `prisma/schema.prisma`**

Logo depois do bloco `bambuEnabled`/`bambuSerial` (linha ~114), adicionar:

```prisma
  // Integração Anycubic Cloud (spec 2026-09-12): mesmo padrão opt-in da
  // Bambu -- anycubicPrinterKey é a "key" que a API da Anycubic usa nos
  // tópicos MQTT (não é um serial no sentido Bambu).
  anycubicEnabled        Boolean         @default(false)
  anycubicPrinterKey     String?
```

- [ ] **Step 2: Editar `model Settings`**

Logo depois de `bambuCloudRegion` (linha ~71), adicionar:

```prisma
  // Integração Anycubic Cloud (spec 2026-09-12): auth_token de sessão
  // trocado a partir do token do Slicer Next colado manualmente pelo
  // usuário (sem login programático -- ver lib/anycubic/auth.ts). Cifrado
  // com a mesma chave AES da Bambu (lib/crypto.ts).
  anycubicAuthTokenEncrypted    String?
  anycubicUserEmail             String?
  anycubicUserId                String?
```

- [ ] **Step 3: Rodar `npx prisma validate` e `npx prisma generate`**

Run: `DATABASE_URL="x" npx prisma validate && DATABASE_URL="x" npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` seguido de geração sem erro

- [ ] **Step 4: Escrever a migration à mão**

```sql
-- prisma/migrations/20260912120000_anycubic_integration/migration.sql
ALTER TABLE "Printer" ADD COLUMN "anycubicEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Printer" ADD COLUMN "anycubicPrinterKey" TEXT;

ALTER TABLE "Settings" ADD COLUMN "anycubicAuthTokenEncrypted" TEXT;
ALTER TABLE "Settings" ADD COLUMN "anycubicUserEmail" TEXT;
ALTER TABLE "Settings" ADD COLUMN "anycubicUserId" TEXT;
```

- [ ] **Step 5: Verificar consistência com `prisma migrate diff` (se disponível) ou revisão manual**

Conferir que os nomes de coluna no SQL batem exatamente com os campos do schema (case-sensitive, PascalCase como as migrations existentes).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260912120000_anycubic_integration/migration.sql
git commit -m "feat: schema da integração Anycubic Cloud (Printer + Settings)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/anycubic/signing.ts` — assinatura HTTP (MD5)

Núcleo puro: monta os headers assinados que TODA chamada HTTP da Anycubic exige (ver "Notas de protocolo" acima). Testável com vetores fixos (nonce/timestamp injetados, não gerados internamente).

**Files:**
- Create: `lib/anycubic/signing.ts`
- Test: `tests/unit/anycubicSigning.test.ts`

**Interfaces:**
- Produces: `buildSignedHeaders(opts: { nonce: string; timestamp: number; authToken?: string }): Record<string, string>` — consumido pela Task 6 (`lib/anycubic/auth.ts`).

- [ ] **Step 1: Escrever o teste com vetor fixo (calculado com `node:crypto` real, não inventado)**

```ts
// tests/unit/anycubicSigning.test.ts
import { describe, it, expect } from 'vitest'
import { buildSignedHeaders } from '@/lib/anycubic/signing'

describe('anycubic buildSignedHeaders', () => {
  it('monta os headers assinados com MD5(appId+timestamp+appVersion+appSecret+nonce+appId)', () => {
    const headers = buildSignedHeaders({ nonce: 'fixed-nonce', timestamp: 1700000000000 })

    expect(headers['Xx-Signature']).toBe('9f2b6d7e6c6b6a6a6a6a6a6a6a6a6a6a') // placeholder -- substituído no Step 2
  })
})
```

- [ ] **Step 2: Calcular o vetor real com `node -e` e corrigir o teste**

Run:
```bash
node -e "
const crypto = require('crypto');
const appId = 'f9b3528877c94d5c9c5af32245db46ef';
const appSecret = '0cf75926606049a3937f56b0373b99fb';
const appVersion = 'V3.0.0';
const nonce = 'fixed-nonce';
const timestamp = 1700000000000;
const sigInput = appId + timestamp + appVersion + appSecret + nonce + appId;
console.log(crypto.createHash('md5').update(sigInput, 'utf8').digest('hex'));
"
```

Substituir o valor `9f2b6d7e6c6b6a6a6a6a6a6a6a6a6a6a` pelo hash real impresso, e completar o teste checando os outros headers:

```ts
import { describe, it, expect } from 'vitest'
import { buildSignedHeaders } from '@/lib/anycubic/signing'

describe('anycubic buildSignedHeaders', () => {
  it('monta os headers assinados com MD5(appId+timestamp+appVersion+appSecret+nonce+appId)', () => {
    const headers = buildSignedHeaders({ nonce: 'fixed-nonce', timestamp: 1700000000000 })

    expect(headers['Xx-Signature']).toBe('<HASH_REAL_DO_STEP_2>')
    expect(headers['Xx-Device-Type']).toBe('pcf')
    expect(headers['Xx-Is-Cn']).toBe('1')
    expect(headers['Xx-Nonce']).toBe('fixed-nonce')
    expect(headers['Xx-Timestamp']).toBe('1700000000000')
    expect(headers['Xx-Version']).toBe('V3.0.0')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['XX-LANGUAGE']).toBe('US')
    expect(headers['XX-Token']).toBeUndefined()
  })

  it('inclui XX-Token quando authToken é passado', () => {
    const headers = buildSignedHeaders({ nonce: 'fixed-nonce', timestamp: 1700000000000, authToken: 'session-token-abc' })
    expect(headers['XX-Token']).toBe('session-token-abc')
  })
})
```

- [ ] **Step 3: Rodar o teste e confirmar que falha (função ainda não existe)**

Run: `npx vitest run tests/unit/anycubicSigning.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/signing'"

- [ ] **Step 4: Implementar `lib/anycubic/signing.ts`**

```ts
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'

// Constantes extraídas por engenharia reversa do JS/app da Anycubic (ver
// spec 2026-09-12 §2.1) -- não são credenciais do usuário. Modo "Slicer"
// (device_type 'pcf'), único suportado nesta fase. Podem quebrar sem
// aviso se a Anycubic atualizar o app/site (risco documentado na spec).
const APP_ID = 'f9b3528877c94d5c9c5af32245db46ef'
const APP_SECRET = '0cf75926606049a3937f56b0373b99fb'
const APP_VERSION = 'V3.0.0'
const DEVICE_TYPE = 'pcf'
const AUTH_CN = '1'

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

export function buildSignedHeaders(opts: { nonce: string; timestamp: number; authToken?: string }): Record<string, string> {
  const sigInput = `${APP_ID}${opts.timestamp}${APP_VERSION}${APP_SECRET}${opts.nonce}${APP_ID}`
  const headers: Record<string, string> = {
    'Xx-Device-Type': DEVICE_TYPE,
    'Xx-Is-Cn': AUTH_CN,
    'Xx-Nonce': opts.nonce,
    'Xx-Signature': md5Hex(sigInput),
    'Xx-Timestamp': String(opts.timestamp),
    'Xx-Version': APP_VERSION,
    'Content-Type': 'application/json',
    'XX-LANGUAGE': 'US',
  }
  if (opts.authToken) headers['XX-Token'] = opts.authToken
  return headers
}

// Gera nonce/timestamp reais -- separado de buildSignedHeaders pra manter
// a função de assinatura pura/determinística e testável.
export function buildSignedHeadersNow(authToken?: string): Record<string, string> {
  return buildSignedHeaders({ nonce: randomUUID(), timestamp: Date.now(), authToken })
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/anycubicSigning.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add lib/anycubic/signing.ts tests/unit/anycubicSigning.test.ts
git commit -m "feat: assinatura HTTP da Anycubic Cloud (lib/anycubic/signing.ts)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Certificados TLS estáticos + `lib/anycubic/mqttCrypto.ts`

Certificado/chave cliente fixos (públicos, extraídos por engenharia reversa — ver spec §2.1) e a criptografia da senha MQTT (RSA com a chave pública da CA deles).

**Files:**
- Create: `lib/anycubic/certs/anycubic_mqtt_ca.crt`
- Create: `lib/anycubic/certs/anycubic_mqtt_client.crt`
- Create: `lib/anycubic/certs/anycubic_mqtt_client.key`
- Create: `lib/anycubic/mqttCrypto.ts`
- Test: `tests/unit/anycubicMqttCrypto.test.ts`

**Interfaces:**
- Produces: `encryptMqttToken(authToken: string): string`, `buildMqttClientId(email: string): string`, `buildMqttUsername(email: string, encryptedToken: string): string` — consumidos pela Task 9 (`lib/anycubic/listener.ts`).

- [ ] **Step 1: Criar os 3 arquivos de certificado**

Copiar o conteúdo exato de `custom_components/anycubic_cloud/anycubic_cloud_api/resources/anycubic_mqqt_tls_ca.crt`, `anycubic_mqqt_tls_client.crt` e `anycubic_mqqt_tls_client.key` do repositório `WaresWichall/hass-anycubic_cloud` (branch `master`) pros 3 arquivos acima (PEM padrão, ~20-30 linhas cada, começando com `-----BEGIN CERTIFICATE-----`/`-----BEGIN PRIVATE KEY-----`). São arquivos públicos do protocolo, não segredos do usuário.

```bash
curl -sL https://raw.githubusercontent.com/WaresWichall/hass-anycubic_cloud/master/custom_components/anycubic_cloud/anycubic_cloud_api/resources/anycubic_mqqt_tls_ca.crt -o lib/anycubic/certs/anycubic_mqtt_ca.crt
curl -sL https://raw.githubusercontent.com/WaresWichall/hass-anycubic_cloud/master/custom_components/anycubic_cloud/anycubic_cloud_api/resources/anycubic_mqqt_tls_client.crt -o lib/anycubic/certs/anycubic_mqtt_client.crt
curl -sL https://raw.githubusercontent.com/WaresWichall/hass-anycubic_cloud/master/custom_components/anycubic_cloud/anycubic_cloud_api/resources/anycubic_mqqt_tls_client.key -o lib/anycubic/certs/anycubic_mqtt_client.key
```

Conferir que cada arquivo baixado começa com `-----BEGIN CERTIFICATE-----` (os dois `.crt`) ou `-----BEGIN PRIVATE KEY-----` (o `.key`) antes de seguir.

- [ ] **Step 2: Escrever o teste de round-trip RSA (chave de teste local, não a CA real)**

```ts
// tests/unit/anycubicMqttCrypto.test.ts
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, privateDecrypt, constants } from 'crypto'
import { encryptMqttTokenWithKey, buildMqttClientId, buildMqttUsername } from '@/lib/anycubic/mqttCrypto'

describe('anycubic mqttCrypto', () => {
  it('encryptMqttTokenWithKey criptografa e o resultado decripta de volta pro token original (round-trip com par de chaves de teste)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

    const encryptedB64 = encryptMqttTokenWithKey('meu-token-secreto', publicKey)
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(encryptedB64, 'base64'),
    )

    expect(decrypted.toString('utf8')).toBe('meu-token-secreto')
  })

  it('buildMqttClientId é o MD5 de email+"pcf"', () => {
    // vetor calculado com node:crypto real -- ver Task 4 Step 3 do plano
    expect(buildMqttClientId('user@example.com')).toBe('6254e84c68ff0b1678ea4530a2be15e7')
  })

  it('buildMqttUsername monta "user|pcf|{email}|{sigMd5}"', () => {
    const username = buildMqttUsername('user@example.com', 'FAKE_ENCRYPTED_TOKEN_BASE64')
    expect(username).toBe('user|pcf|user@example.com|6da79c9ec9cd72b81aa5ddf559fce998')
  })
})
```

- [ ] **Step 2b: Confirmar os vetores fixos com `node -e` (já calculados, só documentando a fonte)**

Run:
```bash
node -e "
const crypto = require('crypto');
console.log('clientId:', crypto.createHash('md5').update('user@example.com'+'pcf','utf8').digest('hex'));
const clientId = crypto.createHash('md5').update('user@example.com'+'pcf','utf8').digest('hex');
const sandwich = clientId + 'FAKE_ENCRYPTED_TOKEN_BASE64' + clientId;
console.log('sigMd5:', crypto.createHash('md5').update(sandwich,'utf8').digest('hex'));
"
```
Expected: `clientId: 6254e84c68ff0b1678ea4530a2be15e7`, `sigMd5: 6da79c9ec9cd72b81aa5ddf559fce998` (os mesmos valores já usados no teste acima).

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/anycubicMqttCrypto.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/mqttCrypto'"

- [ ] **Step 4: Implementar `lib/anycubic/mqttCrypto.ts`**

```ts
import { createHash, createPublicKey, publicEncrypt, constants, type KeyLike } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

// Separado de encryptMqttToken pra ser testável com uma chave de teste
// (a CA real da Anycubic não precisa entrar no teste unitário).
export function encryptMqttTokenWithKey(authToken: string, publicKey: KeyLike): string {
  const encrypted = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(authToken, 'utf8'),
  )
  return encrypted.toString('base64')
}

let cachedCaPublicKey: KeyLike | null = null

function loadCaPublicKey(): KeyLike {
  if (cachedCaPublicKey) return cachedCaPublicKey
  const caCertPem = readFileSync(join(__dirname, 'certs', 'anycubic_mqtt_ca.crt'), 'utf8')
  cachedCaPublicKey = createPublicKey(caCertPem)
  return cachedCaPublicKey
}

// Senha da sessão MQTT (modo Slicer/"pcf"): o auth_token criptografado com
// RSA-PKCS1v15 usando a chave pública extraída do certificado CA da
// Anycubic (arquivo público, ver certs/anycubic_mqtt_ca.crt).
export function encryptMqttToken(authToken: string): string {
  return encryptMqttTokenWithKey(authToken, loadCaPublicKey())
}

export function buildMqttClientId(email: string): string {
  return md5Hex(email + 'pcf')
}

// Username MQTT: "user|pcf|{email}|{sigMd5}", sigMd5 = md5(clientId + mqttToken + clientId)
// -- "sandwich" de client id em volta do token criptografado, formato exigido
// pelo broker deles (ver lib/anycubic/mqttCrypto do projeto de referência).
export function buildMqttUsername(email: string, encryptedToken: string): string {
  const clientId = buildMqttClientId(email)
  const sigMd5 = md5Hex(clientId + encryptedToken + clientId)
  return `user|pcf|${email}|${sigMd5}`
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/anycubicMqttCrypto.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add lib/anycubic/certs lib/anycubic/mqttCrypto.ts tests/unit/anycubicMqttCrypto.test.ts
git commit -m "feat: certificados TLS + cripto MQTT da Anycubic Cloud

Certificado/chave cliente públicos extraídos por engenharia reversa
comunitária (não são segredo do usuário, ver spec §2.1). Senha da sessão
MQTT é o auth_token criptografado com RSA usando a chave pública do
certificado CA.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `lib/anycubic/parser.ts` — payload MQTT → status normalizado

Núcleo puro: cada mensagem MQTT da Anycubic só carrega um pedaço do estado (diferente da Bambu, que manda o "report" quase inteiro a cada tick) — por isso o parser devolve um PATCH parcial pra mesclar no estado acumulado, não um objeto completo.

**Files:**
- Create: `lib/anycubic/parser.ts`
- Test: `tests/unit/anycubicParser.test.ts`

**Interfaces:**
- Produces: `type AnycubicStatus`, `INITIAL_ANYCUBIC_STATUS: AnycubicStatus`, `parseAnycubicPayload(raw: unknown): AnycubicMqttMessage | null`, `buildStatusPatch(msg: AnycubicMqttMessage): Partial<AnycubicStatus>`, `applyStatusPatch(prev: AnycubicStatus, patch: Partial<AnycubicStatus>): AnycubicStatus` — consumidos pela Task 7 (jobTracker) e Task 8 (listener).

- [ ] **Step 1: Escrever os testes**

```ts
// tests/unit/anycubicParser.test.ts
import { describe, it, expect } from 'vitest'
import { parseAnycubicPayload, buildStatusPatch, applyStatusPatch, INITIAL_ANYCUBIC_STATUS } from '@/lib/anycubic/parser'

describe('anycubic parser', () => {
  it('parseAnycubicPayload aceita um payload válido com type/action/state/data', () => {
    const msg = parseAnycubicPayload({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })
    expect(msg).toEqual({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })
  })

  it('parseAnycubicPayload devolve null pra payload sem type/action', () => {
    expect(parseAnycubicPayload({ foo: 'bar' })).toBeNull()
    expect(parseAnycubicPayload(null)).toBeNull()
    expect(parseAnycubicPayload('string')).toBeNull()
  })

  it('buildStatusPatch extrai temperatura de uma mensagem type=tempature', () => {
    const patch = buildStatusPatch({
      type: 'tempature',
      action: 'auto',
      state: 'done',
      data: { curr_hotbed_temp: 58, curr_nozzle_temp: 210 },
    })
    expect(patch).toEqual({ bedTemp: 58, nozzleTemp: 210 })
  })

  it('buildStatusPatch extrai fan speed de uma mensagem type=fan', () => {
    const patch = buildStatusPatch({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 75 } })
    expect(patch).toEqual({ fanSpeedPercent: 75 })
  })

  it('buildStatusPatch mapeia início de impressão (type=print, action=start, state=printing) pro estado PRINTING com progresso/camada/arquivo', () => {
    const patch = buildStatusPatch({
      type: 'print',
      action: 'start',
      state: 'printing',
      data: { curr_layer: 12, total_layers: 200, filename: 'peca.gcode', progress: 6, remain_time: 118, print_time: 320 },
    })
    expect(patch).toEqual({
      printState: 'PRINTING',
      currentLayer: 12,
      totalLayers: 200,
      gcodeFile: 'peca.gcode',
      progressPercent: 6,
      remainingMinutes: 118,
      printTimeSeconds: 320,
    })
  })

  it('buildStatusPatch mapeia pausa (action=pause, state=paused) pro estado PAUSED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'pause', state: 'paused', data: {} })
    expect(patch.printState).toBe('PAUSED')
  })

  it('buildStatusPatch mapeia fim com sucesso (action=start, state=finished) pro estado FINISHED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'finished', data: { supplies_usage: 24 } })
    expect(patch.printState).toBe('FINISHED')
    expect(patch.suppliesUsage).toBe(24)
  })

  it('buildStatusPatch mapeia cancelamento (action=stop, state=stoped) pro estado CANCELLED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'stop', state: 'stoped', data: {} })
    expect(patch.printState).toBe('CANCELLED')
  })

  it('buildStatusPatch mapeia falha (action=start, state=failed) pro estado CANCELLED (Anycubic não distingue falha de cancelamento neste stream)', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'failed', data: {} })
    expect(patch.printState).toBe('CANCELLED')
  })

  it('buildStatusPatch devolve objeto vazio pra tipo de mensagem não tratado (ex.: multiColorBox)', () => {
    expect(buildStatusPatch({ type: 'multiColorBox', action: 'x', state: 'y', data: {} })).toEqual({})
  })

  it('applyStatusPatch mescla só os campos presentes no patch, preservando o resto', () => {
    const prev = { ...INITIAL_ANYCUBIC_STATUS, nozzleTemp: 200, bedTemp: 55 }
    const next = applyStatusPatch(prev, { fanSpeedPercent: 90 })
    expect(next.fanSpeedPercent).toBe(90)
    expect(next.nozzleTemp).toBe(200)
    expect(next.bedTemp).toBe(55)
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/anycubicParser.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/parser'"

- [ ] **Step 3: Implementar `lib/anycubic/parser.ts`**

```ts
// Cada mensagem MQTT da Anycubic carrega só um pedaço do estado (ex.: uma
// mensagem type=fan só fala de ventoinha) -- diferente da Bambu, que manda
// o "report" quase inteiro a cada tick. Por isso o parser devolve um PATCH
// parcial pra mesclar no estado acumulado (ver applyStatusPatch), não um
// objeto completo. Mapeamento de campos vem da leitura do código-fonte do
// projeto de referência (ver spec §2.2) -- unidades de remain_time/
// print_time/supplies_usage não confirmadas contra uma conta real ainda
// (mesma ressalva que a Bambu teve pro peso, resolvida com teste ao vivo).
export type AnycubicPrintState = 'IDLE' | 'DOWNLOADING' | 'CHECKING' | 'PREHEATING' | 'PRINTING' | 'PAUSED' | 'FINISHED' | 'CANCELLED'

export type AnycubicStatus = {
  printState: AnycubicPrintState
  progressPercent: number | null
  remainingMinutes: number | null
  currentLayer: number | null
  totalLayers: number | null
  gcodeFile: string | null
  printTimeSeconds: number | null
  nozzleTemp: number | null
  bedTemp: number | null
  fanSpeedPercent: number | null
  suppliesUsage: number | null
}

export const INITIAL_ANYCUBIC_STATUS: AnycubicStatus = {
  printState: 'IDLE',
  progressPercent: null,
  remainingMinutes: null,
  currentLayer: null,
  totalLayers: null,
  gcodeFile: null,
  printTimeSeconds: null,
  nozzleTemp: null,
  bedTemp: null,
  fanSpeedPercent: null,
  suppliesUsage: null,
}

export type AnycubicMqttMessage = {
  type: string
  action: string
  state?: string
  data?: Record<string, unknown>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAnycubicPayload(raw: unknown): AnycubicMqttMessage | null {
  if (!isPlainRecord(raw)) return null
  const { type, action, state, data } = raw
  if (typeof type !== 'string' || typeof action !== 'string') return null
  return {
    type,
    action,
    state: typeof state === 'string' ? state : undefined,
    data: isPlainRecord(data) ? data : undefined,
  }
}

function numIfPresent(data: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!data || !(key in data)) return undefined
  const v = data[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return undefined
}

function strIfPresent(data: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!data || !(key in data)) return undefined
  const v = data[key]
  return typeof v === 'string' ? v : undefined
}

// Estado terminal "failed" não existe como valor próprio no stream da
// Anycubic -- a impressora manda action=start/state=failed, que a própria
// lib de referência trata como Cancelled (com uma mensagem de erro à
// parte). Sem HMS/código de falha equivalente ao da Bambu nesta fase.
const PRINT_STATE_BY_ACTION_STATE: Record<string, AnycubicPrintState> = {
  'start:downloading': 'DOWNLOADING',
  'start:checking': 'CHECKING',
  'start:preheating': 'PREHEATING',
  'start:printing': 'PRINTING',
  'start:finished': 'FINISHED',
  'start:failed': 'CANCELLED',
  'pause:pausing': 'PAUSED',
  'pause:paused': 'PAUSED',
  'resume:resuming': 'PRINTING',
  'resume:resumed': 'PRINTING',
  'start:stoped': 'CANCELLED',
  'start:stopping': 'CANCELLED',
  'stop:stoped': 'CANCELLED',
  'stop:stopping': 'CANCELLED',
  'stop:failed': 'CANCELLED',
}

export function buildStatusPatch(msg: AnycubicMqttMessage): Partial<AnycubicStatus> {
  const patch: Partial<AnycubicStatus> = {}

  if (msg.type === 'tempature' && msg.action === 'auto' && msg.state === 'done') {
    const bed = numIfPresent(msg.data, 'curr_hotbed_temp')
    const nozzle = numIfPresent(msg.data, 'curr_nozzle_temp')
    if (bed !== undefined) patch.bedTemp = bed
    if (nozzle !== undefined) patch.nozzleTemp = nozzle
    return patch
  }

  if (msg.type === 'fan' && msg.action === 'auto' && msg.state === 'done') {
    const fan = numIfPresent(msg.data, 'fan_speed_pct')
    if (fan !== undefined) patch.fanSpeedPercent = fan
    return patch
  }

  if (msg.type === 'print') {
    const printState = PRINT_STATE_BY_ACTION_STATE[`${msg.action}:${msg.state}`]
    if (printState) patch.printState = printState

    const layer = numIfPresent(msg.data, 'curr_layer')
    if (layer !== undefined) patch.currentLayer = layer
    const totalLayers = numIfPresent(msg.data, 'total_layers')
    if (totalLayers !== undefined) patch.totalLayers = totalLayers
    const filename = strIfPresent(msg.data, 'filename')
    if (filename !== undefined) patch.gcodeFile = filename
    const printTime = numIfPresent(msg.data, 'print_time')
    if (printTime !== undefined) patch.printTimeSeconds = printTime
    const progress = numIfPresent(msg.data, 'progress')
    if (progress !== undefined) patch.progressPercent = progress
    const remainTime = numIfPresent(msg.data, 'remain_time')
    if (remainTime !== undefined) patch.remainingMinutes = remainTime
    const supplies = numIfPresent(msg.data, 'supplies_usage')
    if (supplies !== undefined) patch.suppliesUsage = supplies

    return patch
  }

  return patch
}

export function applyStatusPatch(prev: AnycubicStatus, patch: Partial<AnycubicStatus>): AnycubicStatus {
  const next = { ...prev }
  for (const key of Object.keys(patch) as (keyof AnycubicStatus)[]) {
    const value = patch[key]
    if (value !== undefined) (next[key] as unknown) = value
  }
  return next
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/anycubicParser.test.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/anycubic/parser.ts tests/unit/anycubicParser.test.ts
git commit -m "feat: parser dos payloads MQTT da Anycubic Cloud

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `lib/anycubic/jobTracker.ts` — debounce de fim de job

Mesmo state machine da Bambu (`lib/bambu/jobTracker.ts`), duplicado (não abstraído) pra manter os módulos desacoplados, adaptado ao `AnycubicStatus`/`AnycubicPrintState` da Task 5.

**Files:**
- Create: `lib/anycubic/jobTracker.ts`
- Test: `tests/unit/anycubicJobTracker.test.ts`

**Interfaces:**
- Consumes: `AnycubicStatus`, `AnycubicPrintState` de `@/lib/anycubic/parser`
- Produces: `type AnycubicCaptureDraft`, `createAnycubicJobTracker(): { handleStatus(status: AnycubicStatus, now: Date): AnycubicCaptureDraft | null }` — consumido pela Task 8 (`lib/anycubic/listener.ts`).

- [ ] **Step 1: Escrever os testes (espelhando `tests/unit/bambuJobTracker.test.ts`)**

```ts
// tests/unit/anycubicJobTracker.test.ts
import { describe, it, expect } from 'vitest'
import { createAnycubicJobTracker } from '@/lib/anycubic/jobTracker'
import { INITIAL_ANYCUBIC_STATUS, type AnycubicStatus } from '@/lib/anycubic/parser'

function status(overrides: Partial<AnycubicStatus>): AnycubicStatus {
  return { ...INITIAL_ANYCUBIC_STATUS, ...overrides }
}

describe('createAnycubicJobTracker', () => {
  it('não gera captura enquanto só recebe leituras IDLE', () => {
    const tracker = createAnycubicJobTracker()
    expect(tracker.handleStatus(status({ printState: 'IDLE' }), new Date())).toBeNull()
  })

  it('inicia um job na primeira leitura PRINTING e não gera captura até terminar', () => {
    const tracker = createAnycubicJobTracker()
    const t0 = new Date('2026-09-12T10:00:00Z')
    expect(tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), t0)).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), new Date('2026-09-12T10:05:00Z'))).toBeNull()
  })

  it('exige 2 leituras terminais iguais seguidas antes de confirmar FINISHED', () => {
    const tracker = createAnycubicJobTracker()
    const t0 = new Date('2026-09-12T10:00:00Z')
    tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), t0)

    const t1 = new Date('2026-09-12T11:00:00Z')
    expect(tracker.handleStatus(status({ printState: 'FINISHED' }), t1)).toBeNull()

    const t2 = new Date('2026-09-12T11:00:10Z')
    const capture = tracker.handleStatus(status({ printState: 'FINISHED' }), t2)
    expect(capture).not.toBeNull()
    expect(capture?.outcome).toBe('FINISHED')
    expect(capture?.startedAt).toEqual(t0)
    expect(capture?.finishedAt).toEqual(t1)
    expect(capture?.durationHours).toBeCloseTo(1, 5)
    expect(capture?.gcodeFileName).toBe('peca.gcode')
  })

  it('reinicia a contagem se o estado terminal mudar no meio (ex.: FINISHED depois CANCELLED)', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    expect(tracker.handleStatus(status({ printState: 'FINISHED' }), new Date('2026-09-12T11:00:00Z'))).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'CANCELLED' }), new Date('2026-09-12T11:00:05Z'))).toBeNull()
    const capture = tracker.handleStatus(status({ printState: 'CANCELLED' }), new Date('2026-09-12T11:00:10Z'))
    expect(capture?.outcome).toBe('CANCELLED')
  })

  it('mapeia CANCELLED pra outcome CANCELLED e usa supplies_usage como gramsUsedTotal quando presente', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    tracker.handleStatus(status({ printState: 'FINISHED', suppliesUsage: 18.5 }), new Date('2026-09-12T11:00:00Z'))
    const capture = tracker.handleStatus(status({ printState: 'FINISHED', suppliesUsage: 18.5 }), new Date('2026-09-12T11:00:10Z'))
    expect(capture?.gramsUsedTotal).toBe(18.5)
  })

  it('volta a PRINTING antes da confirmação cancela a pendência sem gerar captura', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    expect(tracker.handleStatus(status({ printState: 'PAUSED' }), new Date('2026-09-12T10:30:00Z'))).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:31:00Z'))).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/anycubicJobTracker.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/jobTracker'"

- [ ] **Step 3: Implementar `lib/anycubic/jobTracker.ts`**

```ts
import type { AnycubicStatus } from './parser'

export type AnycubicCaptureOutcome = 'FINISHED' | 'CANCELLED' | 'UNKNOWN'

export type AnycubicCaptureDraft = {
  startedAt: Date
  finishedAt: Date
  durationHours: number
  gcodeFileName: string | null
  gramsUsedTotal: number | null
  outcome: AnycubicCaptureOutcome
}

type RunningJob = { startedAt: Date; gcodeFile: string | null }
type PendingTermination = { printState: string; firstSeenAt: Date; suppliesUsage: number | null }

function mapOutcome(printState: string): AnycubicCaptureOutcome {
  if (printState === 'FINISHED') return 'FINISHED'
  if (printState === 'CANCELLED') return 'CANCELLED'
  return 'UNKNOWN'
}

const RUNNING_STATES = new Set(['PRINTING'])
// PAUSED não é terminal nem "em andamento" pro tracker -- volta a PRINTING
// ou vira terminal depois, mas por si só não fecha nem reinicia o job.
const TERMINAL_STATES = new Set(['FINISHED', 'CANCELLED', 'IDLE'])

// Mesmo debounce de 2 leituras terminais seguidas do lib/bambu/jobTracker.ts
// (duplicado de propósito, ver plano Task 6) -- protege contra ruído de
// rede/report sem inventar um mecanismo novo.
export function createAnycubicJobTracker() {
  let current: RunningJob | null = null
  let pending: PendingTermination | null = null

  function handleStatus(status: AnycubicStatus, now: Date): AnycubicCaptureDraft | null {
    const isRunning = RUNNING_STATES.has(status.printState)

    if (isRunning) {
      pending = null
      if (!current) current = { startedAt: now, gcodeFile: status.gcodeFile }
      return null
    }

    if (!current) {
      pending = null
      return null
    }

    if (!TERMINAL_STATES.has(status.printState)) return null

    if (!pending || pending.printState !== status.printState) {
      pending = { printState: status.printState, firstSeenAt: now, suppliesUsage: status.suppliesUsage }
      return null
    }

    const job = current
    const finishedAt = pending.firstSeenAt
    const suppliesUsage = pending.suppliesUsage
    current = null
    pending = null

    const durationHours = (finishedAt.getTime() - job.startedAt.getTime()) / 3_600_000

    return {
      startedAt: job.startedAt,
      finishedAt,
      durationHours,
      gcodeFileName: job.gcodeFile,
      gramsUsedTotal: suppliesUsage,
      outcome: mapOutcome(status.printState),
    }
  }

  return { handleStatus }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/anycubicJobTracker.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/anycubic/jobTracker.ts tests/unit/anycubicJobTracker.test.ts
git commit -m "feat: job tracker (debounce de fim de job) da Anycubic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `lib/anycubic/auth.ts` — login por token colado + listagem de impressoras

**Files:**
- Create: `lib/anycubic/auth.ts`
- Test: `tests/unit/anycubicAuth.test.ts`

**Interfaces:**
- Consumes: `buildSignedHeadersNow` de `@/lib/anycubic/signing`
- Produces: `exchangeSlicerToken(pastedToken: string): Promise<{ authToken: string }>`, `fetchUserInfo(authToken: string): Promise<{ id: string; email: string }>`, `type AnycubicPrinterRef = { key: string; name: string }`, `fetchMyPrinters(authToken: string): Promise<AnycubicPrinterRef[]>` — consumidos pelas Tasks 9 (listener) e 10 (actions).

- [ ] **Step 1: Escrever os testes (mesmo padrão de mock de `global.fetch` do `tests/unit/bambuAuth.test.ts`)**

```ts
// tests/unit/anycubicAuth.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { exchangeSlicerToken, fetchUserInfo, fetchMyPrinters } from '@/lib/anycubic/auth'

describe('anycubic auth client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('exchangeSlicerToken troca o token colado por um auth_token de sessão', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { token: 'session-token-abc' } }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeSlicerToken('slicer-token-xyz')
    expect(result).toEqual({ authToken: 'session-token-abc' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v3/public/loginWithAccessToken')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ device_type: 'pcf', access_token: 'slicer-token-xyz' })
  })

  it('exchangeSlicerToken lança erro se a resposta não tiver data.token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ msg: 'invalid token' }) }) as unknown as typeof fetch
    await expect(exchangeSlicerToken('token-invalido')).rejects.toThrow('Token do Slicer Next inválido ou expirado')
  })

  it('exchangeSlicerToken lança erro em resposta HTTP não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    await expect(exchangeSlicerToken('token')).rejects.toThrow('Falha ao trocar o token do Slicer Next')
  })

  it('fetchUserInfo devolve id e email, enviando XX-Token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 42, user_email: 'user@example.com' } }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const info = await fetchUserInfo('session-token-abc')
    expect(info).toEqual({ id: '42', email: 'user@example.com' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['XX-Token']).toBe('session-token-abc')
  })

  it('fetchMyPrinters lista as impressoras com key e nome', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ key: 'abc123', name: 'Kobra 3' }, { key: 'def456', name: 'Kobra 2' }] }),
    }) as unknown as typeof fetch

    const printers = await fetchMyPrinters('session-token-abc')
    expect(printers).toEqual([{ key: 'abc123', name: 'Kobra 3' }, { key: 'def456', name: 'Kobra 2' }])
  })

  it('fetchMyPrinters ignora entradas sem key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: 'Sem key' }, { key: 'def456', name: 'Kobra 2' }] }),
    }) as unknown as typeof fetch

    const printers = await fetchMyPrinters('session-token-abc')
    expect(printers).toEqual([{ key: 'def456', name: 'Kobra 2' }])
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/anycubicAuth.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/auth'"

- [ ] **Step 3: Implementar `lib/anycubic/auth.ts`**

```ts
// Cliente HTTP da Anycubic Cloud (engenharia reversa comunitária, sem doc
// oficial -- ver spec 2026-09-12 §2). Sem login programático: o usuário
// cola o token extraído manualmente do Anycubic Slicer Next (Windows).
import { buildSignedHeadersNow } from './signing'

const BASE_URL = 'https://cloud-universe.anycubic.com/p/p/workbench/api'

async function signedFetch(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; authToken?: string } = {}) {
  const headers = buildSignedHeadersNow(opts.authToken)
  return fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

export async function exchangeSlicerToken(pastedToken: string): Promise<{ authToken: string }> {
  const res = await signedFetch('/v3/public/loginWithAccessToken', {
    method: 'POST',
    body: { device_type: 'pcf', access_token: pastedToken.trim() },
  })
  if (!res.ok) throw new Error('Falha ao trocar o token do Slicer Next — tente novamente')
  const data = (await res.json()) as { data?: { token?: string } }
  if (!data.data?.token) throw new Error('Token do Slicer Next inválido ou expirado — extraia um novo e cole de novo')
  return { authToken: data.data.token }
}

export async function fetchUserInfo(authToken: string): Promise<{ id: string; email: string }> {
  const res = await signedFetch('/user/profile/userInfo', { authToken })
  if (!res.ok) throw new Error('Falha ao obter dados da conta Anycubic')
  const data = (await res.json()) as { data?: { id?: number | string; user_email?: string } }
  if (data.data?.id === undefined || !data.data.user_email) throw new Error('Anycubic não retornou id/e-mail da conta')
  return { id: String(data.data.id), email: data.data.user_email }
}

export type AnycubicPrinterRef = { key: string; name: string }

// Lista as impressoras vinculadas à conta -- mesmo papel do
// fetchBoundDevices da Bambu, pra escolher a "key" numa lista em vez de
// caçar ela manualmente.
export async function fetchMyPrinters(authToken: string): Promise<AnycubicPrinterRef[]> {
  const res = await signedFetch('/work/printer/getPrinters', { authToken })
  if (!res.ok) throw new Error('Falha ao buscar impressoras da conta Anycubic')
  const data = (await res.json()) as { data?: { key?: string; name?: string }[] }
  return (data.data ?? [])
    .filter((p): p is { key: string; name?: string } => Boolean(p.key))
    .map((p) => ({ key: p.key, name: p.name ?? p.key }))
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/anycubicAuth.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/anycubic/auth.ts tests/unit/anycubicAuth.test.ts
git commit -m "feat: cliente HTTP assinado da Anycubic Cloud (login por token colado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `lib/anycubic/listener.ts` — núcleo puro + casca real MQTT

Mesmo formato do `lib/bambu/listener.ts`: `createListenerCore` puro/testável, casca real (conexão MQTT de verdade) sem teste automatizado.

**Files:**
- Create: `lib/anycubic/listener.ts`
- Test: `tests/unit/anycubicListener.test.ts`

**Interfaces:**
- Consumes: `parseAnycubicPayload`, `buildStatusPatch`, `applyStatusPatch`, `INITIAL_ANYCUBIC_STATUS`, `AnycubicStatus` de `@/lib/anycubic/parser`; `createAnycubicJobTracker`, `AnycubicCaptureDraft` de `@/lib/anycubic/jobTracker`; `encryptMqttToken`, `buildMqttUsername` de `@/lib/anycubic/mqttCrypto`; `decryptCredential` de `@/lib/crypto`
- Produces: `createAnycubicListenerCore(opts): { start(): void; getLiveStatus(printerId: string): AnycubicStatus | null }`, `startAnycubicListener(): Promise<void>`, `restartAnycubicListener(): Promise<void>`, `getAnycubicLiveStatus(printerId: string): AnycubicStatus | null`, `getAnycubicConnectionStatus(): AnycubicConnectionStatus` — consumidos pelas Tasks 9-11.

- [ ] **Step 1: Escrever os testes do núcleo puro (espelhando `tests/unit/bambuListener.test.ts`)**

```ts
// tests/unit/anycubicListener.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createAnycubicListenerCore } from '@/lib/anycubic/listener'

describe('createAnycubicListenerCore', () => {
  it('só assina impressoras com anycubicEnabled=true e anycubicPrinterKey preenchida', () => {
    const subscribe = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [
        { id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' },
        { id: 'p2', anycubicEnabled: false, anycubicPrinterKey: 'KEY2' },
        { id: 'p3', anycubicEnabled: true, anycubicPrinterKey: null },
      ],
      subscribe,
      onCapture: vi.fn(),
    })
    core.start()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith('KEY1', expect.any(Function))
  })

  it('acumula patches parciais no cache em memória e expõe via getLiveStatus', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
    })
    core.start()
    handlers['KEY1']({ type: 'tempature', action: 'auto', state: 'done', data: { curr_hotbed_temp: 55, curr_nozzle_temp: 200 } })
    handlers['KEY1']({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })

    const status = core.getLiveStatus('p1')
    expect(status?.bedTemp).toBe(55)
    expect(status?.nozzleTemp).toBe(200)
    expect(status?.fanSpeedPercent).toBe(80)
  })

  it('getLiveStatus devolve null pra impressora sem mensagem recebida ainda', () => {
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: vi.fn(),
      onCapture: vi.fn(),
    })
    core.start()
    expect(core.getLiveStatus('p1')).toBeNull()
  })

  it('chama onCapture quando um job termina, com o printerId certo (debounce de 2 leituras, ver Task 6)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onCapture = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture,
    })
    core.start()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { filename: 'a.gcode' } })
    handlers['KEY1']({ type: 'print', action: 'start', state: 'finished', data: {} })
    expect(onCapture).not.toHaveBeenCalled()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'finished', data: {} })
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture).toHaveBeenCalledWith('p1', expect.objectContaining({ outcome: 'FINISHED' }))
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/anycubicListener.test.ts`
Expected: FAIL com "Cannot find module '@/lib/anycubic/listener'"

- [ ] **Step 3: Implementar o núcleo puro + casca real em `lib/anycubic/listener.ts`**

```ts
import mqtt, { MqttClient } from 'mqtt'
import { readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/crypto'
import {
  parseAnycubicPayload,
  buildStatusPatch,
  applyStatusPatch,
  INITIAL_ANYCUBIC_STATUS,
  type AnycubicStatus,
} from '@/lib/anycubic/parser'
import { createAnycubicJobTracker, type AnycubicCaptureDraft } from '@/lib/anycubic/jobTracker'
import { encryptMqttToken, buildMqttUsername } from '@/lib/anycubic/mqttCrypto'

type PrinterRef = { id: string; anycubicEnabled: boolean; anycubicPrinterKey: string | null }

// Núcleo puro/testável -- mesmo formato do lib/bambu/listener.ts#createListenerCore.
// Diferença chave: cada mensagem MQTT da Anycubic é um PATCH parcial (ver
// lib/anycubic/parser.ts), não um "report" completo -- por isso acumula
// via applyStatusPatch em vez de sobrescrever o status inteiro a cada tick.
export function createAnycubicListenerCore(opts: {
  printers: PrinterRef[]
  subscribe: (printerKey: string, onMessage: (payload: unknown) => void) => void
  onCapture: (printerId: string, capture: AnycubicCaptureDraft) => void
}) {
  const liveStatus = new Map<string, AnycubicStatus>()
  const trackers = new Map<string, ReturnType<typeof createAnycubicJobTracker>>()

  function start() {
    for (const printer of opts.printers) {
      if (!printer.anycubicEnabled || !printer.anycubicPrinterKey) continue
      const tracker = createAnycubicJobTracker()
      trackers.set(printer.id, tracker)
      opts.subscribe(printer.anycubicPrinterKey, (payload) => {
        const msg = parseAnycubicPayload(payload)
        if (!msg) return
        const patch = buildStatusPatch(msg)
        const prev = liveStatus.get(printer.id) ?? INITIAL_ANYCUBIC_STATUS
        const next = applyStatusPatch(prev, patch)
        liveStatus.set(printer.id, next)

        const capture = tracker.handleStatus(next, new Date())
        if (capture) opts.onCapture(printer.id, capture)
      })
    }
  }

  function getLiveStatus(printerId: string): AnycubicStatus | null {
    return liveStatus.get(printerId) ?? null
  }

  return { start, getLiveStatus }
}

// --- Casca real (não coberta por teste automatizado -- depende da nuvem
// Anycubic de verdade, ver spec §2/§9) ---

export type AnycubicConnectionStatus = 'connected' | 'expired' | 'not_configured' | 'no_printer'

let connectionStatus: AnycubicConnectionStatus = 'not_configured'
let core: ReturnType<typeof createAnycubicListenerCore> | null = null
let client: MqttClient | null = null

const MQTT_HOST = 'mqtt-universe.anycubic.com'
const MQTT_PORT = 8883
const MQTT_TOPIC_PREFIX = 'anycubic/anycubicCloud/v1'

function buildMqttSslOptions() {
  const certDir = join(__dirname, 'certs')
  return {
    ca: readFileSync(join(certDir, 'anycubic_mqtt_ca.crt')),
    cert: readFileSync(join(certDir, 'anycubic_mqtt_client.crt')),
    key: readFileSync(join(certDir, 'anycubic_mqtt_client.key')),
    rejectUnauthorized: false,
  }
}

export async function startAnycubicListener(): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted || !settings.anycubicUserEmail) {
    connectionStatus = 'not_configured'
    return
  }

  const printers = await prisma.printer.findMany({
    where: { anycubicEnabled: true, anycubicPrinterKey: { not: null } },
    select: { id: true, anycubicEnabled: true, anycubicPrinterKey: true },
  })
  if (printers.length === 0) {
    connectionStatus = 'no_printer'
    return
  }

  const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
  const email = settings.anycubicUserEmail
  const mqttPassword = encryptMqttToken(authToken)
  const mqttUsername = buildMqttUsername(email, mqttPassword)

  client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
    username: mqttUsername,
    password: mqttPassword,
    reconnectPeriod: 5000,
    ...buildMqttSslOptions(),
  })

  client.on('connect', () => {
    connectionStatus = 'connected'
  })
  client.on('error', (err) => {
    connectionStatus = 'expired'
    console.error('[anycubic] erro na conexão MQTT:', err.message)
  })

  core = createAnycubicListenerCore({
    printers,
    subscribe: (printerKey, onMessage) => {
      // machine_type não é usado pra roteamento aqui -- assina com "+" no
      // lugar dele, já que só precisamos filtrar por key (o "+" aceita
      // qualquer machine_type, sem precisar saber o valor exato).
      const topic = `${MQTT_TOPIC_PREFIX}/printer/app/+/${printerKey}/#`
      client!.subscribe(topic)
      client!.on('message', (receivedTopic, buffer) => {
        const parts = receivedTopic.split('/')
        if (parts[3] !== 'printer' || parts[4] !== 'app' || parts[6] !== printerKey) return
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
          outcome: capture.outcome === 'FINISHED' ? 'FINISHED' : capture.outcome === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN',
        },
      })
    },
  })
  core.start()
}

export function getAnycubicLiveStatus(printerId: string): AnycubicStatus | null {
  return core?.getLiveStatus(printerId) ?? null
}

export async function restartAnycubicListener(): Promise<void> {
  if (client) {
    client.removeAllListeners()
    client.end(true)
    client = null
  }
  core = null
  connectionStatus = 'not_configured'
  await startAnycubicListener()
}

export function getAnycubicConnectionStatus(): AnycubicConnectionStatus {
  return connectionStatus
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/anycubicListener.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar `tsc` pra checar o arquivo inteiro (a casca real também precisa compilar)**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes em `tests/integration/accessories.test.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/anycubic/listener.ts tests/unit/anycubicListener.test.ts
git commit -m "feat: listener MQTT da Anycubic Cloud (núcleo puro + casca real)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `instrumentation.ts` + `actions/anycubicAuth.ts` + `actions/anycubicStatus.ts`

**Files:**
- Modify: `instrumentation.ts`
- Create: `actions/anycubicAuth.ts`
- Create: `actions/anycubicStatus.ts`

**Interfaces:**
- Consumes: `exchangeSlicerToken`, `fetchUserInfo`, `fetchMyPrinters` de `@/lib/anycubic/auth`; `encryptCredential` de `@/lib/crypto`; `startAnycubicListener`, `restartAnycubicListener`, `getAnycubicConnectionStatus`, `getAnycubicLiveStatus` de `@/lib/anycubic/listener`
- Produces: `connectAnycubicAccount(formData: FormData): Promise<ActionResult>`, `disconnectAnycubicAccount(): Promise<ActionResult>`, `getAnycubicStatus(): Promise<AnycubicConnectionStatus>`, `getAnycubicBoundPrinters(): Promise<{ success: boolean; printers?: AnycubicPrinterRef[]; error?: string }>`, `reconnectAnycubicListener(): Promise<{ success: boolean }>` — consumidos pelas Tasks 11 e 12.

- [ ] **Step 1: Editar `instrumentation.ts` pra também iniciar o listener Anycubic no boot**

Ler o arquivo atual primeiro (`instrumentation.ts` já chama `startBambuListener()`); adicionar a chamada ao `startAnycubicListener()` ao lado, sem remover a da Bambu:

```ts
import { startAnycubicListener } from '@/lib/anycubic/listener'
```

E no corpo da função de registro, ao lado de `await startBambuListener()`:

```ts
await startAnycubicListener()
```

- [ ] **Step 2: Criar `actions/anycubicAuth.ts`**

```ts
'use server'
import { prisma } from '@/lib/prisma'
import { exchangeSlicerToken, fetchUserInfo } from '@/lib/anycubic/auth'
import { encryptCredential } from '@/lib/crypto'
import { restartAnycubicListener } from '@/lib/anycubic/listener'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function connectAnycubicAccount(formData: FormData): Promise<ActionResult> {
  const pastedToken = String(formData.get('slicerToken') ?? '').trim()
  if (!pastedToken) return { success: false, error: 'Cole o token do Slicer Next' }

  try {
    const { authToken } = await exchangeSlicerToken(pastedToken)
    const { id, email } = await fetchUserInfo(authToken)

    await prisma.settings.update({
      where: { id: 1 },
      data: {
        anycubicAuthTokenEncrypted: encryptCredential(authToken),
        anycubicUserEmail: email,
        anycubicUserId: id,
      },
    })

    await restartAnycubicListener()
    revalidatePath('/settings')
    revalidatePath('/monitor')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao conectar conta Anycubic' }
  }
}

export async function disconnectAnycubicAccount(): Promise<ActionResult> {
  await prisma.settings.update({
    where: { id: 1 },
    data: { anycubicAuthTokenEncrypted: null, anycubicUserEmail: null, anycubicUserId: null },
  })
  await restartAnycubicListener()
  revalidatePath('/settings')
  revalidatePath('/monitor')
  return { success: true }
}
```

- [ ] **Step 3: Criar `actions/anycubicStatus.ts`**

```ts
'use server'
import { prisma } from '@/lib/prisma'
import { getAnycubicConnectionStatus, restartAnycubicListener } from '@/lib/anycubic/listener'
import { decryptCredential } from '@/lib/crypto'
import { fetchMyPrinters, type AnycubicPrinterRef } from '@/lib/anycubic/auth'

export async function getAnycubicStatus() {
  return getAnycubicConnectionStatus()
}

export async function getAnycubicBoundPrinters(): Promise<{ success: boolean; printers?: AnycubicPrinterRef[]; error?: string }> {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  if (!settings?.anycubicAuthTokenEncrypted) {
    return { success: false, error: 'Conecte a conta Anycubic em Configurações primeiro' }
  }
  try {
    const authToken = decryptCredential(settings.anycubicAuthTokenEncrypted)
    const printers = await fetchMyPrinters(authToken)
    return { success: true, printers }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Falha ao buscar impressoras' }
  }
}

export async function reconnectAnycubicListener(): Promise<{ success: boolean }> {
  await restartAnycubicListener()
  return { success: true }
}
```

Nota: `getAnycubicLiveStatus` (importado acima) não precisa de um wrapper próprio aqui — `actions/bambuStatus.ts` (Task 13) importa direto de `@/lib/anycubic/listener`, mesmo padrão que já usa hoje pra `getLiveStatus` da Bambu.

- [ ] **Step 4: Verificação**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts actions/anycubicAuth.ts actions/anycubicStatus.ts
git commit -m "feat: actions + boot do listener Anycubic Cloud

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `actions/printers.ts` — reiniciar listener ao habilitar Anycubic

**Files:**
- Modify: `actions/printers.ts`

**Interfaces:**
- Consumes: `restartAnycubicListener` de `@/lib/anycubic/listener`

- [ ] **Step 1: Ler o trecho atual que chama `restartBambuListener()` em `createPrinter`/`updatePrinter`**

Localizar (`grep -n "restartBambuListener" actions/printers.ts`) os pontos onde `if (parsed.data.bambuEnabled) await restartBambuListener()` acontece.

- [ ] **Step 2: Adicionar a chamada equivalente pra Anycubic**

Ao lado de cada `if (parsed.data.bambuEnabled) await restartBambuListener()`, adicionar:

```ts
if (parsed.data.anycubicEnabled) await restartAnycubicListener()
```

com o import `import { restartAnycubicListener } from '@/lib/anycubic/listener'` no topo do arquivo.

- [ ] **Step 3: Verificação**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: nesse ponto ainda vai reclamar de `parsed.data.anycubicEnabled` não existir no tipo — normal, resolve no Step 4 abaixo (schema Zod ainda não tem o campo)

- [ ] **Step 4: Adicionar `anycubicEnabled`/`anycubicPrinterKey` ao schema Zod**

Em `lib/validation/printer.ts`, ao lado dos campos `bambuEnabled`/`bambuSerial` existentes no schema, adicionar:

```ts
anycubicEnabled: z.boolean().default(false),
anycubicPrinterKey: z.string().optional().nullable(),
```

- [ ] **Step 5: Verificação final**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes

- [ ] **Step 6: Commit**

```bash
git add actions/printers.ts lib/validation/printer.ts
git commit -m "feat: valida e reinicia listener Anycubic ao salvar impressora

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: UI de Configurações — `AnycubicConnectionForm.tsx`

**Files:**
- Create: `app/(app)/settings/AnycubicConnectionForm.tsx`
- Modify: `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `connectAnycubicAccount`, `disconnectAnycubicAccount` de `@/actions/anycubicAuth`; `getAnycubicStatus`, `reconnectAnycubicListener` de `@/actions/anycubicStatus`

- [ ] **Step 1: Criar `AnycubicConnectionForm.tsx` (mesmo padrão visual do `BambuConnectionForm.tsx`)**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectAnycubicAccount, disconnectAnycubicAccount } from '@/actions/anycubicAuth'
import { reconnectAnycubicListener, type getAnycubicStatus } from '@/actions/anycubicStatus'
import { SubmitButton } from '@/components/SubmitButton'

type ConnectionStatus = Awaited<ReturnType<typeof getAnycubicStatus>>

const STATUS_BADGE: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: 'MQTT conectado', className: 'text-emerald-600 dark:text-emerald-400' },
  expired: { label: 'MQTT com erro — ver logs do servidor', className: 'text-red-600 dark:text-red-400' },
  not_configured: { label: 'MQTT ainda não conectado', className: 'text-amber-600 dark:text-amber-400' },
  no_printer: {
    label: 'Nenhuma impressora com a "key" da Anycubic preenchida — ver Impressoras',
    className: 'text-amber-600 dark:text-amber-400',
  },
}

export function AnycubicConnectionForm({
  connectedEmail,
  connectionStatus,
}: {
  connectedEmail: string | null
  connectionStatus: ConnectionStatus
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function handleConnect(formData: FormData) {
    setError(null)
    const result = await connectAnycubicAccount(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao conectar')
      return
    }
    router.refresh()
  }

  async function handleDisconnect() {
    await disconnectAnycubicAccount()
    router.refresh()
  }

  async function handleReconnect() {
    await reconnectAnycubicListener()
    router.refresh()
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Integração Anycubic</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Monitoramento somente leitura via Cloud MQTT. Sem login automático — precisa colar um token extraído do
        Anycubic Slicer Next (Windows).
      </p>
      <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        <summary className="tk-summary cursor-pointer">Como extrair o token</summary>
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>Abra o Anycubic Slicer Next no Windows e deixe logado.</li>
          <li>
            No PowerShell, rode:
            <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 dark:bg-slate-800">
              {`$log = Get-ChildItem "$env:AppData\\AnycubicSlicerNext\\log" -Filter "debug_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Select-String -Path $log.FullName -Pattern 'accessToken = ([^,\\s]+)' | Select-Object -Last 1`}
            </pre>
          </li>
          <li>Copie o valor capturado e cole abaixo.</li>
        </ol>
      </details>
      <div className="mt-4">
        {connectedEmail ? (
          <div className="text-sm">
            <p>
              Conectado como <strong>{connectedEmail}</strong>
            </p>
            <p className={`mt-1 text-xs font-medium ${STATUS_BADGE[connectionStatus].className}`}>{STATUS_BADGE[connectionStatus].label}</p>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={handleReconnect} className="text-sm text-violet-600 hover:underline dark:text-violet-400">
                Reconectar
              </button>
              <button type="button" onClick={handleDisconnect} className="text-sm text-red-600 hover:underline dark:text-red-400">
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <form action={handleConnect} className="flex flex-col gap-3">
            <label className="text-sm">
              Token do Slicer Next
              <textarea name="slicerToken" className="tk-input-full" rows={3} required placeholder="eyJhbGciOi..." />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <SubmitButton pendingLabel="Conectando…">Conectar</SubmitButton>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Editar `app/(app)/settings/page.tsx`**

Adicionar o import e a busca de status ao lado dos já existentes da Bambu:

```ts
import { AnycubicConnectionForm } from './AnycubicConnectionForm'
import { getAnycubicStatus } from '@/actions/anycubicStatus'
```

No `Promise.all` que já busca `bambuConnectionStatus`, adicionar `getAnycubicStatus()` e desestruturar como `anycubicConnectionStatus`. Depois do `<BambuConnectionForm ... />`, adicionar:

```tsx
<div className="mt-4">
  <AnycubicConnectionForm connectedEmail={settings.anycubicUserEmail} connectionStatus={anycubicConnectionStatus} />
</div>
```

- [ ] **Step 3: Verificação**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/settings/AnycubicConnectionForm.tsx" "app/(app)/settings/page.tsx"
git commit -m "feat: tela de conexão Anycubic em Configurações

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: UI de Impressoras — checkbox + seletor de "key"

**Files:**
- Modify: `app/(app)/printers/PrinterForm.tsx`

**Interfaces:**
- Consumes: `getAnycubicBoundPrinters` de `@/actions/anycubicStatus`; `AnycubicPrinterRef` de `@/lib/anycubic/auth`

- [ ] **Step 1: Ler o bloco atual do seletor Bambu em `PrinterForm.tsx` (linhas ~228-262, já lido nesta sessão) e replicar o mesmo padrão pra Anycubic**

Adicionar ao lado dos states existentes (`bambuSerial`, `bambuDevices` etc.):

```ts
import { getAnycubicBoundPrinters } from '@/actions/anycubicStatus'
import type { AnycubicPrinterRef } from '@/lib/anycubic/auth'
```

```ts
const [anycubicPrinterKey, setAnycubicPrinterKey] = useState(editingPrinter?.anycubicPrinterKey ?? '')
const [anycubicPrinters, setAnycubicPrinters] = useState<AnycubicPrinterRef[] | null>(null)
const [anycubicPrintersError, setAnycubicPrintersError] = useState<string | null>(null)
const [loadingAnycubicPrinters, setLoadingAnycubicPrinters] = useState(false)

async function handleSearchAnycubicPrinters() {
  setLoadingAnycubicPrinters(true)
  setAnycubicPrintersError(null)
  const result = await getAnycubicBoundPrinters()
  setLoadingAnycubicPrinters(false)
  if (!result.success) {
    setAnycubicPrintersError(result.error ?? 'Falha ao buscar impressoras')
    return
  }
  if (!result.printers || result.printers.length === 0) {
    setAnycubicPrintersError('Nenhuma impressora vinculada à conta Anycubic')
    return
  }
  setAnycubicPrinters(result.printers)
}
```

No `useEffect`/reset que já limpa `bambuSerial`/`bambuDevices` ao trocar `editingPrinter`, adicionar o reset equivalente de `anycubicPrinterKey`/`anycubicPrinters`.

- [ ] **Step 2: Adicionar o bloco de UI logo depois do bloco Bambu existente**

```tsx
<div className="mt-3">
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" name="anycubicEnabled" defaultChecked={editingPrinter?.anycubicEnabled ?? false} />
    Integração Anycubic (monitoramento)
  </label>
  <label className="mt-2 block text-sm">
    Key da impressora Anycubic (opcional)
    <input
      name="anycubicPrinterKey"
      className="tk-input-full"
      value={anycubicPrinterKey}
      onChange={(e) => setAnycubicPrinterKey(e.target.value)}
    />
  </label>
  <button
    type="button"
    onClick={handleSearchAnycubicPrinters}
    disabled={loadingAnycubicPrinters}
    className="mt-2 text-sm text-violet-600 hover:underline dark:text-violet-400"
  >
    {loadingAnycubicPrinters ? 'Buscando…' : 'Buscar impressoras da conta Anycubic'}
  </button>
  {anycubicPrintersError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{anycubicPrintersError}</p>}
  {anycubicPrinters && (
    <ul className="mt-2 space-y-1">
      {anycubicPrinters.map((printer) => (
        <li key={printer.key}>
          <button
            type="button"
            onClick={() => {
              setAnycubicPrinterKey(printer.key)
              setAnycubicPrinters(null)
            }}
            className="text-sm text-violet-600 hover:underline dark:text-violet-400"
          >
            {printer.name} ({printer.key})
          </button>
        </li>
      ))}
    </ul>
  )}
</div>
```

- [ ] **Step 3: Verificação**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/printers/PrinterForm.tsx"
git commit -m "feat: seletor de impressora Anycubic em Impressoras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Mesclar Bambu + Anycubic em `/monitor`

O `/monitor` atual é todo gated por um `connectionStatus` único da Bambu (bloqueia a página inteira se a Bambu não estiver conectada). Com 2 marcas, o gate precisa virar por-impressora, não por-página — cada card mostra seu próprio estado.

**Files:**
- Modify: `actions/bambuStatus.ts` (função `getAllLiveBambuStatuses`)
- Modify: `app/(app)/monitor/page.tsx`
- Modify: `app/(app)/monitor/LiveStatusPoller.tsx`

**Interfaces:**
- Consumes: `getAnycubicLiveStatus` de `@/lib/anycubic/listener` (mesmo padrão de import direto da lib que `actions/bambuStatus.ts` já usa hoje pra `getLiveStatus`)

- [ ] **Step 1: Renomear e generalizar `getAllLiveBambuStatuses` pra `getAllLiveStatuses` em `actions/bambuStatus.ts`**

Trocar a implementação atual (que só busca `bambuEnabled: true`) por uma que busca as duas marcas e anexa a origem/estado de cada impressora:

```ts
export async function getAllLiveStatuses() {
  const printers = await prisma.printer.findMany({
    where: { active: true, OR: [{ bambuEnabled: true }, { anycubicEnabled: true }] },
    select: { id: true, name: true, nickname: true, bambuEnabled: true, anycubicEnabled: true },
  })
  return printers.map((printer) => {
    if (printer.bambuEnabled) {
      return {
        printerId: printer.id,
        name: printer.nickname ?? printer.name,
        brand: 'bambu' as const,
        status: getLiveStatus(printer.id),
        thumbnailUrl: getCurrentThumbnail(printer.id),
      }
    }
    return {
      printerId: printer.id,
      name: printer.nickname ?? printer.name,
      brand: 'anycubic' as const,
      status: getAnycubicLiveStatus(printer.id),
      thumbnailUrl: null,
    }
  })
}
```

Manter `getAllLiveBambuStatuses` como estava é desnecessário — como só existe um chamador (`app/(app)/monitor/page.tsx`), renomear direto em vez de manter as duas funções.

Adicionar o import: `import { getAnycubicLiveStatus } from '@/lib/anycubic/listener'` no topo do arquivo.

- [ ] **Step 2: Reescrever `app/(app)/monitor/page.tsx` pra listar por impressora, sem gate global de marca**

```tsx
import Link from 'next/link'
import { getAllLiveStatuses } from '@/actions/bambuStatus'
import { LiveStatusPoller } from './LiveStatusPoller'

export const dynamic = 'force-dynamic'

export default async function MonitorPage() {
  const printers = await getAllLiveStatuses()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Monitoramento</h1>

      {printers.length === 0 ? (
        <div className="tk-panel p-4 text-sm text-slate-500 dark:text-slate-400">
          Nenhuma impressora com integração Bambu ou Anycubic habilitada. Configure em{' '}
          <Link href="/printers" className="underline">
            Impressoras
          </Link>
          .
        </div>
      ) : (
        <LiveStatusPoller initialPrinters={printers} />
      )}
    </div>
  )
}
```

O aviso de "não conectado"/"sem key preenchida" some do nível de página e passa a ser por card, tratado no próprio `LiveStatusPoller` (Step 3) — mais direto que duplicar 3 blocos de mensagem por marca.

- [ ] **Step 3: Ajustar `LiveStatusPoller.tsx` pra tratar `status: null` como "sem dados/desconectado" por card**

O componente já trata `!status` mostrando "Sem dados ainda" (linha 54-55 do arquivo atual) — isso já cobre o caso de uma impressora Anycubic ainda não conectada, sem mudança adicional necessária nesse ponto. Só precisa:
1. Trocar o import de `getAllLiveBambuStatuses` pra `getAllLiveStatuses` (`actions/bambuStatus.ts`, já renomeado na Step 1).
2. O bloco de controles de impressão (`PrintControls`, Task de "controle de impressão" já existente) só se aplica a impressoras Bambu por enquanto — envolver a renderização de `<PrintControls />` com `printer.brand === 'bambu' &&`, já que o publish de comando pra Anycubic fica fora do escopo desta fase (spec §3).

```tsx
import { getAllLiveStatuses } from '@/actions/bambuStatus'
// ...
type LiveStatuses = Awaited<ReturnType<typeof getAllLiveStatuses>>
// ...
{printer.brand === 'bambu' && status && (
  <PrintControls printerId={printer.printerId} printerName={printer.name} gcodeState={status.gcodeState} />
)}
```

Nota: como `status` agora pode ser tanto `BambuStatus` quanto `AnycubicStatus`, o restante do JSX que lê campos específicos (`status.gcodeState`, `status.hmsCodes` etc.) só deve renderizar quando `printer.brand === 'bambu'` — os campos de `AnycubicStatus` (Task 5) usam nomes diferentes (`printState`, sem `hmsCodes`). Envolver o bloco de detalhes atual (linhas 57-97 do arquivo lido nesta sessão) numa checagem `printer.brand === 'bambu' ? (/* JSX atual, usando status as BambuStatus */) : (/* bloco novo abaixo */)`.

Bloco novo pro card Anycubic (mesmo nível de informação, campos próprios):

```tsx
) : status ? (
  <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
    <p>{status.printState}</p>
    {status.progressPercent !== null && <p>{status.progressPercent}%</p>}
    {status.remainingMinutes !== null && <p>{status.remainingMinutes} min restantes</p>}
    {status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{status.gcodeFile}</p>}
    {status.currentLayer !== null && status.totalLayers !== null && (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Camada {status.currentLayer}/{status.totalLayers}
      </p>
    )}
    <details className="pt-1">
      <summary className="tk-summary cursor-pointer text-xs">Detalhes</summary>
      <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
        {status.nozzleTemp !== null && <p>Bico: {status.nozzleTemp}°C</p>}
        {status.bedTemp !== null && <p>Mesa: {status.bedTemp}°C</p>}
        {status.fanSpeedPercent !== null && <p>Ventoinha: {status.fanSpeedPercent}%</p>}
      </div>
    </details>
  </div>
) : (
  <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
)}
```

- [ ] **Step 4: Verificação**

Run: `DATABASE_URL="x" npx tsc --noEmit`
Expected: só os 2 erros pré-existentes — TypeScript deve reclamar se algum campo `BambuStatus`/`AnycubicStatus` for acessado fora do branch de marca certo; corrigir até compilar limpo.

Run: `npm run lint`
Expected: sem erros

Run: `npx vitest run tests/unit`
Expected: todos os testes passando (nenhum teste unitário cobre `LiveStatusPoller.tsx`/`page.tsx` diretamente — são Client/Server Components sem lógica pura extraída; verificação visual fica pro Step 5)

- [ ] **Step 5: Testar manualmente no navegador**

Rodar `npm run dev`, abrir `/monitor`, confirmar: card da impressora Bambu continua mostrando os campos de sempre (incluindo os botões de Pausar/Retomar/Parar), e — se já houver uma impressora Anycubic habilitada e conectada até este ponto do plano — o card dela mostra "Sem dados ainda" ou o status básico sem quebrar a página. Sem impressora Anycubic real disponível ainda nesta task, confirmar ao menos que a página renderiza sem erro de runtime com `printers` misto (pode simular temporariamente marcando uma segunda impressora de teste como `anycubicEnabled=true` sem key, só pra ver o card "Sem dados ainda" aparecer).

- [ ] **Step 6: Commit**

```bash
git add actions/bambuStatus.ts "app/(app)/monitor/page.tsx" "app/(app)/monitor/LiveStatusPoller.tsx"
git commit -m "feat: mescla impressoras Bambu e Anycubic no Monitoramento

/monitor deixa de ser bloqueado por um status de marca único -- cada
card agora mostra o estado da SUA impressora, então uma marca
desconectada não esconde a outra que está funcionando.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Nota final (Registrar Produção / autofill)

Nenhuma task altera `actions/productionRuns.ts` nem `ProductionRunBatchForm.tsx`: `getAvailablePrinterCapture(printerId)` (`actions/bambuStatus.ts`) já lê de `PrinterCapture` só por `printerId`, sem saber a marca da impressora — uma captura gravada pela Task 8 (listener Anycubic) já aparece no autofill do Registrar Produção sem nenhuma mudança de código adicional. Validar isso manualmente depois que uma captura real da Anycubic existir no banco (fora do escopo de uma task própria — é herdado de graça da Task 8).

## Riscos conhecidos que sobrevivem à implementação (ver spec §9)

- Unidades de `remain_time`/`print_time`/`supplies_usage` não confirmadas contra uma conta real — só validável testando contra a impressora de verdade do usuário (mesma situação que a Bambu teve com o peso, resolvida depois via teste ao vivo).
- Constantes de app (`APP_ID`/`APP_SECRET`) podem parar de funcionar se a Anycubic atualizar o site/app — sem aviso prévio, só descoberto quando o login parar de funcionar.
- Token do Slicer Next sem renovação automática — expira, usuário repete o passo manual em Configurações.

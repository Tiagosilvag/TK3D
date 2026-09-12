import { randomUUID, createHash } from 'crypto'

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

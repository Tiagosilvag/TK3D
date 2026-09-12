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

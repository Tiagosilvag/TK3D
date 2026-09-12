import { createHash, createPublicKey, publicEncrypt, constants, type KeyLike } from 'crypto'
import { ANYCUBIC_MQTT_CA_CERT } from './certs'

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

// Separado de encryptMqttToken pra ser testável com uma chave de teste
// (a CA real da Anycubic não precisa entrar no teste unitário).
export function encryptMqttTokenWithKey(authToken: string, publicKey: KeyLike): string {
  // A assinatura de tipos do node:crypto tem várias sobrecargas pra
  // publicEncrypt (KeyObjectInput/PrivateKeyInput/PublicKeyInput/
  // JsonWebKeyInput) que não resolvem bem quando a chave chega como o
  // union genérico KeyLike -- o cast abaixo aponta pro shape que a
  // implementação de fato espera em runtime (key + padding).
  const options = { key: publicKey, padding: constants.RSA_PKCS1_PADDING } as Parameters<typeof publicEncrypt>[0]
  const encrypted = publicEncrypt(options, Buffer.from(authToken, 'utf8'))
  return encrypted.toString('base64')
}

let cachedCaPublicKey: KeyLike | null = null

function loadCaPublicKey(): KeyLike {
  if (cachedCaPublicKey) return cachedCaPublicKey
  cachedCaPublicKey = createPublicKey(ANYCUBIC_MQTT_CA_CERT)
  return cachedCaPublicKey
}

// Senha da sessão MQTT (modo Slicer/"pcf"): o auth_token criptografado com
// RSA-PKCS1v15 usando a chave pública extraída do certificado CA da
// Anycubic (ver lib/anycubic/certs.ts).
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

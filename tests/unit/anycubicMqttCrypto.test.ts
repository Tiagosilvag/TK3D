import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, privateDecrypt, constants } from 'crypto'
import { encryptMqttTokenWithKey, encryptMqttToken, buildMqttClientId, buildMqttUsername } from '@/lib/anycubic/mqttCrypto'

describe('anycubic mqttCrypto', () => {
  // Regressão: em produção, ler o certificado via fs.readFileSync quebrava
  // (Next.js empacota o server em chunks e não copia o arquivo pro lugar
  // certo -- ENOENT). O certificado virou string embutida em certs.ts;
  // esse teste roda a função real (sem mock de chave) pra garantir que a
  // string colada não está corrompida e que createPublicKey/publicEncrypt
  // funcionam com ela de ponta a ponta.
  it('encryptMqttToken funciona com o certificado CA real embutido, sem lançar erro', () => {
    const encrypted = encryptMqttToken('token-de-teste')
    expect(typeof encrypted).toBe('string')
    expect(encrypted.length).toBeGreaterThan(0)
  })

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
    expect(buildMqttClientId('user@example.com')).toBe('6254e84c68ff0b1678ea4530a2be15e7')
  })

  it('buildMqttUsername monta "user|pcf|{email}|{sigMd5}"', () => {
    const username = buildMqttUsername('user@example.com', 'FAKE_ENCRYPTED_TOKEN_BASE64')
    expect(username).toBe('user|pcf|user@example.com|6da79c9ec9cd72b81aa5ddf559fce998')
  })
})

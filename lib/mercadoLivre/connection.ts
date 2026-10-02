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

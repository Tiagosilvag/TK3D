import { prisma } from '@/lib/prisma'
import { encryptCredential, decryptCredential } from '@/lib/crypto'
import { refreshAccessToken, isTokenExpiringSoon, MLRefreshError, type MLTokenResponse } from '@/lib/mercadoLivre/auth'

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

// Finding 3b (revisão final da integração Mercado Livre): o refresh token
// do ML é de USO ÚNICO -- duas chamadas concorrentes a getValidAccessToken
// vendo o mesmo token "prestes a expirar" (ex.: rajada de webhooks
// `orders_v2` do ML, correndo contra o poller de 5 minutos ou a própria
// tela de Configurações) disparariam DOIS refreshes com o MESMO refresh
// token -- o primeiro ganha e salva, o segundo falha (o token que ele usou
// já foi invalidado) e, sem este lock, marcaria DESCONECTADA por cima de
// uma conexão que acabou de ser renovada com sucesso. Esta promise
// compartilhada no nível do módulo garante que só UMA chamada de refresh
// de verdade aconteça por vez neste processo -- as demais esperam a MESMA
// promise em vez de iniciar a sua própria. Como a checagem
// (`if (refreshPromise)`) e a criação (`refreshPromise = ...`) não têm
// nenhum `await` entre si, não existe janela de corrida: só uma chamada
// concorrente pode executar esse trecho síncrono por vez (microtasks do
// Node rodam até o fim sem interleaving), então só uma pode encontrar
// `refreshPromise` nulo e criar a promise -- todas as outras, não importa
// a ordem de resolução das suas próprias leituras no banco, sempre vêem o
// valor já definido depois.
let refreshPromise: Promise<string> | null = null

export async function getValidAccessToken(): Promise<string> {
  const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
  if (!connection || connection.status === 'DESCONECTADA') {
    throw new Error('Mercado Livre não está conectado')
  }
  if (!isTokenExpiringSoon(connection.tokenExpiresAt)) {
    return decryptCredential(connection.accessToken)
  }

  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const refreshToken = decryptCredential(connection.refreshToken)
      const tokens = await refreshAccessToken(refreshToken)
      await saveConnection(tokens)
      return tokens.accessToken
    } catch (err) {
      // Finding 3a: só um refresh token REALMENTE revogado/expirado (ML
      // responde 400 invalid_grant ou 401 invalid_token) deve forçar
      // DESCONECTADA (exige reconexão manual, conforme §4 do spec). Uma
      // falha transitória (5xx, 429, erro de rede/timeout sem status
      // nenhum -- inclusive a disputa do 3b, onde o PERDEDOR vê o refresh
      // token que o vencedor já consumiu) nunca deveria desconectar uma
      // integração que pode estar perfeitamente saudável -- relança como
      // está e deixa quem chamou (webhook/poller/página) tratar como uma
      // falha pontual desta chamada, sem mexer no status salvo.
      const status = err instanceof MLRefreshError ? err.status : null
      if (status === 400 || status === 401) {
        const message = err instanceof Error ? err.message : 'Falha ao renovar token'
        await prisma.marketplaceConnection.update({
          where: { platform: 'MERCADO_LIVRE' },
          data: { status: 'DESCONECTADA', lastError: message },
        })
        throw new Error('Conexão com o Mercado Livre expirou — reconecte em Configurações')
      }
      throw err
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function getConnectionStatus() {
  return prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
}

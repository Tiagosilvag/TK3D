# Integração com Mercado Livre — Spec

**Data:** 2026-10-02
**Status:** Aprovado em brainstorming (decisões de escopo confirmadas pelo usuário)
**Escopo geral:** esta é a 1ª de duas integrações de marketplace planejadas.
Shopee é um projeto separado, com seu próprio spec/plano, construído
depois que esta estiver pronta e validada em produção — mas reaproveitando
toda a infraestrutura genérica criada aqui (sistema de notificações,
padrão de `MarketplaceConnection`/inbox).

## 1. Objetivo

Hoje o TK3D não sabe nada sobre o que acontece na conta real do
Mercado Livre — `Order`/`Listing`/`MarketplacePlatform` existem, mas são
100% preenchidos à mão. Esta integração conecta a conta real via API
oficial do Mercado Livre para:

1. **Saber automaticamente quando um pedido novo chega**, com alerta
   visual persistente até o pedido ser despachado.
2. **Consultar quais anúncios estão ativos** na conta, sem precisar
   abrir o site do Mercado Livre.

Não objetivo desta fase: sincronizar estoque de volta pro ML, enviar
status de rastreio, criar o `Order` automaticamente sem confirmação
humana. Ver §8.

## 2. Pré-requisito do usuário

Antes da implementação chegar na parte de conexão real, o usuário
precisa criar uma Aplicação em
[developers.mercadolivre.com.br](https://developers.mercadolivre.com.br)
(gera Client ID + Client Secret) e configurar:
- **Redirect URI**: `https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback`
- **Notificações (webhook)**: `https://tk3d.coffetech.com.br/api/webhooks/mercado-livre`
- **Tópicos de notificação**: `orders_v2` (mínimo necessário)

`MERCADOLIVRE_CLIENT_ID`/`MERCADOLIVRE_CLIENT_SECRET` entram como env
vars no Coolify, mesmo padrão de `BAMBU_CREDENTIAL_KEY`.

## 3. Modelo de dados (schema aditivo, sem migration destrutiva)

```prisma
enum MarketplaceConnectionStatus {
  CONECTADA
  DESCONECTADA
}

model MarketplaceConnection {
  id              String                       @id @default(cuid())
  platform        MarketplacePlatformKind      @unique
  sellerId        String
  // Cifrados com lib/crypto.ts (mesma chave BAMBU_CREDENTIAL_KEY,
  // já documentada ali como "credenciais" de forma genérica).
  accessToken     String
  refreshToken    String
  tokenExpiresAt  DateTime
  status          MarketplaceConnectionStatus  @default(CONECTADA)
  connectedAt     DateTime                     @default(now())
  lastError       String?
  updatedAt       DateTime                     @updatedAt
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
  // [{ externalItemId, title, sku, quantity, unitPrice }]
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
  id         String           @id @default(cuid())
  type       NotificationType
  title      String
  body       String?
  link       String?
  // Referência polimórfica leve, mesmo padrão de StockAdjustment
  // (resourceType + resourceId string, sem FK física).
  resourceType String?
  resourceId   String?
  seenAt     DateTime?
  resolvedAt DateTime?
  createdAt  DateTime         @default(now())
}
```

`Order` ganha a relação inversa `inboxEntries MarketplaceOrderInbox[]`
(sem novo campo escalar nele).

## 4. Fluxo de conexão (OAuth2)

Nova página `/settings/integrations`. Botão "Conectar Mercado Livre"
redireciona para a URL de autorização do ML
(`response_type=code&client_id=...&redirect_uri=...`); o vendedor loga
com a própria conta ML e autoriza. O callback
(`app/api/integrations/mercado-livre/callback/route.ts`) troca o código
pelos tokens (`POST /oauth/token`), grava `MarketplaceConnection`
cifrada.

`lib/mercadoLivre/auth.ts#getValidAccessToken()`: lê a conexão, se
`tokenExpiresAt` está a menos de 5min de expirar, renova via refresh
token antes de devolver — toda chamada à API do ML passa por essa
função, nunca usa o token cru armazenado diretamente. Se o refresh
falhar (refresh token revogado/expirado), marca
`status=DESCONECTADA`, grava `lastError`, e a UI mostra banner pedindo
reconexão (mesmo padrão visual de alerta de conexão perdida já usado em
Impressoras/Bambu/Anycubic).

## 5. Detecção de pedido

**Webhook** (`app/api/webhooks/mercado-livre/route.ts`): recebe
`{topic, resource, user_id}`. Se `topic !== 'orders_v2'`, ignora
(200 OK, sem processar). Chama
`lib/mercadoLivre/orders.ts#processOrderNotification(resource)`:
busca o pedido real via API autenticada (nunca confia no corpo do
webhook), faz upsert em `MarketplaceOrderInbox` por
`(platform, externalOrderId)` (idempotente — reentrega do ML não
duplica), cria uma `Notification` do tipo `NOVO_PEDIDO_MARKETPLACE`
apontando pro inbox (`resourceType='MarketplaceOrderInbox'`) só na
criação (não em update de um pedido já existente no inbox).

**Reconciliação** (a cada 5 minutos, singleton iniciado em
`instrumentation.ts`, mesmo padrão do listener MQTT Bambu/Anycubic):
busca pedidos da conta criados/atualizados nos últimos ~15 minutos
(janela com folga sobre o intervalo de 5min, cobre atraso/pedido
perdido) via `GET /orders/search`, chama a mesma
`processOrderNotification` pra cada um — via upsert idempotente, reprocessar
um pedido que o webhook já pegou não cria notificação duplicada nem
Order duplicado.

## 6. Confirmar pedido → Order de verdade

Nova seção em `/orders` ("Pedidos Mercado Livre pendentes"), lista
`MarketplaceOrderInbox` com `status=PENDENTE`. Pra cada item, formulário
pra escolher manualmente Product+cor correspondente (reaproveita o
componente de seleção de produto já usado no formulário de `/orders`
hoje). Ao confirmar: cria `Order`+`OrderItem(s)` normalmente (mesmo
`createOrder` de hoje, `channel=MERCADO_LIVRE`), seta
`MarketplaceOrderInbox.status=CONFIRMADO` e `confirmedOrderId`. Pedido
pode ser marcado `IGNORADO` manualmente (ex.: pedido de teste, duplicata)
sem virar Order.

## 7. Notificações (genérico)

`components/NotificationBell.tsx`, montado no layout raiz
(`app/(app)/layout.tsx`), visível em toda tela:
- Busca contagem de `Notification` com `resolvedAt IS NULL` — bolinha
  vermelha se > 0.
- No layout raiz, se existir alguma `Notification` com `seenAt IS
  NULL`, renderiza um modal (`<dialog>` nativo, padrão já usado no
  app) listando todas; ao fechar, marca `seenAt=now()` em todas as
  exibidas. Não reaparece sozinho até a próxima notificação nova.
- `resolvedAt` da notificação `NOVO_PEDIDO_MARKETPLACE` é setado
  automaticamente por um hook em `updateOrderItemStatus`
  (actions/orders.ts) — `Order` é só o cabeçalho, status vive em
  `OrderItem` (confirmado no código atual). Quando um `OrderItem` muda
  pra `ENTREGUE` ou `CANCELADO`, verifica se o `Order` dele veio de uma
  `MarketplaceOrderInbox` confirmada e se TODOS os `OrderItem`s desse
  `Order` já estão em status terminal (`ENTREGUE`/`CANCELADO`) — só
  então resolve a notificação (busca por
  `resourceType='MarketplaceOrderInbox' AND resourceId=<id do inbox>`).
  Pedido com múltiplos itens só resolve quando o último item chega ao
  fim, não no primeiro.

Sistema desenhado para ser reaproveitado por notificações futuras (ver
§8) — `NotificationType` é um enum que cresce, o componente/modal/bolinha
não mudam.

## 8. Catálogo (só consulta)

Nova página (ex. `/settings/integrations` ou uma aba dentro dela)
lista os anúncios ativos da conta via `GET /users/{seller_id}/items/search`
+ `GET /items?ids=...` (título, preço, estoque anunciado, thumbnail,
link pro anúncio). Busca ao vivo a cada carregamento da página (sem
cache persistido) — não grava nada no banco, não altera o cadastro
manual de `Listing` já existente.

## 9. Tratamento de erro

- Refresh token falha → `DESCONECTADA` + banner de reconexão.
- Rate limit da API do ML → backoff exponencial, nunca derruba a
  aplicação (mesmo padrão do listener MQTT).
- Webhook malformado/tópico desconhecido → log + 200 OK (ML reenvia se
  não receber 200 — ignorar silenciosamente um tópico que não nos
  interessa evita reenvio infinito).
- Item do pedido sem correspondência óbvia de produto → fica pendente
  pra escolha manual, nunca casa sozinho por heurística.

## 10. Não-objetivos desta fase (ideias para depois, fora de escopo agora)

1. Enviar status de despacho/rastreio de volta pro Mercado Livre.
2. Sincronizar estoque anunciado automaticamente a partir do estoque
   real do TK3D.
3. Puxar código de rastreio da transportadora.
4. Alertar sobre perguntas de comprador no anúncio (API de perguntas).
5. Reaproveitar `Notification`/`NotificationBell` para outros alertas
   (ex.: estoque crítico) — infraestrutura pronta, só falta um novo
   `NotificationType` e o produtor correspondente.
6. Criar `Order` automaticamente sem confirmação humana (rejeitado
   explicitamente nesta fase por risco de casamento errado de
   produto/cor).

## 11. Integração com Shopee (projeto separado, não desta spec)

Mesma arquitetura (`MarketplaceConnection`/`MarketplaceOrderInbox`/
`Notification` já são genéricos por `platform`), mas a API da Shopee
tem fluxo de auth e payloads de webhook diferentes do Mercado Livre —
spec e plano próprios, só depois desta integração estar em produção.

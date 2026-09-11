# Integração Bambu Lab (monitoramento) — Spec

**Data:** 2026-09-11
**Status:** Aprovado (decisões de escopo confirmadas pelo usuário)

## 1. Objetivo

Capturar dados reais de impressão das impressoras Bambu Lab do usuário
(hoje uma A1 mini, sem AMS — mas a integração deve funcionar com qualquer
impressora Bambu, com ou sem AMS, e escalar pra N impressoras) e usar isso
pra:

1. Mostrar uma tela de monitoramento ao vivo (status, progresso, tempo
   restante) sem depender do app da Bambu.
2. Pré-preencher, no formulário de Registrar Produção já existente, o
   tempo real de impressão e o filamento realmente gasto — em vez do
   usuário digitar/estimar isso à mão.

Conexão via **Bambu Cloud** (conta Bambu, mesmo canal que o app Bambu
Handy usa) em vez de LAN/Developer Mode, porque o usuário quer manter o
controle remoto pelo Bambu Handy funcionando fora da rede local — o que é
incompatível com Developer Mode (ver spike anterior nesta mesma sessão).
Isso significa: **a integração é somente leitura** — nunca manda
imprimir, fatiar, nem qualquer comando de escrita pra impressora. Mandar
imprimir continua sendo feito como hoje, pelo Bambu Studio/Handy.

## 2. Fora de escopo (explícito)

- **Criação automática de `ProductionRun`**: a integração nunca cria um
  registro de produção sozinha. Ela só guarda telemetria real à parte;
  quem decide quantidade boa/falha e confirma o registro continua sendo o
  usuário, no fluxo manual de sempre. `costSnapshot` continua congelado e
  calculado só na criação manual, sem nenhuma mudança de regra.
- **Câmera / live view**: fora de escopo — não pedido, adiciona
  complexidade de streaming sem servir ao objetivo de custeio/dados.
- **Fatiamento (slicing) via TK3D**: fora de escopo desta spec — resolve
  um problema diferente (gerar o arquivo, não capturar dados de quem já
  está imprimindo).
- **Match por convenção de nome de arquivo**: descartado (decisão do
  usuário) — o match da captura com o registro de produção é por
  impressora + janela de tempo, não por nome do `.3mf`.
- **Distribuição automática de filamento gasto entre múltiplos itens de
  uma mesma Plate**: quando uma Plate tem mais de um item, a integração
  nunca decide sozinha qual item consumiu o quê (ver §7).
- **Multi-tenant**: esta spec assume uma instalação do TK3D por operação
  (como já é hoje — login único, Settings singleton). "Deixar pronto pra
  qualquer impressora Bambu" significa suportar N impressoras sob a
  mesma conta/instalação, não múltiplos clientes na mesma instância.

## 3. Modelo de dados

### 3.1 `Printer` (campos novos, opcionais — não afeta impressoras existentes)

| Campo | Tipo | Default |
|---|---|---|
| `bambuEnabled` | Boolean | `false` |
| `bambuSerial` | String? | `null` |

`bambuSerial` é o device id da impressora na conta Bambu — identifica
qual impressora dentro dos tópicos MQTT da nuvem. Adicionar uma
impressora nova à integração é só marcar `bambuEnabled=true` e preencher
`bambuSerial` no cadastro já existente — nenhum código novo por
impressora/modelo.

### 3.2 `Settings` (campos novos — conta Bambu compartilhada)

| Campo | Tipo | Default |
|---|---|---|
| `bambuCloudEmail` | String? | `null` |
| `bambuCloudCredentialEncrypted` | String? | `null` |
| `bambuCloudRegion` | String? | `"US"` |

Status de conexão (conectado/expirado/não configurado) **não é
persistido** — é lido em tempo real do estado em memória do listener
(§5), pra nunca mostrar um status desatualizado.

### 3.3 `Plate` (campo novo)

| Campo | Tipo | Default |
|---|---|---|
| `actualPrintTimeHours` | Decimal? `@db.Decimal(10,3)` | `null` |

Puramente informativo — mostrado na lista/detalhe da Plate ao lado do
tempo teórico, **nunca** entra em `allocatePlatePrintTime` nem em nenhum
cálculo de custo. `null` quando a Plate não veio de autofill (imensa
maioria dos casos hoje, e sempre pra quem não usa a integração).

### 3.4 Tabela nova `PrinterCapture`

```prisma
enum PrinterCaptureOutcome {
  FINISHED
  FAILED
  CANCELLED
  UNKNOWN
}

model PrinterCapture {
  id              String                 @id @default(cuid())
  printerId       String
  printer         Printer                @relation(fields: [printerId], references: [id])
  startedAt       DateTime
  finishedAt      DateTime
  gcodeFileName   String?
  durationHours   Decimal                @db.Decimal(10, 3)
  gramsUsedTotal  Decimal?               @db.Decimal(10, 2)
  amsBreakdown    Json?
  outcome         PrinterCaptureOutcome
  linkedPlateId   String?
  linkedPlate     Plate?                 @relation(fields: [linkedPlateId], references: [id])
  createdAt       DateTime               @default(now())

  @@index([printerId, finishedAt])
}
```

- Uma linha por job **concluído** — nunca durante a impressão (ver §5).
- `gramsUsedTotal` nulo quando não dá pra calcular com confiança (spool
  sem peso configurado na conta Bambu) — nunca um número inventado.
- `amsBreakdown` guarda o snapshot bruto antes/depois de cada slot, pra
  referência manual futura mesmo quando o total escalar é nulo.
- `linkedPlateId` marca a captura como já usada num autofill — some da
  lista de "disponíveis" pra aquela impressora, mas a linha nunca é
  apagada.
- **Isolamento**: nenhuma mudança em `ProductionRun`. Se a integração for
  removida, `ProductionRun`/`Plate` continuam funcionando exatamente como
  hoje (só perde o campo opcional `actualPrintTimeHours` e a FK de
  `PrinterCapture`, que também pode simplesmente sumir).

## 4. Autenticação e credenciais

Fluxo em 2 passos, dentro da tela de Configurações (nunca CLI/script):

1. **Pedir código** — campo e-mail + senha da conta Bambu + botão
   "Conectar". Server action chama o login da Bambu (dispara 2FA por
   e-mail) e devolve um ticket de verificação de curta duração, mantido
   só na sessão do formulário (nunca salvo no banco).
2. **Confirmar código** — campo do código recebido por e-mail + botão
   "Confirmar". Server action troca ticket+código pelo token de acesso
   real, cifra e grava em `Settings.bambuCloudCredentialEncrypted` +
   `bambuCloudEmail`.

A senha nunca é persistida — passa só naquela chamada e morre. Cifragem
via `crypto` nativo do Node (AES-256-GCM), chave vinda de uma env var
nova `BAMBU_CREDENTIAL_KEY` (mesmo padrão de `APP_PASSWORD`/
`SESSION_SECRET` no `docker-compose.yaml`). Sem essa env var, a tela
recusa salvar em vez de gravar em texto puro.

**Expiração**: comportamento exato de expiração/refresh do token da
nuvem Bambu não é documentado oficialmente — trata-se como incerto até a
implementação validar contra a conta real. Se a Bambu recusar o token
salvo, o listener marca "expirado" em memória (sem loop de retry) e a
tela de Configurações mostra esse status ao vivo com botão
"Reconectar", reabrindo o fluxo de 2 passos. Se existir refresh
silencioso no protocolo, é usado como otimização — o design não depende
disso pra funcionar.

## 5. Listener MQTT

**Onde inicializa**: `instrumentation.ts` (`register()`, hook nativo do
Next 15) — roda uma vez quando o processo do servidor sobe. Sem
dependência nova pra isso.

**Lifecycle**: no boot, lê `Settings` (credencial decifrada) + todo
`Printer` com `bambuEnabled=true`. Sem credencial ou sem impressora
habilitada → fica ocioso. Caso contrário, conecta no broker da região
configurada (`us.mqtt.bambulab.com:8883` ou equivalente conforme
`bambuCloudRegion`) e assina o tópico de report de cada impressora
habilitada, usando `bambuSerial`.

**Cache em memória**: `Map<printerId, estado>` com o último payload de
cada impressora (`gcode_state`, `mc_percent`, `mc_remaining_time`,
temperaturas, AMS por slot, `gcode_file`, timestamp da última
atualização). É o que a tela de Monitoramento (§6) e o status de
Configurações (§4) leem — sem escrita no banco a cada tick.

**Detecção de job e captura final**:
- Transição **para** `RUNNING` (vinda de outro estado estável por
  alguns segundos, pra ignorar ruído/flapping) → guarda `jobStartedAt` +
  snapshot do % restante de cada slot do AMS/spool externo.
- Transição **de** `RUNNING` pra `FINISH`/`FAILED`/`IDLE` → calcula
  `durationHours` (agora − `jobStartedAt`) e `gramsUsedTotal`
  (preferindo o campo de peso/comprimento usado que a própria impressora
  reporta quando presente; senão, diferença do % restante do spool antes
  e depois — `null` se não der pra calcular com confiança). Grava uma
  linha em `PrinterCapture` com `outcome` mapeado do `gcode_state` final.
- Se o processo reiniciar no meio de um job (redeploy), o estado em
  memória se perde — esse job específico simplesmente não gera captura
  ao terminar, em vez de gravar um número inventado.

**Generalização por modelo**: nenhum código é específico de A1/P1/X1 —
o listener só reage à presença/ausência dos campos de AMS no payload
(impressora sem AMS não manda o array, cálculo cai pro spool externo).

## 6. Tela de Monitoramento (`/monitor`)

Rota nova, item de menu próprio ("Monitoramento") na seção operacional
(perto de Produção/Montagem) — não em Impressoras (catálogo/config) nem
em Configurações.

- Um cartão por `Printer` com `bambuEnabled=true`. Sem nenhuma
  impressora habilitada, tela mostra estado vazio com link pra
  Configurações.
- Cartão: nome/apelido, badge de estado (Imprimindo/Ocioso/Pausado/
  Falhou/Desconectado), barra de progresso, tempo restante, arquivo em
  impressão, temperaturas como info secundária. Sem câmera.
- Atualização por polling (Client Component isolado, `fetch`/
  `setInterval` nativo, sem lib de websocket) numa Server Action nova
  que lê o cache em memória do listener.
- Integração desconectada → aviso "integração desconectada — ver
  Configurações" em vez de dado velho.

## 7. Autofill em Registrar Produção

No formulário de criar Plate (`createPlate`), ao escolher a impressora:
Server Action busca a `PrinterCapture` mais recente e ainda sem
`linkedPlateId` daquela impressora, dentro de uma janela de 48h
(constante fixa no código — sem campo em Settings pra isso, YAGNI). Se
achar, mostra aviso com resumo (horário, duração, filamento) e botão
"Usar".

Mapeamento ao clicar "Usar" (respeita o que cada campo já significa
hoje — não inventa semântica nova):

| Resultado da captura | Campo preenchido |
|---|---|
| `FINISHED`, duração | `Plate.actualPrintTimeHours` (novo campo, §3.3) |
| `FAILED`, duração | `timeWastedHours` do item — já é "horas perdidas" |
| Filamento, Plate com **1 item só** | diferença (real − teórico já calculado) auto-preenche `gramsWasted` daquele item |
| Filamento, Plate com **vários itens** | só mostrado como referência ao lado da soma teórica — distribuição fica manual |

Ao usar, marca `PrinterCapture.linkedPlateId` — some da lista de
sugestões pra aquela impressora. Se ignorada, a linha continua no banco
(nunca apagada), só some da sugestão depois de passar da janela de 48h.

## 8. Erros e resiliência

- Token inválido/expirado: sem retry-loop, marcado em memória, refletido
  na UI (§4, §6) — nunca dado velho fingindo atual.
- `BAMBU_CREDENTIAL_KEY` ausente/trocada: decifrar falha → tratado como
  "sem credencial", nunca derruba o boot da aplicação.
- Restart do container no meio de um job: essa captura específica não é
  gerada (ver §5) — sem número inventado.
- Ruído de estado (flapping): só conta como novo job uma transição pra
  `RUNNING` vinda de estado estável.
- Falha ao gravar `PrinterCapture`: logada, nunca derruba o listener nem
  a conexão MQTT.

## 9. Testes

- **Unitários** (`tests/unit`, rodam no sandbox): parser do payload MQTT,
  detector de transição início/fim de job, cálculo de delta de filamento
  (com e sem AMS), distribuição 1-item-vs-vários-itens (§7), round-trip
  de cifragem/decifragem da credencial. Usam fixtures de payloads reais
  gravados manualmente uma vez (ver limite abaixo) — nada de rede.
- **Integração** (`tests/integration`, precisam de banco vivo — não
  rodam neste sandbox): vincular/desvincular `PrinterCapture`, autofill
  no `createPlate`, salvar credencial em `Settings`.
- **Limite explícito**: conexão real com a nuvem Bambu (login, MQTT) não
  entra em teste automatizado — serviço de terceiro, não documentado,
  com 2FA. Validado manualmente contra a impressora real durante a
  implementação; os payloads capturados nessa validação viram as
  fixtures dos testes unitários do parser.

## 10. Dependência nova

Adiciona a lib `mqtt` (cliente MQTT pro Node) — única dependência nova
desta spec, desvio explícito da convenção "sem dependências novas por
padrão" do projeto, já aprovado pelo usuário nesta sessão. Todo o resto
(login na nuvem Bambu, parse do payload, cifragem) é código próprio,
sem trazer nenhuma lib de terceiro pronta pra Bambu.

# Integração Anycubic Cloud (Fase 1: monitoramento + captura + autofill)

## 1. Motivação

O usuário tem uma segunda impressora, uma Anycubic da linha Kobra (FDM),
além da Bambu Lab A1 mini já integrada (ver
`docs/superpowers/specs/2026-09-11-integracao-bambu-lab-design.md`). O
pedido é replicar a mesma lógica: monitoramento ao vivo, captura real de
tempo de impressão e filamento gasto, autofill no Registrar Produção —
sem depender de LAN/modo desenvolvedor, preservando o controle remoto
pelo app oficial (Anycubic App).

## 2. Pesquisa — panorama da API Anycubic Cloud

Não existe documentação oficial. Toda a pesquisa se apoiou em projetos
comunitários que fazem engenharia reversa do protocolo:

- `WaresWichall/hass-anycubic_cloud` — integração original pro Home
  Assistant, abandonada pelo mantenedor (ver issue #33: a Anycubic
  bloqueou MQTT pra tokens "web", só "app/slicer" continuam
  funcionando).
- `ljschmitt/hass-anycubic_cloud_v3` — fork ativo mantido, mesma base
  de código, com correções e extensões. É a referência técnica
  principal desta spec.
- `royrdan/anycubic_cloud` — biblioteca Python solta, "beta", auth
  pouco documentada, não usada como referência principal.

### 2.1 Diferença fundamental frente à Bambu Lab

Na Bambu, o login é um fluxo REST documentado-o-suficiente (email+senha
→ código por e-mail → token), e as chamadas MQTT usam usuário+senha
comuns sobre TLS padrão. **Na Anycubic isso não existe.**

- **Toda chamada HTTP** (mesmo leitura de status) exige um header
  `Xx-Signature` calculado como
  `MD5(app_id + timestamp + app_version + app_secret + nonce + app_id)`,
  onde `app_id`/`app_secret` são constantes (`AC_KNOWN_AID`,
  `AC_KNOWN_SEC` etc.) **extraídas via regex do JS minificado do site
  deles** — não são credenciais do usuário, são segredos do app
  decompilado. O projeto de referência inclui os próprios regexes
  usados pra re-extrair essas constantes quando a Anycubic atualiza o
  site.
- **MQTT em tempo real** exige adicionalmente um **certificado + chave
  privada TLS cliente fixos** (também extraídos por engenharia
  reversa, públicos nos repositórios comunitários, não são segredos do
  usuário) para mTLS, mais um esquema de criptografia pra montar a
  senha da sessão MQTT: RSA (PKCS1v15) do token com a chave pública da
  CA deles, no modo "Slicer".
- **Não existe login programático** (sem endpoint tipo
  email+senha→token). O único caminho pra obter um token que habilite
  MQTT é abrir o **Anycubic Slicer Next (Windows)**, logar, e extrair
  manualmente o `accessToken` de um arquivo de log/config local — não
  automatizável a partir do servidor. Web token (login pelo navegador,
  `localStorage["XX-Token"]`) existe mas não habilita MQTT desde a
  mudança que aposentou o projeto original.

Essa investigação foi decisiva pra decisão de escopo (ver §3): o
usuário optou explicitamente por portar o fluxo completo (assinatura +
MQTT + certificado), ciente de que:
1. é uma superfície de manutenção mais frágil que a Bambu — quebra se
   a Anycubic atualizar o site/app e as constantes mudarem;
2. exige comitar um certificado/chave TLS extraídos por engenharia
   reversa (públicos, não é segredo de ninguém, mas vale deixar
   registrado que a origem é essa).

### 2.2 Superfície da API (relevante pra Fase 1)

Endpoints REST (todos com os headers assinados, `base_url =
https://cloud-universe.anycubic.com/p/p/workbench/api`):

- `POST /v3/public/loginWithAccessToken` — troca o token do Slicer
  Next por um `auth_token` de sessão (`{device_type:'pcf',
  access_token: <token colado>}`).
- `GET /user/profile/userInfo` — retorna `id`/`user_email` do usuário,
  necessários pro client ID e tópicos MQTT.
- `GET /work/printer/getPrinters` (ou `/v2/printer/all`) — lista
  impressoras vinculadas à conta (equivalente ao "bound devices" da
  Bambu) — cada impressora tem uma `key` (usada nos tópicos MQTT, não
  um serial no sentido Bambu).
- `GET /v2/Printer/status`, `GET /v2/printer/info` — status/detalhes
  pontuais via REST (fallback caso MQTT não esteja ativo).
- `GET /v2/project/printHistory` — histórico de impressões da nuvem
  (equivalente ao `/my/tasks` da Bambu) — usado pra enriquecer a
  captura (peso real, thumbnail).

MQTT: broker `mqtts://mqtt-universe.anycubic.com:8883`. Prefixo comum
`anycubic/anycubicCloud/v1`; assina em
`anycubic/anycubicCloud/v1/printer/app/{machine_type}/{key}/#` (status
da impressora) e em
`anycubic/anycubicCloud/v1/server/app/{user_id}/{user_id_md5}/...`
(eventos de usuário). Publica em
`anycubic/anycubicCloud/v1/printer/public/{machine_type}/{key}/{endpoint}`
(fora do escopo desta fase, usado só quando entrarmos em controle de
impressão).

Comandos de impressão (pause/resume/cancel) e câmera cloud (WebRTC)
existem na API mas ficam **fora do escopo desta fase** (ver §3).

## 3. Escopo da Fase 1

**Dentro do escopo:**
- Conectar conta Anycubic colando o token do Slicer Next (sem login
  automatizado).
- Listar/escolher impressora vinculada (igual ao seletor de serial da
  Bambu).
- Status ao vivo no `/monitor`, misturado com os cards da Bambu.
- Captura de impressão (início/fim, tempo real, filamento gasto) na
  mesma tabela `PrinterCapture` já existente.
- Autofill no Registrar Produção — já funciona sem mudança, porque lê
  de `PrinterCapture` por `printerId`, agnóstico de marca.

**Fora do escopo (fases futuras, sob pedido explícito):**
- Controle de impressão (pausar/retomar/cancelar) — precisa do mesmo
  MQTT publish já funcionando nesta fase, então é extensão natural
  depois, igual foi feito com a Bambu.
- Câmera cloud (WebRTC) — protocolo de sinalização não investigado
  a fundo nesta pesquisa; maior escopo próprio.
- Gerenciamento de ACE/multi-color box, arquivos, atualização de
  firmware — não fazem parte do caso de uso (custeio de produção).

## 4. Modelo de dados

- `Printer`: `anycubicEnabled Boolean @default(false)`,
  `anycubicPrinterKey String?` (a "key" retornada por
  `getPrinters`, usada nos tópicos MQTT).
- `Settings`: `anycubicAuthTokenEncrypted String?` (auth_token de
  sessão, criptografado), `anycubicUserEmail String?`,
  `anycubicUserId String?` (necessários pra assinar MQTT — client ID e
  tópico de usuário).
- `PrinterCapture`: **sem alteração**. Já é agnóstico de marca (só
  referencia `printerId`); o campo `amsBreakdown` (Json?) serve tanto
  pro AMS da Bambu quanto pro multi-color box da Anycubic se um dia
  for preenchido, sem precisar de coluna nova.

Migration nova: `prisma/migrations/<timestamp>_anycubic_integration/migration.sql`
seguindo o estilo das existentes.

## 5. Criptografia compartilhada

`lib/bambu/crypto.ts` (AES-256-GCM genérico, chaveado por
`BAMBU_CREDENTIAL_KEY`) não tem nada de Bambu-específico por dentro —
vira `lib/crypto.ts`, reexportado/usado por `lib/bambu/*` e
`lib/anycubic/*`. Sem env var nova (reaproveita a mesma chave já
configurada no Coolify — o propósito continua sendo "credenciais de
impressora", só que agora de duas marcas).

## 6. Arquitetura do módulo `lib/anycubic/*`

Mesma separação em camadas do `lib/bambu/*`:

- `lib/anycubic/signing.ts` (puro) — monta os headers assinados
  (`Xx-Signature`, `Xx-Nonce`, `Xx-Timestamp` etc.) a partir das
  constantes reverse-engineered. Testável com vetores fixos (dado um
  timestamp/nonce fixos, o MD5 resultante é determinístico).
- `lib/anycubic/auth.ts` — `exchangeSlicerToken(pastedToken)` (troca o
  token colado por `auth_token` de sessão), `fetchUserInfo(authToken)`
  (id/email), `fetchMyPrinters(authToken)` (lista pra seletor),
  `fetchPrintHistory(authToken, printerKey)` (enriquecimento da
  captura, mesmo papel do `fetchLatestTask` da Bambu).
- `lib/anycubic/mqttCrypto.ts` (puro) — `encryptMqttToken(authToken,
  caPublicKeyPem)` via `node:crypto.publicEncrypt` (RSA-PKCS1v15) +
  `buildMqttClientId(email)` (MD5(email+"pcf")). Certificado/chave/CA
  ficam como arquivos estáticos em `lib/anycubic/certs/` (públicos,
  comitados).
- `lib/anycubic/parser.ts` (puro) — payload MQTT → status normalizado
  (mesmo papel do `parser.ts` da Bambu; campos concretos a mapear na
  implementação a partir do `AnycubicConsumableData`/`printer.py` do
  projeto de referência: progresso, temperaturas, camada, tempo
  restante).
- `lib/anycubic/jobTracker.ts` (puro) — mesmo state machine de debounce
  (2 leituras terminais seguidas) do `lib/bambu/jobTracker.ts`,
  duplicado (não abstraído) pra manter os módulos desacoplados, igual
  ao padrão já usado no projeto de preferir duplicação pequena a
  abstração prematura.
- `lib/anycubic/listener.ts` — núcleo puro testável (`createListenerCore`,
  mesmo formato do da Bambu) + casca real (conecta MQTT de verdade,
  sem teste automatizado, mesma observação já registrada no código da
  Bambu pro `pushall`).

## 7. UI

- `/settings`: novo card "Conexão Anycubic" — textarea pra colar o
  token do Slicer Next + instrução curta (baseada no PowerShell da doc
  de referência) de como extraí-lo, botão "Conectar" que troca o token
  e testa a conexão.
- `/printers`: checkbox `anycubicEnabled` + campo de key, com botão
  "Buscar impressoras da conta Anycubic" (mesmo padrão do seletor de
  serial da Bambu).
- `/monitor`: `LiveStatusPoller` passa a consultar as duas fontes
  (Bambu + Anycubic) e mesclar por `printerId` — a UI dos cards não
  muda, só a origem do dado.

## 8. Testes

- `signing.ts`, `mqttCrypto.ts`, `parser.ts`, `jobTracker.ts`: testes
  unitários puros, mesmo padrão da Bambu (vetores fixos, sem rede).
  RSA encrypt testado com uma chave de teste gerada localmente, não a
  CA real da Anycubic.
- `auth.ts` real (chamadas HTTP): testado como a Bambu — validação
  manual contra a conta de verdade do usuário, sem teste automatizado.
- Listener real (MQTT de verdade): sem teste automatizado, mesma
  observação da Bambu.

## 9. Riscos e limitações conhecidas

- **Fragilidade das constantes de app**: se a Anycubic atualizar o
  site/app e trocar `app_id`/`app_secret`, a assinatura passa a falhar
  até atualizarmos as constantes manualmente (não há endpoint pra
  descobri-las programaticamente sem replicar o scraper do projeto de
  referência, o que fica fora do escopo desta fase).
- **Token sem refresh conhecido**: quando o token do Slicer Next
  expirar, não há renovação automática — o usuário repete o passo
  manual (extrair de novo e colar em Configurações).
- **Modelo pouco testado pela comunidade**: linha Kobra tem o melhor
  suporte reportado; funções específicas (multi-color box, luz) não
  fazem parte do escopo, mas o parser de status básico (temperatura,
  progresso, camada) é o mesmo pipeline usado por toda a linha.

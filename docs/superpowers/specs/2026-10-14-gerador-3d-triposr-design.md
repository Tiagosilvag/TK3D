# Gerador de modelo 3D a partir de imagem (TripoSR) — Spec

**Data:** 2026-10-14
**Status:** Aprovado em brainstorming (decisões de escopo confirmadas pelo
usuário)

## 1. Objetivo

Hoje não existe no TK3D nenhuma forma de gerar um modelo 3D a partir de uma
imagem. Pesquisa mostrou que não há API hospedada gratuita confiável pra
isso — o caminho realmente gratuito é um modelo open-source auto-hospedado
([TripoSR](https://github.com/VAST-AI-Research/TripoSR), licença MIT), que
precisa de GPU pra rodar em tempo razoável. A VPS onde o TK3D roda em
produção (Coolify) não tem GPU — é uma única máquina genérica. O usuário
tem uma GPU potente no próprio PC.

Esta spec cobre uma ferramenta avulsa (não ligada a Produto/Produção) que
deixa o usuário subir uma imagem no TK3D e, usando a GPU do seu próprio PC
via um worker local, gera um modelo 3D (OBJ + STL) a partir dela.

**Não objetivo desta fase:** ligar o resultado a um `Product` existente,
rodar o TripoSR na própria VPS, qualquer forma de acesso de entrada
(inbound) ao PC do usuário (o worker só faz requisições de saída — nunca
abre porta/túnel/VPN), limpeza automática de malha, conversão pra 3MF
(ver §8).

**Expectativa a deixar explícita na UI:** o resultado do TripoSR é um
rascunho — uma malha aproximada reconstruída a partir de 1 única foto,
tipicamente precisa de limpeza numa ferramenta de modelagem antes de virar
um arquivo pronto pra imprimir. A tela não deve dar a entender que o STL
gerado já está pronto pra produção.

## 2. Arquitetura: worker local por polling (pull, nunca push)

```
┌─────────────┐   upload imagem    ┌──────────────┐   GET /next (poll)   ┌────────────────┐
│   Usuário    │ ──────────────────▶│  TK3D (VPS)  │◀─────────────────────│  Worker local  │
│  (browser)   │                    │   Model3DJob │                      │  (PC, GPU)     │
└─────────────┘   lê status/baixa   └──────────────┘   POST /complete     └────────────────┘
                   STL/OBJ                  ▲         ou /fail             │
                                             └──────────────────────────────┘
                                                  (sempre o worker que inicia
                                                   a conexão, nunca o TK3D)
```

O worker nunca precisa ser alcançável de fora — ele é quem pergunta "tem
trabalho pra mim?" pro TK3D, em intervalos (ex.: a cada 5s). Isso evita
completamente a necessidade de expor o PC do usuário à internet (sem
port-forward, sem túnel, sem IP dinâmico pra gerenciar). Se o PC estiver
desligado ou o worker não estiver rodando, os jobs simplesmente ficam
`PENDENTE` até o worker voltar — nunca erro, nunca timeout do lado do
TK3D.

## 3. Modelo de dados (schema aditivo)

Segue o mesmo padrão de `ProductPhoto` (arquivo binário guardado direto no
Postgres via `Bytes`, sem storage externo nem volume/S3 — ver
`app/api/photos/[id]/route.ts`).

```prisma
enum Model3DJobStatus {
  PENDENTE
  PROCESSANDO
  CONCLUIDO
  ERRO
}

model Model3DJob {
  id               String           @id @default(cuid())
  status           Model3DJobStatus @default(PENDENTE)
  inputImage       Bytes
  inputContentType String
  inputSizeBytes   Int
  outputObj        Bytes?
  outputStl        Bytes?
  errorMessage     String?
  // Job PROCESSANDO há mais de STALE_AFTER_MINUTES (ver §5) é tratado como
  // abandonado (worker crashou/matou o processo sem chamar /fail) e volta
  // a ficar disponível pra reivindicação -- sem isso, um worker que morre
  // no meio de uma geração deixaria o job preso pra sempre.
  claimedAt        DateTime?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
}
```

Limites de tamanho de upload (checados na action de criação do job, não
no schema): imagem de entrada até 10MB, tipos aceitos
`image/png`/`image/jpeg`/`image/webp` — mesma ordem de grandeza de outros
uploads de imagem no app (`ProductPhoto`).

## 4. Tela `/3d-generator`

- Formulário de upload (um único arquivo de imagem) → cria `Model3DJob`
  com `status=PENDENTE`.
- Lista dos jobs mais recentes (mais novo primeiro) com: miniatura da
  imagem de entrada, status, e — quando `CONCLUIDO` — links de download
  do `.obj` e do `.stl`. Quando `ERRO`, mostra `errorMessage`.
- Enquanto existir algum job `PENDENTE`/`PROCESSANDO` na lista, a tela
  revalida periodicamente (polling simples do lado do cliente, ex. a
  cada 5s) pra refletir o progresso sem precisar de F5 manual — mesmo
  princípio (sem WebSocket/SSE, só reload leve) usado em outras telas do
  app que esperam um estado assíncrono mudar.
- Aviso fixo e visível na tela: "Resultado é um rascunho de malha a
  partir de 1 foto — normalmente precisa de limpeza numa ferramenta de
  modelagem antes de imprimir."
- Ação "Excluir" por job (sem retenção automática nesta fase — ver §8).

## 5. API pro worker (autenticação própria, não é a sessão do app)

Três rotas novas em `app/api/mesh-jobs/`, autenticadas por um header
`Authorization: Bearer <MESH_WORKER_SECRET>` comparado com
`crypto.timingSafeEqual` (nunca `===` direto, evita timing attack) contra
uma env var nova (`MESH_WORKER_SECRET`, gerada uma vez e colocada tanto no
Coolify quanto na config do worker local) — **nunca** a senha única de
login do app, que autentica humano no browser, não máquina-a-máquina.

- **`GET /api/mesh-jobs/next`**: reivindica atomicamente o job disponível
  mais antigo por `createdAt` ascendente — candidato é todo job
  `PENDENTE`, OU `PROCESSANDO` com `claimedAt` há mais de
  `STALE_AFTER_MINUTES=15` (considerado abandonado) — via `findFirst`
  seguido de `updateMany({ where: { id, status: <o status visto na
  leitura> }, data: { status: 'PROCESSANDO', claimedAt: now() } })`,
  checando `count===1` antes de devolver — mesmo padrão de claim atômico
  já usado em `confirmInboxOrder`/`ignoreInboxOrder` (integração Mercado
  Livre) pra evitar duas corridas pegarem o mesmo job. Se `count===0`
  (perdeu a corrida — improvável com um único worker, mas tratado mesmo
  assim), tenta o próximo candidato. Nenhum job disponível → `204 No
  Content`.
  Resposta (quando há job): `{ id, imageUrl }`, onde `imageUrl` é uma URL
  de download que já inclui o bearer token (o worker não tem sessão de
  navegador pra reusar um cookie).
- **`POST /api/mesh-jobs/:id/complete`**: corpo multipart com os arquivos
  `.obj` e `.stl` gerados; grava em `outputObj`/`outputStl`, marca
  `CONCLUIDO`.
- **`POST /api/mesh-jobs/:id/fail`**: corpo `{ message: string }`; marca
  `ERRO` com `errorMessage`.

**Isenção no `middleware.ts`:** estas rotas são chamadas pelo worker
(processo Python, sem cookie de sessão do navegador) — precisam da MESMA
isenção de `pathname.startsWith('/api/.../')` que o webhook do Mercado
Livre já tem (ver Finding 1 crítico da revisão final daquela integração:
sem isso, toda chamada do worker cairia num 307 pro `/login` e nunca
chegaria no route handler). Adicionar `/api/mesh-jobs/` à mesma lista de
prefixos isentos de `isWebhookPath`/equivalente — a autenticação de
verdade dessas rotas é o bearer token, verificado dentro do handler, não
a sessão de navegador.

## 6. Worker local (script Python, roda manualmente no PC do usuário)

Novo diretório `worker/` no repo, fora do build do Next.js
(`.dockerignore`/build do Coolify não precisa dele):
- `worker/mesh_worker.py`: loop que faz `GET /api/mesh-jobs/next` a cada
  `POLL_INTERVAL_SECONDS` (configurável, default 5s); ao achar um job,
  baixa a imagem, roda o TripoSR (biblioteca de terceiros, instalada
  separadamente — ver README, não vendorizada neste repo: é um projeto
  open-source próprio com seus próprios pesos de modelo/licença),
  converte a malha gerada (tipicamente `.obj`) pra `.stl` via `trimesh`
  (conversão de geometria pura, sem perda), e faz `POST .../complete`;
  em qualquer exceção, faz `POST .../fail` com a mensagem de erro em vez
  de deixar o job preso.
- `worker/README.md`: passo a passo de instalação (clonar o repo do
  TripoSR, instalar dependências Python incluindo `torch` com suporte a
  CUDA, instalar `trimesh`/`requests`, configurar `TK3D_URL` e
  `MESH_WORKER_SECRET` como variáveis de ambiente locais).
- `worker/requirements.txt`: `trimesh`, `requests`, `Pillow` (o `torch`/
  TripoSR propriamente ficam fora — dependem da GPU/CUDA específica da
  máquina, instalação própria documentada no README, não fixada aqui).

## 7. Segurança

- `MESH_WORKER_SECRET`: env var nova (mesmo padrão de env var simples já
  usado por outras integrações, ex. `BAMBU_CREDENTIAL_KEY`), comparada
  com `timingSafeEqual`. Nunca logada, nunca devolvida em nenhuma
  resposta.
- Upload de imagem: valida `Content-Type` contra uma lista branca
  (`image/png`, `image/jpeg`, `image/webp`) e tamanho máximo (10MB) antes
  de gravar no banco — evita gravar lixo arbitrário ou um arquivo enorme
  na coluna `Bytes`.
- As rotas do worker são as únicas no app que ficam fora do check de
  sessão do `middleware.ts` além do webhook do Mercado Livre — qualquer
  requisição sem o bearer token correto recebe `401` dentro do próprio
  handler, nunca processa nada antes de validar.

## 8. Não-objetivos desta fase (ideias para depois)

1. Ligar o modelo gerado a um `Product` (ex.: usar como ficha técnica
   inicial de uma peça nova).
2. Rodar o TripoSR na própria VPS (sem GPU lá, não vale o esforço agora).
3. Exportar em 3MF (a API de conversão via `trimesh` precisa de uma
   dependência extra pra isso — avaliar quando/se surgir necessidade
   real; STL já cobre o caso de uso de impressão).
4. Limpeza automática de malha (remoção de ruído, fechamento de furos,
   redução de triângulos) — o usuário faz isso manualmente numa
   ferramenta de modelagem, se precisar.
5. Retenção/expiração automática dos jobs antigos (hoje só exclusão
   manual) — revisar se o tamanho do banco crescer de forma
   incômoda.
6. Múltiplos workers simultâneos (hoje só 1 PC/GPU do usuário é
   esperado) — o claim atômico já suporta mais de um sem mudança, mas
   não foi desenhado/testado pra isso.

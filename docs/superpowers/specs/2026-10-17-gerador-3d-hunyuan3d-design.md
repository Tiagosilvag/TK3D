# Gerador de modelo 3D — troca pro Hunyuan3D 2.1

## Contexto

O gerador de modelo 3D (`/3d-generator`) rodava com TripoSR num worker
local (PC do usuário, GPU RTX 4070 12GB — a VPS de produção não tem
GPU). Depois de uso real, TripoSR mostrou um teto de qualidade que
ajuste de parâmetro não resolve: reconstrução a partir de 1 única
imagem produz superfícies onduladas/em-degraus em objetos
mecanicamente complexos e fotos reflexivas (ver histórico de testes com
foto de moto). Pesquisa comparando alternativas (TRELLIS.2, Hunyuan3D
2.1) concluiu:

- **TRELLIS.2**: exige 24GB+ de VRAM (oficial), só Linux, instalação
  bem mais complexa — descartado.
- **Hunyuan3D 2.1**: 10GB de VRAM só pra forma (cabe na RTX 4070),
  21GB só pra textura, 29GB combinado. Suporte oficial a Windows,
  instalação via pip (exceto o estágio de textura, que compila uma
  extensão C++). Licença própria da Tencent que permite uso no Brasil.

Execução em fases (forma primeiro, textura depois, liberando memória
entre elas) foi pesquisada e **não resolve** a limitação de VRAM — o
estágio de textura sozinho já precisa de ~21GB, confirmado tanto pela
documentação oficial quanto por relatos de usuários com GPUs de 16GB e
24GB ainda tomando OOM nesse estágio especificamente.

## Decisão

Troca completa de TripoSR pra Hunyuan3D 2.1, com **os dois caminhos
implementados desde já**:

- **Geração de forma** (sem cor): sempre disponível, roda na GPU atual
  do usuário (~10GB). Virou o modo padrão da tela.
- **Geração de textura**: código pronto e integrado, mas gated por
  VRAM — não funciona na GPU atual (12GB < ~21GB necessários). Fica no
  projeto pra já estar pronto numa troca futura de placa de vídeo, sem
  precisar reabrir essa frente de trabalho depois. Até lá, pedir
  textura numa GPU insuficiente falha o job com mensagem clara
  (nunca trava o worker), e o estágio nem tenta importar os módulos de
  textura (que exigem compilação de extensão) a menos que o job peça.

Além da troca de modelo, a tela ganhou configuração de geração por job
(antes só existia a imagem) e preview visual do resultado:

- Resolução da malha (`octreeResolution`), seed (fixa ou aleatória),
  toggle "gerar textura", resolução de textura (só visível com o
  toggle ligado), alvo de decimação opcional (pós-processamento nosso
  via trimesh, não é parâmetro do Hunyuan3D).
- Preview 3D inline no job concluído via `<model-viewer>` (web
  component do Google, carregado por CDN — não é dependência npm nova),
  renderizando o `.glb` que o worker agora sempre gera e envia de
  volta, além dos `.obj`/`.stl` já existentes pro fluxo de impressão.

## O que mudou

- `prisma/schema.prisma` / migration `20261017120000_mesh_jobs_generation_params`:
  `Model3DJob` ganha `generateTexture`, `seed`, `octreeResolution`,
  `textureResolution`, `simplifyTarget`, `outputGlb`.
- `lib/meshJobs/jobs.ts`, rotas `/api/mesh-jobs/next` (devolve os
  parâmetros do job, não só o id) e `/api/mesh-jobs/[id]/complete`
  (recebe `.glb` além de `.obj`/`.stl`), nova rota de download
  `download/glb`.
- `lib/validation/meshJob.ts` (novo): valida os parâmetros de geração
  vindos do formulário.
- `actions/meshJobs.ts` + `app/(app)/3d-generator/{page,MeshJobsExplorer}.tsx`:
  formulário com as novas opções, seed aleatória gerada no servidor
  (fica gravada e visível, mesmo com "aleatória" marcado), preview
  `<model-viewer>` por job.
- `worker/mesh_worker.py`: reescrito do zero. `Hunyuan3DDiTFlowMatchingPipeline`
  (forma, sempre) e `Hunyuan3DPaintPipeline` (textura, import tardio
  só quando o job pede) carregados uma vez e mantidos em cache no
  processo. Decimação via `trimesh.simplify_quadric_decimation`
  (precisa de `fast-simplification`, adicionado a `requirements.txt`).
- `worker/README.md` / `worker/start_worker.bat`: instalação em duas
  partes (forma, sempre necessária; textura, opcional e claramente
  marcada como não-aplicável ao hardware atual).
- Toda referência a TripoSR removida do projeto (código, comentários,
  docs ativos). Os specs/plans antigos nomeados "triposr" foram
  apagados (diferente do precedente de manter histórico — aqui foi
  pedido explicitamente apagar tudo relacionado, não só manter como
  registro).

## Pontos não verificados (documentados no código também)

A pesquisa que embasou esta troca leu o código-fonte oficial do
Hunyuan3D 2.1 diretamente (não blogs), mas o estágio de **textura**
não pôde ser testado de ponta a ponta neste projeto por falta de VRAM.
Dois pontos específicos ficam como "aposta mais provável, não
confirmada" (ver docstring de `get_paint_pipeline` em
`worker/mesh_worker.py`):

1. O valor de `custom_pipeline` usado (`.../hy3dpaint/hunyuanpaintpbr`)
   segue o `demo.py` oficial literalmente, embora divirja do default
   documentado na própria classe de configuração.
2. O subfolder do modelo de textura no Hugging Face
   (`hunyuan3d-paintpbr-v2-1`, citado no README) não aparece
   referenciado em nenhum código lido — não ficou claro como/se ele é
   selecionado automaticamente.

Quando alguém rodar a geração com textura pela primeira vez (GPU
maior), esses dois pontos são os primeiros lugares a olhar se algo
falhar.

# Worker local — Gerador de modelo 3D (Hunyuan3D 2.1)

Roda no seu PC (não na VPS de produção — ela não tem GPU). Faz polling
no TK3D perguntando se há imagens pendentes, processa localmente com sua
GPU, e devolve o resultado.

Repo oficial: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 (licença
própria da Tencent — Brasil está dentro do "Territory" permitido; ver o
LICENSE do repo antes de usar em produção fora deste uso pessoal).

## 1. Clonar o Hunyuan3D 2.1 e instalar a parte de FORMA (sempre precisa)

Gerar só a forma (malha sem cor) precisa de ~10GB de VRAM — roda numa
RTX 4070 de 12GB. É o modo padrão da tela (`/3d-generator`, "Gerar
textura" desmarcado) e o único testado de ponta a ponta neste setup.

```bash
git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 ~/Hunyuan3D-2.1
cd ~/Hunyuan3D-2.1
pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
pip install -r hy3dshape/requirements.txt
pip install diffusers==0.30.0 transformers==4.46.0
```

O `hy3dshape/requirements.txt` do próprio repo não fixa a versão do
`diffusers`/`transformers` -- sem o `pip install` extra acima, o pip
puxa uma versão nova demais do `diffusers` (que já usa a API
`torch.accelerator`, só existe no PyTorch 2.6+) e quebra com
`AttributeError: module 'torch' has no attribute 'accelerator'` ao
importar `hy3dshape`. As versões acima são as mesmas fixadas no
`requirements.txt` da raiz do repo, testadas pelo próprio Tencent junto
com o PyTorch 2.5.1.

Confirme que o pipeline de forma carrega e gera algo antes de seguir —
ex. rodando `python3 hy3dshape/minimal_demo.py` de dentro do clone (ele
baixa os pesos do Hugging Face na primeira execução, pode demorar).

## 2. Textura (opcional — SÓ necessário numa GPU com ~21GB+ de VRAM)

Gerar com textura (cor) não cabe numa RTX 4070 de 12GB — a própria
documentação oficial do Hunyuan3D 2.1 e relatos de usuários com GPUs de
16GB/24GB confirmam que o estágio de textura sozinho já precisa de
~21GB. O worker já tem o código desse caminho pronto (toggle "Gerar
textura" na tela), mas só tenta importar/rodar esse estágio quando um
job realmente pede — então **pule esta seção inteira enquanto sua GPU
não tiver VRAM suficiente**; o resto do worker funciona normalmente sem
ela.

Quando for usar (troca de placa de vídeo, ou uma GPU maior em nuvem),
instale também:

```bash
cd ~/Hunyuan3D-2.1
pip install -r requirements.txt   # requirements.txt da raiz do repo (cobre textura também)

cd hy3dpaint/custom_rasterizer
pip install -e .
cd ../..

cd hy3dpaint/DifferentiableRenderer
bash compile_mesh_painter.sh
cd ../..

wget https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth -P hy3dpaint/ckpt
```

`compile_mesh_painter.sh` compila uma extensão C++ (precisa de um
compilador C++ e do pybind11, instalado junto com o `requirements.txt`
da raiz) — se topar com erros de compilador aqui, os mesmos ajustes já
documentados no histórico deste projeto pra compilar extensões CUDA no
Windows (Visual Studio Build Tools, terminal "x64 Native Tools Command
Prompt") tendem a resolver.

## 3. Instalar as dependências deste worker

```bash
cd worker/
python -m venv .venv && source .venv/bin/activate   # opcional, recomendado
pip install -r requirements.txt
```

## 4. Configurar e rodar

```bash
export TK3D_URL="https://tk3d.coffetech.com.br"
export MESH_WORKER_SECRET="<o mesmo valor configurado em MESH_WORKER_SECRET no Coolify>"
export HUNYUAN3D_DIR="$HOME/Hunyuan3D-2.1"   # opcional, esse é o default
export TARGET_SIZE_MM="100"                  # opcional, esse é o default -- maior dimensão do modelo exportado, em mm

python mesh_worker.py
```

Os demais parâmetros de geração (resolução da malha, seed, textura
ligada/desligada, resolução de textura, decimação) não são mais
variáveis de ambiente — ficam na tela (`/3d-generator`), escolhidos por
job, e o worker lê isso de cada job que pega.

Deixe rodando enquanto quiser gerar modelos — pode fechar quando não
precisar mais; os jobs enviados nesse período ficam `PENDENTE` até você
rodar o worker de novo.

## Atalho pra ligar depois de desligar o PC

Desligar o PC não quebra nada — os pedidos feitos nesse meio tempo só
ficam `PENDENTE` esperando. Pra não ter que digitar os passos 3-4 toda
vez, `start_worker.bat` (nesta mesma pasta) já faz tudo de uma vez:
ativa o venv, define as variáveis de ambiente e roda o worker. Edite os
caminhos/valores dentro dele uma vez (caminho do clone do Hunyuan3D
muda por máquina) e depois é só dar duplo-clique nele sempre que quiser
gerar modelos.

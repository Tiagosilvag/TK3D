# Worker local — Gerador de modelo 3D (TripoSR)

Roda no seu PC (não na VPS de produção — ela não tem GPU). Faz polling
no TK3D perguntando se há imagens pendentes, processa localmente com sua
GPU, e devolve o resultado.

## 1. Clonar o TripoSR

```bash
git clone https://github.com/VAST-AI-Research/TripoSR ~/TripoSR
cd ~/TripoSR
pip install -r requirements.txt
```

Siga o README do próprio TripoSR pra instalar o PyTorch com suporte à
sua GPU (CUDA) — isso varia por placa/driver e não é coberto aqui.
Confirme que `python run.py <alguma_imagem.png> --output-dir /tmp/teste`
funciona e gera `/tmp/teste/0/mesh.obj` antes de seguir — se o caminho de
saída for diferente na versão que você clonou, ajuste a constante em
`mesh_worker.py#run_triposr`.

## 2. Instalar as dependências deste worker

```bash
cd worker/
python -m venv .venv && source .venv/bin/activate   # opcional, recomendado
pip install -r requirements.txt
```

## 3. Configurar e rodar

```bash
export TK3D_URL="https://tk3d.coffetech.com.br"
export MESH_WORKER_SECRET="<o mesmo valor configurado em MESH_WORKER_SECRET no Coolify>"
export TRIPOSR_DIR="$HOME/TripoSR"   # opcional, esse é o default
export MC_RESOLUTION="512"           # opcional, esse é o default -- resolução da malha (maior = mais detalhe, mais VRAM/tempo)
export TARGET_SIZE_MM="100"          # opcional, esse é o default -- maior dimensão do modelo exportado, em mm

python mesh_worker.py
```

Deixe rodando enquanto quiser gerar modelos — pode fechar quando não
precisar mais; os jobs enviados nesse período ficam `PENDENTE` até você
rodar o worker de novo.

## Atalho pra ligar depois de desligar o PC

Desligar o PC não quebra nada — os pedidos feitos nesse meio tempo só
ficam `PENDENTE` esperando. Pra não ter que digitar os passos 2-3 toda
vez, `start_worker.bat` (nesta mesma pasta) já faz tudo de uma vez:
ativa o venv, define as variáveis de ambiente e roda o worker. Edite os
caminhos/valores dentro dele uma vez (Client ID/caminho do TripoSR
mudam por máquina) e depois é só dar duplo-clique nele sempre que
quiser gerar modelos.

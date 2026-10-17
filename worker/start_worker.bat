@echo off
REM Atalho pra ligar o worker local do Gerador de modelo 3D (Hunyuan3D 2.1)
REM depois de ligar o PC -- ajuste os caminhos/valores abaixo se o seu
REM setup for diferente do documentado em worker/README.md. Usa um venv
REM ÚNICO (dentro da pasta do clone do modelo) em vez de dois venvs
REM separados -- mais simples.

cd /d "C:\Users\Admin\Hunyuan3D-2.1"
call .venv\Scripts\activate

cd /d "C:\Users\Admin\TK3D\worker"

set TK3D_URL=https://tk3d.coffetech.com.br
set MESH_WORKER_SECRET=COLOQUE_AQUI_O_MESMO_VALOR_DO_COOLIFY
set HUNYUAN3D_DIR=C:\Users\Admin\Hunyuan3D-2.1

python mesh_worker.py

REM Mantem a janela aberta se o worker encerrar sozinho (ex.: erro logo
REM no inicio), pra dar tempo de ler a mensagem antes de fechar.
pause

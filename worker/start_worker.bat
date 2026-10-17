@echo off
REM Atalho pra ligar o worker local do Gerador de modelo 3D (TripoSR)
REM depois de ligar o PC -- ajuste os caminhos/valores abaixo se o seu
REM setup for diferente do documentado em worker/README.md.

cd /d "C:\Users\Admin\~\TripoSR"
call .venv\Scripts\activate

cd /d "C:\Users\Admin\TK3D\worker"

set TK3D_URL=https://tk3d.coffetech.com.br
set MESH_WORKER_SECRET=44dabcb84bee7e0d5c367b35f7abce2a68725a737a601ed518335dde9807cb98
set TRIPOSR_DIR=C:\Users\Admin\~\TripoSR

python mesh_worker.py

REM Mantem a janela aberta se o worker encerrar sozinho (ex.: erro logo
REM no inicio), pra dar tempo de ler a mensagem antes de fechar.
pause

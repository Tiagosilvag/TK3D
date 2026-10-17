#!/usr/bin/env python3
"""Worker local do gerador de modelo 3D (TripoSR) -- roda no PC do
usuário, nunca na VPS de produção (sem GPU lá). Faz polling em
/api/mesh-jobs/next, baixa a imagem pendente, roda o TripoSR via
subprocess (repositório clonado separadamente, ver README.md deste
diretório), converte o .obj resultante pra .stl com trimesh, e envia o
resultado de volta.

Ver spec: docs/superpowers/specs/2026-10-14-gerador-3d-triposr-design.md
"""
import os
import subprocess
import sys
import tempfile
import time

import requests
import trimesh

TK3D_URL = os.environ["TK3D_URL"].rstrip("/")
MESH_WORKER_SECRET = os.environ["MESH_WORKER_SECRET"]
TRIPOSR_DIR = os.environ.get("TRIPOSR_DIR", os.path.expanduser("~/TripoSR"))
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
# Resolução do marching cubes que extrai a malha -- o padrão do run.py
# (256) produz aquele aspecto "em degraus"/ondulado em superfícies
# curvas. 512 custa mais VRAM/tempo, mas numa GPU como a RTX 4070 ainda
# roda em segundos e o ganho de detalhe é grande.
MC_RESOLUTION = os.environ.get("MC_RESOLUTION", "512")
# TripoSR exporta a malha numa escala normalizada (~2 unidades de lado),
# sem noção nenhuma de tamanho real -- todo modelo abre no fatiador como
# "objeto muito pequeno" (~2mm). Escalamos pra que a maior dimensão da
# caixa delimitadora vire essa medida em mm antes de salvar o STL.
TARGET_SIZE_MM = float(os.environ.get("TARGET_SIZE_MM", "100"))

HEADERS = {"Authorization": f"Bearer {MESH_WORKER_SECRET}"}


def claim_next_job():
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/next", headers=HEADERS, timeout=30)
    if resp.status_code == 204:
        return None
    resp.raise_for_status()
    return resp.json()["id"]


def download_image(job_id: str, dest_path: str) -> None:
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/{job_id}/image", headers=HEADERS, timeout=60)
    resp.raise_for_status()
    with open(dest_path, "wb") as f:
        f.write(resp.content)


def run_triposr(image_path: str, output_dir: str) -> str:
    """Invoca o run.py oficial do TripoSR como processo separado. Ajuste
    o comando/caminho de saída aqui se a versão do TripoSR que você
    clonou documentar algo diferente -- este script assume a CLI pública
    descrita no README do próprio projeto no momento em que esta
    integração foi escrita (saída em <output_dir>/0/mesh.obj). Confira o
    README do TripoSR antes de rodar pela primeira vez."""
    subprocess.run(
        [sys.executable, "run.py", image_path, "--output-dir", output_dir, "--mc-resolution", MC_RESOLUTION],
        cwd=TRIPOSR_DIR,
        check=True,
    )
    obj_path = os.path.join(output_dir, "0", "mesh.obj")
    if not os.path.exists(obj_path):
        raise RuntimeError(
            f"TripoSR não gerou {obj_path} -- confira o README do TripoSR "
            "pra ver se o layout de saída mudou"
        )
    return obj_path


def convert_obj_to_stl(obj_path: str) -> str:
    # force='mesh' garante um único Trimesh concatenado mesmo se o OBJ
    # vier como múltiplos grupos/materiais (trimesh devolveria uma Scene
    # nesse caso, que não tem a mesma API de escala/export direto).
    mesh = trimesh.load(obj_path, force="mesh")
    largest_dimension = max(mesh.bounding_box.extents)
    if largest_dimension > 0:
        mesh.apply_scale(TARGET_SIZE_MM / largest_dimension)
    stl_path = obj_path.replace(".obj", ".stl")
    mesh.export(stl_path)
    return stl_path


def complete_job(job_id: str, obj_path: str, stl_path: str) -> None:
    with open(obj_path, "rb") as obj_file, open(stl_path, "rb") as stl_file:
        files = {
            "obj": ("mesh.obj", obj_file, "model/obj"),
            "stl": ("mesh.stl", stl_file, "model/stl"),
        }
        resp = requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/complete", headers=HEADERS, files=files, timeout=120)
    resp.raise_for_status()


def fail_job(job_id: str, message: str) -> None:
    try:
        requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/fail", headers=HEADERS, json={"message": message}, timeout=30)
    except requests.RequestException:
        print(f"[worker] não conseguiu reportar falha do job {job_id} pro servidor: {message}")


def process_job(job_id: str) -> None:
    print(f"[worker] processando job {job_id}")
    with tempfile.TemporaryDirectory() as tmp:
        image_path = os.path.join(tmp, "input")
        download_image(job_id, image_path)
        try:
            obj_path = run_triposr(image_path, tmp)
            stl_path = convert_obj_to_stl(obj_path)
            complete_job(job_id, obj_path, stl_path)
            print(f"[worker] job {job_id} concluído")
        except Exception as err:  # qualquer falha vira ERRO no job, nunca trava o loop
            print(f"[worker] job {job_id} falhou: {err}")
            fail_job(job_id, str(err))


def main() -> None:
    print(f"[worker] iniciando, apontando pra {TK3D_URL}, polling a cada {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            job_id = claim_next_job()
        except requests.RequestException as err:
            print(f"[worker] falha ao consultar jobs pendentes: {err}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        if job_id:
            process_job(job_id)
        else:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

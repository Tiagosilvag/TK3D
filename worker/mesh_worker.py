#!/usr/bin/env python3
"""Worker local do gerador de modelo 3D (Hunyuan3D 2.1) -- roda no PC do
usuário, nunca na VPS de produção (sem GPU lá). Faz polling em
/api/mesh-jobs/next, baixa a imagem e os parâmetros do job pendente, gera
a malha com o Hunyuan3D 2.1 (forma sempre -- 10GB de VRAM, roda na placa
atual; textura só quando o próprio job pede, via toggle na tela -- ~21GB
de VRAM, não cabe na placa atual, mas o caminho de código já fica pronto
pra uma troca futura de GPU), decima/escala com trimesh, e envia o
resultado de volta (.obj, .stl pro fatiador, .glb pro preview na tela).

Ver spec: docs/superpowers/specs/2026-10-17-gerador-3d-hunyuan3d-design.md
Repo oficial: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 (clone
separado, ver README.md deste diretório pra instalação).
"""
import os
import sys
import tempfile
import time
import traceback

import requests
import torch
import trimesh

TK3D_URL = os.environ["TK3D_URL"].rstrip("/")
MESH_WORKER_SECRET = os.environ["MESH_WORKER_SECRET"]
# Raiz do clone do repo oficial Tencent-Hunyuan/Hunyuan3D-2.1 (ver
# README.md pra instalação). De dentro dele importamos hy3dshape/
# (geração de forma, sempre) e hy3dpaint/ (textura, só quando o job
# pede -- ver get_paint_pipeline).
HUNYUAN3D_DIR = os.environ.get("HUNYUAN3D_DIR", os.path.expanduser("~/Hunyuan3D-2.1"))
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
# Hunyuan3D exporta a malha numa escala própria do modelo, sem noção de
# tamanho real de impressão -- maior dimensão da caixa delimitadora vira
# essa medida em mm antes de salvar o STL/OBJ finais.
TARGET_SIZE_MM = float(os.environ.get("TARGET_SIZE_MM", "100"))

HEADERS = {"Authorization": f"Bearer {MESH_WORKER_SECRET}"}

_shape_pipeline = None
_paint_pipeline = None


def get_shape_pipeline():
    """Carrega (uma vez, fica em cache em memória) o pipeline de geração
    de forma -- 10GB de VRAM, roda na placa atual. Import local porque
    hy3dshape só existe depois de clonar o repo oficial (ver README.md)."""
    global _shape_pipeline
    if _shape_pipeline is None:
        sys.path.insert(0, os.path.join(HUNYUAN3D_DIR, "hy3dshape"))
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        _shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2.1", device="cuda")
    return _shape_pipeline


def get_paint_pipeline():
    """Carrega (uma vez, fica em cache) o pipeline de textura -- ~21GB de
    VRAM, não roda na RTX 4070 12GB atual do usuário; existe pra já estar
    pronto numa troca futura de GPU. Import local e tardio de propósito:
    só é tentado quando um job realmente pede textura (job["generateTexture"]),
    então o uso do dia a dia (só forma) nunca precisa do estágio de
    textura instalado/compilado (ver README.md, seção "textura, opcional").

    Segue literalmente a sequência de chamadas do demo.py oficial --
    inclusive o valor de custom_pipeline apontando pra dentro do clone
    ("<repo>/hy3dpaint/hunyuanpaintpbr"), que diverge do default
    documentado na própria classe de config ("hunyuanpaintpbr" sem
    caminho). É o que o demo shipado pela Tencent de fato usa/testa; não
    foi possível confirmar qual dos dois é "o certo" nem testar esse
    trecho de ponta a ponta aqui (VRAM insuficiente no hardware atual) --
    seguir o demo oficial ao pé da letra é a aposta mais segura até
    alguém rodar isso numa GPU grande o bastante."""
    global _paint_pipeline
    if _paint_pipeline is None:
        sys.path.insert(0, os.path.join(HUNYUAN3D_DIR, "hy3dpaint"))
        from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline

        conf = Hunyuan3DPaintConfig(max_num_view=6, resolution=512)
        conf.realesrgan_ckpt_path = os.path.join(HUNYUAN3D_DIR, "hy3dpaint", "ckpt", "RealESRGAN_x4plus.pth")
        conf.multiview_cfg_path = os.path.join(HUNYUAN3D_DIR, "hy3dpaint", "cfgs", "hunyuan-paint-pbr.yaml")
        conf.custom_pipeline = os.path.join(HUNYUAN3D_DIR, "hy3dpaint", "hunyuanpaintpbr")
        _paint_pipeline = Hunyuan3DPaintPipeline(conf)
    return _paint_pipeline


def claim_next_job():
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/next", headers=HEADERS, timeout=30)
    if resp.status_code == 204:
        return None
    resp.raise_for_status()
    return resp.json()


def download_image(job_id: str, dest_path: str) -> None:
    resp = requests.get(f"{TK3D_URL}/api/mesh-jobs/{job_id}/image", headers=HEADERS, timeout=60)
    resp.raise_for_status()
    with open(dest_path, "wb") as f:
        f.write(resp.content)


def generate_shape(image_path: str, output_dir: str, octree_resolution: int, seed) -> str:
    """Gera a malha (sem textura) a partir da imagem. Retorna o caminho
    do .glb exportado -- formato oficial do demo.py/minimal_demo.py do
    Hunyuan3D 2.1 (mesh.export('demo.glb'))."""
    pipeline = get_shape_pipeline()
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cuda").manual_seed(seed)
    mesh = pipeline(image=image_path, octree_resolution=octree_resolution, generator=generator)[0]
    glb_path = os.path.join(output_dir, "shape.glb")
    mesh.export(glb_path)
    return glb_path


def generate_texture(shape_glb_path: str, image_path: str, resolution: int, output_dir: str) -> str:
    """Pinta a malha já gerada com base na imagem original. Precisa de
    ~21GB de VRAM -- em VRAM insuficiente, torch levanta um erro de "out
    of memory" (capturado em process_job, vira ERRO no job com mensagem
    clara pro usuário, nunca derruba o worker). Segue o fluxo literal do
    demo.py oficial: a malha de forma precisa estar em disco (não em
    memória) pro pipeline de textura ler via mesh_path -- por isso
    generate_shape já exporta pra arquivo antes desta função ser chamada."""
    pipeline = get_paint_pipeline()
    output_obj_path = os.path.join(output_dir, "textured.obj")
    # output_mesh_path tem que ser .obj aqui -- o código oficial monta o
    # caminho do .glb irmão fazendo output_mesh_path.replace(".obj", ".glb"),
    # então passar .glb direto (como um dos exemplos oficiais faz) quebra
    # essa substituição. Ver docstring acima sobre os pontos não
    # confirmados deste estágio.
    result_path = pipeline(
        mesh_path=shape_glb_path,
        image_path=image_path,
        output_mesh_path=output_obj_path,
        save_glb=True,
    )
    glb_path = result_path.replace(".obj", ".glb")
    return glb_path if os.path.exists(glb_path) else result_path


def finalize_outputs(glb_path: str, simplify_target) -> tuple[str, str, str]:
    """A partir do .glb bruto (com ou sem textura), aplica escala pra
    tamanho de impressão e decimação opcional (simplify_target -- não é
    um parâmetro do Hunyuan3D, é pós-processamento nosso via trimesh), e
    exporta as 3 saídas finais: .obj e .stl pro fluxo de impressão, .glb
    pro preview na tela. decimação de malha com textura pode perder
    precisão nas coordenadas de UV -- aceitável aqui, o arquivo que
    importa pra impressão é o .stl (sem cor de qualquer forma)."""
    # force='mesh' garante um único Trimesh concatenado (um .glb com
    # múltiplos materiais/nós viraria uma Scene, sem a mesma API de
    # escala/simplificação/export direto).
    mesh = trimesh.load(glb_path, force="mesh")
    largest_dimension = max(mesh.bounding_box.extents)
    if largest_dimension > 0:
        mesh.apply_scale(TARGET_SIZE_MM / largest_dimension)
    if simplify_target and len(mesh.faces) > simplify_target:
        mesh = mesh.simplify_quadric_decimation(simplify_target)

    base = os.path.join(os.path.dirname(glb_path), "final")
    obj_path, stl_path, out_glb_path = base + ".obj", base + ".stl", base + ".glb"
    mesh.export(obj_path)
    mesh.export(stl_path)
    mesh.export(out_glb_path)
    return obj_path, stl_path, out_glb_path


def complete_job(job_id: str, obj_path: str, stl_path: str, glb_path: str) -> None:
    with open(obj_path, "rb") as obj_file, open(stl_path, "rb") as stl_file, open(glb_path, "rb") as glb_file:
        files = {
            "obj": ("mesh.obj", obj_file, "model/obj"),
            "stl": ("mesh.stl", stl_file, "model/stl"),
            "glb": ("mesh.glb", glb_file, "model/gltf-binary"),
        }
        resp = requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/complete", headers=HEADERS, files=files, timeout=180)
    resp.raise_for_status()


def fail_job(job_id: str, message: str) -> None:
    try:
        requests.post(f"{TK3D_URL}/api/mesh-jobs/{job_id}/fail", headers=HEADERS, json={"message": message}, timeout=30)
    except requests.RequestException:
        print(f"[worker] não conseguiu reportar falha do job {job_id} pro servidor: {message}")


def process_job(job: dict) -> None:
    job_id = job["id"]
    wants_texture = job["generateTexture"]
    print(f"[worker] processando job {job_id} (textura={'sim' if wants_texture else 'não'})")
    with tempfile.TemporaryDirectory() as tmp:
        image_path = os.path.join(tmp, "input")
        download_image(job_id, image_path)
        try:
            glb_path = generate_shape(image_path, tmp, job["octreeResolution"], job["seed"])
            if wants_texture:
                glb_path = generate_texture(glb_path, image_path, job["textureResolution"], tmp)
            obj_path, stl_path, final_glb_path = finalize_outputs(glb_path, job["simplifyTarget"])
            complete_job(job_id, obj_path, stl_path, final_glb_path)
            print(f"[worker] job {job_id} concluído")
        except (ImportError, ModuleNotFoundError) as err:
            message = (
                'Estágio de textura não instalado neste worker -- veja README.md (seção "Textura (opcional)") antes '
                f'de marcar "Gerar textura". Detalhe: {err}'
            )
            print(f"[worker] job {job_id} falhou: {message}")
            print(traceback.format_exc())
            fail_job(job_id, message)
        except Exception as err:  # qualquer outra falha vira ERRO no job, nunca trava o loop
            message = str(err)
            if "out of memory" in message.lower():
                message = (
                    'Sem VRAM suficiente pra gerar textura (precisa de ~21GB). Gere de novo sem "Gerar textura" '
                    f"marcado, ou tente numa GPU com mais VRAM. Detalhe: {message}"
                )
            print(f"[worker] job {job_id} falhou: {message}")
            # Mensagem curta vai pro job (aparece na tela); o traceback
            # completo só no terminal do worker -- essencial pra
            # diagnosticar erros genéricos do Windows (ex. WinError 267)
            # que não dizem em qual chamada realmente estouraram.
            print(traceback.format_exc())
            fail_job(job_id, message)


def main() -> None:
    print(f"[worker] iniciando, apontando pra {TK3D_URL}, polling a cada {POLL_INTERVAL_SECONDS}s")
    while True:
        try:
            job = claim_next_job()
        except requests.RequestException as err:
            print(f"[worker] falha ao consultar jobs pendentes: {err}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        if job:
            process_job(job)
        else:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

"""Modal-приложение для AI-пайплайна fancai."""

from pathlib import Path

import modal

from config import (
    VOLUME_NAME,
    VOLUME_PATH,
    LLM_GPU,
    IMAGE_GPU,
    SCALEDOWN_WINDOW,
    LLM_TIMEOUT,
    IMAGE_TIMEOUT,
)

app = modal.App("fancai-pipeline")

model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Локальные .py файлы добавляются в образ через add_local_dir (Modal 1.0+ API)
_modal_src = Path(__file__).parent

llm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm>=0.18.0", "pydantic>=2.0")
    .add_local_dir(_modal_src, remote_path="/root")
)

diffusers_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "diffusers>=0.37", "torch>=2.5", "transformers>=4.45", "accelerate>=1.0"
    )
    .add_local_dir(_modal_src, remote_path="/root")
)

# Общие параметры для обоих классов
COMMON_CLS_KWARGS = dict(
    volumes={VOLUME_PATH: model_volume},
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)

# Импорт классов — Modal должен видеть @app.cls декораторы при deploy
import llm_extractor  # noqa: F401, E402
import image_generator  # noqa: F401, E402

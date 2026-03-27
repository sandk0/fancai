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

# Монтируем все .py файлы из modal/ в контейнер для корректных импортов
_local_source = modal.Mount.from_local_dir(
    Path(__file__).parent, remote_path="/root", condition=lambda p: p.endswith(".py")
)

llm_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "vllm>=0.18.0", "pydantic>=2.0"
)

diffusers_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "diffusers>=0.37", "torch>=2.5", "transformers>=4.45", "accelerate>=1.0"
)

# Общие параметры для обоих классов
COMMON_CLS_KWARGS = dict(
    volumes={VOLUME_PATH: model_volume},
    mounts=[_local_source],
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)

# Импорт классов — Modal должен видеть @app.cls декораторы при deploy
import llm_extractor  # noqa: F401, E402
import image_generator  # noqa: F401, E402

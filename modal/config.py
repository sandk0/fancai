"""Конфигурация Modal pipeline."""

# Модели
LLM_MODEL_ID = "Qwen/Qwen3.5-9B"
IMAGE_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
VOLUME_PATH = "/models"
VOLUME_NAME = "fancai-models"

# GPU
LLM_GPU = "L4"
IMAGE_GPU = "L4"

# vLLM
MAX_MODEL_LEN = 65536
GPU_MEMORY_UTILIZATION = 0.90
KV_CACHE_DTYPE = "fp8"

# Таймауты
LLM_TIMEOUT = 600  # 10 мин
IMAGE_TIMEOUT = 120  # 2 мин
SCALEDOWN_WINDOW = 120  # 2 мин простоя до scale-to-zero

# Генерация изображений
IMAGE_WIDTH = 768
IMAGE_HEIGHT = 768
IMAGE_NUM_STEPS = 4
IMAGE_GUIDANCE_SCALE = 1.0  # 1.0 для distilled Klein 4B

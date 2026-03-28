"""Конфигурация Modal pipeline."""

# Модели
LLM_MODEL_ID = "Qwen/Qwen3.5-9B"
IMAGE_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
VOLUME_PATH = "/models"
VOLUME_NAME = "fancai-models"

# GPU
# L40S (48GB) для LLM — Qwen3.5-9B (17.7 GiB) + KV cache для 65K контекста
# L4 (24GB) для ImageGen — FLUX.2 Klein (~8 GiB), хватает с запасом
LLM_GPU = "L40S"
IMAGE_GPU = "L4"

# vLLM
MAX_MODEL_LEN = 65536
GPU_MEMORY_UTILIZATION = 0.90
KV_CACHE_DTYPE = "fp8"

# vLLM Bug #37121 (OPEN): 7x KV cache overestimation. Калибровать по production логам (D-14)
NUM_GPU_BLOCKS_OVERRIDE = 512

# Таймауты
LLM_TIMEOUT = 1800  # D-16: 30 мин — Modal safety net для batch processing
VPS_TIMEOUT_BUFFER = 60  # секунд запаса для сетевого overhead
IMAGE_TIMEOUT = 120  # 2 мин
SCALEDOWN_WINDOW = 120  # 2 мин простоя до scale-to-zero

# Sub-batch (Phase 37)
OVERSIZED_THRESHOLD_TOKENS = 32000  # D-07: глава > 32K tokens -> sequential
BATCH_TOKEN_BUDGET = 128000  # D-03: max_model_len / 2
BATCH_MAX_CHAPTERS = 12  # D-04: максимум глав в batch
BATCH_MIN_CHAPTERS = 2  # D-04: минимум для batch

# Генерация изображений
IMAGE_WIDTH = 768
IMAGE_HEIGHT = 768
IMAGE_NUM_STEPS = 4
IMAGE_GUIDANCE_SCALE = 1.0  # 1.0 для distilled Klein 4B

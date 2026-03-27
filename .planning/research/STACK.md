# Stack Research: Modal Batch Processing & Production Stability

**Domain:** Стабилизация и ускорение AI pipeline (vLLM + Modal + OpenRouter fallback)
**Researched:** 2026-03-27
**Confidence:** HIGH (основано на FINAL-consolidated-audit.md + код-ревью + веб-верификация)

## Scope

Исследование покрывает **только новые технологии и изменения** для v1.5. Существующий стек (React 19, FastAPI, PostgreSQL 17, Redis 7.4, Celery, OpenRouter, Docker Compose) — **не переисследован**.

---

## Recommended Stack

### Core Technologies (изменения и дополнения)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| vLLM | 0.18.0 (pin) | LLM inference на Modal | Уже в production. Pin через `vllm==0.18.0` вместо `>=0.18.0` — API нестабильный между минорами (`guided_decoding_backend` удалён в v0.12.0, заменён `structured_outputs_config`) |
| Modal SDK | >=1.3.0 | Serverless GPU compute | Уже в production. `modal>=0.73` в requirements.txt — обновить до `>=1.3.0` для `startup_timeout` (добавлен v1.1.4) и Volume v2 |
| Pydantic | 2.12+ | Schema constraints с `max_length` | Уже установлен. `Field(max_length=N)` генерирует `maxLength` в JSON Schema — xgrammar его уважает. Единственное ограничение: `maxLength` игнорируется при наличии `format`/`pattern` (у нас их нет) |
| Loguru | 0.7.3 | Structured logging | Уже в production (`backend/requirements.txt`). Поддерживает `serialize=True` для JSON output. **НЕ менять на structlog** — 30+ файлов уже на Loguru |

### Новые компоненты vLLM (конфигурация, не установка)

| Компонент | API | Purpose | Детали |
|-----------|-----|---------|--------|
| `StructuredOutputsConfig` | `from vllm.config.structured_outputs import StructuredOutputsConfig` | Выбор backend для structured output | `StructuredOutputsConfig(backend="xgrammar")` — xgrammar лучше для batch с фиксированной схемой. Default `auto` в production сейчас |
| `num_gpu_blocks_override` | Параметр `LLM()` | Обход Bug #37121 (7x KV cache overestimation для Qwen3.5) | Issue OPEN. PR #37429 NOT MERGED. Стартовое значение 512 — требует profiling sweep |
| `compilation_config` | `LLM(compilation_config={...})` | Оптимизация CUDA graphs | Принимает `dict`, `int`, или `CompilationConfig`. Plain dict работает: `{"cudagraph_capture_sizes": [...]}` |
| `enable_sleep_mode` | `LLM(enable_sleep_mode=True)` + `llm.sleep(level=1)` / `llm.wake_up()` | GPU snapshot оптимизация | Работает в offline LLM class. Sleep levels: 0=пауза, 1=offload weights, 2=discard всё. **НО**: `vllm.LLM` + `@modal.enter(snap=True)` — ноль официальных примеров. POC-гипотеза |
| `enable_prefix_caching` | Уже включён | KV cache для system prompt | Общий system prompt кешируется между запросами в sub-batch. Уже в production |

### Modal (изменения конфигурации)

| Компонент | Текущее | Рекомендация | Обоснование |
|-----------|---------|--------------|-------------|
| Compile cache volume | Отсутствует | `modal.Volume.from_name("fancai-compile-cache")` | torch.compile/vLLM JIT артефакты сохраняются между cold start. Ожидаемый эффект: -20-30s cold start. Монтировать в `~/.cache/vllm/` |
| `startup_timeout` | Не задан | Добавить в `COMMON_CLS_KWARGS` | Появился в Modal v1.1.4. Защита от зависания при GPU queueing |
| `scaledown_window` | 120s | 60s (после перехода на batch) | $0.065 -> $0.033 за idle период. При batch mode контейнер активен реже |
| Image pinning | `vllm>=0.18.0` | `vllm==0.18.0` | Breaking changes между минорами. Pin конкретную версию |
| Multiple volumes | 1 (model_volume) | 2 (model_volume + compile_cache_volume) | `volumes={VOLUME_PATH: model_volume, "/root/.cache/vllm": compile_cache_volume}` |

### Backend (error handling — новый код)

| Компонент | Import | Purpose | Детали |
|-----------|--------|---------|--------|
| `modal.exception.FunctionTimeoutError` | `from modal.exception import FunctionTimeoutError` | Отдельный catch для timeout | Текущий код ловит generic `Exception`. Нужен раздельный catch для timeout vs JSON error vs Modal error |
| `modal.exception.RemoteError` | `from modal.exception import RemoteError` | Modal infrastructure failures | Отделить от user-level errors |
| `modal.exception.InputCancellation` | `from modal.exception import InputCancellation` | Cancellation signals | Видно в production логах: "Received a cancellation signal" |
| `json.JSONDecodeError` | Встроенный | Broken JSON от LLM | Самая частая ошибка в production (10/23 глав). Отделить от timeout |

### Observability (доработка существующего стека)

| Компонент | Подход | Purpose | Обоснование |
|-----------|--------|---------|-------------|
| Structured logging per chapter | Loguru `logger.bind()` | Метрики latency, cost, error type | **НЕ добавлять** Prometheus/Grafana/OpenTelemetry — overkill для текущего масштаба. Loguru `serialize=True` уже даёт JSON output в production |
| Return metadata из Modal | Dict в response | Cold start time, inference time, tokens | Вариант 3 из аудита: `{"results": [...], "metrics": {...}}`. Проще всего, не требует infrastructure changes |
| Error type classification | `chapter.parsing_error` field | Нормализованный `error_type` | Enum: `timeout`, `json_error`, `modal_error`, `cancellation`, `truncated`, `unknown` |

---

## Конкретные изменения кода

### 1. `modal/schemas.py` — maxLength constraints

```python
from pydantic import BaseModel, Field

class ModalEntitySchema(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(default="character", max_length=50)
    visual_summary: str = Field(default="", max_length=500)
    aliases: list[str] = Field(default_factory=list)
    confidence: float = Field(default=1.0)
    importance: int = Field(default=5)
    first_mention_offset: int | None = None
    chapter_event_action: str | None = Field(default=None, max_length=300)
    chapter_event_inner: str | None = Field(default=None, max_length=300)

class ModalDescriptionSchema(BaseModel):
    content: str = Field(max_length=2000)
    type: str = Field(default="location", max_length=50)
    confidence: float = Field(default=1.0)
    entities: list[str] = Field(default_factory=list)
    text_offset: int | None = None
    image_prompt_en: str = Field(default="", max_length=300)

class ModalRelationshipSchema(BaseModel):
    source: str = Field(max_length=200)
    target: str = Field(max_length=200)
    type: str = Field(max_length=100)
    weight: float = Field(default=0.5)
    context: str = Field(default="", max_length=300)
```

**Обоснование значений**: аудит рекомендует эти лимиты на основе типичных output'ов. xgrammar обрезает на `maxLength` символов (не на границе слова) — это приемлемо: обрезанное описание лучше broken JSON.

### 2. `modal/llm_extractor.py` — batch method + finish_reason

```python
@modal.method()
def extract_chapters_batch(
    self, chapters: list[dict], system_prompt: str, schema_json: str
) -> list[dict]:
    """Sub-batch извлечение для нескольких глав."""
    from vllm import SamplingParams
    from vllm.sampling_params import StructuredOutputsParams

    params = SamplingParams(
        max_tokens=16384,
        temperature=0.1,
        structured_outputs=StructuredOutputsParams(json=schema_json),
    )
    conversations = [
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{ch['text']}</book_text>"},
        ]
        for ch in chapters
    ]
    results = self.llm.chat(conversations, params)

    parsed = []
    for i, result in enumerate(results):
        output = result.outputs[0]
        entry = {
            "chapter_number": chapters[i]["chapter_number"],
            "finish_reason": str(output.finish_reason),
        }
        if output.finish_reason == "length":
            entry["truncated"] = True
        try:
            entry["data"] = json.loads(output.text)
            entry["success"] = True
        except json.JSONDecodeError as e:
            entry["error"] = f"json_error: {str(e)[:200]}"
            entry["success"] = False
            entry["raw_text"] = output.text[:500]
        parsed.append(entry)
    return parsed
```

**Ключевой момент**: `llm.chat()` принимает список conversations — каждый элемент это отдельный диалог. vLLM автоматически батчит их с continuous batching. Это **не** `llm.chat([single_conversation])` — это `llm.chat([conv1, conv2, ..., convN])`.

### 3. `modal/config.py` — новые параметры

```python
# Добавить:
NUM_GPU_BLOCKS_OVERRIDE = 512  # Bug #37121 workaround, tune via profiling
LLM_TIMEOUT = 900  # Повышен с 600 (временно, до batch mode)
SUB_BATCH_SIZE = 4  # Начинать с 4, увеличивать до 8-12 по результатам
COMPILE_CACHE_VOLUME_NAME = "fancai-compile-cache"
SCALEDOWN_WINDOW = 60  # Снижен после перехода на batch (экономия $0.032/idle)
```

### 4. `modal/app.py` — compile cache volume

```python
compile_cache_volume = modal.Volume.from_name(
    COMPILE_CACHE_VOLUME_NAME, create_if_missing=True
)

COMMON_CLS_KWARGS = dict(
    volumes={
        VOLUME_PATH: model_volume,
        "/root/.cache/vllm": compile_cache_volume,
    },
    scaledown_window=SCALEDOWN_WINDOW,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
```

### 5. `backend/app/tasks/book_tasks.py` — error classification

```python
from modal.exception import FunctionTimeoutError, RemoteError, InputCancellation

# В цикле обработки глав:
try:
    result = await asyncio.wait_for(
        asyncio.to_thread(extractor.extract_chapter.remote, ...),
        timeout=LLM_TIMEOUT + 60,  # VPS-side timeout с запасом
    )
except FunctionTimeoutError:
    error_type = "timeout"
except RemoteError as e:
    error_type = "modal_error"
except InputCancellation:
    error_type = "cancellation"
except json.JSONDecodeError:
    error_type = "json_error"
except asyncio.TimeoutError:
    error_type = "vps_timeout"
except Exception as e:
    error_type = "unknown"
```

---

## Alternatives Considered

| Рекомендация | Альтернатива | Почему НЕ альтернатива |
|-------------|-------------|------------------------|
| Loguru (оставить) | structlog | 30+ файлов уже на Loguru. structlog лучше для greenfield, но миграция — ненужный effort. Loguru `serialize=True` достаточен для JSON |
| Loguru (оставить) | python-json-logger | Обёртка над stdlib logging. Loguru мощнее из коробки |
| xgrammar backend | guidance | xgrammar быстрее для batch с фиксированной JSON schema. guidance лучше для complex grammars — у нас schema фиксированная |
| Return metadata из Modal | Prometheus push gateway | Overkill для 1 production пользователя. Push gateway добавляет infrastructure complexity |
| Return metadata из Modal | modal.Queue | Усложняет код. Return dict проще и достаточно |
| Chars-based token estimation | AutoTokenizer на Celery worker | AutoTokenizer для Qwen3.5-9B = ~500MB RAM + ~2-3s init. Chars heuristic (`len/3.5`) достаточно точен для threshold проверки. AutoTokenizer — для точного подсчёта, если heuristic даёт ложные срабатывания |
| `vllm==0.18.0` pin | `vllm>=0.18.0` | API ломается между минорами. `guided_decoding_backend` удалён в v0.12.0 без предупреждения. Pin конкретную версию, обновлять сознательно |
| 2 volumes (model + cache) | 1 volume для всего | Compile cache обновляется часто, model weights — редко. Раздельные volumes = независимый lifecycle |

---

## What NOT to Use

| Избегать | Почему | Использовать вместо |
|----------|--------|---------------------|
| `guided_decoding_backend` параметр | **Удалён в vLLM v0.12.0**. Встречается только в deprecation notices | `structured_outputs_config=StructuredOutputsConfig(backend="xgrammar")` |
| `GuidedDecodingParams` | **Удалён в vLLM v0.12.0** | `StructuredOutputsParams` |
| Prometheus / Grafana / OpenTelemetry | Overkill для текущего масштаба (1 active user). Добавляет 3+ контейнера | Loguru JSON logging + return metadata из Modal |
| structlog | Миграция с Loguru — ненужный churn для 30+ файлов | Loguru `serialize=True` + `logger.bind()` для structured context |
| vLLM server mode (`vllm serve`) | Требует рефактор Modal class. `vllm.LLM` offline mode достаточен для batch. Sleep mode работает в LLM class | `vllm.LLM` + `llm.chat([conversations])` |
| `FlashAttention v3/v4` | Только Hopper/Blackwell GPU. L40S = Ada Lovelace (SM 8.9) | Default FLASH_ATTN (FlashAttention v2) — оптимален для L40S |
| Triton attention backend | Portable но медленнее. Единственный плюс — уход от `nvidia/cuda:devel` image | FLASH_ATTN (default) через FlashInfer JIT |
| `min_containers` для Modal | Оплачивается полностью даже в idle. L40S $1.95/hr = $46.80/day | `scaledown_window=60` для scale-to-zero |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `vllm==0.18.0` | `pydantic>=2.0` | vLLM использует Pydantic для StructuredOutputsConfig внутренне |
| `vllm==0.18.0` | `torch>=2.6` | vLLM 0.18.0 требует torch 2.6+. FlashInfer 0.6.6 поставляется вместе |
| `vllm==0.18.0` | Python 3.12 | Поддерживается, но 3.12-specific JIT issues возможны |
| `vllm==0.18.0` | `nvidia/cuda:12.8.1-devel` | Необходим для FlashInfer JIT compilation (nvcc). Runtime image недостаточен |
| `modal>=1.3.0` | `vllm==0.18.0` | Modal 1.3.5 (latest на 2026-03-03). `startup_timeout` доступен с v1.1.4 |
| Pydantic `max_length` | xgrammar backend | `maxLength` в JSON Schema уважается xgrammar. Не работает если есть `format`/`pattern` на том же поле (у нас нет) |
| `num_gpu_blocks_override` | Qwen3.5-9B + L40S | Bug #37121 (OPEN). Repro на 4B-AWQ + DGX Spark + v0.17.1. Влияние на 9B + L40S + v0.18.0 **не подтверждено напрямую** — требует profiling |
| `enable_sleep_mode` | `@modal.enter(snap=True)` | **Непроверенная комбинация**. Ноль официальных примеров с `vllm.LLM`. Все Modal примеры — server mode. POC required |

---

## Installation

### Modal image (изменения в `modal/app.py`)

```python
# Pin vLLM version:
llm_image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.12")
    .pip_install("vllm==0.18.0", "pydantic>=2.0")  # Pin vLLM!
    .add_local_dir(_modal_src, remote_path="/root")
)
```

### Backend (изменения в `requirements.txt`)

```
# Обновить:
modal>=1.3.0   # Было: modal>=0.73. Нужно для startup_timeout (v1.1.4)
```

### Новых pip packages НЕ нужно

Все необходимые библиотеки уже установлены:
- `loguru==0.7.3` — structured logging (уже в backend)
- `pydantic>=2.0` — schema constraints (уже в backend и modal)
- `modal>=0.73` — обновить до `>=1.3.0` (единственное изменение)

---

## Stack Patterns by Variant

**Если sub-batch 4 глав стабилен:**
- Увеличить `SUB_BATCH_SIZE` до 8, затем 12
- Снизить `SCALEDOWN_WINDOW` до 60s
- Потенциально снизить `MAX_MODEL_LEN` (при batch — shared KV cache)

**Если sub-batch нестабилен (>10% JSON errors):**
- Откатить на sequential mode
- Добавить `structured_outputs_config=StructuredOutputsConfig(backend="xgrammar:no-fallback")` для deterministic behavior
- Увеличить `max_length` constraints на 50%
- Проверить `num_gpu_blocks_override` значение через profiling

**Если Modal outage:**
- Feature flag `USE_MODAL_PIPELINE=false`
- OpenRouter (Gemini 3.0 Flash) берёт на себя extraction
- Existing pipeline в `gemini_extractor.py` — полностью рабочий
- Потеря: structured output гарантии (OpenRouter использует prompt-based JSON)

**Если cold start > 3 минут:**
- Добавить compile cache volume (P9) — ожидаемый эффект: -20-30s
- Попробовать GPU snapshot POC (P12) — ожидаемый эффект: 100-130s -> 20-40s
- Если snapshot не работает с `vllm.LLM` — fallback на `scaledown_window=300` (keep warm, +$0.16/idle)

---

## Confidence Assessment

| Область | Confidence | Обоснование |
|---------|------------|-------------|
| maxLength constraints | HIGH | Pydantic `max_length` -> JSON Schema `maxLength` — documented. xgrammar уважает — verified |
| Error classification imports | HIGH | `modal.exception` docs подтверждают `FunctionTimeoutError`, `RemoteError`, `InputCancellation` |
| `llm.chat([conversations])` batch API | HIGH | vLLM Issue #8481, PR #8648 (MERGED). Список conversations поддерживается |
| `StructuredOutputsConfig` API | HIGH | Код vLLM v0.18.0 verified. `guided_decoding_backend` удалён. `structured_outputs_config` — единственный путь |
| `num_gpu_blocks_override=512` | MEDIUM | Bug #37121 OPEN, но repro на другом hardware. 512 — стартовая гипотеза, не оптимум |
| Compile cache volume эффект | MEDIUM | Modal docs подтверждают pattern. -20-30s — экстраполяция из Ministral 3B примеров |
| GPU snapshot с `vllm.LLM` | LOW | Ноль официальных примеров. Alpha feature. POC required |
| Sub-batch speedup 7-13x | MEDIUM | Расчётные диапазоны из аудита. Реальные числа — после POC |

---

## Sources

### Verified (HIGH confidence)

- [vLLM Structured Outputs docs](https://docs.vllm.ai/en/latest/features/structured_outputs/) — backend selection, `StructuredOutputsConfig`
- [Modal exception reference](https://modal.com/docs/reference/modal.exception) — `FunctionTimeoutError`, `RemoteError`, `InputCancellation` и 30+ exception classes
- [vLLM v0.18.0 Release](https://github.com/vllm-project/vllm/releases/tag/v0.18.0) — breaking changes, новые фичи
- [Pydantic JSON Schema docs](https://docs.pydantic.dev/latest/concepts/json_schema/) — `max_length` -> `maxLength` в JSON Schema
- [Modal Volumes guide](https://modal.com/docs/guide/volumes) — Volume v2, multiple volumes mounting
- [Modal vLLM inference example](https://modal.com/docs/examples/vllm_inference) — compile cache volume pattern, `FAST_BOOT` toggle

### Verified (MEDIUM confidence)

- [vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121) — KV cache overestimation, OPEN
- [vLLM Issue #35700](https://github.com/vllm-project/vllm/issues/35700) — Qwen3.5 structured output в thinking mode
- [vLLM PR #37429](https://github.com/vllm-project/vllm/pull/37429) — KV cache fix, OPEN, NOT MERGED
- [Modal GPU Snapshot blog](https://modal.com/blog/gpu-mem-snapshots) — Alpha, benchmark до 3B
- [xgrammar maxLength support](https://deepwiki.com/mlc-ai/xgrammar/5.2-regular-expression-to-ebnf-conversion) — maxLength respected, priority < format/pattern
- [vLLM torch.compile blog](https://blog.vllm.ai/2025/08/20/torch-compile.html) — compile cache patterns

### Production-verified (code review)

- `modal/llm_extractor.py` — текущая минимальная реализация, 2 метода, нет batch
- `modal/schemas.py` — 0 maxLength constraints, 3 schema classes
- `modal/config.py` — LLM_TIMEOUT=600, нет NUM_GPU_BLOCKS_OVERRIDE
- `modal/app.py` — 1 volume, snapshot enabled, vllm>=0.18.0 (не pinned)
- `backend/app/core/logging.py` — Loguru, `serialize=True` в production
- `backend/app/tasks/book_tasks.py` — generic `except Exception`, нет error classification

---
*Stack research для: Modal Batch Processing & Production Stability (fancai v1.5)*
*Researched: 2026-03-27*

# GLiNER2 Inference Optimization — Production Research

**Дата:** 2026-03-24
**Scope:** Оптимизация NER inference pipeline (GLiNER2, fastino/gliner2-base-v1) на VPS без GPU
**Автор:** Claude Code

## Executive Summary

GLiNER2 inference на CPU тратит ~38s на главу из-за двух проблем: (1) неоптимальное число PyTorch потоков (12 вместо 4) и (2) слишком маленький контекст DeBERTa (384 токенов → 24 чанка на главу).

**Три уровня оптимизации:**

1. **Quick Win (1 час, $0):** `torch.set_num_threads(4)` + `model.inference()` → **2.8x** (38s → 13.4s/глава)
2. **Short-term (2 часа, $0):** + 2 Celery workers с 8 CPU → **5.6x throughput** (10 книг за 30 мин вместо 160)
3. **Game-changer (3-5 дней, $0):** Замена на [Modern-GLiNER-bi](https://huggingface.co/knowledgator/modern-gliner-bi-base-v1.0) (ModernBERT, 8192 токенов контекст) → **8-20x** (24 чанка → 2-3 чанка + быстрее backbone)

**Важно:** Сервер AMD EPYC 9645 (Zen 5c) имеет **AVX-512 VNNI** — INT8 квантизация через ONNX Runtime получит аппаратное ускорение (ещё 2-4x сверху).

## 1. Данные сервера

### Hardware

| Параметр | Значение                                 |
| -------- | ---------------------------------------- |
| CPU      | AMD EPYC 9645 96-Core (12 vCPU выделено) |
| RAM      | 32 GB total, ~24 GB available            |
| Disk     | 1007 GB, 914 GB free                     |
| GPU      | Нет                                      |
| OS       | Debian, uptime 22 days                   |

### Docker контейнеры

| Контейнер       | CPU %        | RAM                 |
| --------------- | ------------ | ------------------- |
| fancai_celery   | 0.05% (idle) | 121.5 MiB / 4 GiB   |
| fancai_backend  | 0.49%        | 254.1 MiB / 2 GiB   |
| fancai_postgres | 0.00%        | 11.3 MiB / 12 GiB   |
| fancai_redis    | 0.50%        | 281.6 MiB / 768 MiB |
| fancai_netdata  | 5.21%        | 228.3 MiB / 256 MiB |

### Celery Worker

| Параметр            | Значение               |
| ------------------- | ---------------------- |
| Pool                | prefork                |
| Concurrency         | 1                      |
| max-tasks-per-child | 100                    |
| cgroup CPU limit    | 4.0 cores              |
| cgroup RAM limit    | 4 GB                   |
| Timeouts            | soft=1500s, hard=1800s |

### PyTorch

| Параметр        | Значение                                             |
| --------------- | ---------------------------------------------------- |
| Version         | 2.11.0+cpu                                           |
| CPU threads     | 12 (auto-detected, **не оптимально**)                |
| Interop threads | 12                                                   |
| MKL             | Available ✓                                          |
| OpenMP          | Available ✓                                          |
| CUDA            | Not available                                        |
| AVX-512         | **Available** (f, dq, cd, bw, vl, bf16, vbmi2, vnni) |
| AVX-512 VNNI    | **Available** — аппаратное ускорение INT8 ops        |
| CPU arch        | **Zen 5c** (Turin, 5th gen EPYC)                     |

### Пакеты

| Пакет       | Версия     |
| ----------- | ---------- |
| gliner      | 0.2.26     |
| gliner2     | 1.2.4      |
| onnxruntime | 1.24.4     |
| torch       | 2.11.0+cpu |

## 2. Benchmark Results

### Базовый benchmark (12 threads, текущее состояние)

| Глава       | Размер       | Чанков  | Inference | Сек/чанк  | Raw entities |
| ----------- | ------------ | ------- | --------- | --------- | ------------ |
| Ch0         | 13,201 chars | 24      | 37.9s     | 1.58s     | 1,498        |
| Ch1         | 16,704 chars | 31      | 45.0s     | 1.45s     | 2,097        |
| Ch2         | 9,123 chars  | 19      | 28.9s     | 1.52s     | 1,058        |
| **Среднее** |              | **~25** | **~37s**  | **~1.5s** |              |

Model load time: 3.2s (из кэша на диске)

### Thread Tuning Benchmark

| Потоков | Время (4 чанка) | Сек/чанк  | Speedup vs 12   |
| ------- | --------------- | --------- | --------------- |
| 1       | 6.8s            | 1.69s     | 0.9x            |
| 2       | 3.8s            | 0.94s     | 1.6x            |
| **4**   | **2.7s**        | **0.68s** | **2.3x**        |
| 6       | 3.2s            | 0.81s     | 1.9x            |
| 8       | 3.6s            | 0.90s     | 1.7x            |
| 12      | 6.2s            | 1.55s     | 1.0x (baseline) |

**Оптимум: 4 потока — 2.3x ускорение**

### Full Chapter Benchmark (4 threads)

| Метод                        | Время (24 чанка) | Сек/чанк  |
| ---------------------------- | ---------------- | --------- |
| Sequential predict_entities  | 15.9s            | 0.66s     |
| model.inference(batch=1)     | **13.4s**        | **0.56s** |
| model.inference(batch=4)     | 16.9s            | 0.70s     |
| model.inference(batch=8)     | 18.9s            | 0.79s     |
| inference + packing(batch=4) | 15.5s            | 0.65s     |

**Оптимум: `model.inference(batch_size=1)` — 2.8x ускорение vs baseline**

### Batch/Packing Results

- `batch_predict_entities()` — deprecated, нет ускорения на CPU
- `InferencePackingConfig(max_length=384)` — нет ускорения на CPU
- Batching неэффективен на CPU (нет параллелизма GPU), добавляет overhead по памяти

### Projected Performance After Optimization

| Сценарий              | Текущее  | После оптимизации  | Speedup  |
| --------------------- | -------- | ------------------ | -------- |
| 1 глава (13K chars)   | 37.9s    | 13.4s              | **2.8x** |
| Ведьмак (23 главы)    | ~16 мин  | ~5.1 мин           | **3.1x** |
| Перекрестки (80 глав) | 66+ мин  | ~23 мин            | **2.9x** |
| 10 книг в очереди     | ~160 мин | ~51 мин (1 worker) | **3.1x** |

## 3. Анализ гипотез

### Гипотеза 1: Облачный GLiNER2 API

**Feasibility: Частично реализуемо**

Готового managed API для GLiNER2 не существует. Варианты:

| Вариант                         | Стоимость                          | Latency                      | Сложность |
| ------------------------------- | ---------------------------------- | ---------------------------- | --------- |
| HuggingFace Inference Endpoints | ~$0.06/hr (CPU) или $0.60/hr (GPU) | ~2-5s/chunk                  | 1-2 дня   |
| Modal custom endpoint           | $0.59/hr (T4)                      | ~0.1-0.5s/chunk (GPU)        | 2-3 дня   |
| RunPod Serverless               | $0.40/hr (T4)                      | ~0.1-0.5s/chunk + cold start | 2-3 дня   |
| Self-hosted на GPU VPS          | €184/мес (Hetzner GEX44)           | ~0.1s/chunk                  | 3-5 дней  |

**Расчёт стоимости (50 книг × 200 глав × 25 чанков = 250K chunks/мес):**

- При 0.3s/chunk на GPU = 75K сек = ~21 час GPU/мес
- Modal T4: 21ч × $0.59 = **~$12.4/мес** (+ compute/memory overhead ≈ $15-20/мес total)
- RunPod T4: 21ч × $0.40 = **~$8.4/мес** (+ cold start costs)
- Hetzner GEX44: **€184/мес** (overkill для этой нагрузки)

**Вердикт:** Экономически выгодно при масштабировании (>100 книг/мес), но для текущих 50 книг/мес — дороже чем оптимизация CPU.

**Риски:**

- Cold start на serverless: 10-60s загрузка модели
- Сетевая latency при передаче текста глав
- Зависимость от внешнего сервиса

### Гипотеза 2: Оптимизация CPU inference

#### 2a. Thread Tuning ✅ ПОДТВЕРЖДЕНО

**Speedup: 2.3x** (instant, проверено benchmark)

```python
import torch
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
```

Причина: 12 потоков на 4-core cgroup создают contention. Оптимум = число доступных ядер.

**Сложность: 0.5 часа | Стоимость: $0 | Риски: Нулевые**

#### 2b. model.inference() вместо predict_entities() ✅ ПОДТВЕРЖДЕНО

**Speedup: +16%** (13.4s vs 15.9s с 4 потоками)

`model.inference()` — новый API GLiNER, оптимизированный внутренне. `predict_entities()` — обёртка с overhead.

**Сложность: 1 час | Стоимость: $0 | Риски: Минимальные** (проверить совместимость output format)

#### 2c. ONNX Runtime

**Feasibility: Перспективно (с AVX-512 VNNI)**

Инфраструктура готова:

- `onnxruntime==1.24.4` уже установлен
- GLiNER имеет `export_to_onnx()` метод
- Нужно добавить пакет `onnx` (~50 MB) для экспорта
- **AMD EPYC 9645 имеет AVX-512 VNNI** — INT8 ops аппаратно ускорены
- Существует пакет [gliner2-onnx](https://libraries.io/pypi/gliner2-onnx) (v0.1.1) — запуск GLiNER2 **без PyTorch**

**Известные проблемы:**

- [Issue #191](https://github.com/urchade/GLiNER/issues/191): ONNX inference на 50% медленнее PyTorch (FP32, без VNNI)
- [Issue #218](https://github.com/urchade/GLiNER/issues/218): INT8 quantization ломает качество в некоторых случаях
- DeBERTa + LSTM имеют ограничения при ONNX trace (shape inference warnings)

**С VNNI ситуация другая:** INT8 ops получают ~2-4x аппаратное ускорение на Zen 5c.
Возможный pipeline: FP32 → dynamic INT8 quantization → ONNX Runtime с VNNI.

**Ожидаемый speedup: 1.5-3x** (FP32 ONNX ~1x, + INT8 с VNNI ~2-3x)
**Сложность: 3-5 дней** (экспорт + тестирование качества + A/B)
**Риски: Средние** — INT8 quality нужно тестировать, но VNNI делает это перспективнее

#### 2d. torch.compile()

**Feasibility: Реализуемо с доработкой Docker**

Нужен g++ в контейнере. Ошибка: `No working C++ compiler found`.

**Сложность: 2-3 дня** (добавить gcc в Dockerfile, протестировать compile modes)
**Ожидаемый speedup: 1.2-2x** на CPU с inductor backend
**Риски:**

- Увеличение Docker image на ~200 MB
- Первый inference медленный (компиляция)
- Может быть несовместимо с GLiNER2 custom ops

#### 2e. Batching

**Не подтверждено.** На CPU batching не даёт ускорения — нет GPU параллелизма.

#### 2f. Параллелизация Celery Workers

**Feasibility: Реализуемо**

Текущий cgroup: 4 CPU. С увеличением до 8:

| Конфигурация     | Workers | Threads/worker | CPU total | Книг параллельно | Сек/чанк |
| ---------------- | ------- | -------------- | --------- | ---------------- | -------- |
| Текущая          | 1       | 12 (auto)      | 4         | 1                | 1.55s    |
| Оптимизированная | 1       | 4              | 4         | 1                | 0.66s    |
| Масштабированная | 2       | 4              | 8         | 2                | 0.66s    |

**10 книг: 2 workers × 0.66s/chunk → 5 раундов × ~6 мин = 30 мин** (vs 160 мин текущих)

**Сложность: 2-3 часа** (docker-compose.prod.yml + Celery config)
**Стоимость: $0** (используем существующие ресурсы)
**Риски:** 2 модели в RAM = 2 × 1.7 GB = 3.4 GB. Cgroup RAM limit 4 GB — тесно. Нужно увеличить до 6-8 GB.

#### 2g. Modern-GLiNER-bi (ModernBERT backbone) ⭐ GAME-CHANGER

**Feasibility: Реализуемо, drop-in замена**

[knowledgator/modern-gliner-bi-base-v1.0](https://huggingface.co/knowledgator/modern-gliner-bi-base-v1.0):

| Параметр     | GLiNER2 (текущая)        | Modern-GLiNER-bi                  |
| ------------ | ------------------------ | --------------------------------- |
| Backbone     | DeBERTa v3               | **ModernBERT**                    |
| Params       | 205M                     | 194M                              |
| Max tokens   | **512** (384 используем) | **8,192**                         |
| Attention    | Disentangled             | FlashAttention + Unpadding        |
| Architecture | Encoder                  | **Bi-encoder** (pre-embed labels) |

**Почему это game-changer:**

1. **8192 токенов контекста** → глава в 13K chars (~2500 токенов) помещается в **1 чанк** вместо 24
2. **ModernBERT 2-4x быстрее DeBERTa** на CPU (FlashAttention, оптимизированные kernels)
3. **Bi-encoder**: entity labels embeddings вычисляются 1 раз и переиспользуются
4. **98% качества** large-модели при 2.6x скорости (по бенчмаркам авторов)

**Projected speedup:**

- Чанки: 24 → 1-2 = **12-24x** меньше forward passes
- ModernBERT backbone: ~2-4x быстрее DeBERTa
- Label pre-embedding: ~1.2x (minor)
- **Итого: 8-20x ускорение** (38s → 2-5s на главу)

**Сложность: 3-5 дней** (интеграция + A/B тестирование recall на русском fiction)
**Стоимость: $0/мес** (тот же VPS)
**Риски:**

- Recall на русском fiction может отличаться — нужен A/B тест
- ModernBERT может не поддерживать все GLiNER2 features (gliner2 package compatibility)
- Нужно проверить, работает ли через gliner/gliner2 Python API

#### 2h. Уменьшение модели (GLiNER-small)

`gliner-small-v2` (BERT-small backbone, ~30M params) — в 7x меньше, значительно быстрее.

**Проблема:** Не тестировалась на русском тексте fiction. Recall может упасть существенно.
**Сложность: 2-3 дня** (A/B тест качества)

### Гипотеза 3: GPU inference

| Вариант                  | Цена/мес | Speedup | Cold start | Сложность |
| ------------------------ | -------- | ------- | ---------- | --------- |
| Modal T4 Serverless      | ~$15-20  | 10-20x  | 1-10s      | 2-3 дня   |
| RunPod T4 Serverless     | ~$10-15  | 10-20x  | 10-60s     | 2-3 дня   |
| Hetzner GEX44 (RTX 4000) | €184     | 20-30x  | 0s         | 3-5 дней  |
| Vast.ai T4 spot          | ~$20-40  | 10-20x  | varies     | 2-3 дня   |

На GPU: 0.05-0.1s/chunk (vs 0.66s CPU), т.е. ~10-13x ускорение.

**Для текущей нагрузки (50 книг/мес) GPU не окупается:**

- CPU после оптимизации: 50 книг × 6 мин = 5 часов/мес = 2% utilization
- GPU: быстрее, но платишь за infra which is mostly idle

**GPU имеет смысл при >200 книг/мес** или если latency критична (<1 мин на книгу).

### Дополнительные гипотезы

#### 4. Архитектурная: Приоритетная очередь

Celery поддерживает priority queues. Новая книга = high priority, re-processing = low.
**Не ускоряет inference, но улучшает UX.**

#### 5. Алгоритмическая: Кэширование результатов NER

Если пользователь загружает книгу повторно — NER результаты уже в БД.
Проверить, есть ли этот guard в `book_tasks.py`.

#### 6. Гибридная: GLiNER для batch, LLM для первых глав

- При загрузке книги: LLM (Gemini) обрабатывает первые 3-5 глав мгновенно (~3s/глава, уже работает)
- GLiNER обрабатывает все главы в фоне (batch, low priority)
- Результаты GLiNER обогащают/подтверждают LLM результаты

**Уже запланировано как Phase 33 (hybrid pipeline).**

#### 7. Алгоритмическая: Увеличение max_tokens чанка

Текущий `max_tokens=384`. DeBERTa максимум 512.
Увеличение до 450-480 → меньше чанков → меньше overhead.
Для главы в 13K chars: ~24 чанка при 384 → ~20 чанков при 450 = 17% меньше inference calls.

**Риски:** Entity на границах чанка может быть обрезана. Нужно тестировать.

## 4. Сравнительная таблица

| #      | Вариант                 | Latency/глава | Throughput глав/час | $/мес  | Сложность | Speedup       |
| ------ | ----------------------- | ------------- | ------------------- | ------ | --------- | ------------- |
| 0      | **Текущее**             | 38s           | 95                  | $0     | —         | 1.0x          |
| 1      | **Thread tuning (4)**   | 16s           | 225                 | $0     | 0.5ч      | **2.4x**      |
| 2      | **+ model.inference()** | 13.4s         | 269                 | $0     | 1ч        | **2.8x**      |
| 3      | **+ 2 workers (8 CPU)** | 13.4s         | 538 eff.            | $0     | 2ч        | **5.6x** thru |
| 4      | **+ max_tokens=450**    | ~11s          | 327                 | $0     | 1ч        | **3.5x**      |
| 5      | ONNX INT8 (с VNNI)      | ~5-9s?        | ~400-720?           | $0     | 3-5д      | **1.5-3x**    |
| 6      | torch.compile           | ~10s?         | ~360?               | $0     | 2-3д      | ~3.5x?        |
| 7      | Modal T4 GPU            | ~1.5s         | 2400                | $15-20 | 2-3д      | **25x**       |
| 8      | Hetzner GEX44 GPU       | ~1s           | 3600                | €184   | 3-5д      | **38x**       |
| 9      | gliner-small-v2         | ~5s?          | 720?                | $0     | 2-3д      | ~7x?          |
| **10** | **Modern-GLiNER-bi**    | **2-5s**      | **720-1800**        | **$0** | **3-5д**  | **⭐ 8-20x**  |
| **11** | **#10 + ONNX INT8**     | **1-3s**      | **1200-3600**       | **$0** | **5-7д**  | **⭐ 13-38x** |

## 5. Рекомендация — Top-4

### 🥇 #1: Thread Tuning + model.inference() (Quick Win)

**Speedup: 2.8x | Стоимость: $0 | Время: 1-2 часа**

```python
# В NERService._ensure_loaded():
import torch
torch.set_num_threads(4)
torch.set_num_interop_threads(1)

# В NERService.extract_chapter():
# Заменить цикл predict_entities на один вызов inference()
chunk_texts = [chunk.text for chunk in chunks]
results = self._model.inference(chunk_texts, labels, threshold=threshold, batch_size=1)
```

Минимальные изменения, максимальный эффект. 38s → 13.4s на главу.

### 🥈 #2: Увеличение CPU лимита + 2 workers

**Throughput: 5.6x | Стоимость: $0 | Время: 2-3 часа**

```yaml
# docker-compose.prod.yml
celery-worker:
  deploy:
    resources:
      limits:
        cpus: "8.0"
        memory: 8G
  command: celery -A app.core.celery_app worker -c 2 --max-tasks-per-child=50
  environment:
    - OMP_NUM_THREADS=4
    - MKL_NUM_THREADS=4
```

2 книги параллельно. 10 книг = 30 мин вместо 160.

### 🥉 #3: Modern-GLiNER-bi (Medium-term, максимальный эффект)

**Speedup: 8-20x | Стоимость: $0 | Время: 3-5 дней**

Замена `fastino/gliner2-base-v1` на `knowledgator/modern-gliner-bi-base-v1.0`:

- ModernBERT backbone (FlashAttention, unpadding) — 2-4x быстрее DeBERTa
- Контекст 8192 токенов — целая глава в 1-2 чанка вместо 24
- Bi-encoder — pre-embed entity labels один раз
- 194M params — сопоставимо с текущей моделью

**Требует A/B тестирования recall на русском fiction перед production deploy.**

### #4: Modal T4 Serverless (при масштабировании >100 книг/мес)

**Speedup: 25x | Стоимость: ~$15-20/мес | Время: 2-3 дня**

Создать Modal endpoint с GLiNER2 на T4. Вызывать из Celery task вместо локального inference.
Имеет смысл когда CPU ресурсы становятся bottleneck (>100 книг/мес).

## 6. Quick Wins (прямо сейчас, 1-2 часа)

### QW-1: torch.set_num_threads(4) [30 мин]

Добавить в `NERService._ensure_loaded()`:

```python
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
```

Или через env var в docker-compose.prod.yml:

```yaml
environment:
  - OMP_NUM_THREADS=4
  - MKL_NUM_THREADS=4
```

**Эффект: 38s → 16s на главу (2.4x)**

### QW-2: model.inference() вместо predict_entities() [1 час]

В `extract_chapter()` заменить цикл по чанкам на один вызов:

```python
chunk_texts = [chunk.text for chunk in chunks]
all_results = self._model.inference(chunk_texts, labels, threshold=threshold, batch_size=1)
```

**Эффект: 16s → 13.4s на главу (ещё +16%)**

### QW-3: ENV переменные для PyTorch (5 мин)

Добавить в docker-compose.prod.yml:

```yaml
environment:
  - OMP_NUM_THREADS=4
  - MKL_NUM_THREADS=4
  - TORCH_NUM_THREADS=4
```

**Альтернатива QW-1 без изменения кода.**

## 7. Roadmap внедрения

```
Неделя 1 (Immediate):
├── QW-1: Thread tuning (env var) ── 5 мин
├── QW-2: model.inference() ── 1 час
├── Тест: A/B benchmark подтверждение ── 30 мин
└── Deploy ── 15 мин

Неделя 2 (Short-term):
├── Увеличить cgroup CPU до 8 ── 15 мин
├── Celery concurrency=2 ── 30 мин
├── Увеличить cgroup RAM до 8G ── 15 мин
├── Тест: 2 параллельных книги ── 1 час
└── Мониторинг: CPU/RAM saturation ── 30 мин

Неделя 3-4 (Medium-term, главная оптимизация):
├── Интеграция Modern-GLiNER-bi ── 2 дня
├── A/B тест recall на русском fiction ── 1 день
├── Адаптация TextChunker для 8192 контекста ── 0.5 дня
├── Benchmark + deploy ── 0.5 дня
└── Ожидаемый результат: 38s → 2-5s/глава (8-20x)

Неделя 5-6 (дополнительно, если нужно):
├── ONNX export Modern-GLiNER-bi + INT8 (VNNI) ── 2-3 дня
├── Тест max_tokens оптимизация ── 1 день
└── Ожидаемый результат: 2-5s → 1-3s/глава

Месяц 2+ (если >100 книг/мес):
└── Modal/RunPod GPU endpoint ── 3 дня
```

## Appendix: Ключевые файлы

| Файл                                    | Описание                                      |
| --------------------------------------- | --------------------------------------------- |
| `backend/app/services/ner_service.py`   | NERService singleton, TextChunker, NERAdapter |
| `backend/app/tasks/book_tasks.py:282`   | Feature flag `USE_GLINER_NER`                 |
| `backend/Dockerfile.celery`             | Docker image с PyTorch + GLiNER2              |
| `docker-compose.prod.yml`               | Celery worker deploy limits                   |
| `backend/app/monitoring/metrics.py:497` | NER Prometheus метрики                        |

## Appendix: Источники

- [GLiNER GitHub](https://github.com/urchade/GLiNER) — основной репозиторий
- [GLiNER ONNX Issue #191](https://github.com/urchade/GLiNER/issues/191) — ONNX slower than PyTorch
- [GLiNER Quantization Issue #218](https://github.com/urchade/GLiNER/issues/218) — INT8 quality degradation
- [GLiNER.cpp](https://github.com/Knowledgator/GLiNER.cpp) — C++ inference engine
- [gline-rs](https://github.com/fbilhaut/gline-rs) — Rust inference engine
- [Modal Pricing](https://modal.com/pricing) — GPU serverless pricing
- [RunPod Pricing](https://www.runpod.io/pricing) — GPU serverless pricing
- [Hetzner GPU](https://www.hetzner.com/dedicated-rootserver/gex44/) — GEX44 €184/мес
- [GLiNER Inference Speedup #88](https://github.com/urchade/GLiNER/issues/88) — optimization tips
- [ONNX vs PyTorch Speed](https://dev-kit.io/blog/machine-learning/onnx-vs-pytorch-speed-comparison) — comparison guide
- [Modern-GLiNER-bi-base](https://huggingface.co/knowledgator/modern-gliner-bi-base-v1.0) — ModernBERT backbone, 8192 context
- [ModernBERT announcement](https://huggingface.co/blog/modernbert) — FlashAttention + unpadding
- [ModernBERT vs DeBERTa](https://arxiv.org/html/2504.08716v1) — benchmark comparison
- [gliner2-onnx](https://libraries.io/pypi/gliner2-onnx) — GLiNER2 без PyTorch через ONNX
- [AMD EPYC 9645 specs](https://www.amd.com/en/products/processors/server/epyc/9005-series/amd-epyc-9645.html) — Zen 5c, AVX-512 VNNI

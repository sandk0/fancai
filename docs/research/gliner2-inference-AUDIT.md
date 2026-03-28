# GLiNER2 Inference Optimization — Audit Report

**Дата аудита:** 2026-03-24
**Аудитируемый документ:** `docs/research/gliner2-inference-optimization.md` (2026-03-24)
**Автор аудита:** Claude Code (Opus 4.6)
**Методология:** 11 параллельных исследовательских агентов с веб-верификацией, анализ кода, инфраструктуры

---

## A. Executive Summary

Отчёт содержит **одну корректную high-impact рекомендацию** (thread tuning, 2.8x) и **одну фундаментально ошибочную** (Modern-GLiNER-bi, "8-20x"). Главная рекомендация отчёта (#3, "Game-changer") построена на трёх фактических ошибках: (1) ModernBERT — English-only, непригоден для русского текста; (2) "2-4x быстрее на CPU" — все бенчмарки GPU-only (FlashAttention); (3) "13K chars = ~2500 токенов" — для русского реально ~5000-6500 токенов. Реальный speedup от Modern-GLiNER-bi: 2-3x (не 8-20x), с вероятной катастрофической деградацией recall на русском.

Quick Win (#1, thread tuning + model.inference) — единственная безусловно верная рекомендация. ONNX и torch.compile — оценки завышены. GPU serverless — экономически оправдан даже на текущей нагрузке (Modal: $0/мес с free tier). Отчёт полностью игнорирует подписочную модель (premium/free), что критично для архитектурных решений.

**Обнаружено 3 критических бага в текущей инфраструктуре**, не упомянутых в отчёте:

1. `worker_max_memory_per_child=512MB` в celery_app.py — убьёт GLiNER worker (~1.7GB)
2. CPU-бюджет исчерпан: 11.3 из 12 vCPU — нельзя увеличить celery до 8 CPU
3. Нет `OMP_NUM_THREADS` нигде — подтверждено, проблема реальна

---

## B. Верификация утверждений

| #   | Утверждение                                  | Вердикт         | Доказательство                                                                                                                                                                                               | Исправление                                                                       |
| --- | -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Thread tuning: 4 потока = 2.3x               | ✅ Подтверждено | PyTorch docs, Uber blog, HuggingFace BERT CPU Scaling. Стандартная практика: optimal threads = cgroup CPU count                                                                                              | —                                                                                 |
| 2   | model.inference() +16% vs predict_entities() | ⚠️ Частично     | Числа корректны. Но inference() — **внутренний API**, не публичный, не документирован. Может сломаться при обновлении gliner                                                                                 | Использовать с фиксацией версии gliner. Не называть "новый оптимизированный API"  |
| 3   | ONNX INT8 + VNNI = 1.5-3x                    | ⚠️ Частично     | Теоретически верно для generic transformer. **Практически недостижимо для GLiNER**: Issue #191 (ONNX 50% медленнее), Issue #218 (INT8 ломает качество), gliner2-onnx не поддерживает fastino/gliner2-base-v1 | Пометить как "заблокировано". Не включать в roadmap до исправления issues         |
| 4   | torch.compile = 1.2-2x на CPU                | ⚠️ Частично     | Реалистичнее **0.9-1.4x**. Множество отчётов о замедлении на CPU. DeBERTa disentangled attention = graph breaks                                                                                              | Скорректировать до 1.0-1.3x. Тестировать перед включением в roadmap               |
| 5   | Batching неэффективен на CPU                 | ✅ Подтверждено | GLiNER Discussion #73, Issue #88. На CPU нет параллелизма GPU                                                                                                                                                | —                                                                                 |
| 6   | 2 workers + 8 CPU = 5.6x throughput          | ❌ Нереализуемо | **11.3 из 12 vCPU уже выделены**. Добавить 4 CPU для celery нельзя без урезания PostgreSQL или backend                                                                                                       | Нужен перебалансирование CPU: celery 6 + postgres 3 + backend 1.5 + rest 1.5 = 12 |
| 7   | Modern-GLiNER-bi = 8-20x                     | ❌ Опровергнуто | **3 ошибки:** (1) ModernBERT — English-only; (2) FlashAttention — GPU-only; (3) 13K chars рус = ~5000-6500 токенов, не 2500. Реальный speedup: **2-3x** с деградацией recall                                 | **Исключить из roadmap**. Для русского нужна мультиязычная модель                 |
| 8   | Modal T4 $0.59/hr                            | ✅ Подтверждено | Актуальная цена на март 2026. Free tier $30/мес покрывает рабочую нагрузку полностью                                                                                                                         | —                                                                                 |
| 9   | RunPod T4 $0.40/hr                           | ✅ Подтверждено | Актуальная цена. FlashBoot <200ms cold start                                                                                                                                                                 | —                                                                                 |
| 10  | Hetzner GEX44 €184/мес                       | ⚠️ Устарело     | С апреля 2026 — **~€212/мес** (+37% повышение цен Hetzner)                                                                                                                                                   | Обновить цену                                                                     |
| 11  | GPU окупается при >200 книг/мес              | ⚠️ Частично     | Modal free tier ($30/мес) = $0 до ~50 GPU-часов. **GPU фактически бесплатен** на текущей нагрузке                                                                                                            | GPU выгоден **уже сейчас** через Modal free tier                                  |

---

## C. Упущенные альтернативы

### C.1 fast-gliner / gline-rs (Rust runtime для GLiNER)

| Параметр  | Значение                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Описание  | Rust-реализация GLiNER inference через ONNX Runtime (PyO3 Python bindings)                                           |
| Speedup   | **3-5x** vs PyTorch GLiNER                                                                                           |
| Сложность | Низкая — `pip install fast-gliner`, drop-in API                                                                      |
| Стоимость | $0                                                                                                                   |
| Риск      | Один автор; нужно проверить совместимость с GLiNER2 (изначально для GLiNER v1)                                       |
| Источник  | [gline-rs GitHub](https://github.com/fbilhaut/gline-rs), [HackerNews](https://news.ycombinator.com/item?id=42629478) |

**Почему упущено:** Отчёт упоминает gline-rs в Appendix, но не включает в рекомендации. Это потенциально **лучший quick win** после thread tuning — 3-5x speedup без смены модели.

### C.2 NuNER Zero (drop-in замена весов)

| Параметр  | Значение                                                               |
| --------- | ---------------------------------------------------------------------- |
| Описание  | GLiNER-архитектура, token classifier (не span). Обучен на 1M аннотаций |
| Speedup   | ~1x (тот же pipeline)                                                  |
| Качество  | **+3.1-4.5% F1** над GLiNER-large-v2.1                                 |
| Сложность | Минимальная — замена model_id                                          |
| Стоимость | $0                                                                     |
| Русский   | Мультиязычный backbone (как GLiNER2)                                   |
| Источник  | [NuNER Zero HuggingFace](https://huggingface.co/numind/NuNER_Zero)     |

### C.3 GLiNER bi-encoder v2.0 (новая архитектура Knowledgator)

| Параметр  | Значение                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| Описание  | Раздельное кодирование текста и лейблов. Pre-compute label embeddings                      |
| Speedup   | **1.5-2x** за счёт label caching (при 4+ типах сущностей)                                  |
| Качество  | 60.3% F1 (bi-base) vs 59.0% (GLiNER2)                                                      |
| Backbone  | DeBERTa (мультиязычный) — **работает с русским**                                           |
| Сложность | Средняя — новый API (encode_labels + batch_predict_with_embeds)                            |
| Стоимость | $0                                                                                         |
| Источник  | [gliner-bi-base-v2.0 HuggingFace](https://huggingface.co/knowledgator/gliner-bi-base-v2.0) |

### C.4 AMD ZenDNN + ONNX Runtime

| Параметр  | Значение                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| Описание  | AMD-оптимизированный ONNX EP специально для EPYC (MatMul kernels, INT8, BF16) |
| Speedup   | **2-3x** (если ONNX конвертация GLiNER работает)                              |
| Сложность | Средняя — ZenDNN fork ONNX Runtime                                            |
| Риск      | GLiNER ONNX issues (#191, #218) блокируют                                     |
| Источник  | [AMD ZenDNN](https://www.amd.com/en/developer/zendnn.html)                    |

### C.5 Natasha/Slovnet как быстрый pre-filter

| Параметр    | Значение                                                                        |
| ----------- | ------------------------------------------------------------------------------- |
| Описание    | Нативный русский NER, 30MB модель, 25 статей/сек, NumPy-only                    |
| Применение  | Быстрый первый проход для PER/LOC/ORG → GLiNER только для artifact/organization |
| Speedup     | **3-5x** (GLiNER обрабатывает меньше текста)                                    |
| Ограничение | Только 3 типа (PER/LOC/ORG), нет zero-shot                                      |
| Стоимость   | $0                                                                              |
| Источник    | [Natasha GitHub](https://github.com/natasha/slovnet)                            |

### C.6 Pre-compute label embeddings (текущая GLiNER2)

| Параметр      | Значение                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| Описание      | Предвычислить эмбеддинги лейблов 1 раз, использовать batch_predict_with_embeds |
| Speedup       | **1.3-2x** (зависит от числа лейблов)                                          |
| Сложность     | Низкая — несколько строк кода                                                  |
| Совместимость | Требует gliner API, нужно проверить в gliner2 package                          |
| Источник      | [GLiNER Discussion #73](https://github.com/urchade/GLiNER/discussions/73)      |

### C.7 Model warm-up при старте Celery worker

| Параметр  | Значение                                                                               |
| --------- | -------------------------------------------------------------------------------------- |
| Описание  | Первый inference в PyTorch 10-100x медленнее. Прогрев через dummy inference при старте |
| Speedup   | Убирает 10-100x penalty на первом запросе                                              |
| Сложность | Минимальная — `worker_process_init` signal                                             |
| Источник  | [PyTorch Issue #33354](https://github.com/pytorch/pytorch/issues/33354)                |

---

## D. Архитектура для подписочной модели

### D.1 Priority Queue Architecture

**Текущее состояние:**

- Celery config уже имеет 3 очереди: `heavy`, `normal`, `light`
- `worker_prefetch_multiplier=1` — корректно для ML
- `task_acks_late=True` — задачи не теряются
- Redis broker — **не поддерживает нативные приоритеты** (эмуляция через N списков)

**Рекомендуемая архитектура:**

```
Очереди:
  premium_heavy  → celery-worker-premium  (выделенный, всегда свободен для premium)
  free_heavy     → celery-worker-free     (общий пул)
  normal         → celery-worker-free     (изображения)
  light          → celery-worker-free     (периодические задачи)

Fallback: celery-worker-free также слушает premium_heavy
  (берёт premium задачи, если premium-worker занят)
```

**Маршрутизация (динамическая, не через task_routes):**

```python
queue = "premium_heavy" if user.is_premium else "free_heavy"
process_book_task.apply_async(args=[book_id], queue=queue)
```

### D.2 SLA Enforcement (<5 мин/книга для premium)

| Метод обработки                     | 30 глав    | 50 глав    | 100 глав   | SLA <5мин?                |
| ----------------------------------- | ---------- | ---------- | ---------- | ------------------------- |
| NER only (13.4s/глава)              | ~7 мин     | ~11 мин    | ~22 мин    | Нет                       |
| LLM only (Gemini, 3s/глава)         | ~1.5 мин   | ~2.5 мин   | ~5 мин     | **Да**                    |
| Гибрид: LLM первые 5 глав + NER фон | ~15с + фон | ~15с + фон | ~15с + фон | **Да (instant entities)** |

**Стоимость LLM для premium:**

- Gemini 2.0 Flash: ~$0.015/книга = ~$1.5/мес при 100 premium книг
- Gemini 3.0 Flash: ~$0.09/книга = ~$9/мес при 100 premium книг

**Вывод:** SLA <5 мин достижимо **только через LLM** (Gemini). NER на CPU не вписывается. Гибридный pipeline (LLM для premium в реальном времени + NER для обогащения в фоне) — оптимальная стратегия.

### D.3 Масштабирование

| Масштаб  | Free книг | Premium книг | NER CPU-часы | LLM стоимость | VPS достаточно?               |
| -------- | --------- | ------------ | ------------ | ------------- | ----------------------------- |
| 50/мес   | 40        | 10           | 5.2ч         | ~$1.5         | Да                            |
| 200/мес  | 160       | 40           | 20.8ч        | ~$6           | Да                            |
| 500/мес  | 400       | 100          | 52ч          | ~$15          | Да (1 worker)                 |
| 1000/мес | 800       | 200          | 104ч         | ~$30          | На пределе (нужен 2-й worker) |
| 2000/мес | 1600      | 400          | 208ч         | ~$60          | Нужен 2-й сервер              |

**Bottleneck на текущем VPS:** ~500-700 книг/мес при 1 NER worker. При 1000+ — нужен 2-й worker или GPU offload.

### D.4 Гибридный Pipeline (LLM + NER)

Уже запланировано как Phase 33 в отчёте, но не проработано для подписочной модели:

**Premium пользователь загружает книгу:**

1. **T+0s:** LLM (Gemini Flash) обрабатывает первые 3-5 глав → **мгновенные сущности**
2. **T+15s:** WebSocket push: "Найдено N сущностей, читайте!"
3. **Фон:** NER (GLiNER2) обрабатывает все главы → обогащение, confidence scores
4. **T+5-10мин:** NER завершён, merge LLM + NER результатов

**Free пользователь загружает книгу:**

1. **T+0s:** Задача в `free_heavy` очередь
2. **T+0-30мин:** NER обработка всех глав
3. **T+30мин:** Push notification: "Книга готова!"

**Merge стратегия (LLM + NER):**

- LLM даёт: имя, тип, описание, aliases
- NER даёт: имя, тип, confidence, character offsets
- Merge по fuzzy match имён (уже есть `find_entity_fuzzy` в book_tasks.py)
- При конфликте типа: LLM имеет приоритет (лучше понимает контекст)
- NER добавляет: точные offsets, mentions count, confidence scores

---

## E. Обновлённая сравнительная таблица

| #   | Вариант                     | Latency/глава      | Throughput глав/час | $/мес              | Сложность | Speedup         | Premium SLA?     | Масштаб 1000 кн/мес                  |
| --- | --------------------------- | ------------------ | ------------------- | ------------------ | --------- | --------------- | ---------------- | ------------------------------------ |
| 0   | **Текущее**                 | 38s                | 95                  | $0                 | —         | 1.0x            | Нет              | Нет                                  |
| 1   | **Thread tuning (4)**       | 16s                | 225                 | $0                 | 0.5ч      | **2.4x**        | Нет              | Нет                                  |
| 2   | **+ model.inference()**     | 13.4s              | 269                 | $0                 | 1ч        | **2.8x**        | Нет              | Нет                                  |
| 3   | + max_tokens=450            | ~11s               | 327                 | $0                 | 1ч        | 3.5x            | Нет              | Нет                                  |
| 4   | **+ model warm-up**         | -10s на 1-й запрос | —                   | $0                 | 0.5ч      | —               | —                | —                                    |
| 5   | **+ pre-compute labels**    | ~10s               | ~360                | $0                 | 1ч        | ~3.8x           | Нет              | Нет                                  |
| 6   | **fast-gliner (Rust)**      | ~3-5s              | 720-1200            | $0                 | 1д        | **8-13x**       | Нет              | Возможно                             |
| 7   | GLiNER bi-base v2.0         | ~8-10s             | 360-450             | $0                 | 3д        | 4-5x            | Нет              | Нет                                  |
| 8   | NuNER Zero                  | ~13s               | 277                 | $0                 | 0.5д      | 2.8x (+quality) | Нет              | Нет                                  |
| 9   | ~~Modern-GLiNER-bi~~        | ~~2-5s~~           | —                   | —                  | —         | ~~8-20x~~       | —                | **НЕ ПРИМЕНИМО: English-only**       |
| 10  | ONNX INT8 + VNNI            | ?                  | ?                   | $0                 | 3-5д      | ?               | Нет              | **ЗАБЛОКИРОВАНО: issues #191, #218** |
| 11  | **Modal T4 GPU**            | ~1.5s              | 2400                | **$0** (free tier) | 2-3д      | **25x**         | Нет (cold start) | Да ($20/мес)                         |
| 12  | RunPod T4 GPU               | ~1.5s              | 2400                | $8.50              | 2-3д      | 25x             | Нет (cold start) | Да ($34/мес)                         |
| 13  | **LLM (Gemini Flash)**      | **~3s**            | 1200                | $1.5-9             | 0ч (есть) | **12x**         | **Да**           | Да ($30-90/мес)                      |
| 14  | **Гибрид: LLM+NER**         | 3s (initial)       | 1200+269            | $1.5-9             | 2-3д      | **Лучший UX**   | **Да**           | Да                                   |
| 15  | Celery 2 workers            | 13.4s (×2)         | 538                 | $0                 | 2ч        | 5.6x thru       | Нет              | Возможно                             |
| 16  | Natasha pre-filter + GLiNER | ~5-8s              | 450-720             | $0                 | 2д        | 5-7x            | Нет              | Возможно                             |

---

## F. Обновлённые рекомендации

### #1 (P0, сегодня): Thread Tuning + model.inference() + warm-up

**Speedup: 2.8x | $0 | 2 часа**

```python
# В NERService._ensure_loaded():
import os
import torch
# Динамическое определение доступных ядер (не хардкод!)
available_cpus = len(os.sched_getaffinity(0))
torch.set_num_threads(min(available_cpus, 4))
torch.set_num_interop_threads(1)

# ENV в docker-compose.prod.yml:
OMP_NUM_THREADS=4
MKL_NUM_THREADS=4
```

**Дополнительно:** Исправить `worker_max_memory_per_child` в celery_app.py (512MB → 3000000 KB или удалить).

**Почему `os.sched_getaffinity(0)` вместо хардкода:** Если cgroup limit изменится (например, при масштабировании), код автоматически адаптируется.

### #2 (P0, сегодня): Исправить инфраструктурные баги

1. **`worker_max_memory_per_child=512000`** → увеличить до `3000000` (3GB) или убрать
2. Добавить ENV vars `OMP_NUM_THREADS=4`, `MKL_NUM_THREADS=4` в celery-worker
3. Добавить model warm-up через `worker_process_init` signal

### #3 (P1, неделя 1): Гибридный Pipeline (LLM + NER)

**Лучший UX | $1.5-9/мес | 2-3 дня**

- Premium: LLM (Gemini Flash) для первых глав → мгновенные сущности
- Free: NER (GLiNER2) фоновая обработка
- Phase 33 уже запланирована — приоритизировать
- Merge стратегия через существующий `find_entity_fuzzy`

### #4 (P1, неделя 1): Раздельные очереди Premium/Free

**Изоляция SLA | $0 | 3 часа**

- 2 Celery worker сервиса в docker-compose
- Dynamic routing на основе подписки пользователя
- Premium worker: только `premium_heavy`
- Free worker: `free_heavy` + `normal` + `light` + `premium_heavy` (fallback)

### #5 (P2, неделя 2-3): fast-gliner (Rust runtime)

**Speedup: 3-5x | $0 | 1-2 дня**

- `pip install fast-gliner`
- ONNX export текущей GLiNER2 модели
- Проверить совместимость с fastino/gliner2-base-v1
- Если совместимо → замена runtime без смены модели

### Бонус (если fast-gliner не совместим): Modal T4 Serverless

**Speedup: 25x | $0 (free tier) | 2-3 дня**

- Free tier $30/мес > $12.30 реальных затрат
- Per-second billing, cold start 2-4s
- Идеально для burst обработки

---

## G. Risk Register

| #   | Риск                                                                                 | Вероятность | Импакт      | Митигация                                                         |
| --- | ------------------------------------------------------------------------------------ | ----------- | ----------- | ----------------------------------------------------------------- |
| R1  | `worker_max_memory_per_child=512MB` убьёт GLiNER worker при включении USE_GLINER_NER | ВЫСОКАЯ     | КРИТИЧЕСКИЙ | Увеличить до 3GB или убрать до включения NER                      |
| R2  | CPU бюджет исчерпан (11.3/12 vCPU), нельзя масштабировать celery                     | ВЫСОКАЯ     | ВЫСОКИЙ     | Перебалансировать: postgres 3 CPU, celery 6 CPU, backend 1.5 CPU  |
| R3  | model.inference() — внутренний API, может сломаться при обновлении gliner            | СРЕДНЯЯ     | СРЕДНИЙ     | Зафиксировать gliner==0.2.26 в requirements                       |
| R4  | Modern-GLiNER-bi развёрнут на production без тестирования русского                   | СРЕДНЯЯ     | КРИТИЧЕСКИЙ | **Исключить из roadmap.** Для русского нужна мультиязычная модель |
| R5  | ONNX INT8 квантизация ломает NER quality (GLiNER Issue #218)                         | ВЫСОКАЯ     | ВЫСОКИЙ     | Не использовать до исправления upstream. Мониторить issue         |
| R6  | Recall деградация при смене модели (текущий 86.84%)                                  | СРЕДНЯЯ     | ВЫСОКИЙ     | A/B тест инфраструктура уже есть (test_ner_ab_comparison.py)      |
| R7  | Modal убирает free tier                                                              | НИЗКАЯ      | НИЗКИЙ      | Fallback на RunPod ($8.50/мес) или CPU                            |
| R8  | fast-gliner не совместим с GLiNER2 (другой пакет)                                    | СРЕДНЯЯ     | СРЕДНИЙ     | Тест за 2 часа. Fallback: ONNX export + onnxruntime напрямую      |
| R9  | Celery Redis не поддерживает preemption для premium задач                            | ВЫСОКАЯ     | НИЗКИЙ      | Отдельные очереди с выделенным worker решают без preemption       |
| R10 | Нет env var для thread tuning — PyTorch видит 12 vCPU хоста                          | ВЫСОКАЯ     | ВЫСОКИЙ     | **Исправить немедленно** (R: #1)                                  |

---

## H. Приложения

### H.1 Источники (с URL)

**Верификация benchmark:**

- [PyTorch CPU Threading](https://docs.pytorch.org/docs/stable/notes/cpu_threading_torchscript_inference.html)
- [HuggingFace BERT CPU Scaling](https://huggingface.co/blog/bert-cpu-scaling-part-1)
- [Uber: CPU Throttling in Containers](https://www.uber.com/blog/avoiding-cpu-throttling-in-a-containerized-environment/)
- [GLiNER Issue #191: ONNX slower](https://github.com/urchade/GLiNER/issues/191)
- [GLiNER Issue #218: INT8 breaks quality](https://github.com/urchade/GLiNER/issues/218)
- [GLiNER Discussion #73: Batching](https://github.com/urchade/GLiNER/discussions/73)
- [PyTorch torch.compile CPU performance](https://discuss.pytorch.org/t/torch-compile-negative-performance/173857)

**Modern-GLiNER-bi:**

- [modern-gliner-bi-base-v1.0 Model Card](https://huggingface.co/knowledgator/modern-gliner-bi-base-v1.0)
- [ModernBERT Blog](https://huggingface.co/blog/modernbert) — GPU-only benchmarks
- [deepvk/RuModernBERT](https://huggingface.co/deepvk/RuModernBERT-base) — tokenizer issues for Russian
- [FlashAttention GitHub](https://github.com/Dao-AILab/flash-attention) — GPU-only
- [ModernBERT vs DeBERTa (arXiv)](https://arxiv.org/html/2504.08716v1) — DeBERTa outperforms when controlling for data

**NER модели:**

- [NuNER Zero](https://huggingface.co/numind/NuNER_Zero)
- [GLiNER bi-encoder v2.0](https://huggingface.co/knowledgator/gliner-bi-base-v2.0)
- [GLiNER2 EMNLP 2025](https://arxiv.org/html/2507.18546v1)
- [Russian NER for Cultural Texts (arXiv:2506.02589)](https://arxiv.org/abs/2506.02589)
- [Natasha/Slovnet](https://github.com/natasha/slovnet)

**Inference frameworks:**

- [gline-rs (Rust GLiNER)](https://github.com/fbilhaut/gline-rs)
- [fast-gliner PyPI](https://pypi.org/project/fast-gliner/)
- [GLiNER.cpp](https://github.com/Knowledgator/GLiNER.cpp)
- [AMD ZenDNN](https://www.amd.com/en/developer/zendnn.html)
- [CTranslate2 — DeBERTa not supported](https://github.com/OpenNMT/CTranslate2/issues/1008)

**GPU serverless:**

- [Modal Pricing](https://modal.com/pricing) — T4 $0.59/hr, $30/mo free tier
- [RunPod Pricing](https://www.runpod.io/pricing) — T4 $0.40/hr
- [Banana.dev Sunset](https://www.banana.dev/blog/sunset) — closed March 2024
- [Hetzner Price Increase](https://www.tomshardware.com/tech-industry/hetzner-to-raise-prices-by-up-to-37-percent-from-april-1)

**Celery architecture:**

- [Celery Priority Queue Redis](https://olzhasar.com/posts/prioritizing-tasks-with-celery-and-redis/)
- [Celery Task Routing](https://celery.school/celery-task-routing)
- [celery-exporter for Prometheus](https://github.com/grafana/celery-exporter)

### H.2 CPU Budget Analysis

```
Текущее распределение (docker-compose.prod.yml):
  caddy:         0.5 CPU  /  128 MB
  backend:       2.0 CPU  / 2048 MB
  celery-worker: 4.0 CPU  / 4096 MB
  celery-beat:   0.3 CPU  /  256 MB
  postgres:      4.0 CPU  / 12288 MB
  redis:         0.5 CPU  /  768 MB
  ────────────────────────────────────
  ИТОГО:        11.3 CPU  / 19584 MB
  Доступно:     12.0 CPU  / 32768 MB
  Свободно:      0.7 CPU  / 13184 MB

Перебалансированное (для 2 celery workers):
  caddy:          0.5 CPU  /   128 MB
  backend:        1.5 CPU  /  2048 MB
  celery-premium: 3.0 CPU  /  4096 MB
  celery-free:    3.0 CPU  /  4096 MB
  celery-beat:    0.3 CPU  /   256 MB
  postgres:       3.0 CPU  / 10240 MB
  redis:          0.5 CPU  /   768 MB
  ────────────────────────────────────
  ИТОГО:         11.8 CPU  / 21632 MB
```

### H.3 Cost Model

| Масштаб       | CPU NER ($0) | LLM Premium | Modal GPU   | Итого сверх VPS |
| ------------- | ------------ | ----------- | ----------- | --------------- |
| 50 книг/мес   | $0           | $1.50       | $0          | **$1.50**       |
| 200 книг/мес  | $0           | $6          | $0          | **$6**          |
| 500 книг/мес  | $0           | $15         | $0          | **$15**         |
| 1000 книг/мес | $0           | $30         | $20 (burst) | **$50**         |

При бюджете $50/мес на inference — масштабирование до 1000 книг/мес реально.

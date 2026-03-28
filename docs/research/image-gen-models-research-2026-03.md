# Исследование моделей генерации изображений для fancai

**Дата**: 2026-03-25
**Контекст**: Текущее решение — FLUX.2 Klein 4B через OpenRouter ($0.016/image, ~63 images/book = $1.01). Цель — self-hosted на Modal для снижения стоимости + character consistency.

---

## Task 1: FLUX.2 Klein Multi-Reference — детали

### Лимиты reference images

| Платформа               | Лимит ref images      | Источник                                                                                                              |
| ----------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| BFL API (Klein)         | до 4                  | [BFL Docs](https://docs.bfl.ml/flux_2/flux2_overview)                                                                 |
| BFL API (dev/pro)       | до 8                  | [BFL API](https://docs.bfl.ml/flux_2/flux2_image_editing)                                                             |
| BFL Playground          | до 10                 | [Together AI Blog](https://www.together.ai/blog/flux-2-multi-reference-image-generation-now-available-on-together-ai) |
| FLUX.2 Flex variant     | до 10                 | [BFL Overview](https://bfl.ai/models/flux-2)                                                                          |
| Self-hosted (diffusers) | ограничен только VRAM | [HuggingFace](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)                                               |

**Вывод по self-hosted**: При локальном запуске через diffusers лимит reference images определяется исключительно доступной VRAM. Каждое reference image кодируется отдельно и передается трансформеру с разными positional embeddings. Модель attend'ит ко всем references при генерации.

### VRAM для multi-reference на L4 (24GB)

- Базовая модель 4B: ~13GB VRAM
- FP8 quantization: ~8GB VRAM (-40%)
- NVFP4 quantization: ~6GB VRAM (-55%)
- **Оценка для 4 ref images на L4 (24GB)**: должно хватить в bf16, точно хватит в FP8
- **Оценка для 6+ ref images**: потребуется FP8 или cpu offloading

### Влияние reference images на время генерации

Каждый reference image кодируется через VAE encoder отдельно и добавляет tokens в attention. Конкретных замеров overhead не найдено в публичных бенчмарках, но:

- Без ref: ~0.5-1s (distilled 4-step, RTX 5090)
- Архитектура: linear attention overhead от дополнительных reference tokens
- 9B-KV вариант решает проблему через KV-cache — ускорение до 2.5x для multi-reference

**Источники**: [BFL Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence), [Together AI](https://www.together.ai/blog/flux-2-multi-reference-image-generation-now-available-on-together-ai), [fal.ai Guide](https://fal.ai/learn/devs/flux-2-klein-user-guide)

---

## Task 2: Qwen-Image-2.0

### Обзор

| Параметр                | Значение                                                |
| ----------------------- | ------------------------------------------------------- |
| Размер                  | 7B (8B Qwen3-VL encoder + 7B diffusion decoder)         |
| Лицензия                | **Apache 2.0** — полностью коммерческая                 |
| Макс. разрешение        | 2048x2048 (native 2K)                                   |
| Релиз                   | 10 февраля 2026                                         |
| DPG-Bench               | 88.32 (vs FLUX.1 12B = 83.84)                           |
| AI Arena                | #1 text-to-image + #1 image editing (на момент запуска) |
| Artificial Analysis Elo | ~1151 (Qwen Image Max 2512)                             |

### VRAM

| Конфигурация            | VRAM     |
| ----------------------- | -------- |
| Full precision (bf16)   | 24GB     |
| NF4 quantized           | ~17-20GB |
| Q4_K_M GGUF             | ~13GB    |
| DiffSynth (CPU offload) | от 4GB   |

### Время генерации

- 1920x1080: ~55s (consumer GPU)
- 1024x1024 @ 40 steps (5070ti, Q5M): ~148s
- GPU generation: 30-60s типично
- **Оценка для L4 (24GB)**: ~40-60s в full precision, ~60-90s с NF4

### Character Consistency

Qwen-Image-Edit-2511 поддерживает:

- Identity preservation при редактировании портретов
- Multi-person group shots с сохранением идентичности каждого
- Reference image routing через Qwen2.5-VL (semantic) + VAE Encoder (appearance)
- Смена поз, одежды, фонов с сохранением identity

**Вывод**: Сильная модель с Apache 2.0 лицензией и character consistency через editing pipeline. Но: медленная генерация (30-60s vs <1s у FLUX.2 Klein), что критично для 63 images/book.

**Источники**: [GitHub](https://github.com/QwenLM/Qwen-Image), [WaveSpeed Blog](https://wavespeed.ai/blog/posts/blog-what-is-qwen-image-2-0-features-benchmarks/), [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/02/qwen-image-2-0-is-here/), [The Decoder](https://the-decoder.com/qwen-updates-image-editing-model-with-better-character-consistency/)

---

## Task 3: GLM-Image (16B, MIT/Apache 2.0)

### Обзор

| Параметр              | Значение                                                  |
| --------------------- | --------------------------------------------------------- |
| Размер                | 16B (9B autoregressive + 7B DiT diffusion decoder)        |
| Лицензия              | MIT или Apache 2.0 (противоречивые данные в источниках)   |
| Архитектура           | Hybrid autoregressive + diffusion                         |
| CVTG-2K Word Accuracy | 91.16% (#1, vs GPT Image 1 = 85.69%, FLUX.1 Dev = 49.65%) |
| Сильная сторона       | Текст-рендеринг, knowledge-intensive генерация            |

### VRAM

| Конфигурация   | VRAM             |
| -------------- | ---------------- |
| CPU offloading | 48GB minimum     |
| Optimal        | 80GB (H100/A100) |
| System RAM     | 32GB+            |

### Время генерации

| GPU                                   | Время      | Примечание              |
| ------------------------------------- | ---------- | ----------------------- |
| H100 (80GB), full precision           | ~64s       | Одиночное изображение   |
| H100, optimized (35 steps + xFormers) | ~28s       | -3% quality degradation |
| A6000 (48GB), CPU offload             | ~142s      | Качество сохраняется    |
| H100, batch (100 images)              | ~58s/image | 9.4% efficiency gain    |

### Пригодность для книжных иллюстраций

- Отличный text rendering (но нам он не нужен для иллюстраций)
- Character consistency: может генерировать consistent sprites и environment concepts
- **Проблема**: требует 48-80GB VRAM — не влезет на L4 (24GB) или A10G (24GB)
- **Проблема**: медленная генерация (28-64s на H100, ещё медленнее на меньших GPU)
- **Проблема**: autoregressive архитектура = sequential token generation = медленнее diffusion-only

**Вывод**: НЕ подходит для fancai. Требует слишком мощного GPU (min 48GB), слишком медленная, основное преимущество (text rendering) нам не нужно.

**Источники**: [HuggingFace](https://huggingface.co/zai-org/GLM-Image), [GitHub](https://github.com/zai-org/GLM-Image), [Codersera Guide](https://ghost.codersera.com/blog/glm-image-complete-guide/), [302.AI Review](https://medium.com/@302.AI/glmopen-source-glm-image-test-text-rendering-tops-sota-image-quality-remains-key-bottleneck-38b20bf2b39c)

---

## Task 4: Imagen 4 Fast (Google)

### Pricing

| Параметр | Значение                           |
| -------- | ---------------------------------- |
| Цена     | $0.02/image                        |
| Доступ   | API через Google Cloud (Vertex AI) |
| Биллинг  | Per-image, не subscription         |

### Качество

- Лучшее соотношение цена/качество среди API-моделей
- Уступает GPT Image 1.5 (Elo 1264) и Gemini 3 Pro Image (Elo 1214)
- Подходит для production use cases с приоритетом скорости

### Character Consistency

- **НЕ поддерживает** native character reference/consistency
- Только через detailed prompts (ненадежно)
- Google рекомендует specialized tools для character consistency
- Нет multi-reference input

**Сравнение с текущим решением**:

- Текущее: FLUX.2 Klein через OpenRouter = $0.016/image
- Imagen 4 Fast = $0.02/image (+25%)
- Self-hosted FLUX.2 Klein на Modal = нужно считать

**Вывод**: Дороже текущего решения, без character consistency. Не имеет смысла для миграции.

**Источники**: [MagicHour Blog](https://magichour.ai/blog/imagen-4-pricing-and-api), [LaoZhang Comparison](https://blog.laozhang.ai/en/posts/ai-image-generation-api-comparison-2026), [PricePerToken](https://pricepertoken.com/image/model/google-imagen-4-fast)

---

## Task 5: FLUX.2 Klein 4B vs 9B-KV

### FLUX.2 Klein 9B-KV — что это

KV-cache вариант модели 9B, который кэширует key-value pairs reference images при первом denoising step и переиспользует их в последующих steps.

| Параметр              | 4B (distilled)                     | 9B-KV                                |
| --------------------- | ---------------------------------- | ------------------------------------ |
| Размер                | 4B                                 | 9B flow + 8B Qwen3 text embedder     |
| VRAM                  | ~13GB                              | ~29GB                                |
| Inference steps       | 4                                  | 4 (distilled)                        |
| Скорость (без ref)    | <1s                                | <0.5s (GB200)                        |
| Max ref images        | 4 (API)                            | 5                                    |
| Multi-ref скорость    | baseline                           | до 2.5x быстрее (KV-cache)           |
| Лицензия              | **Apache 2.0**                     | **Non-commercial**                   |
| Character consistency | Decent, но inconsistent multi-edit | Лучше, structured outputs consistent |

### Проблема для fancai

- 9B-KV: **non-commercial license** — нельзя использовать в production
- 9B-KV: требует 29GB VRAM — не влезет на L4 (24GB)
- 4B: Apache 2.0, 13GB VRAM — идеально для L4
- 4B: multi-ref inconsistent, требует multiple renders

**Вывод**: 9B-KV лучше по качеству character consistency, но non-commercial + 29GB VRAM делают его непригодным. Остаемся на 4B.

**Источники**: [HuggingFace 9B-KV](https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv), [StableDiffusionTutorials](https://www.stablediffusiontutorials.com/2026/03/flux2-klein-9b-kv.html), [RunDiffusion Guide](https://learn.rundiffusion.com/flux-2-klein-three-new-models/)

---

## Task 6: FLUX.1 Kontext [dev]

### Обзор

| Параметр                   | Значение                     |
| -------------------------- | ---------------------------- |
| Размер                     | 12B                          |
| Лицензия                   | **Non-commercial**           |
| VRAM (без оптимизации)     | ~31.5GB                      |
| VRAM (с FP8/quantization)  | ~20GB                        |
| VRAM (с CPU offload)       | от 8GB                       |
| Время генерации (RTX 4090) | ~20s                         |
| Character consistency      | Да, native — без fine-tuning |

### Character Consistency

- Поддерживает character, style и object reference без finetuning
- Robust consistency через multiple successive edits с minimal visual drift
- Проблема с multiple characters — часто смешивает features разных субъектов
- Dev версия требует тщательного prompt engineering (vs Pro/Max)

### Оценка в Artificial Analysis

- Kontext Max и Pro: outperform all competing models
- Kontext Dev: outperforms all except family members и GPT Image 1

### Проблемы для fancai

1. **Non-commercial license** — нельзя в production
2. ~20GB VRAM с quantization — влезет на L4, но тесно
3. 20s generation time — слишком медленно для 63 images/book
4. Смешивание features при нескольких персонажах

**Вывод**: Отличная character consistency, но non-commercial license — блокер. Время генерации тоже неприемлемо.

**Источники**: [HuggingFace](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev), [Together AI Blog](https://www.together.ai/blog/flux-1-kontext), [ComfyUI Wiki](https://comfyui-wiki.com/en/tutorial/advanced/image/flux/flux-1-kontext)

---

## Task 7: Character Consistency — State of the Art

### Сравнение подходов

| Подход                       | Pros                                               | Cons                                                                 | Подходит для книг?  |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| **Multi-reference (FLUX.2)** | Native, no training, Apache 2.0                    | 4B inconsistent при multi-edit, 82-86% similarity                    | Да, базовый уровень |
| **LoRA training**            | Максимальная consistency, работает с любой моделью | Требует 15-30 images dataset, 1-3h training time, GPU                | Да, для premium     |
| **IP-Adapter**               | Быстрый, без training, good text control           | Хуже identity preservation чем LoRA                                  | Средне              |
| **InstantID**                | 82-86% face similarity, сбалансированный           | Resource-intensive, face-focused (не full body)                      | Средне              |
| **PuLID**                    | Лучшие faces, detail preservation                  | Не может maintain consistency across images, restrictive expressions | Нет                 |
| **Qwen-Image Edit**          | Identity preservation, Apache 2.0                  | 30-60s/image, нужен reference                                        | Средне              |

### Лучший подход для книжных персонажей (литературные описания, не фото)

Ключевая проблема: у нас нет фотографий персонажей, только текстовые описания. Это исключает:

- InstantID (требует face photo)
- PuLID (требует face photo)
- IP-Adapter (требует reference image)

**Рекомендуемый pipeline для fancai**:

1. **Фаза 1 (быстрая)**: Генерируем "character sheet" через FLUX.2 Klein 4B по текстовому описанию
2. **Фаза 2 (consistency)**: Используем generated character sheet как reference для всех последующих иллюстраций с этим персонажем
3. **Альтернатива**: LoRA per-character (train на 15-30 generated images), но это дорого по compute

### Качество по количеству reference images

- 1 ref: базовая identity, drift при разных позах
- 2 ref: лучше разнообразие поз, но всё ещё drift
- 4 ref: reliable consistency для 4-6 panels (current SOTA)
- Полная consistency для 30+ страниц: требует LoRA или character sheet approach

**Источники**: [AI Storybook Blog](https://aistorybook.app/blog/ai-image-generation/character-consistency-in-ai-art-solved), [Toony Story Comparison](https://toonystory.com/blog/best-ai-for-character-consistency-2026), [Apatero LoRA Guide](https://www.apatero.com/blog/ai-consistent-character-generator-multiple-images-2026), [MuskeersTech Pipeline](https://www.musketeerstech.com/for-ai/consistent-characters-ai-childrens-books/)

---

## Task 8: Z-Image-Turbo — обновления

### Текущий статус (март 2026)

| Параметр        | Значение                                 |
| --------------- | ---------------------------------------- |
| Размер          | 6B                                       |
| AI Arena Elo    | 1080±7 (#25 overall, **#1 open-source**) |
| Inference steps | 8 NFE                                    |
| VRAM            | 12-16GB                                  |
| Лицензия        | Open-source (Tongyi-MAI)                 |

### Позиция в рейтингах

- **#1 open-source** на Arena AI text-to-image
- На Artificial Analysis: FLUX.2 [dev] Turbo (Elo 1165) > Qwen Image Max 2512 (Elo 1151) > Z-Image-Turbo (~1080)
- Уступает FLUX.2 dev variants и Qwen Image в quality

### Конкуренты

1. **FLUX.2 Klein 4B** — быстрее (<1s vs ~2-7s), меньше VRAM (13GB vs 16GB), Apache 2.0
2. **Qwen-Image 2.0** — выше quality (DPG 88.32), #1 Arena, Apache 2.0, но медленнее
3. **FLUX.2 [dev] Turbo** — выше Elo (1165 vs 1080), но non-commercial

**Вывод**: Z-Image-Turbo уже не лучший выбор. FLUX.2 Klein 4B быстрее и с Apache 2.0.

**Источники**: [HuggingFace](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo), [GitHub](https://github.com/Tongyi-MAI/Z-Image), [BestPhoto Blog](https://bestphoto.ai/blog/z-image-turbo-launch)

---

## Task 9: Бенчмарки времени генерации

### Сводная таблица (1024x1024, distilled/fast variants)

| Модель                                   | GPU              | Время                | VRAM    | Источник                                                                                                                                    |
| ---------------------------------------- | ---------------- | -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **FLUX.2 Klein 4B** (distilled, 4 steps) | RTX 5090         | ~1.2s                | 8.4GB   | [BFL Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)                                                         |
| **FLUX.2 Klein 4B** (distilled)          | RTX 4090         | ~1-2s                | ~13GB   | [302.AI](https://medium.com/@302.AI/flux-2-klein-test-sub-second-generation-speed-stuns-while-quality-faces-trade-offs-302-ai-c197a73df052) |
| **FLUX.2 Klein 4B** (distilled)          | GB200            | <0.5s                | -       | [BFL](https://bfl.ai/models/flux-2-klein)                                                                                                   |
| **FLUX.2 Klein 4B** (base, 50 steps)     | RTX 5090         | ~17s                 | 9.2GB   | [BFL Blog](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence)                                                         |
| **FLUX.2 Klein 4B** (distilled)          | **L4 (24GB)**    | **~2-4s** (оценка)   | ~13GB   | Экстраполяция: L4 ~60% throughput RTX 4090                                                                                                  |
| **FLUX.2 Klein 4B** (distilled)          | **A10G (24GB)**  | **~2-3s** (оценка)   | ~13GB   | Экстраполяция: A10G ~70% throughput RTX 4090                                                                                                |
| **Z-Image-Turbo 6B** (8 steps)           | RTX 4090         | ~2.3-7.7s            | 12-16GB | [SaasCRM Review](https://saascrmreview.com/z-image-turbo-review/)                                                                           |
| **Z-Image-Turbo 6B**                     | H800             | <1s                  | -       | [HuggingFace](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)                                                                              |
| **Z-Image-Turbo 6B**                     | **A10G (24GB)**  | **~4-8s** (оценка)   | ~16GB   | Экстраполяция                                                                                                                               |
| **HiDream I1 Fast** (FP8, 16 steps)      | H100             | 3.4s                 | ~27GB   | [InstaSD](https://www.instasd.com/post/hidream-performance-benchmarks-in-comfyui)                                                           |
| **HiDream I1 Fast** (FP8)                | RTX 4090         | ~20s (2nd gen)       | ~18GB   | [InstaSD](https://www.instasd.com/post/hidream-performance-benchmarks-in-comfyui)                                                           |
| **HiDream I1 Fast**                      | **A10G (24GB)**  | **~25-35s** (оценка) | ~18GB   | Экстраполяция                                                                                                                               |
| **Qwen-Image 2.0** (7B)                  | Consumer GPU     | 30-60s               | 24GB    | [GitHub](https://github.com/QwenLM/Qwen-Image)                                                                                              |
| **GLM-Image** (16B)                      | H100 (optimized) | ~28s                 | 80GB    | [Codersera](https://ghost.codersera.com/blog/glm-image-complete-guide/)                                                                     |

> **Примечание**: Для L4 и A10G нет опубликованных бенчмарков FLUX.2 Klein 4B. Оценки основаны на соотношении throughput L4/A10G vs RTX 4090 (FP16 TFLOPS: L4=30.3, A10G=31.2, RTX 4090=82.6, но с bf16 и memory bandwidth разница меньше).

### Оценка стоимости на Modal

| GPU                  | Modal цена     | FLUX.2 Klein 4B время | Стоимость/image    | 63 images      |
| -------------------- | -------------- | --------------------- | ------------------ | -------------- |
| L4                   | ~$0.45-0.80/hr | ~2-4s                 | **$0.0003-0.0009** | **$0.02-0.06** |
| A10G                 | ~$0.000306/s   | ~2-3s                 | **$0.0006-0.0009** | **$0.04-0.06** |
| Текущее (OpenRouter) | -              | -                     | $0.016             | $1.01          |

**Вывод: Self-hosted FLUX.2 Klein 4B на Modal L4 дает экономию ~15-50x по стоимости генерации.** Даже с учетом cold start и overhead, экономия колоссальная.

---

## Итоговые рекомендации

### Для текущей задачи (снижение стоимости)

**FLUX.2 Klein 4B на Modal L4** — однозначный выбор:

- Apache 2.0 лицензия — коммерческое использование
- 13GB VRAM — легко влезает на L4 (24GB)
- <1-4s генерация — быстрее текущего API
- ~$0.02-0.06 за книгу vs $1.01 — экономия 15-50x
- Native multi-reference support (до 4 refs через API, больше self-hosted)

### Для character consistency (следующий этап)

**Рекомендуемый pipeline**:

1. **Character Sheet Generation**: Сначала генерируем "character sheet" (портрет + 2-3 ракурса) по текстовому описанию через FLUX.2 Klein 4B
2. **Multi-Reference Generation**: Используем character sheet как 2-4 reference images для каждой иллюстрации с этим персонажем
3. **Fallback**: Если consistency недостаточна, рассмотреть LoRA per-character (но это значительный compute overhead)

### Модели, которые НЕ подходят

| Модель               | Причина отказа                                           |
| -------------------- | -------------------------------------------------------- |
| GLM-Image 16B        | Требует 48-80GB VRAM, 28-64s генерация                   |
| FLUX.2 Klein 9B-KV   | Non-commercial license, 29GB VRAM                        |
| FLUX.1 Kontext [dev] | Non-commercial license, 20s генерация                    |
| Imagen 4 Fast        | $0.02/image (дороже текущего), нет character consistency |
| HiDream I1 Fast      | 18-27GB VRAM, 20-35s генерация на consumer GPU           |

### Модели для мониторинга

| Модель                       | Почему следить                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Qwen-Image 2.0**           | Apache 2.0, #1 Arena quality, character consistency через edit — но медленная (30-60s). Если появится distilled variant — пересмотреть |
| **FLUX.2 Klein 9B**          | Если BFL сменит лицензию на Apache 2.0 — лучше quality                                                                                 |
| **FLUX.1 Kontext [pro/max]** | Лучшая character consistency, но проприетарная. Если выйдет open-weight — пересмотреть                                                 |

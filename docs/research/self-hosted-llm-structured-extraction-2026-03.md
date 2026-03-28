# Self-Hosted LLM для Structured JSON Extraction из русского текста

**Дата:** 2026-03-25 (обновлено)
**Контекст:** fancai — fiction reader, entity extraction + description extraction из русского худ. текста
**Baseline:** Gemini 3.0 Flash через OpenRouter ($0.50/M input, $3.00/M output) = **$5.12/книга**

---

## Содержание

1. [Методология расчёта](#методология-расчёта)
2. [Сводная таблица моделей](#сводная-таблица-моделей)
3. [Детальный анализ: Qwen3.5 серия (НОВОЕ)](#детальный-анализ-qwen35-серия)
4. [Детальный анализ: GigaChat 3 Lightning (НОВОЕ)](#детальный-анализ-gigachat-3-lightning)
5. [Детальный анализ: Mistral Small 4 (НОВОЕ)](#детальный-анализ-mistral-small-4)
6. [Детальный анализ: Другие модели](#детальный-анализ-другие-модели)
7. [vLLM Structured Output баги (НОВОЕ)](#vllm-structured-output-баги)
8. [Квантизация на L4 (НОВОЕ)](#квантизация-на-l4)
9. [vLLM Performance Tuning (НОВОЕ)](#vllm-performance-tuning)
10. [SGLang как альтернатива vLLM (НОВОЕ)](#sglang-как-альтернатива-vllm)
11. [Расчёт стоимости на Modal](#расчёт-стоимости-на-modal)
12. [Итоговая рекомендация](#итоговая-рекомендация)

---

## Методология расчёта

### Параметры книги (скорректировано по данным OpenRouter Management API)

- 50 глав
- **~4.71M input tokens** total (system prompt + текст главы + JSON schema)
- **~270K output tokens** total (structured JSON)
- Суммарно: **~5M tokens на книгу**

### Baseline стоимость (Gemini 3.0 Flash через OpenRouter)

```
Input:  4.71M × $0.10/M  = $0.47
Output: 270K  × $0.40/M  = $0.11
+ OpenRouter markup + retries = итого $5.12 (реальные данные)
```

### Формула стоимости self-hosted на Modal

```
cost = (output_tokens / output_throughput_tok_s) × GPU_price_per_sec
     + (input_tokens / prefill_throughput_tok_s) × GPU_price_per_sec
```

При batch processing prefill ~10-20x быстрее генерации. Bottleneck — output generation.
С prefix caching system prompt обрабатывается только 1 раз.

### Modal GPU Pricing (подтверждено март 2026)

| GPU       | $/сек     | VRAM  | Часовая | Mem BW    |
| --------- | --------- | ----- | ------- | --------- |
| T4        | $0.000164 | 16 GB | $0.59   | 320 GB/s  |
| L4        | $0.000222 | 24 GB | $0.80   | 300 GB/s  |
| A10G      | $0.000306 | 24 GB | $1.10   | 600 GB/s  |
| L40S      | $0.000542 | 48 GB | $1.95   | 864 GB/s  |
| A100 40GB | $0.000583 | 40 GB | $2.10   | 1555 GB/s |
| A100 80GB | $0.000694 | 80 GB | $2.50   | 2039 GB/s |
| H100      | $0.001097 | 80 GB | $3.95   | 3350 GB/s |

Источник: [Modal Pricing](https://modal.com/pricing)

---

## Сводная таблица моделей

| Модель                   | Размер    | Active | Min GPU (Modal) | VRAM (quant) | Output tok/s (est.) | $/книга (270K out) | Русский       | JSON quality   | Статус            |
| ------------------------ | --------- | ------ | --------------- | ------------ | ------------------- | ------------------ | ------------- | -------------- | ----------------- |
| **Qwen3.5-35B-A3B GPTQ** | 35B MoE   | 3B     | L4 (24GB)       | ~20 GB       | ~60-80              | **$0.75-1.00**     | Отличный      | **Баг #35700** | Ждать фикс vLLM   |
| **Qwen3.5-9B**           | 9B dense  | 9B     | L4 (24GB)       | ~10 GB (FP8) | ~40-60              | **$1.00-1.50**     | Отличный      | OK             | **TOP CANDIDATE** |
| **Qwen3.5-4B**           | 4B dense  | 4B     | T4 (16GB)       | ~8 GB (FP16) | ~80-100             | **$0.45-0.60**     | Хороший       | OK             | Budget tier       |
| **GigaChat3 Lightning**  | 10B MoE   | 1.8B   | L4 (24GB)       | ~10 GB (FP8) | ~234-334            | **$0.18-0.26**     | **Лучший**    | Ограниченный   | **Мониторить**    |
| **Mistral Small 4**      | 119B MoE  | 6B     | 2×L40S (96GB)   | ~66 GB NVFP4 | ~30-50              | **$3.00-5.00**     | Неизвестно    | Да             | Не влезет на L4   |
| Qwen3-14B AWQ            | 14B dense | 14B    | L4 (24GB)       | ~10 GB       | ~50-80              | **$0.75-1.20**     | Очень хороший | Хороший        | **Проверенный**   |
| Gemma 3 27B INT4         | 27B dense | 27B    | L40S (48GB)     | ~14 GB       | ~30-40              | **$1.50-2.00**     | Хороший       | Нестабильный   | Рискованно        |
| Phi-4 Reasoning Plus     | 14B dense | 14B    | L4 (24GB)       | ~11 GB AWQ   | ~40-50              | **$1.20-1.50**     | Средний       | Баги в vLLM    | Не рекомендуется  |

> **ВАЖНО:** Числа стоимости скорректированы для 270K output tokens (не 250K как ранее) и **batch=1** throughput (worst case). При continuous batching стоимость может быть в 3-10x ниже.

---

## Детальный анализ: Qwen3.5 серия

### Qwen3.5-35B-A3B (MoE)

**Релиз:** Март 2026
**Архитектура:** 35B total, 3B active, 256 experts (8 routed + 1 shared), Gated DeltaNet (GDN) layers
**Контекст:** 262K native
**Языки:** Multilingual, отличный русский (наследие Qwen3)

#### VRAM и квантизация

| Формат    | Размер весов | Помещается на L4 (24GB)? |
| --------- | ------------ | ------------------------ |
| BF16      | ~67 GB       | НЕТ                      |
| FP8       | ~39 GB       | НЕТ                      |
| GPTQ-Int4 | ~20 GB       | ДА (остаётся ~4GB на KV) |
| AWQ-4bit  | ~22 GB       | ОЧЕНЬ ТЕСНО              |

Источники: [Qwen3.5-35B-A3B HF](https://huggingface.co/Qwen/Qwen3.5-35B-A3B), [GPTQ-Int4](https://huggingface.co/Qwen/Qwen3.5-35B-A3B-GPTQ-Int4), [AWQ-4bit](https://huggingface.co/cyankiwi/Qwen3.5-35B-A3B-AWQ-4bit)

#### Throughput бенчмарки

| GPU              | Метод          | Throughput    | Источник                                                                                                                                                  |
| ---------------- | -------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DGX Spark (TP=2) | MXFP4 vLLM     | 70.68 tok/s   | [NVIDIA Forums](https://forums.developer.nvidia.com/t/vllm-0-17-0-mxfp4-patches-for-dgx-spark-qwen3-5-35b-a3b-70-tok-s-gpt-oss-120b-80-tok-s-tp-2/362824) |
| DGX Spark (TP=2) | vanilla vLLM   | 42.85 tok/s   | [NVIDIA Forums](https://forums.developer.nvidia.com/t/vllm-0-17-0-mxfp4-patches-for-dgx-spark-qwen3-5-35b-a3b-70-tok-s-gpt-oss-120b-80-tok-s-tp-2/362824) |
| RTX 5090         | GPTQ-Int4 vLLM | 194-197 tok/s | [HF Discussion](https://huggingface.co/Qwen/Qwen3.5-35B-A3B-GPTQ-Int4/discussions/3)                                                                      |
| RTX 3090         | GGUF Q4        | ~112 tok/s    | [Complete Guide](https://techie007.substack.com/p/qwen-35-the-complete-guide-benchmarks)                                                                  |
| Alibaba API      | Service        | 177.7 tok/s   | [Artificial Analysis](https://artificialanalysis.ai/models/qwen3-5-35b-a3b)                                                                               |

**Нет данных для L4 GPU напрямую.** Расчёт от bandwidth:

- L4 bandwidth: 300 GB/s, RTX 3090: 936 GB/s
- Пропорция: 300/936 = 0.32
- Estimate L4 GPTQ-Int4: ~112 × 0.32 = **~36 tok/s** (batch=1, conservative)
- С Marlin kernel (AWQ/GPTQ): может быть лучше, ~50-70 tok/s

**КРИТИЧЕСКИЙ БАГ:** Structured output **не работает** с MTP enabled в thinking mode. См. раздел [vLLM баги](#vllm-structured-output-баги).

#### Оценка для fancai на L4

```
Output: 270K tokens / 50 tok/s = 5400 сек = 90 минут
Input prefill: 4.71M / 500 tok/s = 9420 сек (но с prefix caching system prompt: ~6000 сек)
Total: ~11400 сек × $0.000222 = $2.53/книга
```

> С continuous batching (3-5 глав параллельно), throughput вырастет ~3-5x → **$0.50-0.85/книга**

**Вердикт:** Помещается на L4 в GPTQ-Int4, но с очень маленьким KV cache. Context window придётся ограничить до 4K-8K. Structured output баг в vLLM критический — **ждать фикс**.

---

### Qwen3.5-9B (Dense) ★ НОВЫЙ TOP CANDIDATE

**Архитектура:** 9B dense, GDN layers
**Контекст:** 262K native
**Качество:** Превосходит Qwen3-30B на большинстве бенчмарков. Beats GPT-5-Nano на vision tasks.

#### VRAM

| Формат | Размер | L4 (24GB)                               |
| ------ | ------ | --------------------------------------- |
| BF16   | ~18 GB | ДА (~6 GB на KV cache)                  |
| FP8    | ~10 GB | ДА (~14 GB на KV cache, отлично)        |
| INT4   | ~5 GB  | ДА (~19 GB на KV cache, огромный запас) |

Источник: [Qwen3.5-9B HF](https://huggingface.co/Qwen/Qwen3.5-9B), [VRAM Guide](https://kaitchup.substack.com/p/qwen35-9b-4b-2b-and-08b-gpu-requirements)

#### Преимущества

- **Помещается на L4 даже в BF16** — можно использовать FP8 KV cache для большого контекста
- **262K контекст** — более чем достаточно для любой главы
- GPQA Diamond: превосходит Qwen3-30B на 8 пунктов, IFEval на 3 пункта
- vLLM полная поддержка: `vllm serve Qwen/Qwen3.5-9B --tensor-parallel-size 1 --max-model-len 262144`
- Structured output + tool calling через `--tool-call-parser qwen3_coder`
- GDN архитектура — эффективнее на длинных контекстах

Источник: [vLLM Qwen3.5 Guide](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)

#### Оценка throughput на L4

Прямых бенчмарков нет. Расчёт:

- 9B dense на L4 (300 GB/s) в BF16: ~40-50 tok/s (batch=1)
- В FP8: ~60-80 tok/s
- При batch throughput (5-10 concurrent): ~200-400 tok/s

```
Batch=1: 270K / 50 tok/s = 5400 сек × $0.000222 = $1.20/книга
Batch=5: 270K / 200 tok/s = 1350 сек × $0.000222 = $0.30/книга
```

**Вердикт:** Отличный кандидат. Качество выше Qwen3-14B, помещается на L4 с запасом, нет MoE-специфических багов. **Рекомендуется как основной кандидат для тестирования.**

---

### Qwen3.5-4B (Dense)

**Размер:** 4B dense
**VRAM:** ~8 GB FP16, ~4 GB INT4
**GPU:** T4 (16GB) с запасом

- Качество: хороший для 4B, но **может быть недостаточно** для сложного entity extraction из русского текста
- Throughput на T4: ~80-100 tok/s (batch=1)
- **$0.45-0.60/книга** при batch=1 на T4
- Может быть fallback для простых книг

---

## Детальный анализ: GigaChat 3 Lightning

### GigaChat3-10B-A1.8B (MoE)

**Разработчик:** Sber (Россия)
**Лицензия:** MIT (коммерческое использование разрешено)
**Архитектура:** 10B total, 1.8B active, MoE + MLA (Multi-head Latent Attention) + MTP (Multi-Token Prediction)
**Обучение:** 20T tokens, 10+ языков, 5.5T synthetic data

Источник: [GitHub](https://github.com/salute-developers/gigachat3), [HuggingFace](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)

#### Бенчмарки качества

| Benchmark       | GigaChat3 Lightning | Сравнение                  |
| --------------- | ------------------- | -------------------------- |
| MMLU RU         | 0.6833              | Выше Qwen3-4B              |
| MMLU PRO EN     | 0.6061              | —                          |
| Human Eval Plus | 0.6951              | —                          |
| Math 500        | 0.7000              | —                          |
| MERA text       | ±2-7% от SOTA       | Близко к SOTA для русского |

Источники: [GigaChat3 GitHub](https://github.com/salute-developers/gigachat3), [MERA Benchmark](https://mera.a-ai.ru/en/industrial/submits/94), [arXiv Paper](https://arxiv.org/html/2506.09440v1)

#### Throughput (vLLM v0.11.0, bfloat16, batch=1)

| Конфигурация     | Output Throughput | Total Token Throughput | TTFT    |
| ---------------- | ----------------- | ---------------------- | ------- |
| С MTP            | **333.6 tok/s**   | 678.9 tok/s            | 26.3 ms |
| Без MTP          | 234.4 tok/s       | 476.9 tok/s            | 31.1 ms |
| Qwen3-1.7B (ref) | —                 | 726 tok/s (baseline)   | —       |
| Qwen3-4B (ref)   | —                 | 420 tok/s              | —       |

Источник: [HuggingFace Model Card](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)

> **ВПЕЧАТЛЯЕТ:** 333 tok/s output при batch=1 — это **быстрее Qwen3-4B** при том что модель 10B total. MTP даёт +40% speedup.

**НО:** GPU не указан в бенчмарке. Вероятно A100/H100 (vLLM v0.11.0 benchmark conditions). На L4 будет значительно медленнее.

#### Оценка на L4

Пропорция по bandwidth (если бенчмарк на A100 80GB):

- A100: 2039 GB/s, L4: 300 GB/s → ratio 0.147
- Estimate: 333 × 0.147 = **~49 tok/s** с MTP (batch=1)
- Без MTP: 234 × 0.147 = **~34 tok/s**

```
С MTP: 270K / 49 tok/s = 5510 сек × $0.000222 = $1.22/книга
Без MTP: 270K / 34 tok/s = 7941 сек × $0.000222 = $1.76/книга
```

#### VRAM на L4

- 10B total, FP8: ~10 GB весов → помещается на L4 с ~14 GB для KV cache
- MLA сжимает KV cache в latent representation → ещё больше экономия памяти

#### Structured Output — ОГРАНИЧЕНИЯ

**Критическая проблема:** GigaChat3 использует **Python list syntax** для tool calls, НЕ JSON.

- Tool call parser: `--tool-call-parser gigachat3`
- Формат ответа: Python list (не JSON array)
- **Нет стандартного JSON Schema guided decoding** — нужно тестировать через vLLM generic structured output
- vLLM DeepGemm конфликтует — обязательно `VLLM_USE_DEEP_GEMM=0`
- Требуется vLLM development branch для полной поддержки

Источник: [HuggingFace Model Card](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)

#### Русский язык — ЛУЧШИЙ в классе

- **Создан специально для русского языка** — Sber/SalutDevices
- MERA benchmark: ±2-7% от SOTA
- MMLU RU: 0.6833 — превосходит Qwen3-4B
- 20T tokens обучения с фокусом на русском

#### Версия 3.1

Есть GigaChat3.1-10B-A1.8B — обновлённая версия. [HuggingFace](https://huggingface.co/ai-sage/GigaChat3.1-10B-A1.8B)

#### Вердикт

**Плюсы:**

- Лучший русский язык в классе <14B
- Очень быстрый (MTP + 1.8B active)
- MIT лицензия
- Помещается на L4 с запасом

**Минусы:**

- Structured output нестандартный (Python list, не JSON)
- vLLM поддержка не полная (development branch)
- Нет подтверждённых L4 бенчмарков
- Маленький размер (1.8B active) — качество extraction может быть недостаточным

**Рекомендация:** Мониторить. Протестировать structured JSON extraction качество. Если качество достаточно — лучший вариант по скорости и стоимости.

---

## Детальный анализ: Mistral Small 4

### Mistral-Small-4-119B-2603 (MoE)

**Релиз:** 16 марта 2026
**Архитектура:** 119B total, 6B active (8B с embedding/output), 128 experts, 4 active per token
**Контекст:** 128K tokens
**Лицензия:** Apache 2.0

Источник: [Mistral Blog](https://mistral.ai/news/mistral-small-4), [HuggingFace](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)

#### VRAM и квантизация

| Формат | Размер  | GPU                      |
| ------ | ------- | ------------------------ |
| BF16   | ~238 GB | 4×A100 80GB              |
| NVFP4  | ~66 GB  | 2×L40S (96GB)            |
| INT4   | ~60+ GB | Не поместится на A10G/L4 |

> **НЕ ПОМЕЩАЕТСЯ на L4/A10G (24GB)** даже в INT4. Минимум 2×L40S ($3.90/час).

Источник: [Hardware Corner](https://www.hardware-corner.net/llm-database/Mistral/), [NVFP4 HF](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603-NVFP4)

#### Performance

- 40% reduction в end-to-end completion time vs Mistral Small 3
- 3x больше requests/sec vs Mistral Small 3
- vLLM support: PR в процессе мержа (ожидался март 2026)
- EAGLE speculative decoding поддержка: [mistralai/Mistral-Small-4-119B-2603-eagle](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603-eagle)

#### Structured Output

- Function calling нативно поддерживается
- JSON structured output через vLLM — работает, но были баги с MistralTokenizer ([#15551](https://github.com/vllm-project/vllm/issues/15551))
- Mistral Docs: [Structured Output](https://docs.mistral.ai/capabilities/structured-output/structured_output_overview/)

#### Русский язык

- Поддержка "dozens of languages" — русский **не указан явно** в документации
- Нет MERA benchmark результатов
- Вероятно приемлемый, но **не проверено**

#### Вердикт

**НЕ РЕКОМЕНДУЕТСЯ для fancai:**

- Не помещается на L4/A10G — нужно 2×L40S ($3.90/час)
- При 30-50 tok/s: 270K / 40 = 6750 сек × $0.001084 (2×L40S) = **$7.32/книга** — дороже Gemini!
- Русский не подтверждён
- Overkill для задачи extraction

---

## Детальный анализ: Другие модели

### Gemma 3 27B

- **Structured output баг в vLLM:** Issue [#15766](https://github.com/vllm-project/vllm/issues/15766) — assertion error при structured output
- В более новых версиях vLLM (v0.17+) с `chunked_prefill_enabled=True` проблема решена
- Нестабильные результаты при classification tasks — модель игнорирует часть классов
- **VRAM:** ~14 GB INT4, не помещается на L4 в FP16 (54 GB)
- **Вердикт:** Рискованно. Structured output нестабилен. Не рекомендуется.

Источник: [vLLM Issue #15766](https://github.com/vllm-project/vllm/issues/15766)

### Phi-4 Reasoning Plus (14B)

- **Контекст:** 16K — **критически мало** для глав по 10K+ tokens
- **vLLM баг:** Модель зацикливается на повторении reasoning phrases ([#18141](https://github.com/vllm-project/vllm/issues/18141))
- Structured output + reasoning требует `--structured-outputs-config.enable_in_reasoning=True`
- **Вердикт:** Не рекомендуется — контекст мал, vLLM баги.

Источник: [HuggingFace](https://huggingface.co/microsoft/Phi-4-reasoning-plus), [vLLM Bug](https://github.com/vllm-project/vllm/issues/18141)

### Qwen3-14B AWQ (предыдущий TOP PICK)

- По-прежнему хороший вариант
- Qwen3.5-9B **превосходит** Qwen3-14B по бенчмаркам (GPQA, IFEval, LongBench)
- Qwen3.5-9B имеет 262K контекст vs 128K у Qwen3-14B
- **Рекомендация:** Заменить на Qwen3.5-9B как основной кандидат

### GLM-4.7 Flash

- Недавние бенчмарки показывают что **обгоняет Qwen3.5-35B-A3B** по скорости inference
- Но нет данных о VRAM, vLLM совместимости, structured output
- Мониторить

Источник: [AI News](https://aihaberleri.org/en/news/glm-47-flash-outpaces-qwen35-35b-a3b-in-local-inference-speed-new-benchmarks-reveal)

---

## vLLM Structured Output баги

### Issue #35700: Qwen3.5 structured output не работает

**Статус:** ОТКРЫТ (на 25.03.2026)
**URL:** [github.com/vllm-project/vllm/issues/35700](https://github.com/vllm-project/vllm/issues/35700)

**Корень проблемы:** Structured output ломается когда **MTP (Multi-Token Prediction) включён** в thinking mode.

**Условия воспроизведения:**

- Qwen3.5-27B-FP8 или Qwen3.5-35B-A3B-FP8
- vLLM OpenAI-compatible API
- response_format с JSON schema
- MTP + thinking mode enabled

**Workaround:** Отключить MTP:

```bash
# НЕ использовать --speculative-config с MTP
vllm serve Qwen/Qwen3.5-9B --dtype auto
# Без --num-speculative-tokens, без --speculative-config
```

**В non-thinking mode без MTP — работает нормально.**

### Issue #35574: enable_thinking=False не работает

**Статус:** ЗАКРЫТ
**Решение:** Исправлено в vLLM 0.9.0 с `--reasoning-parser qwen3`
**URL:** [github.com/vllm-project/vllm/issues/35574](https://github.com/vllm-project/vllm/issues/35574)

### Issue #36872: Gibberish output с speculative decoding

**Статус:** ОТКРЫТ
**URL:** [github.com/vllm-project/vllm/issues/36872](https://github.com/vllm-project/vllm/issues/36872)

- Qwen3.5-35B-A3B-FP8 с speculative decoding → gibberish output + коллапс throughput
- Не использовать speculative decoding с Qwen3.5 MoE моделями пока

### Issue #18819: Broken structured output с Qwen3 при enable_thinking=False

**Статус:** Исправлен в поздних версиях vLLM (0.9.0+)

### Выводы по багам

1. **Qwen3.5-9B (dense)** — наименее проблемный, нет MoE-специфических багов
2. **Qwen3.5-35B-A3B (MoE)** — structured output + MTP = баг. Без MTP работает, но теряем скорость
3. **Speculative decoding** — НЕ использовать с Qwen3.5 MoE моделями
4. **Текущая версия vLLM:** 0.17.x — многие баги Qwen3.5 ещё открыты
5. **Рекомендация:** Использовать Qwen3.5-9B (dense) для структурированного вывода до фикса MoE багов

---

## Квантизация на L4

### L4 GPU ключевые характеристики

- **VRAM:** 24 GB GDDR6
- **Memory Bandwidth:** 300 GB/s
- **Compute Capability:** 8.9 (Ada Lovelace)
- **FP8 hardware:** Поддерживается (cc >= 8.9), но **вес-only W8A16** для FP8 через Marlin

#### ВАЖНО: FP8 KV cache на L4

FP8 computation (W8A8) требует compute capability **>8.9** (строго больше).
L4 имеет **ровно 8.9** → **FP8 KV cache может НЕ работать** с native acceleration.
FP8 weights загружаются как W8A16 через FP8 Marlin kernel.

Источник: [vLLM FP8 Docs](https://docs.vllm.ai/en/v0.5.4/quantization/fp8.html), [Quantized KV Cache](https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/)

### Сравнение методов квантизации

| Метод             | Throughput     | Speedup vs BF16 | Качество     | L4 Support  |
| ----------------- | -------------- | --------------- | ------------ | ----------- |
| **AWQ+Marlin**    | **741 tok/s**  | ~1.6x           | 51.8% Pass@1 | ДА          |
| GPTQ+Marlin       | 712 tok/s      | ~1.54x          | 51.0%        | ДА          |
| AWQ (без Marlin)  | 67 tok/s       | 0.15x           | 51.8%        | ДА          |
| GPTQ (без Marlin) | 275 tok/s      | 0.60x           | 51.0%        | ДА          |
| BF16              | 461 tok/s      | 1.0x            | Baseline     | ДА          |
| FP8 W8A16         | ~500-550 tok/s | ~1.1-1.2x       | ~Baseline    | ДА (Marlin) |

> **AWQ + Marlin kernel = лучший выбор на L4.** 10.9x speedup для AWQ с Marlin vs без. GPTQ + Marlin тоже хорош (2.6x speedup).

Источник: [JarvisLabs Quantization Guide](https://docs.jarvislabs.ai/blog/vllm-quantization-complete-guide-benchmarks), [GPUStack Impact Study](https://docs.gpustack.ai/2.0/performance-lab/references/the-impact-of-quantization-on-vllm-inference-performance/)

**КРИТИЧЕСКИ ВАЖНО:** Без Marlin kernel AWQ даёт только 67 tok/s — это 10x медленнее! Всегда проверять что Marlin kernel активирован (`--quantization awq_marlin` или `--quantization gptq_marlin`).

### Guided Decoding Overhead

| Сценарий                   | Overhead         | Источник                                                                            |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| Simple JSON schema         | 5-15% latency    | [SqueezeBits](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang) |
| Complex schema             | 30-60% latency   | [SqueezeBits](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang) |
| Repetitive schema (cached) | Minimal (~5%)    | [vLLM Blog](https://blog.vllm.ai/2025/01/14/struct-decode-intro.html)               |
| Batch ≥8                   | Significant drop | [SqueezeBits](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang) |

**Для fancai:** Используем **одну и ту же JSON schema** для всех глав → schema caching в XGrammar → overhead ~5-10%.

**XGrammar** — лучший backend для repetitive schemas. Pre-computation + caching минимизируют runtime overhead.

Источник: [vLLM Structured Decoding Intro](https://www.bentoml.com/blog/structured-decoding-in-vllm-a-gentle-introduction)

---

## vLLM Performance Tuning

### Ключевые параметры для L4 (24GB)

#### max_model_len

- Ограничивает максимальный контекст и размер KV cache
- **Рекомендация:** Начать с `--max-model-len 8192` (достаточно для главы + system prompt + output)
- Каждое удвоение контекста ≈ удваивает KV cache memory
- Для 9B модели при 8K context: ~1-2 GB KV cache

Источник: [vLLM Optimization Guide](https://docs.vllm.ai/en/stable/configuration/optimization/)

#### gpu_memory_utilization

- Контролирует долю VRAM для KV cache + весов
- **Рекомендация:** `--gpu-memory-utilization 0.90` для L4
- Значения 0.85-0.95 типичны; выше = больше concurrent requests, но меньше headroom для CUDA spikes

Источник: [Red Hat vLLM Tuning](https://developers.redhat.com/articles/2026/03/03/practical-strategies-vllm-performance-tuning)

#### max_num_seqs и max_num_batched_tokens

- `max_num_seqs` — максимум concurrent sequences в batch
- `max_num_batched_tokens` — максимум токенов в одном batch iteration
- **Для L4 с 9B моделью (FP8, ~10GB весов, ~14GB на KV):**
  - `--max-num-seqs 8-16` (conservative для 24GB)
  - `--max-num-batched-tokens 8192`
- При preemption warnings — уменьшать оба параметра

Источник: [vLLM Engine Args](https://docs.vllm.ai/en/stable/configuration/engine_args/), [vLLM Issue #2492](https://github.com/vllm-project/vllm/issues/2492)

#### Prefix Caching

- **ОБЯЗАТЕЛЬНО включить** — system prompt (JSON schema + инструкции) одинаковый для всех 50 глав
- `--enable-prefix-caching` (default в vLLM V1)
- KV cache для system prompt вычисляется 1 раз и переиспользуется
- Экономия: если system prompt 2K tokens → 50 глав × 2K = 100K tokens prefill saved

**Ограничение:** APC не ускоряет decoding (генерацию), только prefill. Для наших 4.71M input tokens это значительная экономия.

Источник: [vLLM Prefix Caching](https://docs.vllm.ai/en/stable/design/prefix_caching/)

#### Speculative Decoding (MTP)

- MTP-1 снижает per-token latency при low concurrency
- **НО:** для Qwen3.5 MoE моделей — вызывает баги (gibberish output, structured output failures)
- Для Qwen3.5-9B (dense) — потенциально безопаснее, но нужно тестировать
- MTP потребляет KV cache capacity → снижает effective batch size
- **Рекомендация:** НЕ включать MTP до стабилизации vLLM

Источник: [vLLM Spec Decode](https://docs.vllm.ai/en/latest/features/speculative_decoding/), [vLLM Issue #36872](https://github.com/vllm-project/vllm/issues/36872)

### Оптимальная конфигурация для fancai на L4

```bash
VLLM_USE_DEEP_GEMM=0 vllm serve Qwen/Qwen3.5-9B \
  --dtype auto \
  --quantization awq_marlin \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 8 \
  --enable-prefix-caching \
  --kv-cache-dtype auto \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --port 8000
```

> Примечание: AWQ вариант Qwen3.5-9B нужно найти или создать. Если нет — использовать BF16 с `--max-model-len 8192`.

---

## SGLang как альтернатива vLLM

### Почему рассмотреть SGLang

SGLang **значительно лучше** vLLM для structured output:

| Метрика                   | vLLM             | SGLang                             |
| ------------------------- | ---------------- | ---------------------------------- |
| Guided decoding overhead  | 30-60% (complex) | **Minimal**                        |
| Architecture              | Sequential masks | Overlapped with GPU                |
| Throughput (H100)         | ~12,500 tok/s    | **~16,200 tok/s**                  |
| Structured output latency | Higher           | **3x faster** for structured tasks |
| Schema caching            | XGrammar         | Compressed FSM                     |

Источники: [SqueezeBits](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang), [PreemAI Comparison](https://blog.premai.io/vllm-vs-sglang-vs-lmdeploy-fastest-llm-inference-engine-in-2026/)

**Ключевое преимущество:** SGLang overlapping mask generation с GPU inference → structured output почти без penalty. Для fancai (100% structured output) это может дать 20-40% экономию.

**НО:** vLLM имеет лучшую экосистему, больше документации, и Modal examples. SGLang на Modal требует custom setup.

**Рекомендация:** Начать с vLLM, переключиться на SGLang если structured output overhead станет bottleneck.

---

## Расчёт стоимости на Modal — Обновлённая таблица

Assumptions:

- 50 глав, **270K output tokens**, **4.71M input tokens**
- vLLM batch processing
- Throughput estimates: **batch=1** (worst case) и **batch=5** (realistic)
- Structured output overhead: ~10% (repetitive schema + XGrammar caching)

| Модель                    | GPU    | batch=1 tok/s | $/книга (b=1) | batch=5 tok/s | $/книга (b=5) | vs Gemini ($5.12) |
| ------------------------- | ------ | ------------- | ------------- | ------------- | ------------- | ----------------- |
| **Qwen3.5-9B BF16**       | **L4** | **~45**       | **$1.33**     | **~180**      | **$0.33**     | **15x дешевле**   |
| Qwen3.5-9B FP8 (W8A16)    | L4     | ~60           | $1.00         | ~240          | $0.25         | 20x дешевле       |
| Qwen3.5-35B-A3B GPTQ      | L4     | ~40           | $1.50         | ~150          | $0.40         | 13x дешевле       |
| Qwen3.5-4B FP16           | T4     | ~90           | $0.49         | ~400          | $0.11         | 47x дешевле       |
| GigaChat3 10B (MTP, est.) | L4     | ~49           | $1.22         | ~200          | $0.30         | 17x дешевле       |
| Qwen3-14B AWQ             | L4     | ~50           | $1.20         | ~250          | $0.24         | 21x дешевле       |
| Mistral Small 4 NVFP4     | 2×L40S | ~40           | $7.32         | ~150          | $1.95         | **дороже!**       |

> **Cold start:** L4 ~30-60 сек ($0.007-0.013), amortized across 50 chapters per book — negligible.

### Input prefill стоимость (с prefix caching)

System prompt ~2K tokens: cached после 1й главы.
Per-chapter input: ~92K tokens (4.71M / 50 глав - 2K cached)
Prefill speed на L4 (9B model): ~500-1000 tok/s

```
Prefill cost: 4.71M / 700 tok/s = 6729 сек × $0.000222 = $1.49
Но с prefix caching (system prompt reuse): ~$1.20
Total (prefill + generation): ~$1.20 + $1.33 = $2.53/книга (batch=1)
Total (batch=5): ~$0.30 + $0.33 = $0.63/книга
```

**Реалистичная оценка для Qwen3.5-9B на L4: $0.63-2.53/книга** (в зависимости от batching).

---

## Итоговая рекомендация

### Изменения с предыдущей версии

1. **Qwen3.5-9B заменяет Qwen3-14B** как TOP PICK — лучше по бенчмаркам, 262K контекст, помещается на L4
2. **Qwen3.5-35B-A3B** — интересен но structured output баг (#35700) блокирует
3. **GigaChat3 Lightning** — лучший русский, но structured output нестандартный
4. **Mistral Small 4** — не помещается на L4, слишком дорого
5. **Реалистичная стоимость выросла** — с учётом 4.71M input tokens (а не 500K)

### Tier 1: Основной кандидат — Qwen3.5-9B на L4

| Параметр        | Gemini 3.0 Flash | Qwen3.5-9B (self-hosted) |
| --------------- | ---------------- | ------------------------ |
| Стоимость/книга | $5.12            | **$0.63-2.53**           |
| Экономия        | Baseline         | **2-8x дешевле**         |
| Русский язык    | Отличный         | Отличный (Qwen3.5)       |
| Контекст        | 1M+              | 262K (достаточно)        |
| Structured JSON | Нативный         | vLLM guided decoding     |
| Качество модели | Frontier         | > Qwen3-30B (!)          |

**Почему Qwen3.5-9B:**

- Превосходит Qwen3-30B по GPQA, IFEval, LongBench — при 9B параметрах!
- 262K контекст native — любая глава поместится с запасом
- BF16 помещается на L4 с 6 GB на KV cache
- FP8 (W8A16) помещается с 14 GB на KV cache
- Нет MoE-специфических багов в vLLM
- Полная поддержка structured output и tool calling

### Tier 2: Если нужно ещё дешевле — Qwen3.5-4B на T4

- $0.11-0.49/книга
- Качество ниже, может быть недостаточно для сложных книг
- T4 = $0.59/час — самый дешёвый GPU на Modal

### Tier 3: Мониторить

- **GigaChat3 Lightning** — если Sber добавит стандартный JSON structured output
- **Qwen3.5-35B-A3B** — когда vLLM починит structured output + MTP (issue #35700)
- **GLM-4.7 Flash** — если появятся данные о self-hosting

### Tier 4: Не рекомендуется

- **Mistral Small 4** — не помещается на L4/A10G
- **Gemma 3 27B** — нестабильный structured output в vLLM
- **Phi-4 Reasoning Plus** — контекст 16K, vLLM баги
- **DeepSeek V3** — нереалистичные GPU requirements

### Рекомендуемый план действий

1. **Deploy Qwen3.5-9B BF16 на Modal L4** — с prefix caching, max_model_len=8192
2. **A/B тестирование** vs Gemini 3.0 Flash на 5-10 книгах (entity extraction quality)
3. **Попробовать AWQ quantization** если найдётся AWQ вариант — ускорит с Marlin kernel
4. **Тестировать SGLang** если structured output overhead в vLLM слишком высок
5. **Мониторить vLLM releases** — фикс #35700 откроет Qwen3.5-35B-A3B MoE
6. **Протестировать GigaChat3** на качество JSON extraction

### Потенциальная экономия (при 100 книгах/мес)

| Сценарий                | Стоимость/мес | Экономия vs Gemini |
| ----------------------- | ------------- | ------------------ |
| Gemini 3.0 Flash        | $512          | Baseline           |
| Qwen3.5-9B batch=1      | $253          | $259 (51%)         |
| Qwen3.5-9B batch=5      | $63           | $449 (88%)         |
| Qwen3.5-4B batch=5 (T4) | $11           | $501 (98%)         |

---

## Источники

### Модели

- [Qwen3.5-35B-A3B HuggingFace](https://huggingface.co/Qwen/Qwen3.5-35B-A3B)
- [Qwen3.5-9B HuggingFace](https://huggingface.co/Qwen/Qwen3.5-9B)
- [Qwen3.5 Speed Benchmarks](https://qwen.readthedocs.io/en/latest/getting_started/speed_benchmark.html)
- [Qwen3.5 Complete Guide](https://techie007.substack.com/p/qwen-35-the-complete-guide-benchmarks)
- [Qwen3.5 VRAM Guide](https://apxml.com/posts/qwen-3-5-system-requirement-vram-guide)
- [Qwen3.5 Unsloth Guide](https://unsloth.ai/docs/models/qwen3.5)
- [GigaChat3 GitHub](https://github.com/salute-developers/gigachat3)
- [GigaChat3 HuggingFace](https://huggingface.co/ai-sage/GigaChat3-10B-A1.8B)
- [GigaChat3 arXiv Paper](https://arxiv.org/html/2506.09440v1)
- [Mistral Small 4 Blog](https://mistral.ai/news/mistral-small-4)
- [Mistral Small 4 HuggingFace](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)
- [Phi-4 Reasoning Plus HuggingFace](https://huggingface.co/microsoft/Phi-4-reasoning-plus)

### vLLM Issues

- [#35700: Qwen3.5 structured output doesn't work](https://github.com/vllm-project/vllm/issues/35700)
- [#35574: enable_thinking=False не работает](https://github.com/vllm-project/vllm/issues/35574)
- [#36872: Gibberish output with speculative decoding](https://github.com/vllm-project/vllm/issues/36872)
- [#15766: Gemma 3 structured output assertion error](https://github.com/vllm-project/vllm/issues/15766)
- [#18141: Phi-4 reasoning stuck repeating](https://github.com/vllm-project/vllm/issues/18141)
- [#15551: MistralTokenizer structured output bug](https://github.com/vllm-project/vllm/issues/15551)

### vLLM Documentation

- [vLLM Qwen3.5 Recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [vLLM Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)
- [vLLM Optimization Guide](https://docs.vllm.ai/en/stable/configuration/optimization/)
- [vLLM Prefix Caching](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM Speculative Decoding](https://docs.vllm.ai/en/latest/features/speculative_decoding/)
- [vLLM FP8 Quantization](https://docs.vllm.ai/en/v0.5.4/quantization/fp8.html)
- [vLLM Quantized KV Cache](https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/)

### Performance & Benchmarks

- [NVIDIA DGX Spark Qwen3.5 Benchmarks](https://forums.developer.nvidia.com/t/vllm-0-17-0-mxfp4-patches-for-dgx-spark-qwen3-5-35b-a3b-70-tok-s-gpt-oss-120b-80-tok-s-tp-2/362824)
- [SqueezeBits: Guided Decoding Performance](https://blog.squeezebits.com/guided-decoding-performance-vllm-sglang)
- [JarvisLabs Quantization Benchmarks](https://docs.jarvislabs.ai/blog/vllm-quantization-complete-guide-benchmarks)
- [GPUStack Quantization Impact](https://docs.gpustack.ai/2.0/performance-lab/references/the-impact-of-quantization-on-vllm-inference-performance/)
- [Red Hat vLLM Performance Tuning](https://developers.redhat.com/articles/2026/03/03/practical-strategies-vllm-performance-tuning)
- [vLLM vs SGLang vs LMDeploy 2026](https://blog.premai.io/vllm-vs-sglang-vs-lmdeploy-fastest-llm-inference-engine-in-2026/)
- [Artificial Analysis: Qwen3.5-35B-A3B](https://artificialanalysis.ai/models/qwen3-5-35b-a3b)
- [MERA Benchmark](https://mera.a-ai.ru/en/industrial/submits/94)

### Modal

- [Modal Pricing](https://modal.com/pricing)
- [Modal L4 Pricing Article](https://modal.com/blog/nvidia-l4-price-article)
- [Modal A10G Pricing Article](https://modal.com/blog/nvidia-a10g-price-article)
- [Modal vLLM Examples](https://modal.com/docs/examples/vllm_inference)

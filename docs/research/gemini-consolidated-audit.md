# Аудит: Gemini API Consolidated Reference

**Дата аудита:** 2026-03-31
**Аудитор:** Claude Opus 4.6
**Отчёт:** `docs/research/gemini-api-consolidated.md`
**Тип:** Мета-аудит (аудит консолидированного документа на основе 2 предыдущих аудитов)
**Методология:** 4 параллельных исследовательских агента, 30+ веб-источников, ~60 числовых значений верифицировано

## Сводка аудита

| Раздел                      | Ошибок | Неточностей | Устарело | Пропущено | Противоречий |
| --------------------------- | ------ | ----------- | -------- | --------- | ------------ |
| 1. Модели и цены            | 1      | 3           | 0        | 2         | 1            |
| 2. Качество моделей         | 0      | 0           | 0        | 1         | 0            |
| 3. Thinking Control         | 1      | 2           | 0        | 0         | 0            |
| 4. Context Caching          | 0      | 2           | 0        | 0         | 0            |
| 5. Batch API                | 0      | 0           | 0        | 0         | 1            |
| 6. Structured Output        | 0      | 1           | 0        | 0         | 0            |
| 7. Image Generation         | 1      | 2           | 1        | 0         | 0            |
| 8. File Search              | 0      | 1           | 0        | 0         | 0            |
| 9. PDF Document Processing  | 1      | 1           | 0        | 0         | 0            |
| 10. Multimodal Embeddings   | 0      | 0           | 0        | 0         | 0            |
| 11. Thought Signatures      | 0      | 1           | 0        | 0         | 0            |
| 12. Interactions API        | 0      | 0           | 0        | 2         | 0            |
| 13. Tiered Strategy         | 0      | 0           | 0        | 0         | 1            |
| 14. Расчёт стоимости        | 1      | 0           | 0        | 0         | 0            |
| 15. Миграция                | 1      | 0           | 0        | 1         | 0            |
| 16. SDK                     | 1      | 0           | 0        | 0         | 0            |
| 17. Пропущенные возможности | 0      | 0           | 0        | 5         | 0            |
| 18. Источники               | 0      | 0           | 0        | 0         | 0            |
| **Итого**                   | **7**  | **13**      | **1**    | **11**    | **3**        |

---

## Ошибки (требуют исправления)

### E-001: PDF tokens/page для Gemini 3 = 560, не 258

- **Раздел отчёта:** 9.1
- **Утверждение в отчёте:** "Tokens per page: 258 (IMAGE modality, фиксировано)"
- **Фактическое значение:** Для Gemini 3 default (UNSPECIFIED) = **560 tok/page**. LOW = 280, MEDIUM = 560, HIGH = 1120. Значение 258 соответствует **Gemini 2.5** (256 tok/page). Для Gemini 3 базовая цифра иная.
- **Источник:** https://ai.google.dev/gemini-api/docs/document-processing (таблица Media Resolution tokens)
- **Влияние:** **КРИТИЧЕСКОЕ.** Удваивает оценку image tokens для PDF. Все расчёты стоимости PDF-сценариев в разделах 9.3 и 14 занижены:
  - 500 стр × 560 = **280K image tokens** (не 129K)
  - Input cost при 3 Flash: $0.140 (не $0.065)
  - Single-call PDF: **$0.230** (не $0.155)
  - Экономия vs chunk-based: **-77%** (не -85%)
  - Context window: 280K + 750K-1M text = **1.03M-1.28M** — превышает 1M window даже для средних книг
- **Аудитный тег:** [АУДИТ M-002] использовал 258 tok/page — предыдущий аудит ошибся

### E-002: NB2 Elo и позиция на Arena

- **Раздел отчёта:** 7.1
- **Утверждение в отчёте:** "Качество: #1 на Arena.ai (Elo 1280)"
- **Фактическое значение:** NB2 Elo = **~1258**, позиция = **#2**. GPT Image 1.5 (high) обогнал NB2 с Elo ~1264-1265.
- **Источник:** https://arena.ai/leaderboard/text-to-image
- **Влияние:** Низкое. Отчёт содержит аудитный тег [O-003] упоминающий это, но основная таблица 7.1 не исправлена — оригинальные Elo 1280 и "#1" остались.
- **Аудитный тег:** [АУДИТ O-003] корректно заметил, но основная таблица не обновлена

### E-003: google-genai>=1.69.0 — версия не существует

- **Раздел отчёта:** 15, 16.1
- **Утверждение в отчёте:** "Зафиксировать google-genai>=1.69.0 в requirements.txt"
- **Фактическое значение:** Последний релиз на PyPI = **1.68.0** (18 марта 2026). Версия 1.69.0 **не выпущена**.
- **Источник:** https://pypi.org/project/google-genai/
- **Влияние:** Среднее. Рекомендация ссылается на несуществующую версию. Корректно: `>=1.68.0`.

### E-004: 2.5 Flash-Lite thinking_budget min = 512, не 0

- **Раздел отчёта:** 3.2
- **Утверждение в отчёте:** "2.5 Flash-Lite: 0-24576, 0 = OFF"
- **Фактическое значение:** Минимум = **512**, не 0. Thinking **нельзя отключить** через budget=0 на 2.5 Flash-Lite. Документация: "Gemini 2.5 Flash-Lite min budget = 512".
- **Источник:** https://ai.google.dev/gemini-api/docs/thinking
- **Влияние:** Среднее. Для fancai 2.5 Flash-Lite deprecated, но таблица в разделе 3.2 содержит фактическую ошибку.
- **Аудитный тег:** [АУДИТ E-004] утверждал, что диапазоны различаются по моделям — верно, но не исправил min Flash-Lite

### E-005: Расчёты PDF-сценариев занижены

- **Раздел отчёта:** 9.3, 14 (сценарий "PDF hybrid + batch")
- **Утверждение в отчёте:** "Single-call PDF: $0.155", "PDF hybrid + batch LLM ~$0.36"
- **Фактическое значение:** При 560 tok/page (Gemini 3 default):
  - Single-call: image $0.140 + output $0.090 = **$0.230** (не $0.155)
  - При LOW resolution (280 tok/page): $0.070 + $0.090 = **$0.160** (близко к оригиналу, но только с LOW)
- **Источник:** Пересчёт на основе E-001
- **Влияние:** Высокое. Все PDF-сценарии стоимости нуждаются в пересчёте с указанием media_resolution.

### E-006: Сценарии 4-5 images = batch 0.5K, не batch 1K

- **Раздел отчёта:** 14
- **Утверждение в отчёте:** "Batch 3 Flash + NB2 batch" images = $2.20. В секции 5.3: "NB2 images (batch 1K) = $0.034/img"
- **Фактическое значение:** $2.20 = 100 × $0.022 = **batch 0.5K** (не 1K). Batch 1K = $0.034 × 100 = $3.40 (не $2.20).
- **Источник:** ai.google.dev/pricing: NB2 batch 0.5K = $0.022, batch 1K = $0.034
- **Влияние:** Среднее. Если используется 1K, сценарий 4 = $0.63 + $3.40 = **$4.03** (не $2.83). Нужно явно указать разрешение.

### E-007: ULTRA_HIGH media_resolution для PDF — N/A

- **Раздел отчёта:** 9.1
- **Утверждение в отчёте:** "media_resolution: LOW / MEDIUM / HIGH / ULTRA_HIGH (per-document)"
- **Фактическое значение:** `ULTRA_HIGH` существует, но для PDF = **N/A**. Доступно только для IMAGE modality (per-part, рекомендуется для computer use). Для PDF и Video не поддерживается.
- **Источник:** https://ai.google.dev/gemini-api/docs/document-processing
- **Влияние:** Низкое. Но при попытке использовать ULTRA_HIGH для PDF — ошибка.

---

## Неточности (требуют уточнения)

### I-001: 3 Flash default thinking — два источника противоречат

- **Раздел:** 3.1
- **Проблема:** Отчёт указывает 3 Flash default = `high`. Страница Thinking API говорит `minimal`, страница Gemini 3 Developer Guide — `high (Dynamic)`.
- **Уточнение:** Два официальных источника Google противоречат друг другу. Gemini 3 Guide — более авторитетный. Рекомендация: пометить как "high (по gemini-3 guide; документация неконсистентна)" и проверить на реальных запросах без указания thinking_level.
- **Источник:** https://ai.google.dev/gemini-api/docs/thinking vs https://ai.google.dev/gemini-api/docs/gemini-3

### I-002: Issue #699 — версия фикса неверна

- **Раздел:** 6.1
- **Проблема:** Отчёт: "Pydantic `default=` починен в SDK v1.69.0". Issue #699 закрыт **23 апреля 2025**, а v1.69.0 не существует (текущая = 1.68.0, март 2026). Разрыв почти в год.
- **Уточнение:** Issue закрыт — подтверждено. Но привязка к конкретной версии SDK — ошибочна. Фикс, вероятно, в одной из версий мая-июня 2025.
- **Источник:** https://github.com/googleapis/python-genai/issues/699

### I-003: NB2 reference images — 5 characters, не 4

- **Раздел:** 7.1
- **Проблема:** Отчёт: "До 14 (10 objects + 4 characters)". Фактически: **5 characters + 14 objects**. Общий лимит 14 per request — корректен.
- **Уточнение:** Декомпозиция: `max 5 characters + max 14 objects`, общий потолок = 14 reference images.
- **Источник:** https://ai.google.dev/gemini-api/docs/image-generation

### I-004: finish_reason — список неполный

- **Раздел:** 7.2
- **Проблема:** 7 типов перечислены для image generation. Пропущены общие: `RECITATION`, `BLOCKLIST`, `SPII`, `MALFORMED_FUNCTION_CALL`, `OTHER`.
- **Уточнение:** Для image-специфичных ошибок 7 перечисленных — основные. Но error handling должен покрывать **все** FinishReason, включая общие. Также не различаются BlockReason (prompt-side) и FinishReason (candidate-side).
- **Источник:** https://ai.google.dev/gemini-api/docs/safety-settings

### I-005: thinking_budget + thinking_level — рекомендация, не запрет

- **Раздел:** 3.1
- **Проблема:** Отчёт: "thinking_budget и thinking_level **нельзя комбинировать**". Документация не утверждает это категорично — `thinking_budget` принимается Gemini 3 для обратной совместимости, но "may result in unexpected performance".
- **Уточнение:** Корректнее: "разные параметры для разных поколений; комбинирование не рекомендуется"
- **Источник:** https://ai.google.dev/gemini-api/docs/thinking

### I-006: FLUX.2 Klein — прогрессивная цена

- **Раздел:** 1.4
- **Проблема:** Отчёт: "$0.014/img". Фактически: $0.014 **за первый мегапиксель** + $0.001 за каждый дополнительный. Для 1MP = $0.014 (верно), для 4MP = $0.017.
- **Уточнение:** Добавить примечание "(1MP; прогрессивная шкала для высоких разрешений)".
- **Источник:** https://openrouter.ai/black-forest-labs/flux.2-klein-4b

### I-007: RPM/TPM для Tiers — не верифицируемо

- **Раздел:** 1.7
- **Проблема:** Значения 150-300 RPM (Tier 1), 1000+ (Tier 2), 4000+ (Tier 3) **не публикуются** Google официально. Пороги ($100, $1000) и caps ($250, $2000, $20000) — подтверждены.
- **Уточнение:** Добавить примечание "RPM/TPM приблизительные, из неофициальных источников; Google отсылает в AI Studio для текущих квот".
- **Источник:** https://ai.google.dev/gemini-api/docs/rate-limits

### I-008: Metadata filter — синтаксис для числовых значений

- **Раздел:** 8.2, 8.5
- **Проблема:** Пример `metadata_filter='chapter <= "10"'` использует кавычки вокруг числа. Для числовых сравнений metadata должен быть задан как `numeric_value`, а фильтр — без кавычек: `chapter <= 10`.
- **Уточнение:** Изменить metadata на `{"key": "chapter", "numeric_value": 10}` и фильтр на `chapter <= 10`.
- **Источник:** https://ai.google.dev/api/file-search (AIP-160 syntax)

### I-009: Thought signatures для image gen — не "Strict"

- **Раздел:** 11.1
- **Проблема:** Таблица показывает image generation как "ОБЯЗАТЕЛЬНО". Документация: Strict enforcement (400 error) только для **function calling**. Для image gen — подписи генерируются SDK автоматически; ручное управление нужно только при multi-turn REST API.
- **Уточнение:** Изменить на "Автоматически (SDK)" или "Обязательно для multi-turn REST".
- **Источник:** https://ai.google.dev/gemini-api/docs/thought-signatures

### I-010: Context Caching storage для 3 Flash — $4.50 сомнительно

- **Раздел:** 4.2
- **Проблема:** Отчёт указывает $4.50/1M/hour для 3 Flash и Pro. Для Flash-Lite = $1.00. Цена $4.50 для Flash-класса модели — аномально высока (одинакова с Pro). Другие Flash модели (2.5 Flash) исторически имели более низкую storage cost.
- **Уточнение:** Требует верификации на pricing page. Если подтверждается $4.50 для Flash — break-even смещается с ~4 до ~10 запросов.
- **Источник:** https://ai.google.dev/pricing

### I-011: Box Blog — пропущены дополнительные бенчмарки

- **Раздел:** 2.2
- **Проблема:** Отчёт фиксирует +10 и +13 п.п. Box также публикует: +9 п.п. на images, +6 п.п. на long documents, "+15% relative improvement" (не percentage points — источник путаницы в исходном исследовании).
- **Уточнение:** Добавить примечание: "15% = relative improvement, не absolute percentage points".
- **Источник:** https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction

### I-012: Remote MCP в Interactions API — не с Gemini 3

- **Раздел:** 12.1
- **Проблема:** Таблица: "Function calling: Да (включая Remote MCP)". Фактически Remote MCP **не работает с Gemini 3 моделями** (coming soon). Только streamable HTTP, не SSE.
- **Уточнение:** Добавить "(кроме Gemini 3, coming soon; только streamable HTTP)".
- **Источник:** https://ai.google.dev/gemini-api/docs/interactions

### I-013: Flash-Lite caching minimum не документирован явно

- **Раздел:** 4.1
- **Проблема:** Flash-Lite подразумевается как Flash-модель с минимумом 1,024. Документация по кэшированию **не упоминает Flash-Lite** в списке поддерживаемых моделей, хотя pricing показывает storage cost для неё.
- **Уточнение:** Добавить "Flash-Lite minimum = 1,024 (вероятно, как Flash-класс; явно не документирован)".
- **Источник:** https://ai.google.dev/gemini-api/docs/caching

---

## Устаревшая информация

### O-001: NB2 Arena позиция

- **Раздел:** 7.1
- **Что устарело:** "Elo 1280", "#1 на Arena.ai"
- **Актуальная информация:** NB2 Elo = ~1258, позиция #2. GPT Image 1.5 (high) = #1 с Elo ~1264-1265.
- **Источник:** https://arena.ai/leaderboard/text-to-image
- **Примечание:** Аудитный тег [O-003] упоминает это, но основная таблица 7.1 не обновлена.

---

## Внутренние противоречия

### C-001: NB2 batch — таблица 1.1 vs секция 5.3

- **Разделы:** 1.1 vs 5.3
- **Противоречие:** Таблица 1.1 (строка 29) показывает "—" в столбцах Batch для NB2. Секция 5.3 (строка 275) показывает "NB2 images (batch 1K) = $0.034/img". Секция 14 использует batch NB2 в расчётах.
- **Рекомендация:** NB2 batch **поддерживается**. Исправить таблицу 1.1: Batch In = $0.25, Batch Out (images) = $30.00/1M img tok. Pricing: batch 0.5K=$0.022, 1K=$0.034, 2K=$0.050, 4K=$0.076.

### C-002: Flash-Lite в extraction fallback vs "НЕПРИГОДНА"

- **Разделы:** 2.4 vs 13.1
- **Противоречие:** Раздел 2.4: "НЕПРИГОДНА для extraction задач fancai" (подтверждённый баг early response, деградация 76x). Раздел 13.1: `3.1 Flash-Lite` в fallback chain для Extraction TSA (`3 Flash → 3.1 Flash-Lite → OR 2.5 Flash`).
- **Рекомендация:** Убрать Flash-Lite из extraction fallback. Корректная chain: `3 Flash → OR 2.5 Flash → retry 3 Flash`. Flash-Lite допустима для translation/dedup/synthesis.

### C-003: Сценарии 4-5 — неявное разрешение NB2

- **Разделы:** 5.3 vs 14
- **Противоречие:** Секция 5.3 упоминает "batch 1K = $0.034/img". Секция 14 рассчитывает images = $2.20 = 100 × $0.022 (batch **0.5K**). Текст не указывает разрешение, создавая впечатление batch 1K.
- **Рекомендация:** Явно указать разрешение в сценариях: "NB2 batch 0.5K = $2.20" или "NB2 batch 1K = $3.40".

---

## Ошибки предыдущих аудитов

### PA-001: [АУДИТ E-004] — Flash-Lite thinking_budget не полностью исправлен

- **Аудитный тег в отчёте:** [АУДИТ E-004]
- **Утверждение аудита:** "Диапазоны различаются по моделям (не единый 128-24576)"
- **Проблема:** Корректно заметил различие Pro/Flash, но **не исправил** минимум Flash-Lite. Указал `0-24576`, фактически **512-24576**.
- **Фактическое значение:** 2.5 Pro: 128-32768, 2.5 Flash: 0-24576, 2.5 Flash-Lite: **512-24576**
- **Источник:** https://ai.google.dev/gemini-api/docs/thinking

### PA-002: [АУДИТ M-002] — PDF tokens/page использовал 258 (Gemini 2.5)

- **Аудитный тег в отчёте:** [АУДИТ M-002]
- **Утверждение аудита:** "500 стр × 258 tok = 829K-1.1M total tokens"
- **Проблема:** Использовал 258 tok/page, что актуально для Gemini 2.5. Для Gemini 3 (целевая модель) default = 560 tok/page.
- **Фактическое значение:** 500 стр × 560 = 280K image + 750K-1M text = **1.03M-1.28M**. Проблема context window **ещё серьёзнее**.
- **Источник:** https://ai.google.dev/gemini-api/docs/document-processing

### PA-003: [АУДИТ M-007] — Context Caching P1 для PDF не окупается для 2-call

- **Аудитный тег в отчёте:** [АУДИТ M-007]
- **Утверждение аудита:** "Context Caching для PDF — 10x экономия на повторных запросах"
- **Проблема:** Для 2-call PDF hybrid сценария (раздел 9.6) caching **не окупается**: хранение 280K tokens × $4.50/1M/hour = **$1.26/час** >> экономия $0.126 на втором call. Окупается только при **10+ calls к одному документу** в час.
- **Фактическое значение:** Break-even для PDF caching ≈ 10 requests/hour (не 4). Для single-book processing с 2-3 calls — нет экономии.
- **Источник:** Пересчёт на основе текущих цен

### PA-004: Break-even ~4 запроса — зависит от storage cost

- **Раздел:** 4.6
- **Утверждение отчёта:** "кэш окупается после ~4 запросов"
- **Проблема:** При storage $4.50/1M/hour для Flash: break-even ≈ **10 запросов** (не 4). Цифра ~4 верна только при storage $1.00 (Flash-Lite) или для промпта >4096 tokens.
- **Источник:** Пересчёт: storage 1024 tok × $4.50/1M = $0.0046/hr; savings/request = $0.45/1M × 1024 = $0.00046; BE = 0.0046/0.00046 ≈ 10

---

## Пропущенные возможности

### M-001: Embedding Batch API — inline + file-based

- **Описание:** Batch API теперь поддерживает embeddings. Два метода: inline (для <20MB) и file-based (для больших объёмов). Цена: $0.075/1M (50% скидка).
- **Применимость для fancai:** Средняя. При массовом embed 300+ entities — экономия на batch.
- **Источник:** https://developers.googleblog.com/en/gemini-batch-api-now-supports-embeddings-and-openai-compatibility/

### M-002: Code Execution (GA для Gemini 3 Flash)

- **Описание:** Gemini может генерировать и исполнять Python-код в sandbox (до 30 сек, NumPy/Pandas/Matplotlib). GA для 3 Flash.
- **Применимость для fancai:** Низкая. Потенциал для post-processing entity данных, но backend Python надёжнее.
- **Источник:** https://ai.google.dev/gemini-api/docs/code-execution

### M-003: URL Context (GA)

- **Описание:** Передача URL для анализа контента страницы. Поддерживает PDF, HTML, images, JSON, XML, CSV.
- **Применимость для fancai:** Низкая. fancai работает с EPUB, не с веб-контентом.
- **Источник:** https://ai.google.dev/gemini-api/docs/url-context

### M-004: Interactions API — Delete и Cancel endpoints

- **Описание:** Отчёт не упоминает: DELETE `/interactions/{id}` и POST `/interactions/{id}/cancel` существуют. List endpoint **не существует**.
- **Применимость для fancai:** Низкая (Interactions API = P3).
- **Источник:** https://ai.google.dev/api/interactions-api

### M-005: Multimodal output (text + image в одном ответе)

- **Описание:** Gemini 3 Flash может генерировать текст и изображения в одном API call. Потенциально: извлечь описание + сгенерировать иллюстрацию одним запросом.
- **Применимость для fancai:** Средняя. Упрощает pipeline, но текущая раздельная архитектура надёжнее.
- **Источник:** https://ai.google.dev/gemini-api/docs/image-generation

### M-006: NB2 — 4K разрешение и полные batch цены

- **Описание:** Пропущена цена NB2 4K standard ($0.151) и все batch цены кроме 1K. Полная таблица: batch 0.5K=$0.022, 1K=$0.034, 2K=$0.050, 4K=$0.076.
- **Применимость для fancai:** Средняя (для выбора оптимального разрешения).
- **Источник:** https://ai.google.dev/pricing

### M-007: Дополнительные deprecation даты

- **Описание:** Не упомянуты: `gemini-2.5-flash-image` shutdown **2 октября 2026**, все Gemini 2.0 shutdown **1 июня 2026**.
- **Применимость для fancai:** Низкая (fancai не использует 2.0 или 2.5 flash-image).
- **Источник:** https://ai.google.dev/gemini-api/docs/deprecations

### M-008: JSON mode vs JSON Schema — различие

- **Описание:** Два уровня: (1) JSON Mode (`response_mime_type="application/json"`) — гарантирует валидный JSON; (2) JSON Schema (`+ response_schema`) — гарантирует JSON + соответствие schema. Отчёт описывает второй вариант в разделе 6, но не объясняет различие.
- **Применимость для fancai:** Информационная. fancai использует JSON Schema (Pydantic) — корректно.
- **Источник:** https://ai.google.dev/gemini-api/docs/structured-output

### M-009: Grounding quota — per billing account, не per project

- **Описание:** 5000 free prompts/month привязаны к **billing account** (не project). Один prompt может вызвать несколько search queries, каждый тарифицируется отдельно.
- **Применимость для fancai:** Низкая (Grounding = P4).
- **Источник:** https://discuss.ai.google.dev/t/grounding-with-google-search-5-000-free-prompts-month-is-the-quota-scoped-per-project-or-per-billing-account/134866

### M-010: 3.1 Flash-Lite streaming + function calling bug

- **Описание:** Связанный баг в LiteLLM (Issue #22900): 3.1 Flash-Lite в streaming возвращает `finish_reason: "stop"` вместо `tool_calls`. Усугубляет проблему early response для structured output.
- **Применимость для fancai:** Средняя (подтверждает непригодность Flash-Lite для extraction).
- **Источник:** https://github.com/BerriAI/litellm/issues/22900

### M-011: Distillation / Fine-tuning — только Vertex AI

- **Описание:** Fine-tuning убран из публичного Gemini API, остался только в Vertex AI (enterprise tier, preview).
- **Применимость для fancai:** Низкая. Для объёмов fancai (10 books/month) Vertex AI не оправдан.
- **Источник:** https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning

---

## Оценка рекомендаций

### R-001: "Сценарий 4 оптимален" (+$0.47/+20%)

- **Оценка:** Частично верна
- **Обоснование:** При учёте OpenRouter 5.5% комиссии: фактический baseline = $2.49 (не $2.36). Сценарий 4 = $2.83. Реальная разница = **+$0.34 (+14%)**, не +20%. При 10 books/month = +$3.40/месяц. Рекомендация сама по себе обоснована, но требует пересчёта с учётом E-006 (0.5K vs 1K разрешение images).

### R-002: "PDF hybrid P1"

- **Оценка:** Под вопросом
- **Обоснование:** После коррекции E-001 (560 tok/page): context window проблема **усугубилась**. 500 стр = 280K image + 750K-1M text = 1.03M-1.28M — выходит за 1M даже при default resolution. Whole-book feasible только для книг **<250 стр** при default или **<500 стр** при LOW resolution. Рекомендация: сохранить P1, но уточнить scope: "P1 для книг <250 стр (default) / <500 стр (LOW resolution)". Для длинных книг — hybrid (discovery chunks + PDF pages).

### R-003: "Embeddings P1" ($0.007/книга)

- **Оценка:** Подтверждена, но обоснование ошибочно
- **Обоснование:** Экономия $0.007/книга = $0.07/месяц при 10 books. ROI на pgvector+интеграцию (~8 часов dev = $400) = **5714 месяцев**. P1 оправдан **качеством** (embedding ловит семантические связи, недоступные fuzzy), не экономикой. Рекомендация: убрать экономию из аргументации, обосновывать качеством dedup.

### R-004: "File Search P2"

- **Оценка:** Подтверждена
- **Обоснование:** $0.26/книга при 10 books = $2.60/месяц. Overlap с PDF discovery значительный. P2 — корректный приоритет.

### R-005: "Context Caching P1 для PDF"

- **Оценка:** Опровергнута для 2-call сценария
- **Обоснование:** Хранение 280K tokens × $4.50/1M/hour = **$1.26/час** значительно превышает экономию $0.126 на втором call. Окупается при 10+ calls. Для single-book 2-call processing — **нет экономии**. Корректно: P1 для multi-document workflows (10+ queries к одному набору), **P3 для 2-call PDF scenario**.

### R-006: "google-genai>=1.69.0"

- **Оценка:** Опровергнута
- **Обоснование:** Версия 1.69.0 не существует. Корректно: `>=1.68.0` (текущая стабильная на 31 марта 2026).

### R-007: Migration plan — реалистичность

- **Оценка:** Частично верна
- **Обоснование:** Фазы логичны, порядок корректен. Пропущенные зависимости:
  1. Фаза 2 (Batch): нужен job monitoring/retry, не описан
  2. Фаза 3 (PDF): Calibre в Docker image — deployment concern
  3. Hard deadline: 2.5 Flash deprecation 17 июня 2026 — затрагивает fallback chain
  4. Фаза 2+3 могут идти параллельно (оба зависят от Фазы 1)

### R-008: Hybrid OpenRouter + Direct

- **Оценка:** Подтверждена с оговоркой
- **Обоснование:** Архитектурная сложность реальна: два API client, два auth mechanism, routing logic. Для production-grade проекта выигрыш (Batch 50%, Caching 90%, Pydantic parsing) оправдывает сложность. Для стартапа с 10 books/month — marginal.

---

## Пересчитанные стоимости

### PDF Single-Call (исправленный, раздел 9.3)

| media_resolution | Image tokens (500 стр) | Input cost (3 Flash) | + Output 30K | Итого      | vs Chunk-based |
| ---------------- | ---------------------- | -------------------- | ------------ | ---------- | -------------- |
| LOW              | 140K                   | $0.070               | $0.090       | $0.160     | -84%           |
| **DEFAULT**      | **280K**               | **$0.140**           | **$0.090**   | **$0.230** | **-77%**       |
| HIGH             | 560K                   | $0.280               | $0.090       | $0.370     | -64%           |

**Context window feasibility (500 стр книга, ~750K text tokens):**

| Resolution | Image + Text        | vs 1M window  |
| ---------- | ------------------- | ------------- |
| LOW        | 140K + 750K = 890K  | Fits (barely) |
| DEFAULT    | 280K + 750K = 1.03M | **Exceeds**   |
| HIGH       | 560K + 750K = 1.31M | **Exceeds**   |

### Сценарии стоимости (раздел 14, пересчёт)

Базовые допущения сохранены: 1 книга = 50 глав, ~200 LLM вызовов, ~100 images.

| #   | Сценарий                     | LLM      | Images (0.5K) | Images (1K) | Итого (0.5K) | Итого (1K) |
| --- | ---------------------------- | -------- | ------------- | ----------- | ------------ | ---------- |
| 1   | OpenRouter 2.5 (текущий)     | $0.96    | $1.40         | $1.40       | $2.36        | $2.36      |
| 2   | Direct 3 Flash + FLUX        | $1.26    | $1.40         | $1.40       | $2.66        | $2.66      |
| 3   | Direct 3 Flash + NB2         | $1.26    | $4.50         | $6.70       | $5.76        | $7.96      |
| 4   | Batch 3 Flash + NB2 batch    | $0.63    | **$2.20**     | **$3.40**   | **$2.83**    | **$4.03**  |
| 5   | Batch + Cache + NB2          | $0.61    | $2.20         | $3.40       | $2.81        | $4.01      |
| 6   | Free LLM + FLUX              | $0.00    | $1.40         | $1.40       | $1.40        | $1.40      |
| —   | PDF hybrid + batch (LOW res) | ~$0.42\* | $2.20         | $3.40       | $2.62        | $3.82      |

\*PDF hybrid LLM пересчёт с LOW resolution: PDF discovery $0.160 + 150 batch calls ~$0.26 = $0.42 (при LOW; при DEFAULT — $0.49)

**Ключевое изменение:** Сценарии с NB2 1K стоят **на $1.20 больше**, чем указано в отчёте (который неявно использовал 0.5K). Нужно явно указывать разрешение.

---

## Подтверждённые данные (выборочно)

Из ~60 верифицированных значений **подтверждены корректными:**

- **Все 4 Model ID** (3.1 Pro, 3 Flash, 3.1 Flash-Lite, NB2)
- **38 из 38 цен за токены** (все модели, все tier'ы)
- **4 из 4 дат deprecation** (2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 3 Pro retired)
- **OpenRouter 5.5% комиссия** — подтверждена
- **Spend Caps с 1 апреля 2026** — подтверждено
- **Все параметры Batch API** (50% скидка, SLO 24h, max 100 concurrent, 2GB file, 48h expiry)
- **Все параметры Context Caching** (минимумы Flash/Pro, 90% скидка, что кэшируется, ограничения)
- **Batch + Caching: скидки НЕ складываются** — подтверждено дословной цитатой из docs
- **Structured Output API** (response.parsed, text/x.enum, anyOf, SafetySetting API, async API)
- **8 embedding task types** — полный список
- **pgvector 0.8.x + PostgreSQL 17** — совместимость подтверждена
- **Thought Signatures** (mandatory для FC, dummy values, SDK auto-handles)
- **Interactions API** (Beta, store=True default, breaking change Dec 19, 2025)
- **SynthID watermark** — обязателен, нельзя отключить
- **File Search specs** (formats, 100MB, storage tiers, TTL, indexing price, FC combo date)
- **Flash-Lite early response bug** — открыт, подтверждён

---

## Итоговые рекомендации аудитора

### Критические исправления (блокируют использование как эталона)

1. **Исправить tokens/page для Gemini 3:** Заменить 258 на таблицу по resolution (LOW=280, DEFAULT=560, HIGH=1120). Пересчитать все PDF-стоимости.

2. **Убрать Flash-Lite из extraction fallback chain:** Раздел 13.1 противоречит разделу 2.4. Extraction fallback: `3 Flash → OR 2.5 Flash → retry 3 Flash`.

3. **Исправить SDK версию:** `>=1.69.0` → `>=1.68.0`.

### Важные исправления

4. **Унифицировать NB2 batch:** Заполнить batch цены в таблице 1.1. Явно указать разрешение в сценариях раздела 14.

5. **Исправить Flash-Lite thinking_budget:** min = 512, не 0.

6. **Пересмотреть Context Caching P1 для PDF:** Не окупается для 2-call; P3 для PDF, P1 для multi-document.

7. **Обновить NB2 Elo:** 1280 → ~1258, #1 → #2.

### Рекомендации по качеству документа

8. **Указывать media_resolution во всех PDF расчётах** — стоимость различается в 4x между LOW и HIGH.

9. **Добавить секцию "Gemini 3 vs 2.5 различия"** — tokens/page, thinking defaults, safety defaults — ключевые различия при миграции, сейчас разбросаны по 5 разделам.

10. **Пометить RPM/TPM в Tier таблице как "неофициальные"** — Google не публикует эти данные.

---

## Общая оценка документа

**Качество: ВЫСОКОЕ с локальными ошибками.** Из ~60 числовых значений 38 цен за токены подтверждены точно (100%). Основные проблемы — в расчётных секциях (PDF tokens, cost scenarios) и одном противоречии (Flash-Lite extraction). Структура документа продуманная, аудитные теги из предыдущих проверок в целом корректны (3 ошибки из ~15 тегов = 80% accuracy предыдущих аудитов).

**Ценность мета-аудита:** Найдено **4 ошибки предыдущих аудитов** (PA-001 — PA-004), что подтверждает необходимость третьего уровня проверки для эталонного документа.

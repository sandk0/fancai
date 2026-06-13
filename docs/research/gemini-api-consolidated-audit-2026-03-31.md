# Аудит отчета `docs/research/gemini-api-consolidated.md`

**Дата аудита:** 2026-03-31  
**Аудируемый документ:** `docs/research/gemini-api-consolidated.md`  
**Цель:** проверить фактическую точность, актуальность на 31 марта 2026 года, полноту покрытия возможностей Gemini API и качество источниковой базы.

## Executive Summary

Итоговый вердикт: документ полезен как рабочая сводка, но в текущем виде **не может считаться эталонным**. Самые серьезные проблемы сосредоточены в блоках **pricing/caching/cost modeling**, в части **benchmark snapshots**, в разделе **Interactions API**, а также в самой **методике приоритизации источников**.

### Сводка находок

| Категория | Кол-во |
| --- | ---: |
| `critical` | 4 |
| `high` | 6 |
| `medium` | 8 |
| `low` | 1 |
| Пропущенные возможности | 7 |

### Главное

1. **Разделы 4, 5 и 14 нельзя считать надежными**, потому что в них использованы неверные или неуниверсальные допущения о стоимости context caching и batch+caching. Это тянет вниз итоговые cost tables и recommendation engine.
2. **Раздел 2.1 с Arena ELO устарел уже на самом срезе**: значения и места моделей на leaderboard не совпадают с публичным снимком `arena.ai` от 26 марта 2026 года.
3. **Раздел 12 содержит фактическую ошибку**: Interactions API не поддерживает Remote MCP для Gemini 3, хотя документ утверждает обратное.
4. **Методика документа ошибочна для volatile API-фактов**: приоритет `Аудиты > Исследования > Документация` методологически слабее, чем `Official docs/changelog/API reference > official SDK/docs > primary external sources`.

## Методика и границы аудита

Аудит выполнен в два слоя:

1. Прочитан и размечен исходный документ `docs/research/gemini-api-consolidated.md`.
2. Критичные и меняющиеся утверждения сверены по первичным источникам.

### Приоритет источников в этом аудите

1. Официальные страницы Gemini API: pricing, models, deprecations, rate limits, Gemini 3 guide, structured output, file search, document processing, files, embeddings, interactions, safety settings, changelog.
2. Официальные SDK-источники: PyPI `google-genai`.
3. Первичные внешние источники по benchmark/экосистеме: `arena.ai`, arXiv paper по Gemini Embedding, Box blog, OpenRouter docs/FAQ, Google AI Developers Forum.

### Важная граница

Для некоторых тезисов документ делает сильные выводы поверх наблюдений, форумов или локальных замеров. В таких случаях я разделяю:

- **подтвержденный факт**;
- **обоснованный inference**;
- **неподтвержденное или слабосвязанное обобщение**.

## Ключевые выводы

### Что в документе подтверждается

- shutdown `gemini-3-pro-preview` 9 марта 2026 и замена на `gemini-3.1-pro-preview`;
- deprecation dates для `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`;
- наличие `gemini-embedding-2-preview` и несовместимость embedding space с `gemini-embedding-001`;
- наличие File Search metadata filtering;
- PDF limits: 50 MB / 1000 pages / 258 tokens per page;
- извлечение native text из PDF без тарификации этих токенов;
- строгая обязательность thought signatures для Gemini 3 function calling и image generation.

### Что требует срочной правки

- цены и логика caching/batch;
- leaderboard snapshot;
- Remote MCP в Interactions API;
- трактовка OpenRouter fee;
- source mapping и воспроизводимость cost tables;
- часть сильных operational выводов по `3.1 Flash-Lite`.

## Находки по разделам

### F-001

- **Локация:** раздел 4.2, строки 203-211
- **Тип:** `ошибка`
- **Severity:** `critical`
- **Исходное утверждение:** для `3 Flash` storage price = `$4.50 / 1M tokens/hour`, для `3.1 Flash-Lite` storage price = `$1.00 / 1M tokens/hour` как универсальная ставка.
- **Вердикт:** это неверно как минимум для `gemini-3-flash-preview`, а для `gemini-3.1-flash-lite-preview` документ смешивает standard и batch pricing.
- **Исправленная формулировка:**  
  `gemini-3-flash-preview` имеет storage price `$1.00 / 1M tokens/hour` и в standard, и в batch.  
  `gemini-3.1-flash-lite-preview` имеет `$1.00 / 1M tokens/hour` в standard и `$0.50 / 1M tokens/hour` в batch.  
  `gemini-3.1-pro-preview` имеет `$4.50 / 1M tokens/hour`.
- **Почему важно для fancai:** на этих цифрах строятся break-even оценки, приоритет caching и суммарные cost tables.
- **Источники:** [Pricing: Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/pricing), [Pricing: Gemini 3.1 Flash-Lite Preview](https://ai.google.dev/gemini-api/docs/pricing), [Pricing: Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/pricing)
- **Confidence:** `high`

### F-002

- **Локация:** раздел 5.2, строки 255-266; раздел 14, строки 627-649
- **Тип:** `ошибка`
- **Severity:** `critical`
- **Исходное утверждение:** batch и caching не складываются; cached tokens всегда идут по “90% cached rate”, а не по batch rate.
- **Вердикт:** это неуниверсально и в текущей формулировке неверно.
- **Исправленная формулировка:** поведение **модель-специфично**.  
  Для `gemini-3.1-pro-preview` batch cached price совпадает со standard cached price (`$0.20/$0.40`), то есть batch discount для cached input не проявляется.  
  Для `gemini-3-flash-preview` batch cached price также совпадает со standard cached price (`$0.05`).  
  Для `gemini-3.1-flash-lite-preview` batch cached price ниже standard cached price (`$0.0125` vs `$0.025`), то есть batch discount для cached input фактически есть.
- **Почему важно для fancai:** это ломает универсальные формулы из разделов 5 и 14 и делает недостоверными расчеты сценариев `Batch + Cache`.
- **Источники:** [Pricing: Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/pricing), [Pricing: Gemini 3.1 Flash-Lite Preview](https://ai.google.dev/gemini-api/docs/pricing), [Pricing: Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/pricing)
- **Confidence:** `high`

### F-003

- **Локация:** раздел 14, строки 627-649
- **Тип:** `ошибка`
- **Severity:** `critical`
- **Исходное утверждение:** сводная cost table и recommendation “Сценарий 4 — лучшее quality/cost”.
- **Вердикт:** таблица в текущем виде не воспроизводима и опирается на неверные ценовые предпосылки.
- **Исправленная формулировка:** таблицу нужно пересобрать заново из официального pricing с явным раскрытием:
  - числа input/output tokens на один вызов;
  - доли cached vs non-cached input;
  - какие модели считаются standard vs batch;
  - где используется OpenRouter credits fee и почему;
  - какие изображения считаются 0.5K/1K/2K.
- **Почему важно для fancai:** в документе именно этот раздел переводит технические факты в бизнес-рекомендацию. Если входные ставки неверны, то и итоговая рекомендация ненадежна.
- **Источники:** [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenRouter Pricing](https://openrouter.ai/pricing), [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- **Confidence:** `high`

### F-004

- **Локация:** раздел 1.5, строка 79; раздел 14.1, строки 647-649
- **Тип:** `неточность`
- **Severity:** `high`
- **Исходное утверждение:** “реальная стоимость через OpenRouter на 5-5.5% выше указанных цен”.
- **Вердикт:** это слишком широкое утверждение.
- **Исправленная формулировка:** OpenRouter заявляет, что **не делает markup на inference pricing**; fee взимается **при покупке credits**. Для pay-as-you-go это 5.5% с минимумом `$0.80` для non-crypto платежей; для crypto 5.0%. Значит эффективный uplift зависит от схемы пополнения, минимального fee, taxes и использования credits, а не является автоматическим per-request markup.
- **Почему важно для fancai:** документ превращает billing-fee на уровне пополнения в будто бы стабильную прибавку к цене каждого сценария. Это искажает baseline.
- **Источники:** [OpenRouter Pricing](https://openrouter.ai/pricing), [OpenRouter FAQ](https://openrouter.ai/docs/faq), [Simplifying Our Platform Fee](https://openrouter.ai/announcements/simplifying-our-platform-fee)
- **Confidence:** `high`

### F-005

- **Локация:** раздел 2.1, строки 104-113
- **Тип:** `устарело`
- **Severity:** `high`
- **Исходное утверждение:** `Gemini 3.1 Pro` = `#2 / 1500`, `Gemini 3 Flash` = `#8 / ~1473`, `Gemini 3.1 Flash-Lite` = `~1432`.
- **Вердикт:** snapshot уже не соответствует публичному leaderboard.
- **Исправленная формулировка:** на публичной странице `arena.ai` с датой **Mar 26, 2026** значения следующие:
  - `claude-opus-4-6-thinking` = `1504±6`
  - `claude-opus-4-6` = `1500±6`
  - `gemini-3.1-pro-preview` = `1493±6` и rank `3`
  - `gemini-3-flash` = `1474±4` и rank `9`
  - `gemini-3.1-flash-lite-preview` = `1438±6` и rank `40`
- **Почему важно для fancai:** документ использует leaderboard как аргумент для model strategy. Для volatile leaderboard нужен датированный snapshot, иначе выводы быстро портятся.
- **Источники:** [Arena Text Leaderboard](https://arena.ai/leaderboard/text)
- **Confidence:** `high`

### F-006

- **Локация:** раздел 1.6-1.7, строки 81-98
- **Тип:** `слабый источник`
- **Severity:** `medium`
- **Исходное утверждение:** статические free-tier значения RPM/TPM/RPD и диапазоны RPM по tier.
- **Вердикт:** в официальной docs эти конкретные значения в таком виде не подтверждаются.
- **Исправленная формулировка:** rate limits зависят от модели и usage tier; официальная docs говорит смотреть **active rate limits in AI Studio**. В docs явно подтверждены только dimensions (`RPM`, `TPM`, `RPD`), привязка к project и qualification thresholds для usage tiers.
- **Почему важно для fancai:** если строить throughput planning на неподтвержденных лимитах, можно получить неверный capacity plan.
- **Источники:** [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- **Confidence:** `high`

### F-007

- **Локация:** раздел 12.1, строки 575-585
- **Тип:** `ошибка`
- **Severity:** `critical`
- **Исходное утверждение:** Interactions API поддерживает function calling “включая Remote MCP”.
- **Вердикт:** для Gemini 3 это неверно.
- **Исправленная формулировка:** official docs по Interactions API прямо говорят, что **Remote MCP does not work with Gemini 3 models; this is coming soon**.
- **Почему важно для fancai:** это влияет на архитектурные решения, если команда решит использовать Interactions для tool orchestration.
- **Источники:** [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- **Confidence:** `high`

### F-008

- **Локация:** раздел 9.1, строки 436-444
- **Тип:** `неточность`
- **Severity:** `high`
- **Исходное утверждение:** `media_resolution = LOW / MEDIUM / HIGH / ULTRA_HIGH (per-document)`.
- **Вердикт:** формулировка не совпадает с official docs.
- **Исправленная формулировка:** для document understanding Gemini 3 docs говорят о `media_resolution` на уровне **individual media part**, а в PDF-контексте документирован набор `low / medium / high`. Формулировка про `ULTRA_HIGH` и “per-document” в этом разделе не подтверждена official doc page.
- **Почему важно для fancai:** это напрямую касается PDF A/B test plan и токен-бюджета.
- **Источники:** [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing), [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- **Confidence:** `high`

### F-009

- **Локация:** раздел 8.1, строки 362-375
- **Тип:** `неточность`
- **Severity:** `medium`
- **Исходное утверждение:** structured output с File Search отмечен только для `Gemini 3 Flash` и `3.1 Pro`.
- **Вердикт:** coverage неполное.
- **Исправленная формулировка:** official File Search docs говорят, что **starting with Gemini 3 models** file search можно комбинировать со structured outputs. В supported models для File Search присутствует и `Gemini 3.1 Flash-Lite Preview`.
- **Почему важно для fancai:** это расширяет design space для дешевых verification pipelines и budget fallback.
- **Источники:** [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- **Confidence:** `high`

### F-010

- **Локация:** раздел 8 в целом
- **Тип:** `пропущенная возможность`
- **Severity:** `high`
- **Исходное утверждение:** раздел File Search описывает retrieval, filtering и structured output, но не фиксирует citations/grounding metadata как отдельную возможность.
- **Вердикт:** это важный пропуск.
- **Исправленная формулировка:** response с File Search может включать **citations** и `grounding_metadata`, указывающие, какие фрагменты документа использованы. Для fancai это особенно полезно в entity verification, spoiler-safe QA и пост-аудите extraction.
- **Почему важно для fancai:** это дает explainability и traceability, а не только retrieval.
- **Источники:** [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- **Confidence:** `high`

### F-011

- **Локация:** преамбула документа, строки 1-18
- **Тип:** `ошибка`
- **Severity:** `high`
- **Исходное утверждение:** “Приоритет источников: Аудиты > Исследования > Документация”.
- **Вердикт:** для API-фактов это методологически неверно.
- **Исправленная формулировка:** для volatile данных корректный порядок должен быть:
  1. official docs / changelog / API reference / pricing / deprecations;
  2. official SDK docs / releases;
  3. первичные внешние источники;
  4. внутренние исследования и аудиты как secondary synthesis.
- **Почему важно для fancai:** текущий порядок повышает риск закрепления уже устаревшего вывода из вчерашнего “аудита” над сегодняшней официальной документацией.
- **Источники:** [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [Models](https://ai.google.dev/gemini-api/docs/models), [Release notes](https://ai.google.dev/gemini-api/docs/changelog), [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- **Confidence:** `high`

### F-012

- **Локация:** раздел 16.1, строки 696-702
- **Тип:** `слабый источник`
- **Severity:** `medium`
- **Исходное утверждение:** “Текущая версия: ~1.67-1.69”, “Bug #2024”, “Issue #1972”, “PR #1973”.
- **Вердикт:** текущая версия SDK подтверждается, а bug/issue claims в документе недостаточно трассируемы.
- **Исправленная формулировка:** на 31 марта 2026 официальный PyPI показывает **`google-genai 1.69.0`, released Mar 28, 2026**. Но конкретные bug/issue тезисы в документе должны сопровождаться **прямыми ссылками на issue/PR**, иначе это слишком volatile и плохо верифицируемо.
- **Почему важно для fancai:** инженерные решения по SDK workarounds нельзя держать на анонимных номерах issue без ссылки и статуса.
- **Источники:** [PyPI google-genai](https://pypi.org/project/google-genai/)
- **Confidence:** `high`

### F-013

- **Локация:** раздел 6.1, строки 287-296
- **Тип:** `слабый источник`
- **Severity:** `medium`
- **Исходное утверждение:** `anyOf` поддерживается “с ноября 2025”, `default=` починен в SDK `v1.69.0`.
- **Вердикт:** состояние “сейчас поддерживается” частично подтверждается, но привязка к датам и issue-status в документе недостаточно доказана.
- **Исправленная формулировка:** официальные SDK docs/PyPI уже содержат пример JSON schema с `anyOf`, значит на дату аудита это действительно поддерживается. Но датировка “с ноября 2025” и claim про закрытый `Issue #699` без прямой ссылки на release note/issue не должны подаваться как установленный факт.
- **Почему важно для fancai:** это не ломает архитектуру, но ухудшает надежность документа как “эталонного”.
- **Источники:** [PyPI google-genai](https://pypi.org/project/google-genai/), [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- **Confidence:** `high`

### F-014

- **Локация:** раздел 6.2 и 16.2, строки 320 и 704-707
- **Тип:** `не подтверждено`
- **Severity:** `medium`
- **Исходное утверждение:** “Использовать `BLOCK_NONE` вместо `OFF` — сохраняет safety ratings для мониторинга”.
- **Вердикт:** официальная safety docs объясняет thresholds и default `OFF`, но в проверенных источниках нет прямой рекомендации именно такого вида.
- **Исправленная формулировка:** оставлять это можно только как **локальную инженерную гипотезу/практику**, а не как подтвержденный vendor-recommendation. Если команда хочет это сохранить, нужна ссылка на официальный source, SDK issue или собственный reproducible experiment.
- **Почему важно для fancai:** это влияет на policy posture и трактовку blocked/allowed content.
- **Источники:** [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- **Confidence:** `medium`

### F-015

- **Локация:** раздел 2.4, строки 135-143; раздел 13, строки 605-608
- **Тип:** `неточность`
- **Severity:** `high`
- **Исходное утверждение:** `Gemini 3.1 Flash-Lite` “НЕПРИГОДНА для extraction задач fancai”.
- **Вердикт:** это слишком сильное обобщение для текущей доказательной базы.
- **Исправленная формулировка:** подтвержден operational risk на части document extraction workloads, включая forum report про premature stop/unfinished extraction и внутренние наблюдения. Но формулировка должна быть: **“имеет подтвержденный риск деградации на некоторых extraction-сценариях; не использовать как default extraction model без локального A/B и guardrails”**.
- **Почему важно для fancai:** абсолютный ban искажет strategy, если проблема окажется workload-specific и компенсируемой prompt/config changes.
- **Источники:** [Google AI Developers Forum thread](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602), [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- **Confidence:** `medium`

### F-016

- **Локация:** раздел 7.1, строки 328-338
- **Тип:** `устарело`
- **Severity:** `medium`
- **Исходное утверждение:** NB2 “#1 на Arena.ai”.
- **Вердикт:** тезис слишком хрупкий без pinned snapshot и в текущем виде не должен подаваться как устойчивый факт.
- **Исправленная формулировка:** лучше писать, что `Gemini 3.1 Flash Image Preview` позиционируется Google как high-efficiency native image model для speed/high-volume use cases. Любой claim “#1” должен иметь явную snapshot-date и ссылку на конкретный leaderboard.
- **Почему важно для fancai:** иначе документ смешивает capability facts с меняющимся маркетингово-рейтинговым состоянием.
- **Источники:** [Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- **Confidence:** `high`

### F-017

- **Локация:** раздел 17, строка 724
- **Тип:** `не подтверждено`
- **Severity:** `low`
- **Исходное утверждение:** “Spend Caps (с 1 апреля 2026)”.
- **Вердикт:** в проверенных official sources на момент аудита это не подтверждено.
- **Исправленная формулировка:** либо убрать, либо снабдить прямой ссылкой на billing/changelog/release note. Сейчас это выглядит как неподтвержденный roadmap-тезис.
- **Почему важно для fancai:** не стоит планировать финансовые controls на основании несвязанного или непойманного слуха.
- **Источники:** [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Release notes](https://ai.google.dev/gemini-api/docs/changelog)
- **Confidence:** `medium`

### F-018

- **Локация:** раздел 9.2, строки 446-448
- **Тип:** `не подтверждено`
- **Severity:** `medium`
- **Исходное утверждение:** embedded text в 500-страничной книге даст `~700K-1M` tokens, и total станет `829K-1.1M`.
- **Вердикт:** это правдоподобный inference, но не подтвержденный official numeric fact.
- **Исправленная формулировка:** можно оставить как **оценочное предупреждение**, но нужно явно пометить его как inference и не использовать как уже установленную техническую границу без `countTokens()`/real sample tests.
- **Почему важно для fancai:** это влияет на решение делать whole-book PDF strategy.
- **Источники:** [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing), [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- **Confidence:** `medium`

### F-019

- **Локация:** раздел 6.1, строки 287-295
- **Тип:** `неточность`
- **Severity:** `medium`
- **Исходное утверждение:** таблица противопоставляет OpenRouter и Direct так, будто у OpenRouter “Enum = Нет”, “Constraints = Нет”, а у Direct ключевая фича — `text/x.enum`.
- **Вердикт:** таблица смешивает API transport, SDK conveniences и schema capabilities в один слой.
- **Исправленная формулировка:** корректнее разделить:
  - **Gemini API capabilities:** JSON schema, constraints, `anyOf`, structured outputs;
  - **SDK conveniences:** Pydantic types, schema conversion, helper methods;
  - **Router-layer limitations:** что именно OpenRouter passthrough ломает или не экспонирует.
- **Почему важно для fancai:** иначе сравнение становится технологически нечистым и может увести архитектурный выбор не туда.
- **Источники:** [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [PyPI google-genai](https://pypi.org/project/google-genai/)
- **Confidence:** `medium`

## Пропущенные возможности Gemini API

### M-001. File Search citations / grounding metadata

Документ хорошо покрывает retrieval и metadata filtering, но пропускает **citations** и `grounding_metadata`. Для fancai это ценно как explainability layer для entity consistency check и ручной верификации extraction.

Источник: [File Search](https://ai.google.dev/gemini-api/docs/file-search)

### M-002. Persistence model у File Search stores

В документе есть тезис про “TTL бессрочно”, но не выделена архитектурно важная разница:

- raw `File` object удаляется через 48 часов;
- импортированные данные в File Search store хранятся бессрочно до ручного удаления;
- есть рекомендация держать store < 20 GB для лучшей latency;
- backend store size обычно ~3x input size.

Это важно для планирования corpus lifecycle.

Источник: [File Search](https://ai.google.dev/gemini-api/docs/file-search)

### M-003. Interactions retention и `store=false`

В документе есть `store=True по умолчанию`, но не вынесены retention windows и privacy control:

- Paid tier: хранение interaction objects 55 дней;
- Free tier: 1 день;
- `store=false` отключает storage, но несовместим с `background=true` и `previous_interaction_id`.

Это полезно, если fancai будет обрабатывать чувствительные пользовательские тексты.

Источник: [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)

### M-004. Nano Banana Pro / Imagen 4 как отдельная quality tier

Документ рассматривает NB2 и FLUX fallback, но почти не рассматривает:

- `gemini-3-pro-image-preview` как higher-quality native option;
- `Imagen 4` как специализированную альтернативу через Gemini API.

Для иллюстраций и character-critical assets это может быть важнее, чем только NB2 vs FLUX.

Источник: [Image generation](https://ai.google.dev/gemini-api/docs/image-generation)

### M-005. PDF/media resolution tuning как отдельный рычаг стоимости и качества

В документе PDF strategy обсуждается, но не выделен как самостоятельный backlog-item рычаг:

- `media_resolution` можно тюнить;
- Google отдельно рекомендует `medium` для PDFs в Gemini 3 guide как практический default;
- это может сильнее влиять на cost/quality, чем отдельные prompt tweaks.

Источники: [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3), [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)

### M-006. Multimodal embedding limits и новые сценарии

Документ правильно отмечает `gemini-embedding-2-preview`, но не фиксирует practical caps:

- до 6 images;
- audio до 80 секунд;
- video до 120 секунд;
- PDF до 6 страниц.

Это полезно для будущих use cases fancai: dedup cover art, cross-modal retrieval, audio/book assets.

Источник: [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)

## Проблемы источниковой базы документа

### 1. Нет claim-to-source mapping

В документе есть master-list источников, но почти нет прямой связи “вот этот тезис опирается на вот эту страницу и вот этот snapshot”.

### 2. Слишком много volatile-тезисов без pinned snapshot

Особенно это касается:

- `arena.ai`;
- image leaderboard claims;
- OpenRouter fee mechanics;
- SDK issue numbers;
- forum-discovered bugs.

### 3. Сильные operational выводы подаются как факты

Примеры:

- “Flash-Lite непригодна”;
- “лучший scenario 4”;
- “BLOCK_NONE вместо OFF”.

Для таких тезисов нужно явно помечать уровень уверенности и тип доказательства.

### 4. Не хватает прямых ссылок на issue/PR

Если документ оперирует `Bug #2024`, `Issue #1972`, `PR #1973`, то ссылки обязательны. Иначе эти утверждения плохо проверяемы и быстро протухают.

## Приоритетный список исправлений

1. **Полностью пересобрать разделы 4, 5 и 14** по официальному pricing, отдельно для standard/batch/cached и отдельно по моделям.
2. **Переписать раздел 2.1** как snapshot с точной датой leaderboard и без “вечных” rank claims.
3. **Исправить раздел 12.1**: убрать Remote MCP как поддерживаемый для Gemini 3.
4. **Исправить раздел 9.1**: переформулировать `media_resolution`.
5. **Ослабить раздел 2.4**: заменить абсолютное “непригодна” на риск-ориентированную формулировку.
6. **Добавить в раздел 8** citations/grounding metadata.
7. **Переписать source policy** в шапке документа.
8. **Или подтвердить, или удалить** Spend Caps и непойманные SDK bug-claims.

## Неоднозначности и открытые вопросы

1. Полная арифметика cost table не воспроизводится из текущего текста: не хватает явных token assumptions по каждому сценарию.
2. Для некоторых SDK claims (`response.parsed`, `default=` fix, tokenizer issues) нужна более точная связка “claim -> release note / issue / code sample”.
3. Часть forum-derived operational проблем реальна, но требует distinction между “vendor-known limitation” и “локальный workload-specific failure mode”.

## Источники

### Official Google

- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Context caching](https://ai.google.dev/gemini-api/docs/caching)
- [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- [Files API](https://ai.google.dev/gemini-api/docs/files)
- [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings)
- [Release notes](https://ai.google.dev/gemini-api/docs/changelog)

### Official SDK

- [PyPI: google-genai 1.69.0](https://pypi.org/project/google-genai/)

### Primary external sources

- [Arena.ai Text Leaderboard](https://arena.ai/leaderboard/text)
- [Gemini Embedding paper](https://arxiv.org/html/2503.07891v1)
- [Box Blog: Gemini 3 Flash extraction benchmark](https://blog.box.com/gemini-3-flash-sets-new-standard-accuracy-unstructured-data-extraction)
- [Google AI Developers Forum: Flash-Lite early response thread](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [OpenRouter fee announcement](https://openrouter.ai/announcements/simplifying-our-platform-fee)

# Объединенный арбитражный аудит `gemini-api-consolidated.md`

**Дата:** 2026-03-31  
**Целевой документ:** `docs/research/gemini-api-consolidated.md`  
**Сопоставляемые аудиты:**  
- `docs/research/gemini-api-consolidated-audit-2026-03-31.md`  
- `docs/research/gemini-consolidated-audit.md`

## Executive Summary

Этот отчет не просто объединяет два предыдущих аудита, а **разрешает конфликты между ними** по первичным источникам. Итог:

1. **Оба аудита правильно нашли, что документ нельзя считать эталонным без правок**.
2. **Claude нашел несколько важных ошибок, которые мой аудит пропустил**: прежде всего по Gemini 3 PDF token budgeting, по разрешениям NB2 в batch-сценариях, по прогрессивной цене FLUX.2 Klein и по нюансам thought signatures в image generation.
3. **Мой аудит правильно поймал несколько ошибок, которые Claude либо пропустил, либо исказил**: реальная версия `google-genai` = `1.69.0`, storage cost для `gemini-3-flash-preview` = `$1.00`, а не `$4.50`, Flash Image reference split = `10 objects + 4 characters`, а не `5 characters`, OpenRouter fee нельзя превращать в универсальный per-request markup.
4. **В обоих аудитах были собственные ошибки**, поэтому исходный отчет нужно править уже по этому арбитражному документу, а не по одному из двух аудитов по отдельности.

## Метод арбитража

Для каждого спорного тезиса я сделал одно из трех:

1. `accepted` — принимается как корректный;
2. `rejected` — отклоняется как неверный;
3. `reframed` — ядро замечания верное, но формулировка/числа в одном или обоих аудитах должны быть переписаны.

Приоритет источников в арбитраже:

1. official docs / pricing / changelog / API reference;
2. official SDK docs / PyPI;
3. первичные внешние источники (`arena.ai`, OpenRouter docs, forum thread, issue tracker);
4. только после этого — локальные аудиты.

## Ключевые совпадения двух аудитов

Следующие выводы подтверждаются объединенно и должны попасть в исправленную версию исходного отчета:

1. **Разделы 4, 5 и 14 нужно пересобирать**: текущая логика `caching + batch + итоговые cost scenarios` ненадежна.
2. **Arena/leaderboard claims устаревают слишком быстро** и должны быть snapshot-based с точной датой.
3. **Remote MCP нельзя описывать как рабочий с Gemini 3 в Interactions API**.
4. **В документе не хватает claim-to-source mapping**.
5. **Раздел про `3.1 Flash-Lite` конфликтует сам с собой**: модель одновременно объявляется “непригодной” и ставится в extraction fallback.
6. **NB2 ranking в документе устарел** и должен быть переформулирован без вечного claim “#1”.

## Арбитраж по спорным пунктам

| ID | Пункт | Codex | Claude | Арбитраж | Основание |
| --- | --- | --- | --- | --- | --- |
| A-001 | `google-genai>=1.69.0` существует? | `1.69.0 exists` | `1.69.0 does not exist` | `Codex accepted` | PyPI показывает `google-genai 1.69.0`, released Mar 28, 2026 |
| A-002 | PDF tokens/page для Gemini 3 | использован старый `258` | `560 default / 280 low / 1120 high` | `Claude accepted` | guide `media-resolution` для Gemini 3 PDF |
| A-003 | `3 Flash` caching storage | `$1.00` | `$4.50` сомнительно / расчеты от `$4.50` | `Codex accepted` | pricing page дает `$1.00 / 1M tokens/hour` |
| A-004 | Spend Caps подтверждены? | `не подтверждено` | `подтверждено` | `Claude accepted` | changelog 2026-03-16 и 2026-03-12 |
| A-005 | `2.5 Flash-Lite thinking_budget` | `0-24576` | `512-24576, 0 нельзя` | `reframed` | docs: range `512-24576`, но `thinkingBudget=0` разрешен как special disable value |
| A-006 | Flash Image reference split | `10 objects + 4 characters` | `5 characters` | `Codex accepted` | image guide: Flash Image = `10 objects + 4 characters`, Pro Image = `6 objects + 5 characters` |
| A-007 | OpenRouter fee = универсальный +5.5% markup? | `слишком широкое утверждение` | фактически использует uplift в economics | `Codex accepted` | OpenRouter says no inference markup; fee on credit purchase |
| A-008 | NB2 batch resolution в сценариях 4-5 | отмечено как общий cost issue | явно поймал `0.5K vs 1K` | `Claude accepted` | pricing page: batch `0.022/0.034/0.050/0.076` |
| A-009 | `Remote MCP` с Gemini 3 | неверно | неверно | `both accepted` | interactions docs |
| A-010 | `Context caching` break-even для 3 Flash | `~4` | `~10` | `reframed` | при `$1.00` storage и `$0.45/1M` savings break-even ≈ `2.22` повторных reuse/час |
| A-011 | Thought signatures для image generation | “обязательно” | не strict как function calling | `Claude accepted with nuance` | image-generation docs говорят “failure may cause response to fail”; strict 400 явно задокументирован для function calling |
| A-012 | `3 Flash` default thinking | не проблематизировалось | claimed docs conflict | `rejected for Claude` | current thinking docs explicitly say default dynamic `high` |

## Принятые находки Claude, которых не хватало в моем аудите

### 1. Gemini 3 PDF budgeting должен опираться на `media_resolution`, а не на старые 258 tok/page

Это самый важный пропуск моего аудита. Для Gemini 3 page budget определяется так:

- `UNSPECIFIED` = `560` tokens / PDF page
- `LOW` = `280 + Native Text`
- `MEDIUM` = `560 + Native Text`
- `HIGH` = `1120 + Native Text`
- `ULTRA_HIGH` = `N/A` для PDF

Что это меняет:

1. 500-страничная книга на default/unspecified дает **280K image tokens**, а не `129K`.
2. PDF single-call cost, context-window feasibility и раздел 14 нужно пересчитать.
3. В исходном отчете недостаточно просто заменить “258” на “560”: нужно **вынести `media_resolution` в явный параметр всех PDF-расчетов**.

Источники: [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution), [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)

### 2. В сценариях 4-5 не указано, какое разрешение у NB2

Claude прав: цифра `$2.20` для `100 images` соответствует **batch 0.5K**, а не batch `1K`.

- batch `0.5K` = `$0.022/img`
- batch `1K` = `$0.034/img`
- batch `2K` = `$0.050/img`
- batch `4K` = `$0.076/img`

Следствие: раздел 14 нужно переписать так, чтобы каждый сценарий явно указывал `0.5K / 1K / 2K / 4K`.

Источник: [Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### 3. FLUX.2 Klein нужно описывать как прогрессивную цену, а не просто `$0.014/img`

Мой аудит это упустил. `0.014` корректно только для первого мегапикселя/1MP. Для более высоких разрешений цена растет.

Это не ломает baseline на `1K`, но делает раздел 1.4 слишком грубым и потенциально неверным для больших изображений.

Источник: [FLUX.2 Klein 4B](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)

### 4. Thought signatures для image generation описаны слишком грубо

В исходном документе table в разделе 11.1 подает image generation как универсально “ОБЯЗАТЕЛЬНО”. Более точная формулировка:

- SDK handling автоматический;
- для multi-turn image workflows signatures действительно нужно циркулировать;
- documented hard failure `400` явно описан для function calling, а не как универсальная single-turn image rule.

Источник: [Image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)

### 5. `2.5 Flash-Lite` budget нужно переписать аккуратнее

Оба аудита в чистом виде неточны. Правильная формулировка:

- обычный numeric range: `512-24576`
- special value: `0` для disable
- special value: `-1` для dynamic thinking

Поэтому запись `0-24576` упрощает слишком сильно, а запись “0 нельзя” неверна.

Источник: [Thinking](https://ai.google.dev/gemini-api/docs/thinking)

### 6. File Search metadata пример вероятно должен быть числовым

Claude обратил внимание на то, что пример `chapter <= "10"` выглядит строковым, хотя для numeric comparisons логичнее использовать numeric metadata и фильтр без кавычек. Это замечание выглядит технически правдоподобным и должно быть проверено/исправлено при переписывании API-примера.

Статус в арбитраже: `accepted with caution` — замечание полезное, но в исходном документе это скорее **пример-код smell**, а не одна из главных архитектурных проблем.

Источник: [File Search API reference](https://ai.google.dev/api/file-search)

## Принятые находки Codex, которых не хватало или которые Claude исказил

### 1. `google-genai 1.69.0` существует

Claude здесь ошибся. На PyPI виден `google-genai 1.69.0`, released `Mar 28, 2026`.

Следствие:

- ошибочен тезис Claude “версия не существует”;
- но **остается справедливым** более слабое замечание: исходный документ должен подкреплять SDK bug/version claims прямыми ссылками на release notes/issues.

Источник: [PyPI google-genai](https://pypi.org/project/google-genai/)

### 2. `3 Flash` context caching storage = `$1.00`, а не `$4.50`

Это критично, потому что Claude на этой ошибке построил неверные пересчеты `break-even` и вывод “PDF caching окупается только при 10+ calls”.

Фактически pricing page дает:

- `gemini-3-flash-preview` standard storage = `$1.00 / 1M tokens/hour`
- `gemini-3-flash-preview` batch cached price = `same as standard`, batch pricing for caching not yet implemented

Значит Claude-выводы про `$4.50` для 3 Flash надо отвергнуть.

Источник: [Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### 3. Break-even для 3 Flash caching ближе к `~2.22 repeated reuses/hour`, а не к `~4` и тем более не к `~10`

Здесь неправы **оба** предыдущих аудита. При `gemini-3-flash-preview`:

- storage cost = `$1.00 / 1M tokens/hour`
- savings per repeated cached request = `0.50 - 0.05 = $0.45 / 1M tokens`

Следовательно:

`break_even = 1.00 / 0.45 ≈ 2.22`

Так как и storage, и savings масштабируются линейно по числу tokens, ratio не зависит от размера prompt. Практически это означает:

- кэш начинает выглядеть разумно уже примерно с **3 повторных reuse в течение часа**;
- тезис “~4” из моего аудита был завышен;
- тезис “~10” из Claude-аудита возник из неверной storage ставки `$4.50`.

Источник: [Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### 4. OpenRouter fee нельзя механически умножать на итоговую стоимость сценария

Claude продолжает использовать uplift в экономических оценках так, будто это стабильная надбавка к model pricing. Это слабее, чем позиция моего аудита.

Корректнее писать:

- inference pricing itself не marked up;
- platform fee относится к purchase of credits;
- эффективный uplift зависит от режима оплаты и использования credits.

Источник: [OpenRouter Pricing](https://openrouter.ai/pricing), [OpenRouter FAQ](https://openrouter.ai/docs/faq), [Simplifying Our Platform Fee](https://openrouter.ai/announcements/simplifying-our-platform-fee)

### 5. Flash Image reference split в исходном документе был верным

Claude здесь спутал `Gemini 3.1 Flash Image Preview` и `Gemini 3 Pro Image Preview`.

Правильно:

- Flash Image: `up to 10 objects` + `up to 4 characters`
- Pro Image: `up to 6 objects` + `up to 5 characters`

Следовательно, исходный документ в разделе 7.1 на этом конкретном пункте был прав.

Источник: [Image generation](https://ai.google.dev/gemini-api/docs/image-generation)

### 6. Пропущенная возможность: File Search citations / grounding metadata

Этого у Claude нет, но замечание остается сильным. Для fancai это один из самых практичных omissions, потому что дает:

- explainability;
- traceability;
- поддержку “покажи, из каких фрагментов книги взят этот вывод”.

Источник: [File Search](https://ai.google.dev/gemini-api/docs/file-search)

### 7. Пропущенная проблема: source policy в шапке исходного документа методологически неверна

Claude хорошо ловит фактические ошибки, но почти не трогает главную методическую проблему: в шапке документа текущий priority order задан как:

`Аудиты > Исследования > Документация`

Для volatile API это нужно заменить на:

`Official docs/changelog/API reference > official SDK/docs > primary external sources > internal research/audits`

Иначе документ будет системно стареть даже после исправления частных фактов.

Источники: [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [Models](https://ai.google.dev/gemini-api/docs/models), [Release notes](https://ai.google.dev/gemini-api/docs/changelog), [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

## Находки, которые нужно отклонить или переписать

### RJ-001. Отклонить Claude `E-003`

Тезис “`google-genai>=1.69.0` — версия не существует” неверен. PyPI показывает `1.69.0`.

### RJ-002. Отклонить Claude `I-003`

Тезис “NB2 reference images = 5 characters” неверен для `gemini-3.1-flash-image-preview`. Это верно для `gemini-3-pro-image-preview`.

### RJ-003. Отклонить Claude `I-010`, `PA-003`, `PA-004`

Эти выводы построены на неверной предпосылке `$4.50` storage for `3 Flash`, чего не подтверждает pricing page.

### RJ-004. Отклонить мой `F-017`

Тезис “Spend Caps не подтверждены” неверен. Release notes подтверждают и `billing account spend caps`, и `project-level spend caps`.

### RJ-005. Отклонить мою старую трактовку PDF `258 tok/page` для Gemini 3 budgeting

После сопоставления `document-processing` и `media-resolution` guide нужно считать, что для Gemini 3 budget planning приоритетнее **новая таблица media resolution**, а generic `258 tokens/page` уже не годится как basis для pricing.

## Итоговый объединенный список исправлений для исходного отчета

### Критические

1. Переписать **раздел 9** и все PDF-расчеты через `media_resolution`:
   - `LOW = 280`
   - `UNSPECIFIED/MEDIUM = 560`
   - `HIGH = 1120`
   - `ULTRA_HIGH = N/A for PDF`
2. Пересобрать **разделы 4, 5 и 14**:
   - корректные storage prices;
   - model-specific batch cached prices;
   - явное указание image resolution;
   - убрать ложную универсальность формул.
3. Исправить **Interactions API**: убрать Remote MCP как поддерживаемый для Gemini 3.
4. Переписать **раздел 13.1 fallback chain**: не ставить `3.1 Flash-Lite` в extraction fallback без очень явной оговорки о рисках.

### Важные

5. Исправить `2.5 Flash-Lite thinking_budget` на “`512-24576`, плюс special values `0` и `-1`”.
6. Переписать раздел 11 по thought signatures:
   - strict 400 clearly documented for function calling;
   - для image generation — аккуратная формулировка про multi-turn circulation и auto-handling SDK.
7. Переписать раздел 1.4 и 14 по image economics:
   - FLUX progressive pricing;
   - NB2 batch prices по всем resolution tiers.
8. Заменить в шапке приоритет источников на official-first policy.

### Желательные

9. Добавить File Search citations / grounding metadata.
10. Добавить distinction между JSON mode и JSON Schema.
11. Добавить storage/retention nuances для File Search stores и Interactions.
12. Добавить pinned snapshot dates к leaderboard-данным.

## Финальный вердикт

После арбитража итоговая картина такая:

- **Claude сильнее в точечных числовых исправлениях**, особенно там, где нужна внимательная табличная сверка и пересчет.
- **Codex сильнее в методологии источников, архитектурных последствиях и в развязке pricing-layer vs router-layer vs SDK-layer**.
- **Лучший итог получается только из объединения двух аудитов с повторной проверкой спорных мест по первичным источникам**.

Если править `gemini-api-consolidated.md`, опираться нужно именно на этот merged-аудит, а не на один из двух предыдущих отчетов по отдельности.

## Источники арбитража

- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Models](https://ai.google.dev/gemini-api/docs/models)
- [Release notes](https://ai.google.dev/gemini-api/docs/changelog)
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking)
- [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing)
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [File Search](https://ai.google.dev/gemini-api/docs/file-search)
- [File Search API reference](https://ai.google.dev/api/file-search)
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions)
- [Image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [PyPI: google-genai](https://pypi.org/project/google-genai/)
- [Arena.ai text leaderboard](https://arena.ai/leaderboard/text)
- [Arena.ai text-to-image leaderboard](https://arena.ai/leaderboard/text-to-image)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [OpenRouter fee announcement](https://openrouter.ai/announcements/simplifying-our-platform-fee)
- [FLUX.2 Klein 4B](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- [Google AI Developers Forum thread on Flash-Lite early response](https://discuss.ai.google.dev/t/gemini-3-1-flash-lite-comes-back-with-early-response-without-completing-the-task/128602)

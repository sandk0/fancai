# Аудит отчёта `parallel-batch-audit-final.md`

> Дата аудита: 27 марта 2026  
> Аудируемый документ: `docs/research/parallel-batch-audit-final.md`  
> Метод: критическая сверка с актуальными первичными источниками и сопоставление с предыдущим аудитом

## 1. Вердикт

**Итоговая оценка: 4.5/10.**

Этот отчёт выглядит уверенно и местами звучит более “современно”, чем предыдущий аудит, но его главная проблема в том, что он **систематически выдает гипотезы за подтвержденные факты**. В нескольких ключевых местах он делает сильные выводы без надёжной source verification:

- объявляет старые ограничения “исправленными” без подтверждения release notes или merged fix;
- переносит внутренние enum/API-детали на пользовательское поведение без доказательства;
- даёт точные benchmark-цифры там, где первичных benchmark’ов под ваш стек не приведено;
- делает архитектурные выводы (“sequential fallback больше не нужен”, “батч точно не упрётся в timeout”, “snapshots дадут 15-20s”) на недостаточной доказательной базе.

### Ключевые findings

- **Сильная часть отчёта:** он правильно поправляет тезис, что Modal snapshots теперь не требуют обязательного рефакторинга в `server mode`; актуальные docs действительно позволяют использовать `@modal.enter(snap=True)` на `Cls`, а GPU snapshots официально существуют как alpha.  
  Источники: [Modal Memory Snapshots](https://modal.com/docs/guide/memory-snapshots), [Modal GPU snapshot example](https://modal.com/docs/examples/gpu_snapshot), [Modal enter reference](https://modal.com/docs/reference/modal.enter).
- **Критическая проблема:** утверждение, что `Issue #16732` уже исправлен в `v0.18.0`, и один плохой запрос теперь не убивает батч, **не подтверждается**. Сам issue на март 2026 **открыт**.  
  Источник: [vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732).
- **Критическая проблема:** утверждение, что `Issue #37121` уже **FIXED** в `v0.18.0`, также не подтверждается. Публичный issue на март 2026 **открыт**, а отчёт не приводит ни PR, ни release note, ни merged change, которые бы это доказывали.  
  Источник: [vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121).
- **Слишком смелый вывод:** отчёт ссылается на `finish_reason="error"` как на механизм пер-request isolation, но текущая docs по `FinishReason` описывает `error` как **retryable internal request-level error**, а не как универсальный контейнер для input validation failure внутри batch.  
  Источник: [vLLM FinishReason enum](https://docs.vllm.ai/en/stable/api/vllm/v1/engine/).
- **Недоказанные performance-claim’ы:** `15-25s cold start`, `95s prefill`, `210s decode`, `7-8 мин E2E`, `+15-20% batch size`, `30% быстрее FSM` не подтверждены первичными benchmark’ами именно для `Qwen3.5-9B + L40S + structured output + Modal`.

## 2. Верификация фактов

Статусы:

- `CONFIRMED` — подтверждается первичным источником.
- `OUTDATED` — когда-то могло быть верно, но на март 2026 уже не так.
- `INCORRECT` — противоречит текущим данным.
- `UNVERIFIABLE` — убедительного публичного подтверждения нет.

### 2.1. Тезисы из сводной таблицы

| Утверждение из отчёта | Статус | Проверка | Что делать |
|---|---|---|---|
| `llm.chat` официально поддерживает batch input | `CONFIRMED` | Актуальная docs описывает single conversation или sequence of conversations. | Оставить. |
| `Issue #16732` устарел, потому что в `v0.18.0` добавлена изоляция ошибок | `INCORRECT` | Публичный issue #16732 на март 2026 открыт и помечен `stale`; сам по себе этот факт уже опровергает утверждение “исправлено”. | Убрать из отчёта как факт. |
| `PR #8648` добавил batch chat support | `PARTIALLY CONFIRMED` | Направление верное, batch chat support существует, но в отчёте нет прямой ссылки на PR/merge diff. | Оставить только как историческую справку с точной ссылкой. |
| `Qwen3.5 Bug #37121` fixed в `v0.18.0` | `INCORRECT` | Issue #37121 открыт; публичного подтверждения “fixed in 0.18.0” не найдено. | Убрать метку `FIXED`. |
| L40S pricing `$1.95/hr` | `CONFIRMED` | Modal pricing показывает `$0.000542/s`, это эквивалентно `$1.9512/hr`. | Оставить, но в точной форме per-second pricing. |
| GPU snapshot не требует server mode | `CONFIRMED` | Modal docs действительно поддерживают snapshots на `Cls`; GPU snapshots — alpha, и `@modal.enter(snap=True)` используется официально. | Оставить. |
| FlashInfer JIT требует `nvcc`, а `flashinfer-cubin` это смягчает | `CONFIRMED` | FlashInfer docs и PyPI это подтверждают. | Оставить. |

Источники:  
[vLLM LLM.chat API](https://docs.vllm.ai/en/latest/api/vllm/entrypoints/llm/)  
[vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732)  
[vLLM Issue #37121](https://github.com/vllm-project/vllm/issues/37121)  
[Modal Pricing](https://modal.com/pricing)  
[Modal Memory Snapshots](https://modal.com/docs/guide/memory-snapshots)  
[FlashInfer installation](https://docs.flashinfer.ai/installation.html)

### 2.2. Раздел “Критические ошибки и исправления”

| Утверждение | Статус | Проверка | Что делать |
|---|---|---|---|
| `num_gpu_blocks_override=512` вреден, потому что v0.18.0 уже умеет layer-aware allocation | `UNVERIFIABLE` | То, что `512` нельзя объявлять универсальным оптимумом, верно. Но вторая половина тезиса, что `v0.18.0` уже всё чинит автоматически, публично не доказана. | Переформулировать в осторожный вывод: “жёсткий override без profiling sweep рискован”. |
| Ошибка одного запроса больше не убивает batch; остальные завершаются | `UNVERIFIABLE / вероятно неверно для input validation` | Docs по `FinishReason.ERROR` описывают retryable internal error, а issue #16732 всё ещё открыт. Это не похоже на закрытую проблему user-facing batch isolation. | Не удалять fallback/validation стратегию. |
| `finish_reason="error"` достаточно для упрощения error handling | `INCORRECT/OVERSTATED` | Наличие enum `error` не доказывает, что именно input validation или oversized prompt вернут `RequestOutput` вместо исключения. | Не строить код вокруг этого предположения. |
| `snap=True` + warmup даст 15-20s cold start без изменения логики вызовов | `UNVERIFIABLE` | Modal docs обещают 3-10x и рекомендуют warmup, но не дают числа именно для вашего стека. | Оставить как гипотезу для benchmark, не как гарантированный outcome. |

Источники:  
[vLLM FinishReason enum](https://docs.vllm.ai/en/stable/api/vllm/v1/engine/)  
[vLLM Issue #16732](https://github.com/vllm-project/vllm/issues/16732)  
[Modal Memory Snapshots](https://modal.com/docs/guide/memory-snapshots)  
[Modal LFM snapshot example](https://modal.com/docs/examples/lfm_snapshot)

### 2.3. Раздел “Недочёты и пробелы”

| Утверждение | Статус | Проверка | Что делать |
|---|---|---|---|
| десериализация 5-10 MB сложных dict может занять 2-5 секунд CPU | `UNVERIFIABLE` | Это правдоподобно, но в отчёте нет benchmark’а, ни на вашем коде, ни на Modal serialization stack. | Оставить как риск, но не как численно подтверждённый факт. |
| XGrammar в batch mode быстрее Guidance на 15-20% при фиксированной схеме | `PARTIALLY CONFIRMED` | SqueezeBits действительно показывает, что XGrammar выигрывает у LLGuidance на repetitive schemas и gap растёт на batch size >= 8. Но точное число `15-20%` универсально не подтверждено. | Переписать без жёсткой цифры. |
| Speculative decoding поддерживается даже для structured output и даст 1.5-2x | `INCORRECT/UNSAFE` | Есть bug report, что structured output может crash’ить speculative decoding. Это как минимум не тот уровень зрелости, который позволяет рекомендовать эту опцию как near-term acceleration. | Убрать из рекомендаций или пометить как high-risk experiment. |

Источники:  
[SqueezeBits guided decoding benchmark](https://blog.squeezebits.com/70642)  
[vLLM Issue #27969](https://github.com/vllm-project/vllm/issues/27969)

### 2.4. Раздел “Переоценённые и недооценённые риски”

| Утверждение | Статус | Проверка | Что делать |
|---|---|---|---|
| “Упереться в 10 минут на 23 главы практически невозможно” | `INCORRECT/UNVERIFIABLE` | Без собственных benchmark’ов и с учётом structured outputs это слишком сильное утверждение. Существуют issue о long-running structured outputs и timeouts. | Убрать категоричность. |
| Prefill для Qwen3.5 может быть 90-120s из-за гибридной архитектуры | `PLAUSIBLE BUT UNVERIFIABLE` | Это звучит правдоподобно, но без прямого benchmark’а остаётся оценкой. | Оставить как inference, а не verified number. |

Источники:  
[vLLM Issue #10081](https://github.com/vllm-project/vllm/issues/10081)  
[Qwen/Qwen3.5-9B model card](https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/README.md)

## 3. Критические ошибки отчёта

### 3.1. Ложный вывод, что `Issue #16732` фактически закрыт

Это самая опасная ошибка в документе. Он строит целый пласт рекомендаций на том, что batch isolation уже решена в `v0.18.0`, и предлагает упростить error handling до проверки `finish_reason == "error"`.  
Проблема в том, что публичный issue, описывающий ровно эту user-facing потребность, **всё ещё открыт**. Более того, описание `FinishReason.ERROR` говорит о retryable internal error, а не о graceful packaging для input validation problems.

### 3.2. Ложный вывод, что `Issue #37121` уже fixed

Отчёт использует это как основание для совета убрать `num_gpu_blocks_override` и довериться автоматике. Но источник не приведён, а публичный issue всё ещё открыт.  
Это делает совет потенциально опасным: он может быть правильным в будущем, но сейчас он не доказан.

### 3.3. Слишком сильная трактовка GPU snapshot docs

То, что snapshots работают на `Cls`, подтверждено. Но из docs **не следует**, что ваш конкретный `vllm.LLM + Qwen3.5 + L40S` cold start станет `15-20s`. Docs дают диапазон ускорения, а не детерминированную цифру.

### 3.4. Неправильная рекомендация по speculative decoding

Отчёт предлагает speculative decoding почти как overlooked optimization. Но по публичным источникам у speculative + structured outputs есть по крайней мере зафиксированные проблемы/crash scenarios.  
Это не зрелая рекомендация для ближайшей production-итерации.

## 4. Недочёты и пробелы

### 4.1. В отчёте почти нет source attribution

В отличие от хорошего audit-документа, этот текст делает много сильных утверждений без явных ссылок:

- какой именно PR исправил `#37121`;
- где именно задокументировано graceful batch isolation;
- на каком benchmark’е основаны `15-20s`, `95s`, `210s`, `7-8 мин`.

Из-за этого документ трудно использовать как инженерное основание для внедрения.

### 4.2. Недооценён blast radius batch failure

Gemini отчёт слишком быстро снимает тему fallback/recovery. Даже если часть ошибок действительно стала мягче, это **не решает**:

- поздний crash процесса;
- OOM;
- network stall между VPS и Modal;
- broken output parsing;
- idempotent retry after timeout.

То есть рекомендация “сразу упростить error handling” преждевременна.

### 4.3. Пропущена проблема maturity gap между internal enum и external API behavior

Наличие `FinishReason.ERROR` в engine API не равно гарантиям, что именно пользовательский `llm.chat()` офлайн вернёт per-request output вместо исключения в вашем failure mode.  
Это типичная ошибка чтения внутреннего API слишком буквально.

## 5. Переоценённые и недооценённые риски

### Переоценённые

- **Уверенность в fix для batch error isolation**.
- **Уверенность в fix для Qwen3.5 KV overestimation**.
- **Уверенность в `15-20s` cold start без server-mode refactor**.
- **Уверенность в безопасной применимости speculative decoding для structured output**.

### Недооценённые

- **Риск ложноположительного упрощения error handling**.
- **Риск того, что автоматический memory planning для Qwen3.5 всё ещё нестабилен**.
- **Риск того, что structured-output overhead и timeout behaviour под реальной книгой окажутся хуже, чем в теории**.
- **Риск смешения internal engine semantics и user-visible guarantees**.

## 6. Code review findings по предложениям Gemini-аудита

### 6.1. Совет “убрать sequential fallback” преждевременен

Пока нет benchmark/repro на вашем пайплайне, sequential fallback или хотя бы sub-batch fallback нельзя считать избыточным. Иначе вы поднимете throughput, но ухудшите recovery semantics.

### 6.2. Совет “оставить XGrammar как default” в целом разумен, но слишком уверенно подан

Для repetitive schema SqueezeBits действительно показывает преимущество XGrammar над LLGuidance. Но это не снимает необходимости проверять:

- конкретную Pydantic schema;
- Qwen3.5-specific behaviour;
- malformed JSON / truncation rate;
- CPU overhead на вашей книге.

### 6.3. Совет про токенизацию на VPS полезен

Это одна из лучших практических рекомендаций отчёта: предварительная length validation вне Modal действительно снижает cold path pressure внутри контейнера.  
Но и тут лучше говорить не “обязательно”, а “вероятно выгодно, нужно измерить”.

## 7. Скорректированная общая оценка

### Что Gemini-аудит исправил правильно

- Он корректно заметил, что snapshots в Modal стали сильнее и гибче, чем предполагал предыдущий аудит.
- Он правильно раскритиковал безусловный `num_gpu_blocks_override=512` как слишком жёсткий workaround.
- Он справедливо поднял тему deserialize overhead и prefill latency как hidden costs.

### Что Gemini-аудит ухудшил

- Заменил осторожность на необоснованную уверенность.
- Превратил несколько “возможно уже стало лучше” в “точно исправлено”.
- Дал слишком точные числа без доказательной базы.
- Предложил упрощение error handling раньше времени.

## 8. Рекомендации

### Рекомендация 1

Не принимать `docs/research/parallel-batch-audit-final.md` как authoritative final audit. Его можно использовать только как **второе мнение**, из которого стоит взять:

- обновлённый взгляд на Modal snapshots;
- скепсис к жёсткому `num_gpu_blocks_override`;
- идею pre-validation на VPS.

### Рекомендация 2

Считать следующие тезисы **неподтверждёнными до собственного POC**:

- batch isolation уже исправлен;
- Qwen3.5 KV bug уже fixed;
- `finish_reason="error"` покрывает ваши failure cases;
- snapshots гарантированно дают 15-20s;
- speculative decoding подходит для structured output.

### Рекомендация 3

Перед изменением production-плана провести узкий benchmark matrix:

1. `batch=4`, `8`, `12`
2. `xgrammar` vs `guidance`
3. с `num_gpu_blocks_override` и без него
4. с snapshots и без snapshots
5. замер `success rate`, `truncation`, `malformed JSON`, `OOM`, `wall-clock`, `cost/book`

### Рекомендация 4

Архитектурно сейчас safest path выглядит так:

- не monolithic batch 23;
- не полный отказ от fallback;
- а **chunked sub-batch + pre-validation + progress checkpointing**.

Это лучше согласуется и с первым аудитом, и с теми частями Gemini-отчёта, которые действительно полезны.

## Приложение: проверенные ссылки

- `parallel-batch-audit-final.md`: [docs/research/parallel-batch-audit-final.md](/Users/sandk/Documents/GitHub/fancai/docs/research/parallel-batch-audit-final.md)
- vLLM `LLM.chat`: https://docs.vllm.ai/en/latest/api/vllm/entrypoints/llm/
- vLLM `FinishReason`: https://docs.vllm.ai/en/stable/api/vllm/v1/engine/
- vLLM Issue #16732: https://github.com/vllm-project/vllm/issues/16732
- vLLM Issue #37121: https://github.com/vllm-project/vllm/issues/37121
- vLLM Issue #27969: https://github.com/vllm-project/vllm/issues/27969
- vLLM Issue #10081: https://github.com/vllm-project/vllm/issues/10081
- Modal Memory Snapshots: https://modal.com/docs/guide/memory-snapshots
- Modal GPU snapshot example: https://modal.com/docs/examples/gpu_snapshot
- Modal enter reference: https://modal.com/docs/reference/modal.enter
- Modal LFM snapshot example: https://modal.com/docs/examples/lfm_snapshot
- Modal Pricing: https://modal.com/pricing
- FlashInfer installation: https://docs.flashinfer.ai/installation.html
- SqueezeBits guided decoding benchmark: https://blog.squeezebits.com/70642
- Qwen3.5-9B model card: https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/README.md

# Выбор AI-моделей для fancai — 2026-08-01

> Якорь: 2026-08-01. Цены и статусы моделей — с официальных страниц Google
> (`ai.google.dev/gemini-api/docs/{models,pricing,deprecations,latest-model}`, страница
> устареваний обновлена 2026-07-30) и карточки модели в Gemini Enterprise Agent Platform.
> Каталог OpenRouter — `GET https://openrouter.ai/api/v1/models` от 2026-08-01 (336 моделей).
> **Решение не принято**: документ подготовлен к стоп-точке §12.1.

---

## 1. Что фактически нужно от моделей

Прочитаны реальные вызовы, а не общее представление о задаче.

| Нагрузка | Где в коде | Что требуется |
| --- | --- | --- |
| Извлечение сущностей и описаний | `gemini_extractor.py:298` (`TSA_EXTRACTION_PROMPT`), `:362` (`EXTRACTION_PROMPT`), вызов на `:626` | structured output по Pydantic-схеме `GeminiResponseSchema`, чанки до 100 000 символов (`GeminiConfig.max_chunk_chars`), русская художественная проза, до 20 описаний на чанк по ≤1000 символов |
| Дедупликация сущностей | `entity_deduplication_service.py:57` (`DEDUPLICATION_PROMPT`), вызов `:208` | текстовый вывод, семантическое слияние имён и прозвищ |
| Consistency reduce | `consistency_manager.py:617-632` | **идёт напрямую в OpenRouter, минуя `AIProvider`** |
| Перевод RU→EN для промпта картинки | `imagen_generator.py` → `PromptTranslator` | короткий текст, качество образности |
| Генерация изображения | `nano_banana_generator.py:29` → `GeminiClient.generate_image` | 1 изображение на описание, 1K |

**Два независимых маршрута выбора модели.** Это определяет весь список правок ниже:

1. **Gemini-путь** (активен в проде: `AI_PROVIDER=gemini`, `GEMINI_BACKEND=vertex`).
   Модель берётся из `settings.GEMINI_EXTRACTION_MODEL` в `gemini_client.py:86,113`
   и `settings.GEMINI_IMAGE_MODEL` в `:146`. Экстрактор вызывает `generate_structured()`
   **без аргумента `model`** (`gemini_extractor.py:626-630`), поэтому подстановка из
   конфига работает.
2. **OpenRouter-путь** (активен для consistency reduce **независимо от `AI_PROVIDER`**).
   Модель берётся из захардкоженного `FALLBACK_MODELS` в `openrouter_client.py:57-60`.
   Ключи `GEMINI_*` на него не влияют вообще.

---

## 2. Актуальная линейка Gemini на 2026-08-01

### 2.1. Что оказалось правдой из ожиданий пользователя

Названная пользователем «Gemini 3.6 Flash» — **реальная GA-модель**, а не иллюстрация.
`gemini-3.6-flash` вышла 2026-07-21 и на странице моделей стоит первой как «Our latest model».

### 2.2. Текстовые модели

| Модель | ID | Статус | Вход /1M | Выход /1M | Кэш-вход /1M | Batch вход/выход | Контекст | Max out | Дефолтный thinking | Дата GA | Shutdown |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Gemini 3.6 Flash | `gemini-3.6-flash` | Stable | **$1.50** | **$7.50** | $0.15 | $0.75 / $3.75 | 1 048 576 | 65 536 | `medium` | 2026-07-21 | не объявлен |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Stable | $1.50 | $9.00 | $0.15 | $0.75 / $4.50 | 1M | 64K | `medium` | 2026-05-19 | не объявлен |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Stable | $0.30 | $2.50 | $0.03 | $0.15 / $1.25 | 1M | 64K | `minimal` | 2026-07-21 | не объявлен |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Stable | $0.25 | $1.50 | $0.025 | — | 1M | 64K | — | 2026-05-07 | **2027-05-07** |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Preview | — | — | — | — | 1M | 64K | — | 2026-02-19 | не объявлен |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Stable | $0.30 | $2.50 | $0.03 | — | 1M | — | — | 2025-06-17 | **2026-10-16** |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | Stable | $0.10 | $0.40 | $0.01 | — | 1M | — | — | 2025-07-22 | **2026-10-16** |

Все поддерживают structured output и context caching; 3.6 Flash и 3.5 Flash-Lite
дополнительно поддерживают Computer Use (для fancai нерелевантно).

**Поправка к внутреннему исследованию `docs/research/gemini-api-consolidated.md` (2026-03-31).**
Там указано, что 2.5 Pro/Flash выключаются 2026-06-17, а 2.5 Flash-Lite — 2026-07-22.
Официальная страница устареваний на 2026-07-30 даёт для всех трёх **2026-10-16**.
То есть модели ещё живы, но у отката на OpenRouter появился жёсткий срок годности.

### 2.3. Модели изображений

| Модель | ID | Статус | 1K-изображение | Batch 1K | Вход /1M |
| --- | --- | --- | ---: | ---: | ---: |
| Nano Banana 2 | `gemini-3.1-flash-image` | Stable, GA 2026-05-28 | **$0.067** | $0.034 | $0.50 |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Stable, GA 2026-06-30 | **$0.0336** | — | $0.25 |
| Nano Banana Pro | `gemini-3-pro-image` | Stable, GA 2026-05-28 | $0.134 | $0.067 | $2.00 |
| Nano Banana (2.5) | `gemini-2.5-flash-image` | Stable | $0.039 | $0.0195 | $0.30 |
| Imagen 4 | `imagen-4.0-*` | **Deprecated** | $0.02–$0.06 | — | — |

**Imagen 4 выключается 2026-08-17** — через 16 дней после якоря. Проверено: fancai его
не использует. Класс `ImagenService` (`imagen_generator.py:347`) — легаси-имя;
фактически он инициализирует `NanoBananaGenerator` (`:370`) и работает через
`settings.GEMINI_IMAGE_MODEL`. Grep по `imagen-4`/`imagen-3` в `backend/app/` — ноль совпадений.
**Действий не требуется**, но стоит переименовать класс и поправить его docstring,
где до сих пор написано «через OpenRouter FLUX.2 Klein 4B».

### 2.4. Доступность в Vertex

Прод работает через `GEMINI_BACKEND=vertex`, `GCP_LOCATION=global`. Причина выбора `global`
зафиксирована в коммите `91f69258`: `gemini-3.5-flash` отсутствовала в региональных эндпоинтах.

**Ограничение сохраняется.** Карточка `gemini-3.6-flash` в Gemini Enterprise Agent Platform:
`Supported regions → Model availability: Global: global`; то же для Provisioned Throughput
и Standard PayGo. Значит `GCP_LOCATION=global` остаётся обязательным и после смены модели —
менять эту настройку не нужно.

Статус на Vertex: `Launch stage: GA`, `Release date: July 21, 2026`. Поддерживаются thinking,
system instructions, structured output, explicit и implicit context caching, batch inference.

### 2.5. Требуемая версия SDK

`google-genai==2.8.0` в проекте. `gemini-3.5-flash` добавлена в 2.6.0 (2026-05-22),
поэтому текущая модель работает. Для 3.6 Flash и 3.5 Flash-Lite целевая — **2.16.0**
(2026-07-30). Проверено по распаковке wheel 2.16.0: сигнатура `genai.Client.__init__`
содержит **и** `enterprise`, **и** `vertexai` — переименование в 2.6.0 было документационным,
вызов `genai.Client(vertexai=True, project=…, location=…)` в `gemini_client.py:62-63`
остаётся рабочим.

---

## 3. Изменения API, затрагивающие код fancai

Начиная с 3.6 Flash и 3.5 Flash-Lite действуют «для этих и всех будущих моделей».

### 3.1. `temperature`, `top_p`, `top_k` объявлены deprecated

Официально: «deprecated and ignored. In future model generations, supplying these parameters
returns an HTTP 400 error. **Remove these parameters from all requests.**»
Карточка Vertex формулирует то же: «Custom values for parameters like temperature, top-K,
and top-P aren't supported… that value will be ignored».

**Затронутый код:**

| Файл:строка | Что |
| --- | --- |
| `backend/app/core/gemini_client.py:83,89` | `generate_text(temperature: float = 0.3)` → передаётся в `GenerateContentConfig` |
| `backend/app/core/gemini_client.py:110,118` | `generate_structured(temperature: float = 0.1)` → то же |
| `backend/app/core/ai_provider.py:19,28` | `temperature` в сигнатуре протокола |
| `backend/app/services/gemini_extractor.py:629` | вызов с `temperature=0.3` |

Сейчас параметр просто игнорируется — поломки нет. Но детерминизм, который проект
рассчитывал получить через `temperature=0.1` на structured output, **уже не работает**.
Рекомендация Google — переносить требования детерминизма в system instruction.
Это правка промптов, вынесена в §7.

### 3.2. Prefilled model turn → HTTP 400

Запрос, у которого последний непустой ход имеет роль `model`, возвращает 400.
Проверено: fancai строит single-turn запросы (`generate_structured(prompt=…)`), заготовленных
ходов модели нет. **Не затронуто.**

### 3.3. Ловушка в учёте стоимости

`backend/app/core/gemini_pricing.py` содержит захардкоженную таблицу цен, а
`compute_cost()` возвращает **`0.0` для неизвестной модели** (строки 31-33).
Таблица сверена с официальной страницей на 2026-08-01 — **все 4 текстовые и 3 модели
изображений в ней указаны верно**, дрейфа нет. Но в ней **нет** `gemini-3.6-flash`
и `gemini-3.5-flash-lite`.

Следствие: переключение модели без правки таблицы приведёт к тому, что весь учёт расходов
молча станет нулевым. Правка `PRICING` обязана входить в тот же коммит, что и смена модели.

### 3.4. Ловушка в ключе кэша и метках метрик

`GeminiConfig` (`gemini_extractor.py:126-132`) хардкодит `model_id`, `model_extraction`,
`model_translation`, `model_reduce` как `"gemini-3.5-flash"`. На выбор модели это не влияет
(вызов идёт без `model=`), **но** эти поля используются в:

- ключе кэша LLM: `f"llm:gemini:{self.config.model_extraction}:{text_hash}"` (`:447`);
- метриках попаданий/промахов кэша (`:460`, `:463`);
- метриках количества описаний (`:556`, `:561`);
- метках rate-limit (`:643`).

Следствие: после смены `GEMINI_EXTRACTION_MODEL` на 3.6 кэш продолжит отдавать ответы,
сгенерированные 3.5, под ключом с именем 3.5 — то есть **новая модель не будет применена
к уже закэшированным чанкам** (TTL кэша 24 часа), а все метрики будут врать про модель.
Эти поля нужно перевести на `settings.GEMINI_EXTRACTION_MODEL`.

---

## 4. Модель стоимости

### 4.1. Измеренные величины

Из прод-БД (агрегаты, без выборки содержимого строк):

| Величина | Значение | Источник |
| --- | --- | --- |
| Книг / глав | 16 / 554 | `COUNT(*)` |
| Средняя длина главы | 27 722 символа | `AVG(LENGTH(content))` |
| Суммарный объём | 15,36 млн символов | `SUM(LENGTH(content))` |
| Типичный роман в наборе | 50 глав / 1,64 млн символов | группировка по книге |
| Крупнейший | 62 главы / 2,01 млн символов | то же |
| Сгенерировано изображений | 45 | `COUNT(*)` |

Из `llm_usage_log` за окно 2026-06-16…22 (44 вызова `gemini-3.5-flash`):

| Величина | На вызов |
| --- | ---: |
| Входные токены | 6 252 |
| Видимые выходные токены | 6 150 |
| Thinking-токены | 6 495 |

> **Как получены thinking-токены.** Поле `completion_tokens` их не содержит, а `compute_cost`
> тарифицирует `(out_tokens + thoughts)` по ставке выхода. Инвертируя **известную локальную
> формулу** при известных ставках: `(5.4201 − 275066×1.5/10⁶) × 10⁶ / 9.00 = 556 389`
> выходных-эквивалентных токенов, минус 270 610 видимых = **285 779 thinking**.
> Это арифметика над собственными логами fancai, а не биллинг Google.
> Отношение thinking к видимому выходу: **1,06**.

### 4.2. Формула

```
tokens_in  = chars_book / R + P × chapters
tokens_out = tokens_in × K_out
tokens_thk = tokens_out × K_thk
cost_book  = (tokens_in × price_in + (tokens_out + tokens_thk) × price_out) / 1e6
           + images_book × price_image
```

| Параметр | Значение | Статус |
| --- | --- | --- |
| `chars_book` | 1 640 000 (типичный роман) | измерено |
| `chapters` | 50 | измерено |
| `R` — символов на токен, русская проза | **2,5** (диапазон чувствительности 2,0–3,0) | **допущение [INFERENCE]** |
| `P` — накладные токены промпта на вызов | **2 000** | **допущение [INFERENCE]**, `TSA_EXTRACTION_PROMPT` ≈ 4 КБ |
| `K_out` — выход к входу | **0,98** | измерено |
| `K_thk` — thinking к выходу | **1,06** | измерено (см. выше) |
| Перекрытие чанков | **0** | средняя глава 27,7 К < лимита 100 К, разбиения нет |
| `images_book` | 3 | измерено: 45 изображений / 16 книг |

### 4.3. Результат

Типичный роман 1,64 млн символов, 50 глав, при `R = 2,5`:
`tokens_in = 656 000 + 100 000 = 756 000`; `tokens_out = 741 000`; `tokens_thk = 785 000`;
оплачиваемый выход `1 526 000`.

| Сценарий | Вход | Выход (с thinking) | Текст | Изображения | **Итого за книгу** | Δ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Сейчас**: 3.5 Flash + Nano Banana 2 | $1,13 | $13,73 | $14,86 | $0,20 | **$15,06** | база |
| 3.6 Flash + Nano Banana 2 (только ставка) | $1,13 | $11,45 | $12,58 | $0,20 | **$12,78** | **−15,1 %** |
| 3.6 Flash с заявленной экономией токенов −10 % | $1,13 | $10,30 | $11,43 | $0,20 | **$11,63** | −22,8 % |
| 3.6 Flash + Batch API | $0,57 | $5,72 | $6,29 | $0,10 | **$6,39** | −57,6 % |
| 3.6 Flash + Nano Banana 2 Lite | $1,13 | $11,45 | $12,58 | $0,10 | **$12,68** | −15,8 % |
| 3.5 Flash-Lite (гипотетически на всём) | $0,23 | $3,82 | $4,05 | $0,20 | **$4,25** | −71,8 % |

Чувствительность к `R` для рекомендованного варианта (3.6 Flash, стандартный tier):

| `R`, символов/токен | Вход, токенов | **Итого за книгу** |
| ---: | ---: | ---: |
| 2,0 | 920 000 | $15,54 |
| 2,5 | 756 000 | $12,78 |
| 3,0 | 647 000 | $10,93 |

**Месячный прогноз.** Текущий профиль нагрузки — 3 пользователя, 16 книг за 5 месяцев,
последняя запись в `llm_usage_log` 2026-06-22. Фактическое потребление сейчас близко к нулю,
поэтому месячная оценка строится не от истории, а от сценария запуска:

| Книг в месяц | 3.5 Flash (сейчас) | 3.6 Flash | 3.6 Flash + Batch |
| ---: | ---: | ---: | ---: |
| 10 | $151 | $128 | $64 |
| 50 | $753 | $639 | $320 |
| 200 | $3 012 | $2 556 | $1 278 |

### 4.4. Что модель стоимости не учитывает

- **Context caching** не даст выигрыша на текущем профиле: промпт ~2 000 токенов при
  минимальном пороге кэширования, окупаемость требует многократного переиспользования
  одного префикса в пределах часа. Вывод совпадает с `gemini-api-consolidated.md` §4.6.
- **Consistency reduce через OpenRouter** в модель не включён: у него нет ни атрибуции
  в `llm_usage_log` (поле `service` пусто во всех записях), ни отдельного учёта.
- **Дедупликация и перевод** идут через тот же `AIProvider` и учтены в общем `K_out`.

---

## 5. Рекомендация

### 5.1. Основное

| Роль | Сейчас | Рекомендуется | Почему |
| --- | --- | --- | --- |
| Primary LLM (извлечение, synthesis, dedup) | `gemini-3.5-flash` | **`gemini-3.6-flash`** | тот же вход $1,50, выход $7,50 вместо $9,00; официально заявлена меньшая многословность; GA, shutdown не объявлен; Vertex/global поддерживается |
| Lite-модель (зарезервирована под tiering) | `gemini-3.1-flash-lite` | **`gemini-3.5-flash-lite`** | у текущей **объявлен shutdown 2027-05-07** с этой же рекомендованной заменой |
| Image | `gemini-3.1-flash-image` | **оставить** | GA, shutdown не объявлен, ID подтверждён — комментарий «ID подтвердить smoke-тестом A3.1» в `config.py:72` можно снимать |
| OpenRouter fallback (текст) | `google/gemini-2.5-flash`, `-lite` | **`google/gemini-3.6-flash`, `google/gemini-3.5-flash-lite`** | обе текущие выключаются 2026-10-16; обе новые есть в каталоге OpenRouter по тем же ставкам |
| OpenRouter image | `black-forest-labs/flux.2-klein-4b` | **`google/gemini-3.1-flash-image`** или удалить ключ | **текущей модели нет в каталоге OpenRouter**; FLUX там отсутствует целиком |
| `AI_PROVIDER` по умолчанию | `"openrouter"` | **`"gemini"`** | прод уже работает так через env; дефолт кода вводит в заблуждение новые окружения |

### 5.2. Точный список правок

**`backend/app/core/config.py`:**

| Строка | Ключ | Было | Стало |
| --- | --- | --- | --- |
| 66 | `AI_PROVIDER` | `"openrouter"` | `"gemini"` |
| 67 | `GEMINI_EXTRACTION_MODEL` | `"gemini-3.5-flash"` | `"gemini-3.6-flash"` |
| 68-70 | `GEMINI_LITE_MODEL` | `"gemini-3.1-flash-lite"` | `"gemini-3.5-flash-lite"` |
| 71-73 | `GEMINI_IMAGE_MODEL` | `"gemini-3.1-flash-image"` | без изменений; снять комментарий «ID подтвердить smoke-тестом» |
| 60-62 | `OPENROUTER_IMAGE_MODEL` | `"black-forest-labs/flux.2-klein-4b"` | `"google/gemini-3.1-flash-image"` |
| 76 | `GEMINI_BACKEND` | `"developer"` | решение пользователя: прод уже `vertex` через env |
| 78-80 | `GCP_LOCATION` | `"global"` | **без изменений** — 3.6 Flash доступна только в `global` |

**Правки вне `config.py`, без которых смена моделей будет только на бумаге:**

| Файл:строка | Правка | Почему обязательна |
| --- | --- | --- |
| `backend/app/core/gemini_pricing.py:8-13` | добавить `gemini-3.6-flash` (1.50 / 7.50 / 0.15) и `gemini-3.5-flash-lite` (0.30 / 2.50 / 0.03) | иначе `compute_cost` вернёт `0.0` и учёт расходов обнулится |
| `backend/app/core/openrouter_client.py:57-60` | `FALLBACK_MODELS` → `["google/gemini-3.6-flash", "google/gemini-3.5-flash-lite"]` | путь consistency reduce не управляется `GEMINI_*`; текущие модели умрут 2026-10-16 |
| `backend/app/services/gemini_extractor.py:126-132` | заменить хардкод на `settings.GEMINI_EXTRACTION_MODEL` | иначе ключ кэша и все метрики останутся с именем 3.5 |
| `backend/app/core/gemini_client.py:83,89,110,118` | убрать `temperature` из вызовов | параметр deprecated и игнорируется; в будущих поколениях — HTTP 400 |
| `backend/app/core/ai_provider.py:19,28` | убрать `temperature` из протокола | согласование сигнатур |
| `backend/app/services/gemini_extractor.py:629` | убрать `temperature=0.3` | то же |
| `backend/requirements.txt:30` | `google-genai==2.8.0` → `2.16.0` | поддержка новых ID моделей |
| `backend/tests/core/test_config_gemini.py:6` | обновить ожидаемое значение | тест жёстко проверяет `"gemini-3.5-flash"` |

**Сброс кэша.** После смены модели необходимо инвалидировать LLM-кэш в Redis DB 0
(TTL 24 часа), иначе новая модель не применится к уже обработанным чанкам.
Redis DB 1 (брокер Celery) **не трогать**.

### 5.3. Что решает пользователь (§8.4)

1. **Дефолт `AI_PROVIDER`.** Менять на `"gemini"` или оставить как есть, полагаясь на env?
2. **`GEMINI_BACKEND` по умолчанию.** Прод на `vertex`, дефолт кода — `developer`.
   Приводить дефолт к бою или сохранять развилку?
3. **Batch API.** Даёт −50 % на текст и изображения, но меняет модель исполнения
   (асинхронные джобы вместо синхронных вызовов) — это архитектурная работа, не смена ключа.
   Ставить в бэклог или планировать?
4. **Tiering.** `GEMINI_LITE_MODEL` сейчас **не имеет ни одного потребителя в коде**
   (grep: только `config.py` и тест). Оживлять ли tiering или удалить ключ?
5. **Nano Banana 2 Lite** вдвое дешевле ($0,0336 против $0,067), но это другое качество.
   Для художественных сцен нужен визуальный A/B — проводить?

---

## 6. Оценка влияния на промпты

Требуется ли правка промптов при переходе 3.5 → 3.6 Flash.

| Промпт | Файл | Нужна правка? | Обоснование |
| --- | --- | --- | --- |
| `TSA_EXTRACTION_PROMPT` | `gemini_extractor.py:298` | **вероятно да, небольшая** | 3.6 Flash заявлена как менее многословная и «prefers running diagnostic code scripts» — для structured output это нейтрально, но требования к детерминизму, которые раньше задавались `temperature=0.1`, теперь нужно переносить в текст промпта |
| `EXTRACTION_PROMPT` (legacy JSON) | `gemini_extractor.py:362` | то же | используется при `use_tsa_mode=False` |
| `DEDUPLICATION_PROMPT` | `entity_deduplication_service.py:57` | нет | короткий, structured, к многословности нечувствителен |
| `EXTRACTION_SYSTEM_PROMPT` | `prompts/modal_extraction.py:12` | нет | Modal-путь выключен |
| Промпт перевода RU→EN | `imagen_generator.py` → `PromptTranslator` | нет | однострочная задача |

**Объём:** добавить в system-часть двух extraction-промптов явные правила формата и
стабильности вывода взамен утраченного `temperature`. Оценка — 1–2 часа плюс прогон
на контрольной главе.

**Это отдельная задача.** Здесь она не выполняется: правка промптов меняет качество
извлечения и требует сравнения выходов, а не только запуска тестов.

---

## 7. План smoke-проверки перед переключением дефолта

Выполнять **до** изменения `config.py`, на копии данных, с явной оценкой стоимости.

| Шаг | Действие | Ожидаемый результат | Стоимость |
| --- | --- | --- | --- |
| 1 | `client.models.get("gemini-3.6-flash")` в Vertex-режиме с `GCP_LOCATION=global` | модель резолвится | $0 |
| 2 | Один вызов `generate_structured` на одной реальной главе (~28 000 символов) с текущей схемой `GeminiResponseSchema`, модель передана явно | валидный JSON по схеме, без `finish_reason=SAFETY` | ~$0,25 |
| 3 | Тот же вызов на `gemini-3.5-flash` | база для сравнения | ~$0,30 |
| 4 | Сравнить: число описаний, число сущностей, покрытие имён, длина `visual_summary`, наличие галлюцинированных имён | 3.6 не хуже 3.5 по полноте | $0 |
| 5 | Сверить `usage_metadata`: `prompt_token_count`, `candidates_token_count`, `thoughts_token_count` | подтвердить или опровергнуть заявленную экономию токенов | $0 |
| 6 | Один вызов `generate_image` на `gemini-3.1-flash-image` с описанием из шага 2 | изображение получено, `service_used=imagen` | $0,067 |
| 7 | Проверить, что `compute_cost("gemini-3.6-flash", …)` **не** возвращает `0.0` после правки таблицы | ненулевая стоимость в `llm_usage_log` | $0 |
| 8 | Один вызов через OpenRouter на `google/gemini-3.6-flash` | путь отката жив | ~$0,25 |

**Суммарная стоимость smoke-проверки: около $0,90.** Это укладывается в «дешёвые
smoke-проверки» по §12.2 и не требует отдельного разрешения на траты.

Переключать дефолт только после зелёных шагов 4, 5 и 7.

# Миграция на OpenRouter

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секции 1, 4

---

## 1. Текущая архитектура

5 сервисов используют google-genai SDK напрямую:

| Сервис              | Файл                              | Использование                             | Сложность миграции |
| ------------------- | --------------------------------- | ----------------------------------------- | ------------------ |
| Gemini Extractor    | `gemini_extractor.py`             | `response_schema=PydanticModel` + 2 схемы | **HIGH**           |
| Entity Dedup        | `entity_deduplication_service.py` | `response_schema=DeduplicationResponse`   | MEDIUM             |
| Entity Synthesis    | `entity_synthesis_service.py`     | `response_mime_type` только (без schema)  | LOW                |
| Consistency Manager | `consistency_manager.py`          | `response_mime_type` только               | LOW                |
| Imagen Generator    | `imagen_generator.py`             | `client.models.generate_images()`         | **CRITICAL**       |

## 2. Ключевые технические проблемы

### Потеря `response_schema=PydanticModel`

- google-genai SDK автоматически конвертирует Pydantic → JSON Schema → валидный ответ
- OpenRouter требует ручной конвертации + `response_format.json_schema`
- Ответ приходит как строка JSON, нужен ручной `model_validate()`

### Проблема с вложенными схемами

- Pydantic v2 генерирует `$defs`, `$ref`, `anyOf` (для Optional полей)
- Gemini через OpenRouter плохо обрабатывает эти конструкции ([Issue #3617](https://github.com/pydantic/pydantic-ai/issues/3617))
- **Необходим JSON Schema трансформер:** инлайн `$defs`, конверсия `anyOf → nullable`

### Imagen 4 недоступен на OpenRouter

- `generate_images()` API не существует на OpenRouter
- Генерация идёт через `chat/completions` с `modalities: ["image"]`
- Нужна полная смена модели (→ FLUX.2 Pro или Nano Banana)

## 3. Рекомендуемый SDK

**openai Python SDK** с `base_url="https://openrouter.ai/api/v1"` — официально рекомендуемый OpenRouter подход.

## 4. OpenRouter-специфичные фичи

| Фича                 | Описание                                                  | Польза для fancai            |
| -------------------- | --------------------------------------------------------- | ---------------------------- |
| Provider routing     | `provider.order: ["Google AI Studio", "Vertex AI"]`       | Контроль провайдера          |
| Model fallbacks      | `models: ["gemini-3-flash", "gemini-2.5-flash"]`          | Автоматический fallback      |
| `require_parameters` | Принудительная маршрутизация на провайдеров с json_schema | Надёжность structured output |
| Response Healing     | Автоматический ремонт JSON (-80% дефектов)                | Уменьшение ошибок парсинга   |
| BYOK                 | Свой Google API key через OpenRouter (5% вместо 5.5%)     | Экономия + лимиты            |
| Analytics API        | `GET /api/v1/activity`                                    | Мониторинг расходов          |

## 5. Порядок миграции

| Фаза      | Сервисы                                                  | Дни            | Сложность |
| --------- | -------------------------------------------------------- | -------------- | --------- |
| 0         | Shared OpenRouter client + JSON Schema трансформер       | 1              | Low       |
| 1         | `entity_synthesis_service.py` + `consistency_manager.py` | 1              | Low       |
| 2         | `entity_deduplication_service.py`                        | 1-2            | Medium    |
| 3         | `gemini_extractor.py`                                    | 2-3            | High      |
| 4         | `imagen_generator.py` (полная переписка)                 | 3-4            | Critical  |
| 5         | Интеграционное тестирование + canary deploy              | 2-3            | High      |
| **Итого** |                                                          | **10-14 дней** |           |

## 6. Риски и митигации

| Риск                                       | Вероятность | Митигация                                                |
| ------------------------------------------ | ----------- | -------------------------------------------------------- |
| Деградация nested schemas через OpenRouter | Высокая     | JSON Schema трансформер (инлайн $defs, fix nullable)     |
| OpenRouter downtime (30 мин в фев 2026)    | Средняя     | Celery retries, async обработка — не критично            |
| Потеря safety_filter_level для изображений | Средняя     | FLUX.2 более permissive чем Imagen для литературных сцен |
| Latency overhead (~25-40ms)                | Низкая      | Запросы 5-30 сек, overhead <0.1%                         |

---

## 7. Prompt Caching через OpenRouter

### Как работает

OpenRouter поддерживает **implicit caching** для Gemini моделей:

- **Автоматическое:** если тот же prefix отправляется повторно, кеш включается без конфигурации
- **Экономия:** 75% на кешированных токенах
- **Минимум:** 1028 токенов (Flash) / 2048 токенов (Pro) для активации кеша
- **Без TTL:** OpenRouter управляет кешем автоматически
- **Без write costs:** нет стоимости записи в кеш

### Применимость для fancai

При обработке книги (100 глав) системный промпт (~2K токенов) отправляется 100+ раз → **автоматически кешируется** через OpenRouter. Это проще чем ручное управление TTL через прямой Gemini API.

### Ограничения

- [Известные проблемы с тарификацией](https://github.com/cline/cline/issues/3158): некоторые запросы тарифицируются по полной цене несмотря на cache hit
- Кеширование работает только внутри одного провайдера (если OpenRouter переключает провайдера, кеш сбрасывается)
- Рекомендация: использовать `provider.order` для закрепления провайдера при обработке книги

---

## Источники

- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter OpenAI SDK](https://openrouter.ai/docs/guides/community/openai-sdk)
- [OpenRouter Feb 2026 Outages](https://openrouter.ai/announcements/openrouter-outages-on-february-17-and-19-2026)
- [Pydantic AI + OpenRouter nested schemas issue](https://github.com/pydantic/pydantic-ai/issues/3617)

# Phase 30: GLiNER2 NER Service - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-24
**Phase:** 30-gliner2-ner-service
**Areas discussed:** Точка интеграции NER, Chunking стратегия, Маппинг entity types, A/B тестирование

---

## Точка интеграции NER

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельный этап до LLM | NERService запускается первым, LLM потом только descriptions/relationships | ✓ (Claude's discretion) |
| Полная замена analyze_chapter | NER + classifier полностью заменяют LLM — захватывает скоуп Phase 31 | |

**User's choice:** You decide → Claude выбрал "Отдельный этап до LLM" как совместимый с Phase 31.

| Option | Description | Selected |
|--------|-------------|----------|
| Один task: NER → LLM | process_book_task вызывает оба последовательно | ✓ |
| Раздельные tasks | NER и LLM как отдельные Celery tasks с chain | |

**User's choice:** Один task: NER → LLM

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy singleton | Один инстанс на worker, модель персистит | ✓ |
| Новый инстанс на книгу | Чистый старт, загрузка ~5-10сек каждый раз | |

**User's choice:** Lazy singleton

| Option | Description | Selected |
|--------|-------------|----------|
| Фиксированный список labels | Жёсткие labels в коде | |
| Настраиваемый список | Labels в Settings таблице, admin API | ✓ |

**User's choice:** Настраиваемый список

| Option | Description | Selected |
|--------|-------------|----------|
| В Settings таблице | Рядом с feature flags, admin API | ✓ |
| Environment variable | JSON в env var | |
| YAML/JSON файл | Файл конфига, Docker volume | |

**User's choice:** В Settings таблице

| Option | Description | Selected |
|--------|-------------|----------|
| Да, с метриками | latency, entities/chapter, chunks через metrics.py | ✓ |
| Только логи | structlog без Prometheus | |

**User's choice:** Да, с метриками

---

## Chunking стратегия

| Option | Description | Selected |
|--------|-------------|----------|
| razdel | Python для русского, ~50KB, sentenize() | ✓ |
| spaCy ru_core_news_sm | Полный NLP pipeline, ~15MB модель | |
| Regex | Без зависимостей, проблемы с инициалами | |

**User's choice:** razdel

| Option | Description | Selected |
|--------|-------------|----------|
| Sentence overlap | 2-3 предложения повторяются, dedup по offset | ✓ |
| Character overlap | Фиксированный overlap в символах | |

**User's choice:** Sentence overlap

| Option | Description | Selected |
|--------|-------------|----------|
| DeBERTa tokenizer | AutoTokenizer от GLiNER2 модели, точный | ✓ |
| Приближённый подсчёт | Символы / 2 для русского | |

**User's choice:** DeBERTa tokenizer

| Option | Description | Selected |
|--------|-------------|----------|
| 384 токенов | Консервативно, 75% от max | |
| 448 токенов | Баланс, 87% от max | |
| You decide | Claude выбирает | ✓ |

**User's choice:** You decide

| Option | Description | Selected |
|--------|-------------|----------|
| Да, один chunk | Короткие главы без split | ✓ |
| Всегда через chunker | Единый путь обработки | |

**User's choice:** Да, один chunk

---

## Маппинг entity types

| Option | Description | Selected |
|--------|-------------|----------|
| Пустые поля, LLM добавит позже | Phase 33 обогатит | ✓ (Claude's discretion) |
| NER + мини-LLM enrichment | Сразу полные entities | |

**User's choice:** You decide → Claude выбрал пустые поля для Phase 33 enrichment.

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельный label | GLiNER: person, location, artifact, organization | ✓ |
| Без artifact | Только person, location, organization | |

**User's choice:** Отдельный label

| Option | Description | Selected |
|--------|-------------|----------|
| Да, ≥ 2 символов | Отсечь шум | ✓ |
| Нет, оставить все | ConsistencyManager сам отфильтрует | |

**User's choice:** Да, ≥ 2 символов

| Option | Description | Selected |
|--------|-------------|----------|
| Да, агрегировать | Один ExtractedEntity с min offset, avg confidence | ✓ |
| Каждый mention отдельно | ConsistencyManager резолвит | |

**User's choice:** Да, агрегировать

| Option | Description | Selected |
|--------|-------------|----------|
| ChapterAnalysisResult с пустыми desc/rel | ConsistencyManager без изменений | ✓ |
| Новый метод в ConsistencyManager | process_ner_entities() | |

**User's choice:** ChapterAnalysisResult с пустыми desc/rel

---

## A/B тестирование

| Option | Description | Selected |
|--------|-------------|----------|
| Из production DB | Entities уже извлечены LLM | ✓ |
| Перезапуск LLM | Fresh baseline, стоит ~$7.50 | |

**User's choice:** Из production DB

| Option | Description | Selected |
|--------|-------------|----------|
| Fuzzy как в ConsistencyManager | casefold + SequenceMatcher + token overlap | ✓ |
| Exact name match | casefold() == casefold() | |

**User's choice:** Fuzzy как в ConsistencyManager

| Option | Description | Selected |
|--------|-------------|----------|
| pytest с fixture | test_ner_ab_comparison.py, assert recall >= 0.80 | ✓ |
| Отдельный скрипт | scripts/ab_test_ner.py | |

**User's choice:** pytest с fixture

| Option | Description | Selected |
|--------|-------------|----------|
| Из production DB chapters | Экспорт как fixture, offline тест | ✓ |
| Live DB | Прямой доступ к DB | |

**User's choice:** Из production DB chapters

---

## Claude's Discretion

- Chunk size в токенах
- Количество предложений в overlap
- Структура NERService
- Выбор 5 книг для A/B
- Обработка пустых полей в adapter

## Deferred Ideas

None.

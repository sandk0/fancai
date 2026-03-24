# NER A/B Test Fixtures

Данные экспортированы из production DB скриптом scripts/export_ner_ab_data.py.

## Формат

- {book}\_chapters.json -- текст глав для NER extraction
- {book}\_baseline.json -- LLM baseline entities для сравнения

## Генерация

```bash
cd backend
uv run python scripts/export_ner_ab_data.py --auto-select 5 --output tests/fixtures/ner_ab_data/
```

## Параметры

- `--book-id <UUID>` -- экспорт конкретной книги
- `--auto-select N` -- выбрать N книг с наибольшим количеством entities
- `--min-entities N` -- минимум entities на книгу (по умолчанию 10)
- `--output <path>` -- директория вывода

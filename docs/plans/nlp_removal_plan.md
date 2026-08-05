# План удаления NLP функциональности из BookReader AI

**Дата создания:** 16 декабря 2025
**Версия:** 1.0
**Цель:** Полное удаление NLP системы для оптимизации под сервер 8 ГБ ОЗУ, 4 CPU

---

## Резюме

### Текущее состояние NLP системы

| Категория | Количество | Размер |
|-----------|------------|--------|
| Backend NLP сервисы | ~25 файлов | ~9700 строк |
| NLP роутеры | 4 файла | ~1500 строк |
| Frontend NLP компоненты | 3 файла | ~800 строк |
| Модели БД | 2 таблицы | descriptions, nlp_rollout_config |
| Feature Flags | 5+ флагов | NLP-related |

### Потребление памяти NLP

| Компонент | RAM |
|-----------|-----|
| SpaCy + ru_core_news_lg | ~4 ГБ |
| Natasha | ~1.5 ГБ |
| Stanza | ~2.5 ГБ |
| GLiNER | ~1.5 ГБ |
| **Итого** | **~10-12 ГБ** |

**Проблема:** NLP система требует 10-12 ГБ RAM, что превышает лимит сервера (8 ГБ).

### Ожидаемый результат после удаления

| Метрика | До | После | Экономия |
|---------|------|-------|---------|
| RAM (runtime) | ~7.5 ГБ | ~2.9 ГБ | **-61%** |
| Docker image | ~2.5 ГБ | ~800 МБ | **-68%** |
| Cold start | 27-52 сек | <5 сек | **-90%** |
| Build time | 10-15 мин | 2-3 мин | **-75%** |

---

## Фаза 1: Подготовка

**Приоритет:** КРИТИЧЕСКИЙ
**Оценка времени:** 2-4 часа

### 1.1 Резервное копирование

- [ ] Создать бэкап базы данных PostgreSQL
  ```bash
  docker-compose exec postgres pg_dump -U postgres bookreader > backup_$(date +%Y%m%d).sql
  ```
- [ ] Создать git branch: `feature/remove-nlp-system`
  ```bash
  git checkout -b feature/remove-nlp-system
  ```
- [ ] Сохранить текущую конфигурацию docker-compose

### 1.2 Анализ данных

- [ ] Проверить количество записей в таблице `descriptions`
  ```sql
  SELECT COUNT(*) FROM descriptions;
  ```
- [ ] Определить зависимость generated_images от descriptions
  ```sql
  SELECT COUNT(*) FROM generated_images WHERE description_id IS NOT NULL;
  ```
- [ ] Документировать rollback план

---

## Фаза 2: Backend - Удаление NLP сервисов

**Приоритет:** ВЫСОКИЙ
**Оценка времени:** 6-8 часов

### 2.1 Удаление NLP каталогов (ПОЛНОЕ УДАЛЕНИЕ)

```
backend/app/services/
├── nlp/                          # ~3000 строк - УДАЛИТЬ ВЕСЬ КАТАЛОГ
├── advanced_parser/              # УДАЛИТЬ ВЕСЬ КАТАЛОГ
```

- [ ] `rm -rf backend/app/services/nlp/`
- [ ] `rm -rf backend/app/services/advanced_parser/`

### 2.2 Удаление NLP файлов

| Файл | Строк | Действие |
|------|-------|----------|
| `nlp_processor.py` | 584 | УДАЛИТЬ |
| `enhanced_nlp_system.py` | 579 | УДАЛИТЬ |
| `multi_nlp_manager.py` | 514 | УДАЛИТЬ |
| `natasha_processor.py` | 560 | УДАЛИТЬ |
| `stanza_processor.py` | 500 | УДАЛИТЬ |
| `gliner_processor.py` | 650 | УДАЛИТЬ |
| `deeppavlov_processor.py` | 17 | УДАЛИТЬ |
| `nlp_cache.py` | 334 | УДАЛИТЬ |
| `nlp_canary.py` | 530 | УДАЛИТЬ |
| `optimized_parser.py` | 300 | РЕФАКТОРИНГ |

### 2.3 СОХРАНИТЬ (LangExtract/Gemini)

| Файл | Строк | Назначение |
|------|-------|------------|
| `langextract_processor.py` | 811 | Основной парсер через LLM API |
| `gemini_extractor.py` | 612 | Альтернативный Gemini парсер |

### 2.4 Удаление NLP роутеров

- [ ] Удалить `backend/app/routers/nlp.py` (360 строк)
- [ ] Удалить `backend/app/routers/admin/nlp_settings.py` (491 строка)
- [ ] Удалить `backend/app/routers/admin/nlp_canary.py` (447 строк)
- [ ] Обновить `backend/app/routers/__init__.py`
- [ ] Обновить `backend/app/routers/admin/__init__.py`

### 2.5 Рефакторинг зависимых файлов

| Файл | Изменения |
|------|-----------|
| ~~`backend/app/services/book/book_parsing_service.py`~~ | **Отменено 2026-08-08.** Точкой входа стал `DescriptionExtractionService`, а сервис так и остался без единого вызывающего с `0c110210` — удалён вместе с `book_statistics_service.py` |
| `backend/app/routers/descriptions.py` | Упростить, использовать langextract |
| `backend/app/routers/books/processing.py` | Убрать NLP зависимости |
| `backend/app/core/tasks.py` | Убрать инициализацию multi_nlp_manager |
| `backend/app/main.py` | Убрать импорт Multi-NLP Manager |
| `backend/app/services/settings_manager.py` | Убрать NLP настройки |
| `backend/app/services/feature_flag_manager.py` | Убрать NLP флаги |

### 2.6 Удаление NLP схем

- [ ] Удалить `backend/app/schemas/responses/nlp.py`
- [ ] Упростить `backend/app/schemas/responses/descriptions.py`
- [ ] Обновить `backend/app/schemas/responses/admin.py`

---

## Фаза 3: База данных - Миграции

**Приоритет:** ВЫСОКИЙ
**Оценка времени:** 3-4 часа

### 3.1 Создание миграции

**Файл:** `backend/alembic/versions/2025_12_16_remove_nlp_tables.py`

```python
"""Remove NLP tables and fields

Revision ID: remove_nlp_001
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # 1. Сохранить данные generated_images (денормализация)
    op.add_column('generated_images',
        sa.Column('description_text', sa.Text, nullable=True))
    op.add_column('generated_images',
        sa.Column('description_type', sa.String(50), nullable=True))

    # 2. Копировать данные из descriptions
    op.execute("""
        UPDATE generated_images gi
        SET
            description_text = d.content,
            description_type = d.type
        FROM descriptions d
        WHERE gi.description_id = d.id
    """)

    # 3. Удалить FK constraint
    op.drop_constraint(
        'generated_images_description_id_fkey',
        'generated_images',
        type_='foreignkey'
    )

    # 4. Сделать description_id nullable
    op.alter_column('generated_images', 'description_id', nullable=True)

    # 5. Удалить таблицу descriptions
    op.drop_table('descriptions')

    # 6. Удалить таблицу nlp_rollout_config
    op.drop_table('nlp_rollout_config')

    # 7. Удалить NLP поля из chapters
    op.drop_column('chapters', 'is_description_parsed')
    op.drop_column('chapters', 'descriptions_found')
    op.drop_column('chapters', 'parsing_progress')
    op.drop_column('chapters', 'parsed_at')

    # 8. Удалить NLP поля из books
    op.drop_column('books', 'is_parsed')
    op.drop_column('books', 'parsing_progress')
    op.drop_column('books', 'parsing_error')

    # 9. Удалить ENUM type
    op.execute("DROP TYPE IF EXISTS descriptiontype CASCADE")

def downgrade():
    # Rollback требует восстановления из backup
    pass
```

### 3.2 Удаление моделей

- [ ] Удалить `backend/app/models/description.py`
- [ ] Удалить `backend/app/models/nlp_rollout_config.py`
- [ ] Обновить `backend/app/models/chapter.py` - убрать NLP поля
- [ ] Обновить `backend/app/models/book.py` - убрать NLP поля
- [ ] Обновить `backend/app/models/image.py` - рефакторинг
- [ ] Обновить `backend/app/models/__init__.py` - убрать импорты

### 3.3 Очистка после миграции

```sql
-- VACUUM после удаления больших таблиц
VACUUM FULL ANALYZE;
```

---

## Фаза 4: Dependencies

**Приоритет:** СРЕДНИЙ
**Оценка времени:** 1-2 часа

### 4.1 Обновление requirements.txt

**Удалить:**
```
spacy==3.7.2
nltk==3.9
stanza==1.7.0
natasha==1.6.0
pymorphy3==1.2.1
gliner>=0.2.0
```

**Сохранить:**
```
langextract==0.1.0
google-genai>=1.0.0
beautifulsoup4==4.12.2
```

### 4.2 Обновление Dockerfile

- [ ] Переименовать `backend/Dockerfile` → `backend/Dockerfile.full` (backup)
- [ ] Переименовать `backend/Dockerfile.lite` → `backend/Dockerfile`
- [ ] Удалить загрузку NLP моделей из Dockerfile

---

## Фаза 5: Frontend - Рефакторинг

**Приоритет:** СРЕДНИЙ
**Оценка времени:** 4-6 часов

### 5.1 Удаление NLP Admin компонентов

- [ ] Удалить `frontend/src/components/Admin/AdminMultiNLPSettings.tsx` (426 строк)

### 5.2 Рефакторинг Admin Dashboard

| Файл | Изменения |
|------|-----------|
| `AdminDashboardEnhanced.tsx` | Убрать NLP tab |
| `AdminTabNavigation.tsx` | Убрать NLP вкладку |
| `AdminStats.tsx` | Убрать NLP статистику |

### 5.3 Обновление API

- [ ] Обновить `frontend/src/api/admin.ts` - убрать NLP API
- [ ] Обновить `frontend/src/types/api.ts` - убрать NLP типы

### 5.4 Обновление хуков

| Хук | Действие |
|-----|----------|
| `useDescriptions.ts` | Упростить, убрать NLP-специфичную логику |
| `useChapter.ts` | Убрать NLP метаданные |

---

## Фаза 6: Docker - Переход на Lite

**Приоритет:** ВЫСОКИЙ
**Оценка времени:** 1-2 часа

### 6.1 Обновление docker-compose

- [ ] Переименовать `docker-compose.yml` → `docker-compose.full.yml`
- [ ] Переименовать `docker-compose.lite.yml` → `docker-compose.yml`

### 6.2 Обновление лимитов памяти

```yaml
# Новые лимиты после удаления NLP
backend:
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 1G      # Было 4G
      reservations:
        memory: 384M    # Было 1G

celery-worker:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M    # Было 2G
      reservations:
        memory: 256M
```

### 6.3 Обновление переменных окружения

```yaml
environment:
  - USE_LANGEXTRACT_PRIMARY=true
  # Удалить:
  # - USE_NLP_PROCESSORS=false
  # - USE_NEW_NLP_ARCHITECTURE=false
```

---

## Фаза 7: Тестирование

**Приоритет:** КРИТИЧЕСКИЙ
**Оценка времени:** 4-6 часов

### 7.1 Unit тесты

- [ ] Удалить NLP тесты из `backend/tests/`
- [x] ~~Обновить тесты для book_parsing_service~~ — сервис удалён 2026-08-08, тесты удалены вместе с ним
- [ ] Запустить: `pytest -v --cov=app`

### 7.2 Integration тесты

- [ ] Тест загрузки книги
- [ ] Тест парсинга через LangExtract
- [ ] Тест генерации изображений
- [ ] Тест API endpoints

### 7.3 Performance тесты

- [ ] Проверить memory usage: `docker stats`
- [ ] Цель: < 4 ГБ total runtime
- [ ] Проверить время старта: < 30 сек

---

## Фаза 8: Документация

**Приоритет:** СРЕДНИЙ
**Оценка времени:** 2-3 часа

### 8.1 Обновить CLAUDE.md

- [ ] Убрать NLP System секцию
- [ ] Обновить Technology Stack
- [ ] Обновить Key Files

### 8.2 Обновить docs/

- [ ] Удалить `docs/explanations/architecture/nlp/`
- [ ] Создать `docs/guides/langextract-setup.md`
- [ ] Обновить architecture diagrams

---

## Порядок выполнения

| День | Фазы | Время |
|------|------|-------|
| 1 | Подготовка + Docker | 3-6 ч |
| 2 | Backend NLP сервисы | 6-8 ч |
| 3 | База данных + Dependencies | 4-6 ч |
| 4 | Frontend | 4-6 ч |
| 5 | Тестирование + Документация | 6-9 ч |

**Общее время:** 23-35 часов (4-5 рабочих дней)

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Потеря данных descriptions | Высокая | Бэкап БД + денормализация в generated_images |
| Breaking changes API | Средняя | Версионирование, deprecation warnings |
| Frontend crashes | Средняя | Feature flags, тестирование |
| Rollback сложности | Низкая | Git branch, DB backup |

---

## Чеклист для Production Deployment

- [ ] Все тесты проходят
- [ ] Memory usage < 4 ГБ
- [ ] API endpoints работают
- [ ] Frontend без ошибок
- [ ] Документация обновлена
- [ ] Rollback план готов
- [ ] Мониторинг настроен

---

## Контакты

**Ответственный:** DevOps Team
**Статус:** Готов к выполнению

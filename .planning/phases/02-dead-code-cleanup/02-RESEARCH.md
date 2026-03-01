# Фаза 2: Очистка мертвого кода — Исследование

**Дата исследования:** 2026-03-01
**Домен:** Рефакторинг — удаление NLP-артефактов, очистка dead code
**Уверенность:** HIGH

<user_constraints>
## Пользовательские ограничения (из CONTEXT.md)

### Заблокированные решения
- **Глубокая зачистка** — удалить ВСЕ NLP-артефакты во всей кодовой базе (~18 файлов, ~1400+ строк мертвого кода), а не только 5 пунктов из CLEAN-01..05
- Включает: тестовые файлы, конфиги, скрипты, ссылки в сервисах, схемы, закомментированные импорты
- Удалить ВСЕ осиротевшие тестовые файлы из корня backend/ (не только NLP-тесты, все test_*.py)
- **Не удалять миграции** — файлы 2025_11_23_add_nlp_rollout_config.py, 2025_12_16_remove_nlp_system.py остаются навсегда
- Удалить NLP-специфичные поля из схем ответов админ-панели (nlp_mode и т.д.)
- Sync endpoint (CLEAN-04): возвращать 501 Not Implemented вместо тихого отбрасывания данных
- celery_config.py (CLEAN-03): удалить, убедиться что ничто не импортирует

### На усмотрение Claude
- Подход к скриптам в backend/scripts/ (удалить явно мертвые: nlp_rollback.py, benchmark_nlp_refactoring.py; оставить неоднозначные)
- Глубина починки фронтенда при удалении NLPAnalysisResult из API-ответов
- Сложность починки админ-UI при удалении NLP-настроек из settings_manager.py
- Стратегия верификации: как убедиться что ничего не сломалось после удаления
- Порядок удаления (что удалять первым)

### Отложенные идеи (ВНЕ СКОУПА)
Нет отложенных идей — обсуждение оставалось в рамках скоупа фазы
</user_constraints>

<phase_requirements>
## Требования фазы

| ID | Описание | Поддержка исследованием |
|----|----------|------------------------|
| CLEAN-01 | Удалить 14 NLP тестовых файлов из корня бэкенда | Найдено 14 test_*.py файлов в корне backend/; ни один не импортируется из backend/tests/ |
| CLEAN-02 | Удалить NLP-поля конфигурации из config.py и settings_manager.py | config.py уже чист (CLEAN-01 ранее выполнен командой); settings_manager.py содержит 5 NLP-секций (nlp_global, nlp_spacy, nlp_natasha, nlp_stanza, nlp_gliner) + get_processor_config(); тест test_config_security.py проверяет отсутствие validate_nlp_weights в config.py |
| CLEAN-03 | Удалить мертвый celery_config.py | Файл существует, ничто его не импортирует (grep подтверждён); celery_app.py — живая конфигурация |
| CLEAN-04 | Исправить TODO-заглушки в sync.py | Найдены 3 TODO на строках 298, 303, 308 — тихо отбрасывают bookmark/highlight/session sync |
| CLEAN-05 | Удалить NLP-схемы из ответов админ-панели | ParsingSettingsResponse содержит nlp_mode + enabled_processors; admin.py содержит 4 NLP schema-класса (MultiNLPSettingsUpdateResponse, NLPProcessorStatusResponse, NLPProcessorTestResponse, NLPProcessorInfoResponse) |
</phase_requirements>

## Резюме

NLP-система была удалена из проекта в декабре 2025, но очистка оказалась неполной. В кодовой базе остались ~18 файлов и ~1400+ строк мертвого кода: тестовые файлы в корне backend/, NLP-секции в settings_manager.py, мертвый celery_config.py, TODO-заглушки в sync.py, NLP-схемы в admin.py, и закомментированные импорты в роутерах.

**Критическая находка:** `NLPAnalysisResult` — это НЕ чисто мертвый код. Бэкенд использует его как обёртку-конверт (`nlp_analysis`) в API-ответах для описаний, а фронтенд активно читает `response.nlp_analysis.descriptions` в 8+ местах (useDescriptions.ts, useChapterData.ts, useChapterPrefetch.ts, descriptions.ts, books.ts). Удаление `NLPAnalysisResult`-класса требует одновременного рефакторинга обоих слоёв. **Рекомендуется:** переименовать поле `nlp_analysis` в `analysis` или `result` в Python-схемах, синхронно обновив фронтенд. Альтернативный подход (оставить структуру, убрать только NLP-упоминания из доков) проще и безопаснее.

`celery_config.py` полностью безопасен к удалению — ни один файл в проекте его не импортирует. Тестовые файлы в корне backend/ также безопасны: pytest.ini указывает `testpaths = tests`, поэтому они не запускаются pytest и не могут быть импортированы из tests/.

**Первичная рекомендация:** Выполнять очистку в порядке от безопасного к рискованному — начиная с файлов без зависимостей (celery_config.py, тесты в корне, скрипты), затем конфиги (settings_manager.py NLP-секции), затем схемы с API-влиянием (NLPAnalysisResult + фронтенд синхронно).

## Стандартный стек

### Основные инструменты (уже в проекте)

| Инструмент | Версия | Назначение | Обоснование |
|------------|--------|-----------|-------------|
| pytest | см. requirements.txt | Верификация после удаления | Уже настроен; pytest.ini с coverage |
| FastAPI | текущая | HTTP 501 ответы | `raise HTTPException(status_code=501, ...)` |
| Pydantic v2 | текущая | Схемы ответов | Уже используется везде |
| grep/ast | stdlib | Поиск мертвых импортов | Быстрее чем внешние инструменты |

### Не нужна установка

Эта фаза не требует установки новых библиотек — только удаление кода и рефакторинг существующего.

## Архитектурные паттерны

### Паттерн 1: Порядок удаления (от безопасного к рискованному)

**Что:** Удалять в порядке возрастания риска
**Когда использовать:** При рефакторинге с зависимостями между файлами

```
Волна 1 (безопасное, нет импортов):
├── backend/celery_config.py           # ничто не импортирует
├── backend/test_*.py (14 файлов)      # не в testpaths
├── backend/scripts/nlp_rollback.py    # 471 строк
└── backend/scripts/benchmark_nlp_refactoring.py  # 176 строк

Волна 2 (конфиги, локальное влияние):
├── settings_manager.py: 5 NLP-секций + get_processor_config()
├── books_validation.py: поле nlp_available (schema)
└── books/validation.py: nlp_available=True (router)

Волна 3 (схемы + API + фронтенд, синхронно):
├── backend: NLPAnalysisResult → DescriptionsResult (rename)
├── backend: admin.py NLP-классы (4 класса)
├── backend: books/processing.py закомментированный import
└── frontend: useDescriptions.ts, useChapterData.ts, etc.

Волна 4 (misc + sync.py):
├── feature_flag_manager.py: docstring NLP references
├── book_parsing_service.py: комментарий про NLP
└── sync.py: 3 TODO → 501 Not Implemented
```

### Паттерн 2: HTTP 501 для нереализованных endpoint'ов

**Что:** Явный 501 вместо тихого сбоя
**Когда использовать:** Для sync.py bookmarks/highlights TODO-заглушек

```python
# Source: FastAPI docs — стандартный паттерн для "not implemented"
from fastapi import HTTPException

# В sync.py — заменить каждый TODO-блок:
elif "/bookmarks" in endpoint:
    raise HTTPException(
        status_code=501,
        detail="Bookmark sync not implemented. Feature planned for Phase 8."
    )

elif "/highlights" in endpoint:
    raise HTTPException(
        status_code=501,
        detail="Highlight sync not implemented. Feature planned for Phase 8."
    )

elif "/reading-sessions" in endpoint:
    raise HTTPException(
        status_code=501,
        detail="Reading session sync not implemented."
    )
```

**Примечание:** Текущий код уже корректно обрабатывает ошибки в цикле (`failed += 1, errors.append(...)`). Тихого отбрасывания нет — данные учитываются в `failed`. Требование CLEAN-04 в контексте требует именно HTTP 501, а не просто подсчёта как failed. Нужно решить: менять сигнатуру возврата или добавить 501 как internal_error в errors-список.

### Паттерн 3: Переименование NLPAnalysisResult (рекомендуемый подход)

**Что:** Переименовать класс и поле, сохранив структуру данных
**Когда использовать:** Для удаления "NLP" из названий без изменения API-контракта

```python
# backend/app/schemas/responses/descriptions.py
# БЫЛО:
class NLPAnalysisResult(BaseModel):
    total_descriptions: int
    by_type: Dict[str, int]
    descriptions: List[DescriptionResponse]
    processing_time_seconds: Optional[float]

class ChapterDescriptionsResponse(BaseModel):
    chapter_info: ChapterMinimalInfo
    nlp_analysis: NLPAnalysisResult  # ← это поле видит фронтенд

# БУДЕТ (вариант А — сохранить имя поля, только переименовать класс):
class DescriptionsAnalysis(BaseModel):  # имя класса Python, фронтенд не видит
    total_descriptions: int
    by_type: Dict[str, int]
    descriptions: List[DescriptionResponse]
    processing_time_seconds: Optional[float]

class ChapterDescriptionsResponse(BaseModel):
    chapter_info: ChapterMinimalInfo
    nlp_analysis: DescriptionsAnalysis  # имя поля сохранено — фронтенд не ломается
```

**Вариант А (РЕКОМЕНДУЕТСЯ):** Переименовать только Python-класс `NLPAnalysisResult` → `DescriptionsAnalysis`, имя JSON-поля `nlp_analysis` сохранить. Фронтенд не требует изменений. Риск: LOW.

**Вариант Б:** Переименовать и класс, и поле (`nlp_analysis` → `descriptions_result`). Требует обновления фронтенда в ~8 местах. Риск: MEDIUM.

**Вывод:** Вариант А проще, выполняет задачу (убирает NLP из Python-имён), не ломает фронтенд.

### Антипаттерны

- **Удалять NLPAnalysisResult без обновления фронтенда** — фронтенд читает `response.nlp_analysis.descriptions` в 8+ местах
- **Удалять settings_manager NLP-секции без поиска вызовов** — функция `get_processor_config()` теоретически может вызываться (но grep не нашёл вызовов вне мертвых тест-файлов)
- **Изменять sync.py без понимания текущего поведения** — текущий код уже добавляет в errors[], смена на raise HTTPException изменит HTTP-поведение endpoint'а

## Не реализовывать самостоятельно

| Проблема | Не строить | Использовать | Почему |
|----------|-----------|-------------|--------|
| Поиск мертвых импортов | Кастомный парсер AST | grep + ручная верификация | Простая задача, grep достаточен |
| Верификация после удаления | Кастомный тест-раннер | pytest (уже настроен) | pytest.ini уже есть, покрытие 70%+ |
| Поиск NLP-референций | Кастомный скрипт | grep -rn "nlp\|NLP" | Встроенный инструмент ОС |

**Ключевой принцип:** Это задача удаления, не разработки. Каждый новый инструмент добавляет риск.

## Типичные ошибки

### Ошибка 1: Нарушение фронтенд-контракта при удалении NLPAnalysisResult

**Что ломается:** Приложение падает на клиенте — `response.nlp_analysis.descriptions` возвращает undefined
**Почему происходит:** Разработчик удаляет Python-класс/поле, не проверяя фронтенд
**Как избежать:** Вариант А (переименовать класс, сохранить имя поля) или полная синхронизация бэкенд+фронтенд в одном коммите
**Признаки:** TypeScript компилируется нормально, но runtime ошибки при загрузке описаний

### Ошибка 2: Удаление settings_manager NLP-секций при наличии вызовов в Redis

**Что ломается:** Кэшированные NLP-настройки в Redis могут влиять на поведение при перезапуске (стартап вытаскивает данные из Redis)
**Почему происходит:** settings_manager при старте читает из Redis, если есть ключи `settings:nlp_*` — они загрузятся
**Как избежать:** После удаления NLP-секций из кода выполнить `redis-cli DEL settings:nlp_global settings:nlp_spacy settings:nlp_natasha settings:nlp_stanza settings:nlp_gliner` на сервере
**Признаки:** После рестарта приложения в логах появляются nlp-настройки из Redis

### Ошибка 3: Нарушение цепочки миграций

**Что ломается:** Свежая установка (docker compose up на новом сервере) не может запустить миграции
**Почему происходит:** Удаление файлов миграций нарушает alembic revision chain
**Как избежать:** **Никогда не удалять файлы миграций** — только код приложения (CONTEXT.md заблокировано)
**Признаки:** `alembic upgrade head` завершается с ошибкой "Can't locate revision"

### Ошибка 4: sync.py — 501 vs тихий сбой (несоответствие требованию)

**Что ломается:** CLEAN-04 требует "возвращать 501", но текущий код уже "не теряет данные" (добавляет в errors[])
**Почему происходит:** Недопонимание требования — тихое отбрасывание vs явный HTTP-ответ
**Как избежать:** HTTP 501 должен возвращаться клиенту в поле `errors[]` batch-ответа, а не как HTTP-исключение (иначе весь batch упадёт)
**Признаки:** При 501 как HTTPException — клиент получает 501 на весь batch-запрос, не только на bookmark-операцию

### Ошибка 5: Пропуск `__all__` при удалении NLP-классов из admin.py

**Что ломается:** Остаточные строки в `__all__` вызывают ImportError или NameError при импорте
**Почему происходит:** Разработчик удаляет класс, забывает удалить из `__all__` и из __init__.py
**Как избежать:** Grep на всё дерево `__all__` и `__init__.py` после каждого удаления

## Примеры кода

### Текущее состояние sync.py TODO-заглушек

```python
# Source: backend/app/routers/sync.py строки 297-314 (текущий код)
elif "/bookmarks" in endpoint:
    # TODO: Implement bookmark sync
    failed += 1
    errors.append("Bookmark sync not yet implemented")

elif "/highlights" in endpoint:
    # TODO: Implement highlight sync
    failed += 1
    errors.append("Highlight sync not yet implemented")

elif "/reading-sessions" in endpoint:
    # TODO: Implement reading session sync
    failed += 1
    errors.append("Reading session sync not yet implemented")
```

### Правильная замена: сохранить batch-семантику, добавить явное сообщение

```python
# После исправления CLEAN-04: явные сообщения о 501, но не HTTPException
# (HTTPException на уровне batch сломает всю обработку)
elif "/bookmarks" in endpoint:
    # NOT IMPLEMENTED (Phase 8: READ-01) — возвращаем 501-семантику через errors
    failed += 1
    errors.append("501: Bookmark sync not implemented (planned Phase 8)")

elif "/highlights" in endpoint:
    failed += 1
    errors.append("501: Highlight sync not implemented (planned Phase 8)")

elif "/reading-sessions" in endpoint:
    failed += 1
    errors.append("501: Reading session sync not implemented")
```

**Альтернатива (если требование подразумевает HTTP 501):** Создать отдельные GET-endpoint'ы `/sync/bookmarks` и `/sync/highlights`, возвращающие 501. Текущий batch-endpoint оставить как есть.

### Удаление NLP-секций из settings_manager.py

```python
# Удалить строки 100-165 (5 секций):
# self._settings["nlp_global"] = {...}  ← удалить
# self._settings["nlp_spacy"] = {...}   ← удалить
# self._settings["nlp_natasha"] = {...} ← удалить
# self._settings["nlp_stanza"] = {...}  ← удалить
# self._settings["nlp_gliner"] = {...}  ← удалить

# Удалить метод get_processor_config() (строка 357-368):
# async def get_processor_config(self, processor_name: str) -> Dict[str, Any]:
#     category = f"nlp_{processor_name}"
#     return await self.get_category_settings(category)
```

### Переименование NLPAnalysisResult (Вариант А — минимальный риск)

```python
# descriptions.py: переименовать класс, сохранить имя поля
# БЫЛО:
class NLPAnalysisResult(BaseModel):
    ...

class ChapterDescriptionsResponse(BaseModel):
    nlp_analysis: NLPAnalysisResult  # имя поля остаётся!

# СТАЛО:
class DescriptionsAnalysis(BaseModel):  # новое имя Python-класса
    ...

class ChapterDescriptionsResponse(BaseModel):
    nlp_analysis: DescriptionsAnalysis  # JSON-поле НЕ МЕНЯЕТСЯ → фронтенд не ломается
```

### Проверка отсутствия импортов celery_config.py

```bash
# Подтверждено: нет импортов celery_config нигде в проекте
grep -rn "celery_config" backend --include="*.py" | grep -v ".venv"
# Вывод: пусто → безопасно удалять
```

## Состояние дел

| Старый подход | Текущий подход | Когда изменилось | Влияние |
|--------------|---------------|-----------------|---------|
| Multi-NLP (spacy/natasha/stanza/gliner) | Только Gemini 3.0 Flash | Декабрь 2025 | NLP-артефакты — мертвый код |
| NLPAnalysisResult как обёртка AI-результатов | NLPAnalysisResult как обёртка Gemini-описаний | Декабрь 2025 | Класс жив, но имя вводит в заблуждение |
| celery_config.py как основная конфигурация | celery_app.py как единственная конфигурация | Реструктуризация | celery_config.py = мертвый файл |
| settings_manager.py с 5 NLP-категориями | Только parsing/image_generation/advanced_parser/system | Декабрь 2025 | nlp_* категории никогда не читаются |

**Устаревшее:**
- `test_nlp_processors.py` / `test_gliner_integration.py` — тестируют удалённые библиотеки
- `scripts/nlp_rollback.py` — rollback для системы, которой нет
- `scripts/benchmark_nlp_refactoring.py` — бенчмарки для удалённого кода
- `NLPProcessorStatus`, `NLPProcessorStatusResponse` и другие NLP-классы в admin.py — endpoint'ов для них нет

## Открытые вопросы

1. **Требование CLEAN-04: "возвращать 501" — уровень HTTP или в тексте errors[]?**
   - Что знаем: текущий sync.py уже добавляет в `errors[]` как failed, endpoint возвращает 200 с counts
   - Что неясно: требует ли CLEAN-04 HTTP 501 (сломает batch) или достаточно явного "501: ..." в тексте ошибки
   - Рекомендация: при планировании уточнить — вероятно достаточно явного сообщения в errors[]

2. **NLPAnalysisResult в описаниях: переименовать или оставить как есть?**
   - Что знаем: класс активно используется бэкендом и фронтендом; Вариант А (только переименовать Python-класс) безопасен
   - Что неясно: является ли переименование Python-класса (невидимое для API) достаточным для требований
   - Рекомендация: Вариант А (переименовать NLPAnalysisResult → DescriptionsAnalysis, сохранить поле nlp_analysis)

3. **AdminMultiNLPSettings в фронтенде: удалить компонент?**
   - Что знаем: `AdminMultiNLPSettings.tsx` помечен как DEPRECATED, `admin.ts` использует mock data
   - Что неясно: используется ли компонент в AdminDashboardEnhanced.tsx (да — используется на строках 142, 261)
   - Рекомендация: На усмотрение Claude — если просто, удалить компонент и его упоминания из AdminDashboardEnhanced; если сложно — пропустить

## Архитектура верификации

### Тестовый фреймворк

| Параметр | Значение |
|----------|---------|
| Фреймворк | pytest с asyncio-mode=auto |
| Конфиг-файл | `backend/pytest.ini` (существует) |
| Быстрый запуск | `cd backend && pytest tests/test_config_security.py -v -x` |
| Полный набор | `cd backend && pytest -v --tb=short` |

### Карта требований → тестов

| ID | Поведение | Тип теста | Команда | Файл существует? |
|----|-----------|-----------|---------|-----------------|
| CLEAN-01 | Нет test_*.py в корне backend/ | smoke | `ls backend/test_*.py 2>/dev/null \| wc -l` (должно быть 0) | ❌ Волна 0 |
| CLEAN-02 | NLP-полей нет в Settings | unit | `cd backend && pytest tests/test_config_security.py::TestNLPValidatorRemoved -v` | ✅ существует |
| CLEAN-02 | NLP-секций нет в settings_manager | unit | `cd backend && pytest tests/test_cleanup_settings.py -v -x` | ❌ Волна 0 |
| CLEAN-03 | celery_config.py не существует | smoke | `ls backend/app/core/celery_config.py 2>/dev/null && echo EXISTS \|\| echo DELETED` | ❌ Волна 0 |
| CLEAN-04 | sync.py возвращает явное 501-сообщение для bookmark/highlight | unit | `cd backend && pytest tests/routers/test_sync.py -v -x` | ❌ Волна 0 |
| CLEAN-05 | Нет NLP-полей в admin-схемах | unit | `cd backend && pytest tests/test_cleanup_admin_schemas.py -v -x` | ❌ Волна 0 |

### Частота запусков

- **После каждого удаления файла:** `cd backend && pytest tests/test_config_security.py -v -x` (быстрая проверка config)
- **После каждой волны:** `cd backend && pytest -v --tb=short` (полный набор)
- **Gate фазы:** Полный набор зелёный перед `/gsd:verify-work`

### Пробелы Волны 0

- [ ] `backend/tests/test_cleanup_settings.py` — проверяет отсутствие NLP-секций в settings_manager (CLEAN-02)
- [ ] `backend/tests/routers/test_sync.py` — проверяет CLEAN-04 behaviour (CLEAN-04)
- [ ] `backend/tests/test_cleanup_admin_schemas.py` — проверяет отсутствие NLP-классов в admin.py (CLEAN-05)
- [ ] Smoke: bash-команды для проверки отсутствия файлов (CLEAN-01, CLEAN-03)

## Источники

### Первичные (HIGH уверенность)
- Прямой анализ кода: `backend/app/core/config.py` — NLP-поля подтверждены
- Прямой анализ кода: `backend/app/services/settings_manager.py` строки 100-165 — 5 NLP-секций
- Прямой анализ кода: `backend/app/core/celery_config.py` — существует, ничто не импортирует
- Прямой анализ кода: `backend/app/routers/sync.py` строки 297-314 — 3 TODO
- Прямой анализ кода: `backend/app/schemas/responses/admin.py` — 4 NLP-класса
- Прямой анализ кода: `frontend/src/hooks/api/useDescriptions.ts` — 8+ мест использования nlp_analysis
- grep-проверка: `grep -rn "celery_config"` — нет импортов → безопасно удалять
- `backend/pytest.ini` — `testpaths = tests` подтверждает: test_*.py в корне не запускаются

### Вторичные (MEDIUM уверенность)
- CONTEXT.md: список NLP-артефактов и интеграционных точек (подтверждён прямым анализом)

## Метаданные

**Разбивка уверенности:**
- Список файлов для удаления: HIGH — прямой анализ кода + grep-верификация
- Порядок удаления: HIGH — основан на реальных зависимостях импортов
- Влияние на фронтенд: HIGH — подтверждено grep по frontend/src
- Поведение sync.py: MEDIUM — требование CLEAN-04 неоднозначно (см. Открытые вопросы)

**Дата исследования:** 2026-03-01
**Действительно до:** 2026-04-01 (стабильная кодовая база, изменения редки)

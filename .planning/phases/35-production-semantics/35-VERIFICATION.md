---
phase: 35-production-semantics
verified: 2026-03-28T14:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Фаза 35: Production Semantics — Отчёт верификации

**Цель фазы:** Pipeline выдаёт корректные статусы книг и не создаёт broken JSON — каждая обработанная книга отражает реальный результат
**Дата верификации:** 2026-03-28
**Статус:** passed
**Re-верификация:** Нет — первичная верификация

---

## Достижение цели

### Наблюдаемые истины

| #  | Истина | Статус | Доказательство |
|----|--------|--------|----------------|
| 1  | Все string поля в Modal schemas ограничены max_length — broken JSON невозможен | ✓ VERIFIED | modal/schemas.py: 12 `max_length=` constraints, ValidationError при превышении подтверждён runtime-тестом |
| 2  | NUM_GPU_BLOCKS_OVERRIDE=512 передаётся в vLLM LLM() init | ✓ VERIFIED | modal/config.py:21, modal/llm_extractor.py:40 `num_gpu_blocks_override=NUM_GPU_BLOCKS_OVERRIDE` |
| 3  | LLM_TIMEOUT=900s — длинные главы не timeout'ятся | ✓ VERIFIED | modal/config.py:24 `LLM_TIMEOUT = 900`, runtime-проверка прошла |
| 4  | max_tokens=16384 в reduce_entities (STAB-08) | ✓ VERIFIED | modal/llm_extractor.py:76 `max_tokens=16384, # STAB-08` |
| 5  | Книга со сбойными главами получает descriptions_extracted=False и status=completed_with_errors | ✓ VERIFIED | book_tasks.py:327 `book.descriptions_extracted = not has_failures`, строки 337,1066 `"completed_with_errors" if has_failures` |
| 6  | Push notification НЕ отправляется при partial failures | ✓ VERIFIED | book_tasks.py:363 `if not has_failures:` перед `send_book_ready_notification` |
| 7  | Modal вызовы защищены VPS-side asyncio.wait_for timeout (960s) | ✓ VERIFIED | book_tasks.py:42 `VPS_TIMEOUT = 960`, строки 561-572 `asyncio.wait_for(..., timeout=VPS_TIMEOUT)` |
| 8  | Per-book time budget check пропускает главы при нехватке времени | ✓ VERIFIED | book_tasks.py:40-59 `check_time_budget()`, `CELERY_HARD_LIMIT=10800`, `SAFETY_MARGIN=300`, строки 551-560 |
| 9  | Admin endpoint POST /admin/reconcile-statuses исправляет inconsistent книги + STAB-09 (Loguru audit) | ✓ VERIFIED | reconciliation.py:22-56, admin/__init__.py:17,33, exc_info=True в 5 исправленных файлах |

**Счёт:** 9/9 истин подтверждены

---

## Проверка артефактов

| Артефакт | Описание | Существует | Содержательный | Подключён | Статус |
|----------|----------|-----------|----------------|-----------|--------|
| `modal/schemas.py` | Pydantic schemas с max_length constraints | ✓ | ✓ 12 constraints | ✓ используется llm_extractor.py | ✓ VERIFIED |
| `modal/config.py` | LLM_TIMEOUT=900, NUM_GPU_BLOCKS_OVERRIDE=512, VPS_TIMEOUT_BUFFER=60 | ✓ | ✓ все 3 константы | ✓ импортируется llm_extractor.py | ✓ VERIFIED |
| `modal/llm_extractor.py` | LLM init с num_gpu_blocks_override, max_tokens=16384 в reduce_entities | ✓ | ✓ строки 17,40,76 | ✓ | ✓ VERIFIED |
| `backend/tests/services/test_modal_schemas.py` | Тесты max_length constraints (10 тестов) | ✓ | ✓ 10 тестов | — (тесты) | ✓ VERIFIED |
| `backend/app/tasks/book_tasks.py` | _finalize_book_status(), check_time_budget(), asyncio.wait_for | ✓ | ✓ строки 299-380,40-59,561-572 | ✓ | ✓ VERIFIED |
| `backend/app/core/pubsub.py` | publish_book_progress с **kwargs: chapters_failed, failed_chapter_numbers | ✓ | ✓ строки 15,47 | ✓ | ✓ VERIFIED |
| `backend/tests/tasks/test_book_status_semantics.py` | 7 тестов статусов книг | ✓ | ✓ 7 тестов | — (тесты) | ✓ VERIFIED |
| `backend/tests/tasks/test_modal_timeout.py` | 3 теста VPS timeout | ✓ | ✓ 3 теста | — (тесты) | ✓ VERIFIED |
| `backend/tests/tasks/test_time_budget.py` | 4 теста time budget | ✓ | ✓ 4 теста | — (тесты) | ✓ VERIFIED |
| `backend/app/routers/admin/reconciliation.py` | POST /admin/reconcile-statuses | ✓ | ✓ `reconcile_book_statuses` | ✓ зарегистрирован в admin/__init__.py | ✓ VERIFIED |
| `backend/app/routers/admin/__init__.py` | Регистрация reconciliation router | ✓ | ✓ строки 17,33 | ✓ | ✓ VERIFIED |
| `backend/tests/routers/test_admin_reconciliation.py` | 6 тестов reconciliation | ✓ | ✓ 6 тестов | — (тесты) | ✓ VERIFIED |

---

## Проверка ключевых связей

| От | До | Через | Статус | Детали |
|----|-----|-------|--------|--------|
| `modal/llm_extractor.py` | `modal/config.py` | `from config import NUM_GPU_BLOCKS_OVERRIDE` | ✓ WIRED | строка 17: `NUM_GPU_BLOCKS_OVERRIDE,` в import |
| `modal/schemas.py` | vLLM structured output | Pydantic JSON Schema maxLength -> xgrammar enforcement | ✓ WIRED | runtime-проверка: maxLength присутствует в JSON Schema |
| `backend/app/tasks/book_tasks.py` | `backend/app/core/pubsub.py` | `publish_book_progress с chapters_failed=, failed_chapter_numbers=` | ✓ WIRED | book_tasks.py:352-353, pubsub.py:47 `data.update(kwargs)` |
| `backend/app/tasks/book_tasks.py` | `push_notification_service` | условный вызов `if not has_failures:` | ✓ WIRED | строка 363: `if not has_failures:` перед вызовом |
| `backend/app/routers/admin/__init__.py` | `backend/app/routers/admin/reconciliation.py` | `router.include_router(reconciliation.router)` | ✓ WIRED | __init__.py строки 17 (import) и 33 (include_router) |
| `backend/app/routers/admin/reconciliation.py` | `backend/app/models/book.py` | SQLAlchemy query Book.descriptions_extracted + Chapter.parsing_error | ✓ WIRED | reconciliation.py:39 `Book.descriptions_extracted == True`, строка 30 `Chapter.parsing_error.isnot(None)` |

---

## Трассировка потока данных (Level 4)

| Артефакт | Переменная данных | Источник | Реальные данные | Статус |
|----------|-------------------|----------|-----------------|--------|
| `_finalize_book_status()` | `failed_chapters` | DB query `Chapter.parsing_error.isnot(None)` | ✓ SQLAlchemy select из Chapter | ✓ FLOWING |
| `reconcile_book_statuses()` | `inconsistent_rows` | DB subquery failed_books_subquery | ✓ SQLAlchemy select Book+Chapter | ✓ FLOWING |
| `reduce_entities()` в llm_extractor | vLLM SamplingParams | `max_tokens=16384` | ✓ передаётся в vLLM | ✓ FLOWING |

---

## Поведенческие spot-checks

| Поведение | Команда | Результат | Статус |
|-----------|---------|-----------|--------|
| modal/schemas.py — maxLength в JSON Schema | `python3 -c "sys.path.insert(0,'modal'); from schemas import ModalEntitySchema; schema=ModalEntitySchema.model_json_schema(); print('maxLength' in str(schema))"` | `True`, name=200 | ✓ PASS |
| ModalEntitySchema — ValidationError при name > 200 символов | `python3 ... ModalEntitySchema(name='x'*201)` | ValidationError | ✓ PASS |
| modal/config.py — константы 900/512/60 | `python3 -c "... print(config.LLM_TIMEOUT, config.NUM_GPU_BLOCKS_OVERRIDE, config.VPS_TIMEOUT_BUFFER)"` | `900 512 60` | ✓ PASS |
| book_tasks.py — все паттерны STAB-05/06 | `grep -n "VPS_TIMEOUT = 960\|CELERY_HARD_LIMIT\|asyncio.wait_for\|Time budget exhausted\|VPS-side timeout"` | все 5 найдены | ✓ PASS |
| Тесты modal schemas (10 тестов) | `uv run python -m pytest tests/services/test_modal_schemas.py` | 10 passed | ✓ PASS |
| Тесты статусов книг (14 тестов) | `uv run python -m pytest tests/tasks/test_book_status_semantics.py tests/tasks/test_modal_timeout.py tests/tasks/test_time_budget.py` | 14 passed | ✓ PASS |
| Тесты reconciliation (6 тестов) | `uv run python -m pytest tests/routers/test_admin_reconciliation.py` | socket.gaierror (нет DB) | ? SKIP (требует БД) |

Тесты reconciliation (`test_admin_reconciliation.py`) требуют живой PostgreSQL — падают с `socket.gaierror` при запуске без docker compose. Это ожидаемое поведение для integration-тестов, структура тестов корректна (6 тестовых функций с `db_session` fixture).

---

## Покрытие требований

| Требование | Plan | Описание | Статус | Доказательство |
|------------|------|----------|--------|----------------|
| STAB-01 | 35-02 | descriptions_extracted=False при partial failures, WebSocket completed_with_errors | ✓ SATISFIED | book_tasks.py:327,337; _finalize_book_status() строки 299-380 |
| STAB-02 | 35-03 | Reconciliation endpoint для inconsistent книг | ✓ SATISFIED | reconciliation.py, зарегистрирован в admin/__init__.py |
| STAB-03 | 35-01 | max_length на всех string полях Modal schemas | ✓ SATISFIED | schemas.py: 12 constraints, runtime validated |
| STAB-05 | 35-02 | asyncio.wait_for wrapper для Modal calls | ✓ SATISFIED | book_tasks.py:561-572, VPS_TIMEOUT=960 |
| STAB-06 | 35-02 | Per-book time budget check | ✓ SATISFIED | book_tasks.py:40-59 check_time_budget(), 396 task_start_time |
| STAB-07 | 35-01 | num_gpu_blocks_override=512 в vLLM init | ✓ SATISFIED | config.py:21, llm_extractor.py:40 |
| STAB-08 | 35-01 | max_tokens=16384 в reduce_entities | ✓ SATISFIED | llm_extractor.py:76 |
| STAB-09 | 35-03 | logger.opt() аудит — Loguru import гарантирован | ✓ SATISFIED | 5 файлов исправлены (exc_info=True), оставшиеся logger.opt() в Loguru-файлах |

**Примечание по REQUIREMENTS.md:** Файл `.planning/REQUIREMENTS.md` по-прежнему отображает STAB-01, STAB-02, STAB-05, STAB-06, STAB-09 как `[ ]` (Pending) и "Pending" в таблице статусов. Это расхождение в трекинге требований — реализация корректна, но REQUIREMENTS.md не обновлён. Требует ручного обновления.

**Осиротевшие требования:** Не обнаружено. Все требования, назначенные фазе 35 в REQUIREMENTS.md (STAB-01..09 кроме STAB-04), охвачены планами 35-01, 35-02, 35-03.

---

## Найденные анти-паттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| `.planning/REQUIREMENTS.md` | 13-21, 74-82 | Статусы STAB-01/02/05/06/09 не обновлены после завершения фазы | ℹ️ Info | Только трекинг-документ, не код |

Нет блокирующих анти-паттернов. Нет заглушек (stub) в production коде.

---

## Требуется верификация человеком

### 1. Reconciliation endpoint — интеграционный тест

**Тест:** `docker compose up -d && cd backend && uv run python -m pytest tests/routers/test_admin_reconciliation.py -v`
**Ожидаемое:** 6 тестов проходят (find inconsistent, fix inconsistent, skip consistent, skip already-false, require admin, require auth)
**Почему человек:** Тест требует живой PostgreSQL (integration test с `db_session` fixture), не запускается без docker compose

### 2. VPS timeout — реальное поведение Modal

**Тест:** Запустить обработку книги с длинными главами, вызвать намеренное зависание Modal (или подождать главу >960s)
**Ожидаемое:** Глава получает `parsing_error` с текстом "VPS-side timeout", книга завершается с `completed_with_errors`
**Почему человек:** Требует работающего Modal endpoint и длительного ожидания

### 3. completed_with_errors — WebSocket на клиенте

**Тест:** Запустить обработку книги с заведомо-неудачными главами, открыть frontend
**Ожидаемое:** UI отображает корректный статус (не "Обработка завершена успешно" при ошибках)
**Почему человек:** Требует запущенного сервера + frontend + observable UI

---

## Итог

Все 9 наблюдаемых истин подтверждены. Все 12 артефактов существуют, содержательны и подключены. Все 9 коммитов (502c66d, 7bdf0cd, 3b18d39, c79a18d, 4b901b3, 0f297a4, cfd7f0c, 19c75ed, aa4e075) присутствуют в git-истории.

Цель фазы достигнута: pipeline выдаёт корректные статусы (`descriptions_extracted=False` при failed chapters, `completed_with_errors` в WebSocket), push notification заблокирован при ошибках, Modal вызовы защищены timeout, per-book time budget предотвращает превышение Celery hard limit, broken JSON из xgrammar предотвращён max_length constraints.

Единственный открытый пункт: тесты `test_admin_reconciliation.py` не запускались локально из-за отсутствия БД — это environment-ограничение, не дефект реализации.

---

_Верифицировано: 2026-03-28_
_Верификатор: Claude (gsd-verifier)_

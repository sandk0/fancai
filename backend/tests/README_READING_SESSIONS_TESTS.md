# Reading Sessions Tests - Руководство по запуску

## Обзор

Comprehensive test suite для Reading Sessions системы в BookReader AI.

**Созданные тесты:**
- ✅ Backend Unit Tests (575+ строк) - `tests/routers/test_reading_sessions.py`
- ✅ Celery Task Tests (650+ строк) - `tests/tasks/test_reading_sessions_tasks.py`
- ✅ Integration Tests (550+ строк) - `tests/integration/test_reading_sessions_flow.py`
- ✅ Test Fixtures (400+ строк) - `tests/fixtures/reading_sessions.py`

**Total: ~2175 строк кода тестов**

---

## Структура тестов

```
backend/tests/
├── routers/
│   └── test_reading_sessions.py        # Unit tests для API endpoints (5 test suites)
├── tasks/
│   └── test_reading_sessions_tasks.py  # Celery task tests (4 test suites)
├── integration/
│   └── test_reading_sessions_flow.py   # E2E integration tests (4 test suites)
└── fixtures/
    └── reading_sessions.py             # Reusable fixtures и mock data
```

---

## Запуск тестов

### 1. Локальный запуск (Docker)

**Запуск всех Reading Sessions тестов:**
```bash
docker-compose exec backend pytest tests/routers/test_reading_sessions.py \
    tests/tasks/test_reading_sessions_tasks.py \
    tests/integration/test_reading_sessions_flow.py \
    -v --tb=short
```

**Запуск только unit тестов:**
```bash
docker-compose exec backend pytest tests/routers/test_reading_sessions.py -v
```

**Запуск только Celery task тестов:**
```bash
docker-compose exec backend pytest tests/tasks/test_reading_sessions_tasks.py -v
```

**Запуск только integration тестов:**
```bash
docker-compose exec backend pytest tests/integration/test_reading_sessions_flow.py -v
```

### 2. Coverage Report

**Получить coverage для reading sessions модулей:**
```bash
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py \
    tests/tasks/test_reading_sessions_tasks.py \
    tests/integration/test_reading_sessions_flow.py \
    --cov=app/routers/reading_sessions \
    --cov=app/tasks/reading_sessions_tasks \
    --cov=app/models/reading_session \
    --cov-report=term-missing \
    --cov-report=html
```

**Просмотр HTML coverage report:**
```bash
open backend/htmlcov/index.html
```

### 3. Быстрый запуск (только fast tests)

**Исключить медленные integration тесты:**
```bash
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py \
    tests/tasks/test_reading_sessions_tasks.py \
    -v --tb=short
```

### 4. Специфичные test suites

**Запустить только тесты для StartSession endpoint:**
```bash
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py::TestStartSession \
    -v
```

**Запустить только cleanup task тесты:**
```bash
docker-compose exec backend pytest \
    tests/tasks/test_reading_sessions_tasks.py::TestCloseAbandonedSessions \
    -v
```

**Запустить только full flow integration tests:**
```bash
docker-compose exec backend pytest \
    tests/integration/test_reading_sessions_flow.py::TestFullReadingSessionFlow \
    -v
```

### 5. Debug режим

**Запуск с полным traceback и pdb:**
```bash
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py \
    -v --tb=long --pdb
```

**Запуск с логами:**
```bash
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py \
    -v --log-cli-level=DEBUG
```

---

## Test Coverage Breakdown

### 1. Backend Unit Tests (`test_reading_sessions.py`)

**Test Suites:**
- `TestStartSession` (7 tests)
  - ✅ Success scenario
  - ✅ Auto-close previous session
  - ✅ Book not found (404)
  - ✅ Invalid position validation (422)
  - ✅ Invalid device type validation (422)
  - ✅ Unauthorized access (401)
  - ✅ Other user's book (404)

- `TestUpdateSession` (5 tests)
  - ✅ Success scenario
  - ✅ Session not found (404)
  - ✅ Already ended session (400)
  - ✅ Access denied (404)
  - ✅ Invalid position validation (422)

- `TestEndSession` (4 tests)
  - ✅ Success scenario
  - ✅ Position validation
  - ✅ Duration calculation
  - ✅ Idempotency check

- `TestGetActiveSession` (2 tests)
  - ✅ Session exists
  - ✅ No active session (null)

- `TestGetHistory` (4 tests)
  - ✅ Pagination
  - ✅ Filter by book
  - ✅ Empty history
  - ✅ Invalid book_id

**Total: 22 unit tests**

**Expected Coverage:**
- `app/routers/reading_sessions.py`: >95%
- `app/models/reading_session.py`: >90%

---

### 2. Celery Task Tests (`test_reading_sessions_tasks.py`)

**Test Suites:**
- `TestCloseAbandonedSessions` (6 tests)
  - ✅ Success scenario
  - ✅ No abandoned sessions
  - ✅ Correct duration calculation
  - ✅ No progress sessions
  - ✅ Error handling
  - ✅ Task returns stats

- `TestGetCleanupStatistics` (6 tests)
  - ✅ Basic statistics
  - ✅ No progress count
  - ✅ Empty database
  - ✅ Different time periods
  - ✅ Task wrapper
  - ✅ Average duration calculation

- `TestTaskErrorHandling` (2 tests)
  - ✅ Exception handling
  - ✅ Database rollback

- `TestTaskPerformance` (2 tests)
  - ✅ Large volume (100 sessions)
  - ✅ Statistics performance (500 sessions)

**Total: 16 tests**

**Expected Coverage:**
- `app/tasks/reading_sessions_tasks.py`: >90%

---

### 3. Integration Tests (`test_reading_sessions_flow.py`)

**Test Suites:**
- `TestFullReadingSessionFlow` (2 tests)
  - ✅ Complete lifecycle (start → update → end → history)
  - ✅ Multiple sessions same book

- `TestConcurrentSessions` (2 tests)
  - ✅ Multiple users concurrent sessions
  - ✅ Auto-close previous on new start

- `TestSessionCleanupIntegration` (2 tests)
  - ✅ Abandoned sessions cleanup flow
  - ✅ Cleanup with concurrent reading

- `TestErrorRecoveryIntegration` (2 tests)
  - ✅ Resume after network interruption
  - ✅ Pagination with large history

**Total: 8 integration tests**

**Expected Coverage:**
- E2E flow coverage: >95%
- Edge cases: >85%

---

## Test Fixtures

**Доступные fixtures (`fixtures/reading_sessions.py`):**

### Factory Fixtures:
- `create_reading_session` - создать одну сессию
- `create_multiple_sessions` - создать несколько сессий

### Specific Fixtures:
- `active_session` - активная сессия (10 мин назад)
- `completed_session` - завершенная сессия (2 часа назад, 45 мин)
- `abandoned_session` - заброшенная сессия (3 часа назад)
- `multiple_device_sessions` - сессии с разных устройств
- `sessions_with_different_progress` - сессии с разным прогрессом

### Mock Data:
- `sample_session_response` - mock API response
- `sample_sessions_history` - mock history response
- `celery_task_result_success` - mock Celery result
- `cleanup_statistics_sample` - mock статистика

### Validation Data:
- `invalid_session_positions` - невалидные позиции
- `invalid_device_types` - невалидные типы устройств
- `edge_case_session_data` - edge cases

---

## Целевые метрики Coverage

**Backend:**
- ✅ `app/routers/reading_sessions.py`: **>95%**
- ✅ `app/tasks/reading_sessions_tasks.py`: **>90%**
- ✅ `app/models/reading_session.py`: **>90%**

**Overall Target: >90%**

---

## Continuous Integration

Тесты автоматически запускаются в CI/CD pipeline при:
- Push в любую ветку
- Pull Request создании/обновлении
- Merge в main

См. `.github/workflows/tests-reading-sessions.yml`

---

## Troubleshooting

### Проблема: Тесты падают с connection error

**Решение:**
```bash
# Проверить что PostgreSQL запущен
docker-compose ps postgres

# Перезапустить services
docker-compose restart postgres backend
```

### Проблема: Тесты проходят локально, но падают в CI

**Причина:** локальное окружение разошлось с `backend/uv.lock`

**Решение:**
```bash
# Привести окружение ровно к тому, что стоит в CI и в образах
uv sync --frozen

# Если зависимость действительно нужно изменить — править pyproject.toml,
# затем перегенерировать lock и закоммитить его вместе с правкой.
# `pip freeze` для этого не годится: он вморозит и то, что попало
# в окружение случайно.
uv lock
```

### Проблема: Медленные тесты

**Решение:**
```bash
# Запустить только быстрые тесты
docker-compose exec backend pytest \
    tests/routers/test_reading_sessions.py \
    -v --durations=10
```

### Проблема: Flaky tests (иногда падают)

**Причина:** Race conditions или timing issues

**Решение:**
- Проверить fixtures cleanup
- Добавить explicit waits
- Изолировать test data

---

## Best Practices

### 1. Использование Fixtures

```python
@pytest.mark.asyncio
async def test_my_feature(
    client: AsyncClient,
    test_user: User,
    test_book: Book,
    create_reading_session,
):
    """Use factory fixture to create custom session."""
    session = await create_reading_session(
        user=test_user,
        book=test_book,
        start_position=25
    )
    # Test logic here
```

### 2. Arrange-Act-Assert Pattern

```python
@pytest.mark.asyncio
async def test_example():
    # Arrange - setup test data
    request_data = {"book_id": str(book.id)}

    # Act - execute the test
    response = await client.post("/api/endpoint", json=request_data)

    # Assert - verify results
    assert response.status_code == 200
```

### 3. Test Naming

Используйте описательные имена:
- ✅ `test_start_session_auto_closes_previous`
- ❌ `test_session_1`

### 4. Test Isolation

Каждый тест должен быть независимым:
```python
@pytest.mark.asyncio
async def test_isolated(db_session):
    # Create own test data
    # Don't rely on other tests
    # Clean up is automatic (fixtures)
```

---

## Команды для CI/CD

### Pre-commit Hook

```bash
# Запустить тесты перед коммитом
pytest tests/routers/test_reading_sessions.py \
    tests/tasks/test_reading_sessions_tasks.py \
    --tb=short -q
```

### Quick Smoke Tests

```bash
# Быстрая проверка критических путей
pytest tests/integration/test_reading_sessions_flow.py::TestFullReadingSessionFlow::test_complete_reading_session_lifecycle -v
```

---

## Полезные ресурсы

- **pytest documentation**: https://docs.pytest.org/
- **pytest-asyncio**: https://pytest-asyncio.readthedocs.io/
- **Coverage.py**: https://coverage.readthedocs.io/
- **FastAPI Testing**: https://fastapi.tiangolo.com/tutorial/testing/

---

## Обновление тестов

При изменении API или моделей:

1. ✅ Обновить соответствующие тесты
2. ✅ Запустить full test suite
3. ✅ Проверить coverage (должен остаться >90%)
4. ✅ Обновить документацию (этот файл)
5. ✅ Запустить CI/CD pipeline

---

**Last Updated:** 2025-10-28
**Total Test Count:** 46 tests (22 unit + 16 task + 8 integration)
**Expected Coverage:** >90%

# Feature Flags Tests - Quick Start Guide

## Быстрый старт тестирования Feature Flags

### Файлы тестов

```
backend/tests/
├── services/
│   ├── test_feature_flag_model.py       ← 27 тестов модели
│   └── test_feature_flag_manager.py     ← 45 тестов сервиса
└── routers/
    └── test_feature_flags_api.py        ← 40+ API тестов
```

### Запуск всех тестов

```bash
cd backend

# Все Feature Flags тесты
pytest tests/services/test_feature_flag_model.py \
       tests/services/test_feature_flag_manager.py \
       tests/routers/test_feature_flags_api.py -v

# С покрытием
pytest tests/services/test_feature_flag_model.py \
       tests/services/test_feature_flag_manager.py \
       tests/routers/test_feature_flags_api.py \
       --cov=app.models.feature_flag \
       --cov=app.services.feature_flag_manager \
       --cov=app.routers.admin.feature_flags \
       --cov-report=term-missing
```

### Запуск конкретного теста

```bash
# Один тест
pytest tests/services/test_feature_flag_model.py::TestFeatureFlagModel::test_feature_flag_creation -v

# Класс тестов
pytest tests/services/test_feature_flag_manager.py::TestFeatureFlagManagerIsEnabled -v

# По паттерну
pytest tests/services/test_feature_flag_manager.py -k "is_enabled" -v
```

---

## Что тестируется

### Model (27 тестов)
- ✓ Создание флагов
- ✓ Сериализация (to_dict)
- ✓ Валидация полей
- ✓ Дефолтные значения
- ✓ Категории (enum)

### Service (45 тестов)
- ✓ Инициализация
- ✓ CRUD операции (get/set/create/list)
- ✓ Кэширование
- ✓ Environment переменные
- ✓ Bulk update операции
- ✓ Обработка ошибок

### API (40+ тестов)
- ✓ GET /admin/feature-flags
- ✓ GET /admin/feature-flags/{flag_name}
- ✓ PUT /admin/feature-flags/{flag_name}
- ✓ POST /admin/feature-flags
- ✓ POST /admin/feature-flags/bulk-update
- ✓ DELETE /admin/feature-flags/cache
- ✓ POST /admin/feature-flags/initialize
- ✓ GET /admin/feature-flags/categories/list
- ✓ Авторизация и доступ

---

## Fixtures (в conftest.py)

Новые fixtures для Feature Flags тестов:

```python
@pytest_asyncio.fixture
async def admin_auth_headers(db_session, client):
    """Заголовки для админа с токеном."""
    # Использование:
    # await client.get("/admin/feature-flags", headers=admin_auth_headers)

@pytest_asyncio.fixture
async def auth_headers(db_session, client):
    """Заголовки для обычного пользователя с токеном."""
    # Использование:
    # await client.get("/admin/feature-flags", headers=auth_headers)
    # → Вернёт 403 (требуется админ)
```

---

## Примеры использования

### Тестирование проверки флага

```python
async def test_check_flag(feature_flag_manager):
    # Проверить включен ли флаг
    is_enabled = await feature_flag_manager.is_enabled("USE_NEW_NLP_ARCHITECTURE")
    assert is_enabled is True
```

### Тестирование API получения флага

```python
async def test_get_flag_api(client, admin_auth_headers):
    response = await client.get(
        "/api/v1/admin/feature-flags/USE_NEW_NLP_ARCHITECTURE",
        headers=admin_auth_headers
    )
    assert response.status_code == 200
    assert response.json()["enabled"] is True
```

### Тестирование обновления флага

```python
async def test_update_flag_api(client, admin_auth_headers):
    response = await client.put(
        "/api/v1/admin/feature-flags/USE_ADVANCED_PARSER",
        json={"enabled": True},
        headers=admin_auth_headers
    )
    assert response.status_code == 200
```

### Тестирование авторизации

```python
async def test_requires_admin(client, auth_headers):
    # Обычный пользователь: валидный токен есть, прав нет → строго 403
    response = await client.get(
        "/api/v1/admin/feature-flags",
        headers=auth_headers
    )
    assert response.status_code == 403


async def test_requires_auth(client):
    # Токена нет вовсе → строго 401 (HTTPBearer(auto_error=False) + raise)
    response = await client.get("/api/v1/admin/feature-flags")
    assert response.status_code == 401
```

---

## Структура тестового класса

```python
@pytest.mark.asyncio
class TestFeatureFlagsListEndpoint:
    """Тесты для GET /admin/feature-flags."""

    async def test_get_all_feature_flags(self, client, admin_auth_headers):
        """Тест получения всех флагов."""
        # Arrange
        expected_count = 6

        # Act
        response = await client.get(
            "/api/v1/admin/feature-flags",
            headers=admin_auth_headers
        )

        # Assert
        assert response.status_code == 200
        assert len(response.json()) == expected_count
```

---

## Проверочный лист перед коммитом

При добавлении/изменении Feature Flags:

- [ ] Запустить все тесты: `pytest tests/services/test_feature_flag* tests/routers/test_feature_flags* -v`
- [ ] Проверить покрытие: `--cov` флаг
- [ ] Нет падающих тестов
- [ ] Новые тесты для новой функциональности
- [ ] Документация обновлена
- [ ] Commit message с префиксом `feat(feature-flags):` или `fix(feature-flags):`

---

## Дебаги и troubleshooting

### Тест не запускается

```bash
# Проверить зависимости
pip install pytest pytest-asyncio sqlalchemy httpx

# Проверить что БД доступна
# Используется TEST_DATABASE_URL из conftest.py
```

### Тест падает с ошибкой БД

```python
# Убедиться что используется правильный fixture
async def test_something(db_session):  # ✓ Правильно
    pass

def test_something(db_session):  # ✗ Должен быть async!
    pass
```

### Timeout на tests

```bash
# Увеличить timeout
pytest --timeout=300

# Или отключить для конкретного теста
@pytest.mark.timeout(600)
async def test_slow_operation():
    pass
```

---

## Ожидаемые результаты

При успешном запуске:

```
tests/services/test_feature_flag_model.py::TestFeatureFlagModel::test_feature_flag_creation PASSED
tests/services/test_feature_flag_model.py::TestFeatureFlagModel::test_feature_flag_to_dict PASSED
tests/services/test_feature_flag_manager.py::TestFeatureFlagManagerIsEnabled::test_is_enabled_from_database PASSED
tests/routers/test_feature_flags_api.py::TestFeatureFlagsListEndpoint::test_get_all_feature_flags PASSED
...

========================= 112 passed in 45.23s =========================
```

---

## Полезные команды

```bash
# Запустить только падающие тесты
pytest --lf tests/services/test_feature_flag_model.py

# Запустить и остановиться на первой ошибке
pytest -x tests/services/test_feature_flag_model.py

# Verbose вывод
pytest -vv tests/services/test_feature_flag_model.py

# Показать print statements
pytest -s tests/services/test_feature_flag_model.py

# Список всех тестов
pytest --collect-only tests/services/test_feature_flag_model.py

# Benchmark (для performance тестов)
pytest --benchmark-only tests/performance/feature_flags_bench.py
```

---

## Интеграция с CI/CD

### GitHub Actions

```yaml
name: Feature Flags Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    # pyproject.toml и uv.lock лежат в backend/, а workflow стартует
    # из корня репозитория.
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - uses: astral-sh/setup-uv@v5
      - run: uv sync --frozen
      - run: uv run pytest tests/services/test_feature_flag*.py tests/routers/test_feature_flags*.py --cov
```

---

## Вопросы и ответы

**Q: Почему тесты async?**
A: FeatureFlagManager использует AsyncSession для работы с БД.

**Q: Как добавить новый тест?**
A: Создайте метод в соответствующем классе, назовите его `test_*`, добавьте assertions.

**Q: Что такое admin_auth_headers?**
A: Fixture который создает админ пользователя и возвращает заголовки с токеном.

**Q: Какое покрытие нужно?**
A: Минимум 70%, желательно >85%.

---

**Версия: 1.0**
**Дата: 2025-11-23**
**Язык: Русский**

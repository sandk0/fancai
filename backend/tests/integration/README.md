# Интеграционные Тесты Backend (Week 2)

Полный набор интеграционных тестов для проверки взаимодействия компонентов backend системы.

## Структура

```
integration/
├── test_book_service_integration.py (25 тестов)
│   ├── CRUD операции (15 тестов)
│   ├── Database транзакции (5 тестов)
│   └── File handling (5 тестов)
│
├── test_book_progress_service_integration.py (20 тестов)
│   ├── Progress calculation (5 тестов)
│   ├── Update progress (4 тестов)
│   ├── Get books with progress (3 тестов)
│   └── Position validation (8 тестов)
│
├── test_book_statistics_service_integration.py (15 тестов)
│   ├── Book count (3 тестов)
│   ├── Book statistics (4 тестов)
│   ├── Description statistics (4 тестов)
│   └── Edge cases (4 тестов)
│
├── test_book_parsing_service_integration.py (20 тестов)
│   ├── Extract descriptions (4 тестов)
│   ├── Get descriptions (4 тестов)
│   ├── Parsing progress (4 тестов)
│   ├── Parsing status (4 тестов)
│   └── Multiple chapters (4 тестов)
│
├── test_books_router_integration.py (20 тестов)
│   ├── Upload tests (3 тестов)
│   ├── List books (4 тестов)
│   ├── Get book details (4 тестов)
│   ├── Delete book (2 тестов)
│   ├── Processing status (2 тестов)
│   ├── Reading progress (5 тестов)
│
├── test_admin_router_integration.py (20 тестов)
│   ├── Authentication (2 тестов)
│   ├── Multi-NLP settings (5 тестов)
│   ├── Parsing management (4 тестов)
│   ├── System health (3 тестов)
│   ├── Cache management (2 тестов)
│   ├── Feature flags (3 тестов)
│   └── Error handling (2 тестов)
│
└── README.md (этот файл)
```

## Запуск Тестов

### Все интеграционные тесты
```bash
cd backend
pytest tests/integration/ -v
```

### Конкретный тест файл
```bash
pytest tests/integration/test_book_service_integration.py -v
```

### Конкретный тест класс
```bash
pytest tests/integration/test_book_service_integration.py::TestBookServiceCRUD -v
```

### Конкретный тест
```bash
pytest tests/integration/test_book_service_integration.py::TestBookServiceCRUD::test_create_book_from_epub_success -v
```

### С coverage отчетом
```bash
pytest tests/integration/ --cov=app --cov-report=html
```

### С фильтром по маркерам
```bash
# Только asyncio тесты
pytest tests/integration/ -v -m asyncio

# Исключить медленные тесты
pytest tests/integration/ -v -m "not slow"
```

## Документация Fixtures

### Базовые Fixtures (из conftest.py)

#### `db_session`
Асинхронная сессия базы данных для тестов. Автоматически создает и удаляет таблицы.
```python
async def test_example(db_session: AsyncSession):
    # Используйте db_session для БД операций
    pass
```

#### `client`
FastAPI тестовый клиент для API интеграционных тестов.
```python
async def test_api(client: AsyncClient):
    response = await client.get("/api/v1/books")
    assert response.status_code == 200
```

#### `test_user`
Тестовый пользователь, предварительно созданный в БД.
```python
async def test_with_user(db_session, test_user: User):
    assert test_user.id is not None
```

#### `test_book`
Тестовая книга с 3 главами, созданная для test_user.
```python
async def test_with_book(db_session, test_book: Book):
    chapters = test_book.chapters
    assert len(chapters) == 3
```

#### `auth_headers` и `admin_auth_headers`
Headers с JWT токенами для авторизованных запросов.
```python
async def test_with_auth(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/v1/books", headers=auth_headers)
    assert response.status_code == 200
```

## Тестовые Сценарии

### BookService Integration Tests

**CRUD Operations:**
- Создание книги из EPUB файла с извлечением метаданных
- Создание глав и начальной записи о прогрессе
- Получение списка книг с пагинацией и фильтрацией
- Получение книги по ID с проверкой доступа
- Удаление книги с каскадным удалением глав и файлов

**Database Transactions:**
- Откат транзакции при ошибке (rollback)
- Конкурентное создание книг
- Управление пулом соединений

**File Handling:**
- Сохранение и удаление файлов при удалении книги
- Сохранение и удаление обложки

### BookProgressService Integration Tests

**Progress Calculation:**
- CFI mode (epub.js): использует reading_location_cfi и текущий процент
- Legacy mode: расчет на основе главы и позиции в главе
- Граничные случаи (0%, 100%, вне главы)

**Progress Updates:**
- Создание нового прогресса
- Обновление существующего прогресса
- Валидация номера главы и процента
- Обновление last_accessed времени

**Reading Sessions:**
- Создание и обновление сессии чтения
- Завершение сессии с расчетом длительности
- Отслеживание позиции чтения

### BookStatisticsService Integration Tests

**Book Statistics:**
- Подсчет количества книг
- Сбор детальной статистики чтения
- Подсчет прочитанных страниц и времени

**Description Statistics:**
- Подсчет описаний по типам
- Распределение описаний по типам (location, character, atmosphere)
- Статистика из нескольких книг и глав

### BookParsingService Integration Tests

**Extract Descriptions:**
- Извлечение описаний из главы через Multi-NLP
- Отметка главы как обработанной
- Сохранение описаний в БД

**Get Descriptions:**
- Получение описаний книги отсортированные по приоритету
- Фильтрация по типу описания
- Ограничение по количеству

**Parsing Progress:**
- Обновление прогресса парсинга
- Установка флага is_parsed при 100%
- Ограничение значения от 0 до 100

**Parsing Status:**
- Получение статуса парсинга (процент, главы, описания)
- Отслеживание обработанных глав
- Подсчет найденных описаний

### Books Router Integration Tests

**Upload:**
- Загрузка EPUB/FB2 файла
- Валидация формата файла
- Проверка размера файла

**List & Get:**
- Получение списка книг пользователя
- Пагинация и фильтрация
- Получение деталей книги
- Проверка доступа (403 для чужих книг)

**Delete & Update:**
- Удаление книги
- Обновление прогресса чтения с CFI поддержкой

**Progress Tracking:**
- Получение статуса парсинга
- Обновление позиции чтения

### Admin Router Integration Tests

**Multi-NLP Settings:**
- Получение статуса процессоров
- Обновление веса и порога
- Тестирование процессора

**Parsing Management:**
- Управление очередью парсинга
- Получение/обновление настроек парсинга

**System:**
- Health check endpoints
- Системная статистика
- Инициализация настроек

**Feature Flags:**
- Получение списка флагов
- Переключение флага
- Обновление флага

## Важные Паттерны

### AAA Pattern (Arrange-Act-Assert)

```python
@pytest.mark.asyncio
async def test_example(db_session):
    # Arrange - подготовка
    user = User(email="test@example.com")
    db_session.add(user)
    await db_session.commit()

    # Act - действие
    result = await some_service.do_something(user.id)

    # Assert - проверка
    assert result is not None
```

### Async/Await в тестах

Все тесты используют `@pytest.mark.asyncio` decorator для асинхронных операций:

```python
@pytest.mark.asyncio
async def test_async_operation(db_session):
    result = await async_function()
    assert result is not None
```

### Database Transaction Management

Каждый тест запускается с чистой БД благодаря `test_db` fixture, которая:
1. Создает все таблицы перед тестом
2. Откатывает изменения после теста
3. Удаляет все таблицы

## Метрики Покрытия

**Целевые метрики:**
- BookService: 85%+ покрытие
- BookProgressService: 80%+ покрытие
- BookStatisticsService: 75%+ покрытие
- BookParsingService: 80%+ покрытие
- Books Router: 70%+ покрытие
- Admin Router: 65%+ покрытие

**Общая цель:** 75%+ покрытие для backend сервисов

## Зависимости

Все зависимости уже в `pyproject.toml` (`uv sync` ставит их из `uv.lock`):
- `pytest` - тестовый фреймворк
- `pytest-asyncio` - поддержка async тестов
- `pytest-cov` - coverage reporting
- `httpx` - async HTTP клиент
- `sqlalchemy` - ORM
- `fastapi` - web framework

## Типичные Ошибки

### 1. Забыли @pytest.mark.asyncio
```python
# ❌ Неправильно
def test_async():
    result = await async_function()

# ✅ Правильно
@pytest.mark.asyncio
async def test_async():
    result = await async_function()
```

### 2. Забыли await db.commit()
```python
# ❌ Неправильно
db_session.add(user)
# Нет commit - изменения не сохранены

# ✅ Правильно
db_session.add(user)
await db_session.commit()
```

### 3. Забыли refresh после flush
```python
# ❌ Неправильно
db_session.add(user)
await db_session.flush()
print(user.created_at)  # None - не заполнено значение БД

# ✅ Правильно
db_session.add(user)
await db_session.commit()
await db_session.refresh(user)
print(user.created_at)  # Правильное значение
```

## CI/CD Integration

Тесты интегрированы в CI/CD pipeline:
```yaml
# .github/workflows/test.yml
- name: Run integration tests
  run: pytest tests/integration/ -v --cov=app --cov-report=xml
```

## Дальнейшее Развитие

Планы для Week 3:
- Frontend Component Tests с vitest (50+ тестов)
- E2E тесты (10-15 критических сценариев)
- Performance тесты (loading, memory profiling)
- Security тесты (penetration testing basics)

## Контакты & Вопросы

По вопросам о тестах - смотрите документацию в:
- `docs/guides/testing/testing-guide.md`
- `docs/reference/api/overview.md`

---

**Автор:** Testing & QA Specialist Agent
**Дата создания:** 2025-11-29
**Версия:** 1.0

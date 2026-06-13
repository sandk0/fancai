# Type Checking Guide для BookReader AI

## Обзор

BookReader AI использует **mypy** для статической проверки типов Python кода. Это руководство описывает как использовать mypy и стандарты type hints в проекте.

## Быстрый старт

### Запуск mypy локально

```bash
cd backend
mypy app/ --config-file=mypy.ini
```

### Запуск mypy в Docker

```bash
docker-compose exec backend mypy app/ --config-file=mypy.ini
```

### Проверка конкретного файла

```bash
mypy app/services/book_service.py --config-file=mypy.ini
```

## Конфигурация

Конфигурация mypy находится в `/backend/mypy.ini`:

- **python_version**: 3.11
- **no_implicit_optional**: True (требует явного `Optional[T]`)
- **warn_return_any**: True (предупреждает о возврате Any)
- **SQLAlchemy plugin**: Включен для лучшей поддержки моделей

## Стандарты Type Hints

### 1. Все функции должны иметь type hints

✅ **Правильно:**
```python
from uuid import UUID
from typing import Optional

async def get_book_by_id(
    db: AsyncSession,
    book_id: UUID,
    user_id: Optional[UUID] = None
) -> Optional[Book]:
    """Получает книгу по ID."""
    result = await db.execute(
        select(Book).where(Book.id == book_id)
    )
    return result.scalar_one_or_none()
```

❌ **Неправильно:**
```python
async def get_book_by_id(db, book_id, user_id=None):
    result = await db.execute(
        select(Book).where(Book.id == book_id)
    )
    return result.scalar_one_or_none()
```

### 2. Используйте современный синтаксис Union

Python 3.10+ поддерживает `|` вместо `Union`:

✅ **Правильно (современный синтаксис):**
```python
def process_data(value: str | int | None) -> dict[str, Any]:
    pass
```

✅ **Правильно (старый синтаксис, тоже OK):**
```python
from typing import Union, Optional, Dict, Any

def process_data(value: Optional[Union[str, int]]) -> Dict[str, Any]:
    pass
```

### 3. UUID типы

Используйте `UUID` из модуля `uuid`, НЕ из SQLAlchemy:

✅ **Правильно:**
```python
from uuid import UUID

def get_book(book_id: UUID) -> Book:
    pass
```

❌ **Неправильно:**
```python
from sqlalchemy.dialects.postgresql import UUID

def get_book(book_id: UUID) -> Book:  # Это UUID column type!
    pass
```

### 4. Optional параметры

Mypy требует явного `Optional[T]` или `T | None` для nullable параметров:

✅ **Правильно:**
```python
def create_book(
    title: str,
    description: str | None = None,
    chapter_id: Optional[str] = None
) -> Book:
    pass
```

❌ **Неправильно:**
```python
def create_book(
    title: str,
    description: str = None,  # mypy error: implicit Optional
    chapter_id: str = None    # mypy error: implicit Optional
) -> Book:
    pass
```

### 5. SQLAlchemy модели и Column типы

#### Проблема: Column[T] vs T

SQLAlchemy Column имеет тип `Column[T]`, но в runtime это `T`:

```python
# В модели:
class Book(Base):
    title = Column(String, nullable=False)  # type: Column[str]

# В коде:
book.title  # type: Column[str] в mypy, но str в runtime!
```

#### Решение 1: Mapped[] аннотации (рекомендуется)

```python
from sqlalchemy.orm import Mapped

class Book(Base):
    title: Mapped[str] = Column(String, nullable=False)
    description: Mapped[str | None] = Column(String, nullable=True)
```

#### Решение 2: type: ignore (временно)

```python
book_title: str = book.title  # type: ignore[assignment]
```

#### Решение 3: cast (для сложных случаев)

```python
from typing import cast

book_title = cast(str, book.title)
```

### 6. Коллекции

Используйте generic типы для коллекций:

✅ **Правильно:**
```python
from typing import List, Dict, Set

def get_books() -> list[Book]:
    pass

def get_metadata() -> dict[str, Any]:
    pass

def get_tags() -> set[str]:
    pass
```

❌ **Неправильно:**
```python
def get_books() -> list:  # Без generic type
    pass

def get_metadata() -> dict:  # Без generic type
    pass
```

### 7. Async функции

Async функции возвращают `Coroutine`, используйте обычные type hints:

✅ **Правильно:**
```python
async def fetch_data() -> dict[str, Any]:
    return {"key": "value"}
```

❌ **Неправильно:**
```python
from typing import Coroutine

async def fetch_data() -> Coroutine[Any, Any, dict]:
    return {"key": "value"}
```

### 8. FastAPI зависимости

Для FastAPI dependencies используйте правильные типы:

✅ **Правильно:**
```python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

async def get_current_user(
    db: AsyncSession = Depends(get_database_session),
    token: str = Depends(oauth2_scheme)
) -> User:
    pass
```

## Распространенные проблемы и решения

### Проблема 1: "Returning Any from function"

**Причина:** SQLAlchemy запросы возвращают Any

```python
# Проблема:
def get_count(db: Session) -> int:
    return db.execute(select(func.count(Book.id))).scalar()  # Returns Any!
```

**Решение:**
```python
def get_count(db: Session) -> int:
    result = db.execute(select(func.count(Book.id))).scalar()
    return int(result) if result is not None else 0
```

### Проблема 2: "Unsupported operand types for /"

**Причина:** Деление с потенциально None значениями

```python
# Проблема:
total_pages = total_items / page_size  # Если total_items может быть None
```

**Решение:**
```python
total_items_val = total_items or 0
total_pages = total_items_val / max(page_size, 1)
```

### Проблема 3: "Value of type X is not indexable"

**Причина:** Попытка индексации Optional[str]

```python
# Проблема:
first_char = text[0]  # Если text: str | None
```

**Решение:**
```python
text_val = text or ""
first_char = text_val[0] if text_val else ""
```

### Проблема 4: Row vs tuple в SQLAlchemy

**Причина:** SQLAlchemy возвращает Row, а не tuple

```python
# Проблема:
result = db.execute(select(Book, Chapter)).first()
# result имеет тип Row[tuple[Book, Chapter]], не tuple!
```

**Решение:**
```python
from typing import cast

row = db.execute(select(Book, Chapter)).first()
if row:
    data = cast(tuple[Book, Chapter], tuple(row))
```

## Игнорирование ошибок (используйте осторожно!)

Только для исключительных случаев:

```python
# Конкретная ошибка (лучше)
result = some_untyped_lib.call()  # type: ignore[no-untyped-call]

# Все ошибки (плохо, избегайте)
result = some_untyped_lib.call()  # type: ignore
```

**Правило:** Если добавляете `# type: ignore`, добавьте комментарий ПОЧЕМУ:

```python
# type: ignore[attr-defined] - Third-party lib без stubs
result = external_lib.undocumented_method()
```

## Интеграция в разработку

### Pre-commit hook

Mypy автоматически запускается перед коммитом (см. `.pre-commit-config.yaml`):

```bash
# Установка pre-commit
pip install pre-commit
pre-commit install

# Запуск вручную
pre-commit run mypy --all-files
```

### CI/CD

GitHub Actions запускает mypy автоматически (см. `.github/workflows/type-check.yml`).

## Метрики качества

### Текущие цели:

- ✅ **Core модули** (app/core/*): 100% type coverage
- ✅ **Models** (app/models/*): 95%+ type coverage (SQLAlchemy limitations)
- 🔄 **Services** (app/services/*): 90%+ type coverage (в процессе)
- 🔄 **Routers** (app/routers/*): 85%+ type coverage (в процессе)

### Проверка coverage:

```bash
# Статистика mypy
mypy app/ --config-file=mypy.ini --html-report ./mypy-report

# Количество ошибок
mypy app/ --config-file=mypy.ini 2>&1 | grep "Found" | tail -1
```

## Рекомендации

1. **Всегда добавляйте type hints** для новых функций
2. **Используйте mypy локально** перед коммитом
3. **Не игнорируйте ошибки** без веской причины
4. **Документируйте сложные типы** комментариями
5. **Проверяйте CI/CD** - если mypy fails, разбирайтесь почему

## Полезные ресурсы

- [Mypy documentation](https://mypy.readthedocs.io/)
- [PEP 484 - Type Hints](https://peps.python.org/pep-0484/)
- [SQLAlchemy mypy plugin](https://docs.sqlalchemy.org/en/20/orm/extensions/mypy.html)
- [FastAPI type hints](https://fastapi.tiangolo.com/python-types/)

## Changelog

- **2025-10-26**: Создан TYPE_CHECKING.md, добавлен mypy в CI/CD
- **2025-10-24**: Настроен mypy.ini с SQLAlchemy plugin
- **2025-10-23**: Начало использования mypy в проекте

---

**Вопросы?** Обратитесь к Code Quality & Refactoring Agent или проверьте `mypy.ini` конфигурацию.

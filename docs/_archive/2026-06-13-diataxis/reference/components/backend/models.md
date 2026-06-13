# Backend Models - BookReader AI

Полная документация всех SQLAlchemy моделей, используемых в BookReader AI. Модели организованы по функциональным областям и содержат подробное описание полей, отношений и бизнес-логики.

## Архитектура моделей

### Базовые принципы
- **UUID первичные ключи** для всех сущностей
- **Временные метки** (created_at, updated_at) для аудита
- **Мягкое удаление** через is_active флаги где необходимо
- **JSON поля** для гибкого хранения метаданных
- **Enum типы** для ограниченных наборов значений
- **Cascade операции** для целостности данных

### Иерархия отношений
```
User (1) → (N) Books → (N) Chapters → (N) Descriptions → (N) Generated Images
User (1) → (N) Reading Progress
User (1) → (1) Subscription
```

---

## Core Models

### 1. User Model

**Файл:** `backend/app/models/user.py`

**Назначение:** Основная модель пользователя системы с аутентификацией и настройками.

```python
class User(Base):
    __tablename__ = "users"
    
    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: str = Column(String(255), unique=True, index=True, nullable=False)
    password_hash: str = Column(String(255), nullable=False)
    
    # Персональные данные
    full_name: Optional[str] = Column(String(255), nullable=True)
    
    # Статус аккаунта
    is_active: bool = Column(Boolean, default=True, nullable=False)
    is_superuser: bool = Column(Boolean, default=False, nullable=False)
    is_verified: bool = Column(Boolean, default=False, nullable=False)
    
    # Настройки читалки (JSON)
    reader_settings: dict = Column(JSON, default=dict, nullable=False)
    
    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
```

**Отношения:**
- `books` → List[Book] (one-to-many)
- `reading_progress` → List[ReadingProgress] (one-to-many)
- `generated_images` → List[GeneratedImage] (one-to-many)
- `subscription` → Optional[Subscription] (one-to-one)

**Методы:**
```python
def verify_password(self, password: str) -> bool:
    """Проверка пароля пользователя."""
    
def set_password(self, password: str) -> None:
    """Установка нового пароля с хешированием."""
    
def get_reading_stats(self) -> dict:
    """Получение статистики чтения пользователя."""
    
def update_reader_settings(self, settings: dict) -> None:
    """Обновление настроек читалки."""
```

**Пример использования:**
```python
# Создание пользователя
user = User(
    email="user@example.com",
    full_name="John Doe",
    reader_settings={
        "theme": "dark",
        "fontSize": 16,
        "fontFamily": "serif"
    }
)
user.set_password("secure_password")

# Проверка пароля
is_valid = user.verify_password("secure_password")

# Обновление настроек
user.update_reader_settings({"theme": "light", "fontSize": 18})
```

### 2. Subscription Model

**Файл:** `backend/app/models/user.py`

**Назначение:** Управление подписками и лимитами пользователей.

```python
class SubscriptionPlan(enum.Enum):
    FREE = "free"
    PREMIUM = "premium" 
    ULTIMATE = "ultimate"

class SubscriptionStatus(enum.Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    PENDING = "pending"

class Subscription(Base):
    __tablename__ = "subscriptions"
    
    # Связи
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: UUID = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    # План подписки
    plan_type: SubscriptionPlan = Column(SQLEnum(SubscriptionPlan), default=SubscriptionPlan.FREE)
    status: SubscriptionStatus = Column(SQLEnum(SubscriptionStatus), default=SubscriptionStatus.ACTIVE)
    
    # Лимиты
    books_limit: int = Column(Integer, default=5, nullable=False)
    images_per_month: int = Column(Integer, default=50, nullable=False)
    priority_generation: bool = Column(Boolean, default=False, nullable=False)
    
    # Биллинг
    price_per_month: decimal.Decimal = Column(DECIMAL(10, 2), default=0.00)
    currency: str = Column(String(3), default="USD")
    
    # Временные рамки
    started_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    expires_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
    cancelled_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
```

**Методы:**
```python
def is_active(self) -> bool:
    """Проверка активности подписки."""
    
def days_until_expiry(self) -> int:
    """Количество дней до истечения подписки."""
    
def can_upload_books(self, current_count: int) -> bool:
    """Проверка возможности загрузки новых книг."""
    
def can_generate_images(self, current_month_count: int) -> bool:
    """Проверка лимита на генерацию изображений."""
```

---

## Content Models

### 3. Book Model

**Файл:** `backend/app/models/book.py`

**Назначение:** Основная модель книги с метаданными и статистикой.

```python
class BookFormat(enum.Enum):
    EPUB = "epub"
    FB2 = "fb2"

class BookGenre(enum.Enum):
    FANTASY = "fantasy"
    DETECTIVE = "detective"
    SCIFI = "science_fiction"
    HISTORICAL = "historical"
    ROMANCE = "romance"
    THRILLER = "thriller"
    HORROR = "horror"
    CLASSIC = "classic"
    OTHER = "other"

class Book(Base):
    __tablename__ = "books"
    
    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: UUID = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    # Основная информация
    title: str = Column(String(500), nullable=False, index=True)
    author: Optional[str] = Column(String(255), nullable=True, index=True)
    genre: BookGenre = Column(SQLEnum(BookGenre), default=BookGenre.OTHER)
    language: str = Column(String(10), default="ru", nullable=False)
    
    # Файл
    file_path: str = Column(String(1000), nullable=False)
    file_format: BookFormat = Column(SQLEnum(BookFormat), nullable=False)
    file_size: int = Column(Integer, nullable=False)
    
    # Контент
    cover_image: Optional[str] = Column(String(1000), nullable=True)
    description: Optional[str] = Column(Text, nullable=True)
    book_metadata: dict = Column(JSON, nullable=True)
    
    # Статистика
    total_pages: int = Column(Integer, default=0, nullable=False)
    estimated_reading_time: int = Column(Integer, default=0, nullable=False)  # минуты
    
    # Статус обработки
    is_parsed: bool = Column(Boolean, default=False, nullable=False)
    parsing_progress: int = Column(Integer, default=0, nullable=False)  # 0-100%
    parsing_error: Optional[str] = Column(Text, nullable=True)
    
    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_accessed: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
```

**Отношения:**
```python
# Отношения
user = relationship("User", back_populates="books")
chapters = relationship("Chapter", back_populates="book", cascade="all, delete-orphan")
reading_progress = relationship("ReadingProgress", back_populates="book", cascade="all, delete-orphan")
```

**Основные методы:**
```python
def get_reading_progress_percent(self, user_id: UUID) -> float:
    """Получение прогресса чтения в процентах."""
    
def get_chapter_count(self) -> int:
    """Получение количества глав."""
    
def get_descriptions_count(self) -> int:
    """Получение количества найденных описаний."""
    
def get_generated_images_count(self) -> int:
    """Получение количества сгенерированных изображений."""
    
def update_parsing_progress(self, progress: int) -> None:
    """Обновление прогресса парсинга."""
    
def mark_as_parsed(self) -> None:
    """Отметить книгу как обработанную."""
```

### 4. Chapter Model

**Файл:** `backend/app/models/chapter.py`

**Назначение:** Модель главы книги с содержимым и статистикой.

```python
class Chapter(Base):
    __tablename__ = "chapters"
    
    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id: UUID = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    
    # Структура
    chapter_number: int = Column(Integer, nullable=False)
    title: Optional[str] = Column(String(500), nullable=True)
    content: str = Column(Text, nullable=False)
    
    # Статистика
    word_count: int = Column(Integer, default=0, nullable=False)
    estimated_reading_time: int = Column(Integer, default=0, nullable=False)  # минуты
    
    # Обработка
    is_processed: bool = Column(Boolean, default=False, nullable=False)
    processing_error: Optional[str] = Column(Text, nullable=True)
    
    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

**Отношения:**
```python
book = relationship("Book", back_populates="chapters")
descriptions = relationship("Description", back_populates="chapter", cascade="all, delete-orphan")
```

**Методы:**
```python
def calculate_word_count(self) -> int:
    """Расчет количества слов в главе."""
    
def calculate_reading_time(self, wpm: int = 200) -> int:
    """Расчет времени чтения (минуты)."""
    
def get_descriptions_by_type(self, desc_type: DescriptionType) -> List[Description]:
    """Получение описаний определенного типа."""
    
def mark_as_processed(self) -> None:
    """Отметить главу как обработанную."""
```

### 5. Description Model

**Файл:** `backend/app/models/description.py`

**Назначение:** Модель описания, найденного NLP процессором.

```python
class DescriptionType(enum.Enum):
    LOCATION = "location"      # 75% приоритет
    CHARACTER = "character"    # 60% приоритет
    ATMOSPHERE = "atmosphere"  # 45% приоритет
    OBJECT = "object"         # 40% приоритет
    ACTION = "action"         # 30% приоритет

class Description(Base):
    __tablename__ = "descriptions"
    
    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chapter_id: UUID = Column(UUID(as_uuid=True), ForeignKey("chapters.id"), nullable=False)
    
    # Контент
    content: str = Column(Text, nullable=False)
    context: Optional[str] = Column(Text, nullable=True)  # окружающий контекст
    
    # Классификация
    type: DescriptionType = Column(SQLEnum(DescriptionType), nullable=False)
    confidence_score: float = Column(Float, default=0.0, nullable=False)
    priority_score: float = Column(Float, default=0.0, nullable=False)
    
    # Метаданные NLP
    entities_mentioned: Optional[str] = Column(Text, nullable=True)
    sentiment_score: float = Column(Float, default=0.0, nullable=False)
    text_position_start: Optional[int] = Column(Integer, nullable=True)
    text_position_end: Optional[int] = Column(Integer, nullable=True)
    
    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

**Отношения:**
```python
chapter = relationship("Chapter", back_populates="descriptions")
generated_images = relationship("GeneratedImage", back_populates="description", cascade="all, delete-orphan")
```

**Методы:**
```python
def calculate_priority_score(self) -> float:
    """Расчет приоритетного счета для генерации изображений."""
    
def get_entities_list(self) -> List[str]:
    """Получение списка упомянутых сущностей."""
    
def is_suitable_for_generation(self) -> bool:
    """Проверка пригодности для генерации изображения."""
    
def get_generation_prompt(self, book_genre: BookGenre) -> str:
    """Генерация промпта для AI на основе описания и жанра."""
```

---

## AI Models

### 6. GeneratedImage Model

**Файл:** `backend/app/models/image.py`

**Назначение:** Модель сгенерированного AI изображения.

```python
class ImageStatus(enum.Enum):
    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"

class AIService(enum.Enum):
    POLLINATIONS = "pollinations"
    OPENAI = "openai"
    MIDJOURNEY = "midjourney"
    STABLE_DIFFUSION = "stable_diffusion"

class GeneratedImage(Base):
    __tablename__ = "generated_images"
    
    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    description_id: UUID = Column(UUID(as_uuid=True), ForeignKey("descriptions.id"), nullable=False)
    user_id: UUID = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    # AI сервис
    service_used: AIService = Column(SQLEnum(AIService), nullable=False)
    model_version: Optional[str] = Column(String(100), nullable=True)
    status: ImageStatus = Column(SQLEnum(ImageStatus), default=ImageStatus.PENDING)
    
    # Результат
    image_url: Optional[str] = Column(String(1000), nullable=True)
    local_path: Optional[str] = Column(String(1000), nullable=True)
    prompt_used: Optional[str] = Column(Text, nullable=True)
    negative_prompt: Optional[str] = Column(Text, nullable=True)
    
    # Метаданные
    generation_time_seconds: Optional[float] = Column(Float, nullable=True)
    image_width: Optional[int] = Column(Integer, nullable=True)
    image_height: Optional[int] = Column(Integer, nullable=True)
    file_size: Optional[int] = Column(Integer, nullable=True)
    
    # Ошибки
    error_message: Optional[str] = Column(Text, nullable=True)
    retry_count: int = Column(Integer, default=0, nullable=False)
    
    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    completed_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True)
```

**Отношения:**
```python
description = relationship("Description", back_populates="generated_images")
user = relationship("User", back_populates="generated_images")
```

**Методы:**
```python
def mark_as_generating(self) -> None:
    """Отметить как генерирующееся."""
    
def mark_as_completed(self, image_url: str, local_path: str, metadata: dict) -> None:
    """Отметить как завершенное."""
    
def mark_as_failed(self, error_message: str) -> None:
    """Отметить как неуспешное."""
    
def can_retry(self, max_retries: int = 3) -> bool:
    """Проверка возможности повторной генерации."""
    
def get_file_size_mb(self) -> float:
    """Получение размера файла в мегабайтах."""
```

---

## Progress Models

### 7. ReadingProgress Model

**Файл:** `backend/app/models/book.py`

**Назначение:** Отслеживание прогресса чтения книг пользователями с CFI-based позиционированием (October 2025).

```python
class ReadingProgress(Base):
    """
    Отслеживание прогресса чтения с CFI-based позиционированием (October 2025).

    NEW October 2025:
    - reading_location_cfi: EPUB CFI для точной позиции в epub.js
    - scroll_offset_percent: Pixel-perfect scroll tracking (0-100%)
    - current_position repurposed: теперь хранит overall % прогресса от epub.js

    Миграции:
    - 8ca7de033db9 (2025-10-19): Added reading_location_cfi
    - e94cab18247f (2025-10-20): Added scroll_offset_percent
    """
    __tablename__ = "reading_progress"

    # Идентификация
    id: UUID = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: UUID = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    book_id: UUID = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)

    # Позиция чтения
    current_chapter: int = Column(Integer, default=1, nullable=False)  # Legacy для FB2
    current_page: int = Column(Integer, default=1, nullable=False)      # Legacy для FB2
    current_position: int = Column(Integer, default=0, nullable=False)  # NEW: epub.js overall % (0-100)

    # ✨ NEW: CFI-based position tracking (October 2025)
    reading_location_cfi: str = Column(String(500), nullable=True,
        comment="EPUB CFI for exact position tracking in epub.js")
    scroll_offset_percent: float = Column(Float, default=0.0, nullable=False,
        comment="Scroll offset within page (0-100%) for pixel-perfect positioning")

    # Статистика чтения
    reading_time_minutes: int = Column(Integer, default=0, nullable=False)
    reading_speed_wpm: float = Column(Float, default=0.0, nullable=False)

    # Временные метки
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_read_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
```

**Отношения:**
```python
user = relationship("User", back_populates="reading_progress")
book = relationship("Book", back_populates="reading_progress")
```

**Методы:**
```python
def update_position(self, chapter: int = None, page: int = None, position: int = None,
                   cfi: str = None, scroll_percent: float = 0.0) -> None:
    """
    Обновление позиции чтения.

    Args:
        chapter: Номер главы (legacy, для FB2)
        page: Номер страницы (legacy, для FB2)
        position: Overall progress % от epub.js (0-100)
        cfi: EPUB CFI для точной позиции
        scroll_percent: Точный % скролла (0-100)

    Example (October 2025 EPUB mode):
        >>> progress.update_position(
        ...     cfi="epubcfi(/6/14!/4/2/16/1:0)",
        ...     scroll_percent=23.5,
        ...     position=45  # от epub.js locations
        ... )

    Example (Legacy FB2 mode):
        >>> progress.update_position(chapter=5, page=23)
    """

def add_reading_time(self, minutes: int) -> None:
    """Добавление времени чтения."""

def calculate_reading_speed(self, words_read: int, time_minutes: int) -> None:
    """Расчет скорости чтения."""

def get_reading_progress_percent(self) -> float:
    """
    Вычисляет процент прогресса чтения (0-100%).

    Supports two modes:
    1. CFI-based (October 2025+): uses current_position from epub.js locations
    2. Legacy (pre-CFI): calculates from current_chapter / total_chapters

    Returns:
        float: Progress percentage (0-100)

    Example:
        >>> # October 2025 EPUB with CFI
        >>> progress = ReadingProgress(
        ...     reading_location_cfi="epubcfi(/6/14!/4/2/16/1:0)",
        ...     scroll_offset_percent=23.5,
        ...     current_position=45  # from epub.js locations
        ... )
        >>> progress.get_reading_progress_percent()
        45.0

        >>> # Legacy FB2 without CFI
        >>> progress = ReadingProgress(
        ...     current_chapter=5,
        ...     total_chapters=10
        ... )
        >>> progress.get_reading_progress_percent()
        40.0  # (4 completed / 10 total) * 100
    """
```

**Backward Compatibility Notes:**
- **Old data** without CFI: continues to work using chapter-based calculation
- **New data** with CFI: uses epub.js locations for accurate percentage
- **current_position repurposed**: now stores overall % from epub.js (0-100), not position in chapter

---

## Model Utilities

### Base Model Features

Все модели наследуются от базового класса `Base` и получают общую функциональность:

```python
class Base:
    """Базовый класс для всех моделей."""
    
    def to_dict(self, exclude: List[str] = None) -> dict:
        """Конвертация модели в словарь."""
        
    def update_from_dict(self, data: dict, exclude: List[str] = None) -> None:
        """Обновление модели из словаря."""
        
    def __repr__(self) -> str:
        """Строковое представление модели."""
```

### Database Constraints

```python
# Уникальные ограничения
UniqueConstraint('user_id', 'book_id', name='uq_user_book_progress')  # ReadingProgress
UniqueConstraint('book_id', 'chapter_number', name='uq_book_chapter')  # Chapter

# Check ограничения
CheckConstraint('parsing_progress >= 0 AND parsing_progress <= 100', name='check_parsing_progress')
CheckConstraint('confidence_score >= 0.0 AND confidence_score <= 1.0', name='check_confidence')
CheckConstraint('current_chapter >= 1', name='check_current_chapter')
CheckConstraint('file_size > 0', name='check_file_size')

# Индексы производительности
Index('idx_books_user_created', 'user_id', 'created_at')
Index('idx_descriptions_chapter_priority', 'chapter_id', 'priority_score')
Index('idx_generated_images_status', 'status')
Index('idx_users_email', 'email', unique=True)
```

### Model Mixins

```python
class TimestampMixin:
    """Mixin для временных меток."""
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class SoftDeleteMixin:
    """Mixin для мягкого удаления."""
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = func.now()

class MetadataMixin:
    """Mixin для метаданных."""
    metadata = Column(JSON, default=dict, nullable=False)
    
    def set_metadata(self, key: str, value: Any) -> None:
        if self.metadata is None:
            self.metadata = {}
        self.metadata[key] = value
```

---

## Testing Models

### Factory Pattern для тестов

```python
# Фабрики для создания тестовых объектов
class UserFactory:
    @staticmethod
    def create(email: str = "test@example.com", **kwargs) -> User:
        return User(
            email=email,
            password_hash="hashed_password",
            full_name="Test User",
            is_active=True,
            **kwargs
        )

class BookFactory:
    @staticmethod
    def create(user_id: UUID, title: str = "Test Book", **kwargs) -> Book:
        return Book(
            user_id=user_id,
            title=title,
            author="Test Author",
            file_path="/test/book.epub",
            file_format=BookFormat.EPUB,
            file_size=1024000,
            **kwargs
        )
```

### Model Tests примеры

```python
def test_user_password_verification():
    user = User(email="test@example.com")
    user.set_password("secure_password")
    
    assert user.verify_password("secure_password")
    assert not user.verify_password("wrong_password")

def test_book_progress_calculation():
    book = Book(title="Test Book")
    book.chapters = [Chapter(chapter_number=i) for i in range(1, 11)]
    
    progress = ReadingProgress(current_chapter=5, current_page=1)
    progress_percent = book.get_reading_progress_percent(progress.user_id)
    
    assert progress_percent == 40.0  # 4 из 10 глав завершены

def test_description_priority_calculation():
    desc = Description(
        content="ancient castle",
        type=DescriptionType.LOCATION,
        confidence_score=0.9
    )
    
    priority = desc.calculate_priority_score()
    assert priority > 60.0  # Location имеет высокий приоритет
```

---

## Performance Considerations

### Query Optimization

```python
# Оптимизированные запросы с join'ами
def get_user_books_with_progress(user_id: UUID):
    return session.query(Book)\
        .join(ReadingProgress)\
        .options(selectinload(Book.reading_progress))\
        .filter(Book.user_id == user_id)\
        .order_by(Book.last_accessed.desc())

# Lazy loading для больших связей
class Book(Base):
    chapters = relationship("Chapter", lazy="dynamic")
    descriptions = relationship("Description", lazy="select")
```

### Database Indexes

```sql
-- Композитные индексы для частых запросов
CREATE INDEX idx_books_user_genre ON books(user_id, genre);
CREATE INDEX idx_descriptions_type_priority ON descriptions(type, priority_score DESC);
CREATE INDEX idx_generated_images_user_status ON generated_images(user_id, status);

-- Partial индексы
CREATE INDEX idx_books_unparsed ON books(user_id) WHERE is_parsed = false;
CREATE INDEX idx_images_completed ON generated_images(description_id) WHERE status = 'completed';
```

---

## Migration Examples

### Alembic Migration Template

```python
"""add new field to books

Revision ID: abc123
Revises: def456
Create Date: 2025-08-24 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'abc123'
down_revision = 'def456'

def upgrade():
    op.add_column('books', sa.Column('new_field', sa.String(255), nullable=True))
    op.create_index('idx_books_new_field', 'books', ['new_field'])

def downgrade():
    op.drop_index('idx_books_new_field')
    op.drop_column('books', 'new_field')
```

---

## Заключение

Модели BookReader AI спроектированы для:

- **Высокой производительности** через правильные индексы и отношения
- **Гибкости** через JSON поля и enum типы
- **Целостности данных** через constraints и cascade операции
- **Простоты использования** через методы-помощники и factory pattern
- **Тестируемости** через factory classes и четкую архитектуру

Все модели содержат подробную документацию и примеры использования для упрощения разработки и поддержки.
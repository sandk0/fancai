# Backend Services - BookReader AI

Полная документация всех backend сервисов, содержащих бизнес-логику приложения. Сервисы организованы по функциональным областям и следуют принципам чистой архитектуры.

## Архитектура сервисов

### Принципы проектирования
- **Single Responsibility** - каждый сервис отвечает за одну область
- **Dependency Injection** - внедрение зависимостей через конструктор
- **Async/Await** - все операции с базой данных асинхронны
- **Error Handling** - структурированная обработка ошибок
- **Logging** - подробное логирование всех операций
- **Testing** - все сервисы покрыты unit тестами

### Иерархия сервисов
```
Core Services (database, auth, config)
    ↓
Business Services (book_service, nlp_processor, image_generator)
    ↓
Integration Services (book_parser, external APIs)
```

---

## Core Services

### 1. AuthService

**Файл:** `backend/app/services/auth_service.py`

**Назначение:** Управление аутентификацией и авторизацией пользователей.

```python
class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.pwd_context = CryptContext(schemes=["bcrypt"])
        self.jwt_secret = settings.JWT_SECRET_KEY
    
    async def create_user(self, user_data: UserCreate) -> User:
        """Создание нового пользователя с валидацией."""
        
    async def authenticate_user(self, email: str, password: str) -> Optional[User]:
        """Аутентификация пользователя по email и паролю."""
        
    def create_access_token(self, data: dict, expires_delta: timedelta = None) -> str:
        """Создание JWT access токена."""
        
    def create_refresh_token(self, data: dict) -> str:
        """Создание JWT refresh токена."""
        
    async def get_current_user(self, token: str) -> User:
        """Получение пользователя по JWT токену."""
        
    async def refresh_tokens(self, refresh_token: str) -> TokenPair:
        """Обновление пары токенов."""
        
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Проверка пароля."""
        
    def get_password_hash(self, password: str) -> str:
        """Хеширование пароля."""
```

**Ключевые особенности:**
- **JWT токены** с автоматическим обновлением
- **Bcrypt хеширование** паролей
- **Валидация** email и сложности пароля
- **Rate limiting** для попыток входа
- **Session management** с отзывом токенов

**Пример использования:**
```python
auth_service = AuthService(session)

# Создание пользователя
user = await auth_service.create_user(UserCreate(
    email="user@example.com",
    password="secure_password",
    full_name="John Doe"
))

# Аутентификация
user = await auth_service.authenticate_user("user@example.com", "secure_password")
access_token = auth_service.create_access_token({"sub": str(user.id)})

# Проверка токена
current_user = await auth_service.get_current_user(access_token)
```

---

## Business Services

### 2. BookService

**Файл:** `backend/app/services/book_service.py`

**Назначение:** Управление книгами, главами и прогрессом чтения.

```python
class BookService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.nlp_processor = NLPProcessor(session)

    async def create_book_from_file(self, file_path: str, user_id: UUID, metadata: dict) -> Book:
        """Создание книги из загруженного файла."""

    async def get_user_books(self, user_id: UUID, filters: BookFilters) -> Tuple[List[Book], PaginationInfo]:
        """Получение книг пользователя с фильтрацией и пагинацией."""

    async def get_book_with_progress(self, book_id: UUID, user_id: UUID) -> BookWithProgress:
        """Получение книги с прогрессом чтения."""

    # ✨ NEW October 2025: CFI-based progress tracking
    async def update_reading_progress(
        self,
        book_id: UUID,
        user_id: UUID,
        reading_location_cfi: str = None,  # NEW: EPUB CFI
        scroll_offset_percent: float = 0.0,  # NEW: Pixel-perfect scroll
        current_position: int = 0,  # NEW: Overall % from epub.js (0-100)
        current_chapter: int = None,  # Legacy: for FB2
        current_page: int = None  # Legacy: for FB2
    ) -> ReadingProgress:
        """
        Обновление прогресса чтения с поддержкой CFI (October 2025).

        Args:
            book_id: ID книги
            user_id: ID пользователя
            reading_location_cfi: EPUB CFI для точной позиции
            scroll_offset_percent: Точный % скролла (0-100)
            current_position: Overall progress % от epub.js (0-100)
            current_chapter: Номер главы (legacy для FB2)
            current_page: Номер страницы (legacy для FB2)

        Returns:
            Updated ReadingProgress object

        Example (October 2025 EPUB mode):
            >>> progress = await book_service.update_reading_progress(
            ...     book_id=book.id,
            ...     user_id=user.id,
            ...     reading_location_cfi="epubcfi(/6/14!/4/2/16/1:0)",
            ...     scroll_offset_percent=23.5,
            ...     current_position=45
            ... )

        Example (Legacy FB2 mode):
            >>> progress = await book_service.update_reading_progress(
            ...     book_id=book.id,
            ...     user_id=user.id,
            ...     current_chapter=5,
            ...     current_page=23
            ... )
        """

    # ✨ NEW October 2025: EPUB file serving for epub.js
    async def get_book_file(self, book_id: UUID, user_id: UUID) -> FileResponse:
        """
        Returns EPUB file for epub.js integration (October 2025).

        Endpoint: GET /api/v1/books/{book_id}/file
        Auth: JWT required
        Content-Type: application/epub+zip

        Args:
            book_id: ID книги
            user_id: ID пользователя (для проверки доступа)

        Returns:
            FileResponse with EPUB binary data

        Raises:
            HTTPException(404): Book not found
            HTTPException(403): Access denied
            HTTPException(400): Not an EPUB file

        Example:
            >>> # Frontend usage
            >>> const response = await fetch(
            ...     `/api/v1/books/${bookId}/file`,
            ...     { headers: { Authorization: `Bearer ${token}` }}
            ... );
            >>> const epubBlob = await response.blob();
            >>> rendition.display(epubBlob);
        """

    async def get_chapter_content(self, book_id: UUID, chapter_number: int, user_id: UUID) -> ChapterContent:
        """Получение содержимого главы с описаниями."""

    async def delete_book(self, book_id: UUID, user_id: UUID) -> bool:
        """Удаление книги и всех связанных данных."""

    async def get_book_statistics(self, book_id: UUID, user_id: UUID) -> BookStatistics:
        """Получение статистики по книге."""

    async def process_book_nlp(self, book_id: UUID, nlp_processor: NLPProcessor) -> ProcessingResult:
        """Асинхронная обработка книги через NLP процессор."""
```

**Методы поиска и фильтрации:**
```python
async def search_books(self, user_id: UUID, query: str, filters: SearchFilters) -> List[Book]:
    """Полнотекстовый поиск по книгам."""
    
async def get_books_by_genre(self, user_id: UUID, genre: BookGenre) -> List[Book]:
    """Получение книг определенного жанра."""
    
async def get_recently_read_books(self, user_id: UUID, limit: int = 10) -> List[Book]:
    """Недавно читанные книги."""
    
async def get_books_by_reading_status(self, user_id: UUID, status: ReadingStatus) -> List[Book]:
    """Книги по статусу чтения (не начаты, в процессе, завершены)."""
```

**Пример использования:**
```python
book_service = BookService(session)

# Создание книги из файла
book = await book_service.create_book_from_file(
    file_path="/uploads/book.epub",
    user_id=user.id,
    metadata={"genre": "fantasy", "language": "ru"}
)

# Получение книг с фильтрацией
books, pagination = await book_service.get_user_books(
    user_id=user.id,
    filters=BookFilters(genre="fantasy", is_parsed=True, page=1, page_size=10)
)

# Обновление прогресса
progress = await book_service.update_reading_progress(
    ReadingProgressUpdate(
        book_id=book.id,
        user_id=user.id,
        current_chapter=5,
        current_page=23
    )
)
```

### 3. NLPProcessor

**Файл:** `backend/app/services/nlp_processor.py`

**Назначение:** Обработка текста и извлечение описаний с помощью NLP технологий.

```python
class NLPProcessor:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.spacy_model = self._load_spacy_model()
        self.nltk_initialized = self._init_nltk()
        
    def _load_spacy_model(self) -> spacy.Language:
        """Загрузка модели spaCy для русского языка."""
        
    async def extract_descriptions_from_text(self, text: str, chapter_id: UUID) -> List[Description]:
        """Основной метод извлечения описаний из текста."""
        
    def _classify_description_type(self, text: str, entities: List[str]) -> Tuple[DescriptionType, float]:
        """Классификация типа описания с оценкой уверенности."""
        
    def _calculate_priority_score(self, desc_type: DescriptionType, confidence: float, context: str) -> float:
        """Расчет приоритетного счета для описания."""
        
    def _extract_entities(self, doc: spacy.tokens.Doc) -> List[str]:
        """Извлечение именованных сущностей из документа."""
        
    async def process_chapter(self, chapter: Chapter) -> ProcessingResult:
        """Обработка целой главы книги."""
        
    def get_description_context(self, text: str, start_pos: int, end_pos: int, context_size: int = 100) -> str:
        """Получение контекста вокруг найденного описания."""
```

**Классификация описаний:**
```python
def _classify_location_description(self, text: str, entities: List[str]) -> float:
    """Классификация описания локации."""
    location_keywords = ["дом", "замок", "комната", "лес", "город", "улица", "здание"]
    location_patterns = [
        r"\b(древн\w+|стар\w+|больш\w+|маленьк\w+)\s+(дом|замок|здание)",
        r"\b(темн\w+|светл\w+|узк\w+|широк\w+)\s+(улица|дорога|коридор)",
        r"\b(высок\w+|низк\w+|круглая|квадратн\w+)\s+(башня|комната|зал)"
    ]
    
def _classify_character_description(self, text: str, entities: List[str]) -> float:
    """Классификация описания персонажа."""
    appearance_keywords = ["волосы", "глаза", "лицо", "рост", "фигура", "одежда"]
    character_patterns = [
        r"\b(высок\w+|низк\w+|стройн\w+|полн\w+)\s+(мужчина|женщина|девушка|парень)",
        r"\b(темн\w+|светл\w+|рыж\w+|сед\w+)\s+(волосы)",
        r"\b(голуб\w+|карие|зелен\w+|серые)\s+(глаза)"
    ]
```

**Приоритизация описаний:**
```python
TYPE_PRIORITIES = {
    DescriptionType.LOCATION: 75,      # Высший приоритет
    DescriptionType.CHARACTER: 60,     # Высокий приоритет
    DescriptionType.ATMOSPHERE: 45,    # Средний приоритет
    DescriptionType.OBJECT: 40,        # Средний приоритет
    DescriptionType.ACTION: 30         # Низкий приоритет
}

def _calculate_priority_score(self, desc_type: DescriptionType, confidence: float, context: str) -> float:
    base_priority = TYPE_PRIORITIES[desc_type]
    confidence_bonus = confidence * 20  # До +20 баллов за уверенность
    length_penalty = max(0, 10 - len(context.split()) * 0.5)  # Штраф за длину
    
    return min(100, base_priority + confidence_bonus - length_penalty)
```

### 4. ImageGeneratorService

**Файл:** `backend/app/services/image_generator.py`

**Назначение:** Генерация AI изображений по описаниям из книг.

```python
class ImageGeneratorService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.pollinations_client = PollinationsClient()
        self.prompt_engineer = PromptEngineer()
        
    async def generate_image_for_description(self, description_id: UUID, user_id: UUID, options: GenerationOptions = None) -> GenerationResult:
        """Генерация изображения для конкретного описания."""
        
    async def batch_generate_for_chapter(self, chapter_id: UUID, user_id: UUID, limit: int = 10) -> BatchGenerationResult:
        """Пакетная генерация изображений для топ-описаний главы."""
        
    async def regenerate_image(self, image_id: UUID, user_id: UUID, options: RegenerationOptions) -> GenerationResult:
        """Перегенерация существующего изображения."""
        
    def _build_prompt(self, description: Description, book_genre: BookGenre, options: GenerationOptions) -> PromptData:
        """Построение промпта для AI генерации."""
        
    async def _save_generated_image(self, generation_result: ExternalGenerationResult, description: Description, user_id: UUID) -> GeneratedImage:
        """Сохранение результата генерации в базу данных."""
        
    async def get_generation_status(self, user_id: UUID) -> GenerationStatus:
        """Получение статуса системы генерации для пользователя."""
```

**Prompt Engineering:**
```python
class PromptEngineer:
    STYLE_PROMPTS = {
        BookGenre.FANTASY: "fantasy art, magical atmosphere, mystical lighting, detailed fantasy illustration",
        BookGenre.DETECTIVE: "noir style, dark atmosphere, realistic, cinematic lighting",
        BookGenre.HISTORICAL: "historical accuracy, period details, realistic, documentary style",
        BookGenre.HORROR: "dark gothic, eerie atmosphere, dramatic shadows, horror aesthetic"
    }
    
    TYPE_PROMPTS = {
        DescriptionType.LOCATION: "detailed architecture, environmental design, landscape",
        DescriptionType.CHARACTER: "character portrait, detailed features, expressive",
        DescriptionType.ATMOSPHERE: "mood lighting, atmospheric effects, cinematic composition"
    }
    
    def build_prompt(self, description: Description, genre: BookGenre, options: GenerationOptions) -> str:
        base_prompt = description.content
        style_prompt = self.STYLE_PROMPTS.get(genre, "realistic, detailed illustration")
        type_prompt = self.TYPE_PROMPTS.get(description.type, "detailed illustration")
        
        quality_prompt = "high quality, detailed, masterpiece, best quality"
        negative_prompt = options.negative_prompt or "blurry, low quality, distorted, ugly"
        
        return f"{base_prompt}, {type_prompt}, {style_prompt}, {quality_prompt}"
```

**External API Clients:**
```python
class PollinationsClient:
    BASE_URL = "https://pollinations.ai/p"
    
    async def generate_image(self, prompt: str, options: dict = None) -> GenerationResult:
        """Генерация изображения через Pollinations.ai"""
        params = {
            "prompt": prompt,
            "model": options.get("model", "flux"),
            "width": options.get("width", 1024),
            "height": options.get("height", 768),
            "enhance": "true",
            "nologo": "true"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(self.BASE_URL, params=params) as response:
                if response.status == 200:
                    image_data = await response.read()
                    return GenerationResult(
                        success=True,
                        image_data=image_data,
                        generation_time=response.headers.get("X-Generation-Time"),
                        model_used=params["model"]
                    )
```

---

## Integration Services

### 5. BookParser

**Файл:** `backend/app/services/book_parser.py`

**Назначение:** Парсинг книг в форматах EPUB и FB2.

```python
class BookParser:
    def __init__(self):
        self.supported_formats = [".epub", ".fb2"]
        
    def get_supported_formats(self) -> List[str]:
        """Получение списка поддерживаемых форматов."""
        
    def validate_book_file(self, file_path: str) -> ValidationResult:
        """Валидация файла книги."""
        
    def parse_book(self, file_path: str, user_id: UUID) -> BookParsingResult:
        """Основной метод парсинга книги."""
        
    def _parse_epub(self, file_path: str) -> EPUBParsingResult:
        """Парсинг EPUB файла."""
        
    def _parse_fb2(self, file_path: str) -> FB2ParsingResult:
        """Парсинг FB2 файла."""
        
    def _extract_metadata(self, book_data: Any, format_type: str) -> BookMetadata:
        """Извлечение метаданных книги."""
        
    def _extract_chapters(self, book_data: Any, format_type: str) -> List[ChapterData]:
        """Извлечение глав книги."""
        
    def _extract_cover_image(self, book_data: Any, format_type: str) -> Optional[bytes]:
        """Извлечение обложки книги."""
```

**EPUB Parser:**
```python
def _parse_epub(self, file_path: str) -> EPUBParsingResult:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
    
    book = epub.read_epub(file_path)
    
    # Метаданные
    metadata = BookMetadata(
        title=book.get_metadata('DC', 'title')[0][0] if book.get_metadata('DC', 'title') else 'Unknown',
        author=', '.join([author[0] for author in book.get_metadata('DC', 'creator')]),
        language=book.get_metadata('DC', 'language')[0][0] if book.get_metadata('DC', 'language') else 'en',
        description=book.get_metadata('DC', 'description')[0][0] if book.get_metadata('DC', 'description') else None
    )
    
    # Извлечение глав
    chapters = []
    chapter_num = 1
    
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            
            # Очистка HTML и получение текста
            content = self._clean_html_content(soup.get_text())
            
            if len(content.strip()) > 100:  # Минимальная длина главы
                chapters.append(ChapterData(
                    number=chapter_num,
                    title=self._extract_chapter_title(soup),
                    content=content
                ))
                chapter_num += 1
    
    return EPUBParsingResult(
        metadata=metadata,
        chapters=chapters,
        cover_image=self._extract_epub_cover(book)
    )
```

---

## Utility Services

### 6. FileService

**Назначение:** Управление файлами и их хранением.

```python
class FileService:
    def __init__(self):
        self.storage_path = Path(settings.STORAGE_PATH)
        self.max_file_size = settings.MAX_FILE_SIZE
        
    async def save_uploaded_file(self, file: UploadFile, user_id: UUID) -> SaveFileResult:
        """Сохранение загруженного файла."""
        
    async def delete_file(self, file_path: str) -> bool:
        """Удаление файла."""
        
    async def get_file_info(self, file_path: str) -> FileInfo:
        """Получение информации о файле."""
        
    def generate_unique_filename(self, original_filename: str, user_id: UUID) -> str:
        """Генерация уникального имени файла."""
        
    async def cleanup_old_files(self, days_old: int = 30) -> CleanupResult:
        """Очистка старых файлов."""
```

### 7. CacheService

**Назначение:** Кеширование данных через Redis.

```python
class CacheService:
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        
    async def get(self, key: str) -> Optional[Any]:
        """Получение значения из кеша."""
        
    async def set(self, key: str, value: Any, expire: int = 3600) -> bool:
        """Установка значения в кеш."""
        
    async def delete(self, key: str) -> bool:
        """Удаление значения из кеша."""
        
    async def get_or_set(self, key: str, factory: Callable, expire: int = 3600) -> Any:
        """Получение из кеша или установка через фабричную функцию."""
```

---

## Service Layer Patterns

### Dependency Injection

```python
class ServiceContainer:
    def __init__(self, session: AsyncSession):
        self.session = session
        self._services = {}
        
    def get_auth_service(self) -> AuthService:
        if 'auth' not in self._services:
            self._services['auth'] = AuthService(self.session)
        return self._services['auth']
        
    def get_book_service(self) -> BookService:
        if 'book' not in self._services:
            self._services['book'] = BookService(self.session)
        return self._services['book']
        
    def get_image_service(self) -> ImageGeneratorService:
        if 'image' not in self._services:
            self._services['image'] = ImageGeneratorService(self.session)
        return self._services['image']
```

### Error Handling

```python
class ServiceError(Exception):
    """Базовый класс ошибок сервисов."""
    
class ValidationError(ServiceError):
    """Ошибки валидации данных."""
    
class NotFoundError(ServiceError):
    """Ресурс не найден."""
    
class PermissionError(ServiceError):
    """Недостаточно прав доступа."""
    
class ProcessingError(ServiceError):
    """Ошибки обработки данных."""

# Использование в сервисах
async def get_book(self, book_id: UUID, user_id: UUID) -> Book:
    book = await self.session.get(Book, book_id)
    
    if not book:
        raise NotFoundError(f"Book {book_id} not found")
        
    if book.user_id != user_id:
        raise PermissionError("Access denied to book")
        
    return book
```

### Logging

```python
import logging
from functools import wraps

logger = logging.getLogger(__name__)

def log_service_call(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        service_name = args[0].__class__.__name__
        method_name = func.__name__
        
        logger.info(f"{service_name}.{method_name} called", extra={
            "service": service_name,
            "method": method_name,
            "args": str(args[1:])[:200]  # Ограничиваем размер лога
        })
        
        try:
            result = await func(*args, **kwargs)
            logger.info(f"{service_name}.{method_name} completed successfully")
            return result
        except Exception as e:
            logger.error(f"{service_name}.{method_name} failed", extra={
                "service": service_name,
                "method": method_name,
                "error": str(e)
            })
            raise
    return wrapper
```

---

## Testing Services

### Service Testing Patterns

```python
import pytest
from unittest.mock import Mock, AsyncMock
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.fixture
async def mock_session():
    session = AsyncMock(spec=AsyncSession)
    return session

@pytest.fixture
def book_service(mock_session):
    return BookService(mock_session)

@pytest.mark.asyncio
async def test_create_book_from_file(book_service, mock_session):
    # Arrange
    file_path = "/test/book.epub"
    user_id = uuid.uuid4()
    metadata = {"title": "Test Book", "author": "Test Author"}
    
    # Mock database operations
    mock_session.add = Mock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    
    # Act
    result = await book_service.create_book_from_file(file_path, user_id, metadata)
    
    # Assert
    assert result.title == "Test Book"
    assert result.author == "Test Author"
    assert result.user_id == user_id
    mock_session.add.assert_called_once()
    mock_session.commit.assert_called_once()

@pytest.mark.asyncio
async def test_nlp_description_extraction():
    nlp_processor = NLPProcessor(mock_session)
    
    text = "В старом замке на вершине холма жил могущественный волшебник."
    chapter_id = uuid.uuid4()
    
    descriptions = await nlp_processor.extract_descriptions_from_text(text, chapter_id)
    
    assert len(descriptions) > 0
    location_desc = next((d for d in descriptions if d.type == DescriptionType.LOCATION), None)
    assert location_desc is not None
    assert "замок" in location_desc.content.lower()
```

### Integration Testing

```python
@pytest.mark.asyncio
async def test_book_processing_pipeline(db_session):
    # Полный тест пайплайна обработки книги
    user = await create_test_user(db_session)
    
    book_service = BookService(db_session)
    nlp_processor = NLPProcessor(db_session)
    image_service = ImageGeneratorService(db_session)
    
    # 1. Создание книги
    book = await book_service.create_book_from_file(
        "test_files/sample.epub", 
        user.id, 
        {"genre": "fantasy"}
    )
    
    # 2. NLP обработка
    processing_result = await book_service.process_book_nlp(book.id, nlp_processor)
    
    assert processing_result.descriptions_found > 0
    
    # 3. Генерация изображений
    top_descriptions = processing_result.descriptions[:5]
    for desc in top_descriptions:
        generation_result = await image_service.generate_image_for_description(
            desc.id, user.id
        )
        assert generation_result.success
```

---

## Performance Optimization

### Caching Strategies

```python
from functools import wraps
import asyncio

def cache_result(expire: int = 3600, key_prefix: str = ""):
    def decorator(func):
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            # Генерация ключа кеша
            cache_key = f"{key_prefix}:{func.__name__}:{hash(str(args) + str(kwargs))}"
            
            # Попытка получить из кеша
            cached_result = await self.cache_service.get(cache_key)
            if cached_result:
                return cached_result
                
            # Выполнение функции и кеширование результата
            result = await func(self, *args, **kwargs)
            await self.cache_service.set(cache_key, result, expire)
            
            return result
        return wrapper
    return decorator

# Использование
class BookService:
    @cache_result(expire=1800, key_prefix="book_stats")
    async def get_book_statistics(self, book_id: UUID, user_id: UUID) -> BookStatistics:
        # Тяжелые вычисления статистики
        pass
```

### Batch Operations

```python
async def batch_process_descriptions(self, description_ids: List[UUID], batch_size: int = 10) -> BatchProcessingResult:
    """Пакетная обработка описаний."""
    results = []
    
    for i in range(0, len(description_ids), batch_size):
        batch = description_ids[i:i + batch_size]
        batch_tasks = [self.process_single_description(desc_id) for desc_id in batch]
        
        batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
        results.extend(batch_results)
        
        # Небольшая пауза между батчами для снижения нагрузки
        await asyncio.sleep(0.1)
    
    return BatchProcessingResult(
        total_processed=len(results),
        successful=[r for r in results if not isinstance(r, Exception)],
        failed=[r for r in results if isinstance(r, Exception)]
    )
```

---

## Заключение

Сервисный слой BookReader AI обеспечивает:

- **Разделение ответственности** между различными бизнес-областями
- **Асинхронную обработку** для высокой производительности  
- **Надежную обработку ошибок** с подробным логированием
- **Кеширование** для оптимизации частых запросов
- **Тестируемость** через dependency injection и моки
- **Масштабируемость** через batch операции и оптимизированные запросы

Все сервисы следуют единым стандартам проектирования и готовы для production использования.
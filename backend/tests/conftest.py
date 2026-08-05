import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker, selectinload
from unittest.mock import AsyncMock, MagicMock
from dataclasses import dataclass
from typing import Optional, Dict, List

from app.main import app
from app.core.database import get_database_session, Base
from app.core.config import settings
from app.core.container import (
    DependencyContainer,
    get_book_parser_dep,
    get_gemini_extractor_dep,
    get_auth_service_dep,
    get_book_service_dep,
    get_image_generator_service_dep,
    get_token_blacklist_dep,
)
from app.models import User, Book


# Test database URL — derived from settings.DATABASE_URL (single source of truth)
def _build_test_database_url() -> str:
    """Derive test database URL from settings."""
    if settings.TEST_DATABASE_URL:
        return settings.TEST_DATABASE_URL
    # Replace db name suffix: fancai_dev -> fancai_test
    url = settings.DATABASE_URL
    base, db_name = url.rsplit("/", 1)
    if "?" in db_name:
        db_name, params = db_name.split("?", 1)
        return f"{base}/{db_name.removesuffix('_dev')}_test?{params}"
    return f"{base}/{db_name.removesuffix('_dev')}_test"


TEST_DATABASE_URL = _build_test_database_url()

# Create test engine.
#
# NullPool обязателен: у каждого теста свой event loop
# (`asyncio_default_fixture_loop_scope=function`), а asyncpg-соединение
# привязано к тому loop'у, в котором создано. Любое пулированное соединение,
# дожившее до следующего теста, падает с «got Future attached to a different
# loop» либо «another operation is in progress» — причём первый тест в процессе
# проходит, а все следующие нет.
test_engine = create_async_engine(
    TEST_DATABASE_URL, echo=False, future=True, poolclass=NullPool
)

# Test session factory
TestSessionLocal = sessionmaker(
    test_engine, class_=AsyncSession, expire_on_commit=False
)


def _create_enums(sync_conn):
    """Create PG enums that have create_type=False in models."""
    from sqlalchemy import text

    exists = sync_conn.execute(
        text("SELECT 1 FROM pg_type WHERE typname = 'entitytype'")
    ).fetchone()
    if not exists:
        sync_conn.execute(
            text("CREATE TYPE entitytype AS ENUM ('character', 'location', 'object')")
        )


def _drop_enums(sync_conn):
    """Drop PG enums after tests."""
    from sqlalchemy import text

    sync_conn.execute(text("DROP TYPE IF EXISTS entitytype CASCADE"))


@pytest_asyncio.fixture(scope="function")
async def test_db():
    """Create test database tables (including PG enums with create_type=False)."""
    async with test_engine.begin() as conn:
        await conn.run_sync(_create_enums)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(_drop_enums)
    # Пул сбрасывать не нужно: движок на NullPool, соединение закрывается
    # вместе с транзакцией и до следующего теста не доживает.


@pytest_asyncio.fixture(scope="function")
async def db_session(test_db):
    """Create a test database session."""
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def override_get_database(db_session):
    """Override the get_database_session dependency."""

    def _override_get_database():
        yield db_session

    app.dependency_overrides[get_database_session] = _override_get_database
    yield
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function")
async def client(override_get_database):
    """Create test HTTP client."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture(autouse=True)
def rate_limiting_disabled():
    """Глобальный rate limiter выключен на время теста.

    Без этого прогон зависит от ПОРЯДКА: любой тест с `TestClient(app)`
    выполняет lifespan приложения и подключает глобальный `rate_limiter`
    к Redis. После него у всех последующих тестов регистрация (2/min)
    и логин (10/min) начинают отвечать 429 — так падали
    `test_token_blacklist` и `test_auth` в полном прогоне после
    `test_security`.

    Тесты самого лимитера поднимают ОТДЕЛЬНЫЙ экземпляр `RateLimiter()`
    и этот флаг не трогают.
    """
    from app.middleware.rate_limit import rate_limiter

    original = rate_limiter.enabled
    rate_limiter.enabled = False
    yield
    rate_limiter.enabled = original


@pytest.fixture
def mock_nlp_processor():
    """Mock NLP processor for testing."""
    mock = AsyncMock()
    mock.extract_descriptions.return_value = [
        {
            "text": "Test description",
            "description_type": "location",
            "priority_score": 0.8,
            "chapter_position": 100,
            "context": "Test context",
        }
    ]
    return mock


@pytest.fixture
def mock_image_generator():
    """Mock image generator for testing."""
    mock = AsyncMock()
    mock.generate_image.return_value = {
        "image_url": "https://example.com/test-image.jpg",
        "generation_time": 5.0,
    }
    return mock


@pytest.fixture
def sample_user_data():
    """Sample user data for testing."""
    return {
        "email": "test@example.com",
        "password": "SecureP@ss0w9rd!",  # Meets all requirements: 12+ chars, uppercase, lowercase, non-sequential digits, special chars
        "full_name": "Test User",
    }


@pytest.fixture
def sample_book_data():
    """Sample book data for testing."""
    return {
        "title": "Test Book",
        "author": "Test Author",
        "genre": "Fiction",
        "description": "A test book for testing purposes",
        "language": "en",
        "file_format": "epub",
        "file_size": 1024000,
        "total_chapters": 5,
    }


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession, sample_user_data):
    """Create a test user in database."""
    from app.models.user import User
    from app.services.auth_service import AuthService

    auth_service = AuthService()
    user = User(
        email=sample_user_data["email"],
        full_name=sample_user_data["full_name"],
        password_hash=auth_service.get_password_hash(sample_user_data["password"]),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_book(db_session: AsyncSession, test_user: User):
    """Create a test book in database with chapters."""
    from app.models.book import Book, BookGenre
    from app.models.chapter import Chapter

    book = Book(
        user_id=test_user.id,
        title="Test Book",
        author="Test Author",
        genre=BookGenre.FANTASY.value,  # Use .value for string column
        language="ru",
        file_path="/tmp/test.epub",
        file_format="epub",
        file_size=1024000,
        total_pages=100,
        estimated_reading_time=50,
        is_parsed=True,
    )
    db_session.add(book)
    await db_session.flush()  # Get book.id without committing

    # Add chapters for the book
    for i in range(1, 4):  # 3 chapters
        chapter = Chapter(
            book_id=book.id,
            chapter_number=i,
            title=f"Chapter {i}",
            content=f"Content of chapter {i} with beautiful forest and tall trees.",
            html_content=f"<p>Content of chapter {i} with beautiful forest and tall trees.</p>",
            word_count=10,
        )
        db_session.add(chapter)

    await db_session.commit()

    # `Book.chapters` объявлен lazy="raise", а фикстура обещает книгу С главами:
    # без явного eager load любое обращение к `test_book.chapters` падает
    # InvalidRequestError. `refresh()` тут не поможет — он переиспользует
    # стратегии маппера, то есть тот же lazy="raise".
    result = await db_session.execute(
        select(Book).options(selectinload(Book.chapters)).where(Book.id == book.id)
    )
    return result.scalar_one()


@pytest_asyncio.fixture
async def test_chapter(db_session: AsyncSession, test_book: Book):
    """Create a test chapter in database."""
    from app.models.chapter import Chapter

    # Главу добавляем ЧЕРЕЗ коллекцию книги: `test_book` отдаёт книгу
    # с уже загруженным `chapters`, и вставка мимо коллекции оставляет её
    # неполной. Тогда `db.delete(book)` каскадит только известные ORM главы,
    # а эта блокирует удаление родителя (chapters_book_id_fkey, NO ACTION).
    chapter = Chapter(
        chapter_number=len(test_book.chapters) + 1,
        title="Chapter 1",
        content="This is a test chapter content with a beautiful forest and tall trees.",
        html_content="<p>This is a test chapter content with a beautiful forest and tall trees.</p>",
        word_count=15,
    )
    test_book.chapters.append(chapter)
    await db_session.commit()
    await db_session.refresh(chapter)
    return chapter


@pytest.fixture
def sample_chapter_data():
    """Sample chapter data for testing."""
    return {
        "chapter_number": 1,
        "title": "Chapter 1: The Beginning",
        "content": "This is the content of the first chapter. It contains a beautiful forest with tall trees.",
        "word_count": 15,
        "estimated_reading_time": 1,
    }


@pytest.fixture
def sample_description_data():
    """Sample description data for testing."""
    return {
        "text": "beautiful forest with tall trees",
        "description_type": "location",
        "priority_score": 0.8,
        "chapter_position": 50,
        "context": "This is the content of the first chapter.",
    }


@pytest.fixture
def authenticated_headers(client, sample_user_data):
    """Get authenticated headers for testing."""

    async def _get_headers():
        # Register user
        reg_response = await client.post("/api/v1/auth/register", json=sample_user_data)

        # If registration failed (e.g., user already exists), that's OK - try login anyway
        if reg_response.status_code not in [201, 400]:
            raise Exception(
                f"Registration failed with status {reg_response.status_code}: {reg_response.text}"
            )

        # Login
        login_response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": sample_user_data["email"],
                "password": sample_user_data["password"],
            },
        )

        # Check login succeeded
        if login_response.status_code != 200:
            raise Exception(
                f"Login failed with status {login_response.status_code}: {login_response.text}"
            )

        data = login_response.json()
        if "tokens" not in data:
            raise Exception(f"Login response missing 'tokens': {data}")

        tokens = data["tokens"]
        return {"Authorization": f"Bearer {tokens['access_token']}"}

    return _get_headers


# Test settings override
# Note: Settings object is a Pydantic BaseSettings which is immutable
# Tests use TEST_DATABASE_URL configured in test engine above
@pytest.fixture(autouse=False)
def override_settings():
    """Override settings for testing (disabled - Pydantic settings are immutable)."""
    yield settings


@pytest_asyncio.fixture
async def admin_auth_headers(db_session: AsyncSession, client: AsyncClient):
    """Get authenticated headers for admin user with proper DB setup."""
    from app.models.user import User
    from app.services.auth_service import AuthService

    # Create admin user
    auth_service = AuthService()
    admin_user = User(
        email="test_admin@example.com",
        full_name="Test Admin",
        password_hash=auth_service.get_password_hash("AdminPass123!"),
        is_admin=True,
    )
    db_session.add(admin_user)
    await db_session.commit()

    # Login and get token
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "test_admin@example.com", "password": "AdminPass123!"},
    )

    if login_response.status_code != 200:
        raise Exception(f"Admin login failed: {login_response.text}")

    data = login_response.json()
    tokens = data["tokens"]

    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest_asyncio.fixture
async def auth_headers(db_session: AsyncSession, client: AsyncClient):
    """Get authenticated headers for regular user."""
    from app.models.user import User
    from app.services.auth_service import AuthService

    # Create regular user
    auth_service = AuthService()
    user = User(
        email="regular_user@example.com",
        full_name="Regular User",
        password_hash=auth_service.get_password_hash("RegularPass123!"),
        is_admin=False,
    )
    db_session.add(user)
    await db_session.commit()

    # Login and get token
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "regular_user@example.com", "password": "RegularPass123!"},
    )

    if login_response.status_code != 200:
        raise Exception(f"User login failed: {login_response.text}")

    data = login_response.json()
    tokens = data["tokens"]

    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest_asyncio.fixture
async def test_user_auth_headers(
    client: AsyncClient, test_user: User, sample_user_data
):
    """Заголовки ВЛАДЕЛЬЦА `test_book`.

    `auth_headers` создаёт отдельного `regular_user@example.com`, поэтому любой
    тест, который соединяет `auth_headers` с `test_book`, получает от ownership
    guard 403/404 — и это правильное поведение API, а не дефект.
    """
    login_response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": sample_user_data["email"],
            "password": sample_user_data["password"],
        },
    )

    if login_response.status_code != 200:
        raise Exception(f"Owner login failed: {login_response.text}")

    return {
        "Authorization": f"Bearer {login_response.json()['tokens']['access_token']}"
    }



@pytest.fixture
async def test_book_with_progress(test_user, db_session):
    """Create a book with reading progress for testing."""
    from app.models.book import Book, BookGenre, ReadingProgress
    from app.models.chapter import Chapter

    # Create book
    book = Book(
        title="Test Book with Progress",
        author="Test Author",
        user_id=test_user.id,
        genre=BookGenre.OTHER.value,
        file_path="/tmp/test-with-progress.epub",
        file_format="epub",
        file_size=1024,
        language="ru",
    )
    db_session.add(book)
    await db_session.flush()

    # Create chapters
    for i in range(3):
        chapter = Chapter(
            book_id=book.id,
            chapter_number=i + 1,
            title=f"Chapter {i + 1}",
            content=f"Content of chapter {i + 1}",
            word_count=100,
        )
        db_session.add(chapter)

    await db_session.flush()

    # Create reading progress
    progress = ReadingProgress(
        user_id=test_user.id,
        book_id=book.id,
        current_chapter=2,
        current_page=10,
        current_position=50,
        reading_location_cfi="/2/4/2/10",
        scroll_offset_percent=30.5,
    )
    db_session.add(progress)

    await db_session.commit()
    await db_session.refresh(book)
    return str(book.id)


@pytest_asyncio.fixture
async def initialized_feature_flags(db_session: AsyncSession):
    """Initialize feature flags for testing."""
    from app.services.feature_flag_manager import FeatureFlagManager

    manager = FeatureFlagManager(db_session)
    await manager.initialize()
    yield
    # Cleanup is handled by test_db fixture


# ============================================================================
# DEPENDENCY INJECTION MOCK FIXTURES
# ============================================================================


@dataclass
class MockImageGenerationResult:
    """Mock result for image generation."""

    success: bool = True
    image_url: Optional[str] = "https://example.com/test-image.png"
    local_path: Optional[str] = "/app/storage/test-image.png"
    error_message: Optional[str] = None
    generation_time_seconds: Optional[float] = 5.0
    model_used: Optional[str] = "imagen-4"
    prompt_used: Optional[str] = "test prompt"


@dataclass
class MockParsedBook:
    """Mock result for book parsing."""

    @dataclass
    class Metadata:
        title: str = "Test Book"
        author: str = "Test Author"
        genre: str = "fiction"
        language: str = "en"
        description: str = "A test book"
        isbn: Optional[str] = None
        publisher: Optional[str] = None
        publish_date: Optional[str] = None
        cover_image_data: Optional[bytes] = None
        cover_image_type: Optional[str] = None

    @dataclass
    class Chapter:
        number: int
        title: str
        content: str
        html_content: str
        word_count: int

    metadata: Metadata = None
    chapters: List = None
    file_format: str = "epub"
    total_pages: int = 100
    estimated_reading_time: int = 50

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = MockParsedBook.Metadata()
        if self.chapters is None:
            self.chapters = [
                MockParsedBook.Chapter(
                    number=1,
                    title="Chapter 1",
                    content="Test chapter content",
                    html_content="<p>Test chapter content</p>",
                    word_count=100,
                )
            ]


@pytest.fixture
def mock_book_parser():
    """
    Mock BookParser for testing.

    Use with app.dependency_overrides to inject this mock into routes.

    Example:
        def test_upload(mock_book_parser, client):
            app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
            # ... test code ...
            app.dependency_overrides.clear()
    """
    mock = AsyncMock()
    mock.parse_book.return_value = MockParsedBook()
    mock.detect_format.return_value = "epub"
    mock.is_format_supported.return_value = True
    mock.get_supported_formats.return_value = ["epub", "fb2"]
    return mock


@pytest.fixture
def mock_image_generator_service():
    """
    Mock ImageGeneratorService for testing.

    Provides mock implementations for all image generation methods.
    """
    mock = MagicMock()

    # Async methods
    mock.generate_image_for_description = AsyncMock(
        return_value=MockImageGenerationResult()
    )
    mock.generate_image_from_text = AsyncMock(return_value=MockImageGenerationResult())
    mock.batch_generate_for_chapter = AsyncMock(
        return_value=[MockImageGenerationResult()]
    )
    mock.get_generation_stats = AsyncMock(
        return_value={
            "queue_size": 0,
            "is_processing": False,
            "supported_types": ["location", "character", "atmosphere"],
            "service_status": {"available": True},
            "api_status": "operational",
            "queue_backend": "celery_redis",
        }
    )
    mock.preview_prompt = AsyncMock(
        return_value={"english_prompt": "translated prompt", "original": "original"}
    )

    # Sync methods
    mock.queue_image_generation.return_value = {
        "task_id": "test-task-123",
        "status": "queued",
        "description_id": "test-desc-id",
    }
    mock.queue_batch_generation.return_value = {
        "task_id": "test-batch-task-123",
        "status": "queued",
        "chapter_id": "test-chapter-id",
        "descriptions_count": 5,
    }
    mock.get_task_status.return_value = {
        "task_id": "test-task-123",
        "status": "SUCCESS",
        "ready": True,
        "result": {"image_url": "https://example.com/result.png"},
    }

    return mock


@pytest.fixture
def mock_illustration_service():
    """
    Mock IllustrationService for testing.

    Lower-level illustration API mock.
    """
    mock = MagicMock()
    mock.is_available.return_value = True
    mock.get_status.return_value = {
        "available": True,
        "model": "imagen-4",
        "rate_limit_remaining": 100,
    }
    mock.generate_image = AsyncMock(return_value=MockImageGenerationResult())
    return mock


@pytest.fixture
def mock_gemini_extractor():
    """
    Mock GeminiDirectExtractor for testing.

    Provides mock description extraction.
    """
    mock = MagicMock()
    mock.is_available.return_value = True
    mock.get_statistics.return_value = {
        "total_extractions": 100,
        "avg_descriptions_per_chapter": 5,
    }
    mock.extract = AsyncMock(
        return_value=[
            {
                "content": "beautiful forest with tall trees",
                "type": "location",
                "confidence_score": 0.9,
                "priority_score": 0.8,
                "chapter_position": 50,
            },
            {
                "content": "mysterious castle on the hill",
                "type": "location",
                "confidence_score": 0.85,
                "priority_score": 0.75,
                "chapter_position": 120,
            },
        ]
    )
    return mock


@pytest.fixture
def mock_book_service():
    """
    Mock BookService for testing CRUD operations.
    """
    mock = MagicMock()
    mock.create_book_from_upload = AsyncMock()
    mock.get_user_books = AsyncMock(return_value=[])
    mock.get_book_by_id = AsyncMock(return_value=None)
    mock.get_book_chapters = AsyncMock(return_value=[])
    mock.get_chapter_by_number = AsyncMock(return_value=None)
    mock.delete_book = AsyncMock(return_value=True)
    return mock


@pytest.fixture
def mock_book_progress_service():
    """
    Mock BookProgressService for testing reading progress.
    """
    mock = MagicMock()
    mock.get_books_with_progress = AsyncMock(return_value=[])
    mock.update_reading_progress = AsyncMock(return_value=True)
    mock.get_reading_progress = AsyncMock(return_value=None)
    return mock


@pytest.fixture
def mock_auth_service():
    """
    Mock AuthService for testing authentication.

    Note: For most auth tests, use the real AuthService with test database.
    This mock is useful for unit testing specific edge cases.
    """
    from app.services.auth_service import AuthService

    real_service = AuthService()
    mock = MagicMock(spec=AuthService)

    # Use real password hashing for consistency
    mock.get_password_hash = real_service.get_password_hash
    mock.verify_password = real_service.verify_password

    # Mock async methods
    mock.create_user = AsyncMock()
    mock.authenticate_user = AsyncMock()
    mock.refresh_access_token = AsyncMock()
    mock.update_user_profile = AsyncMock(return_value=True)
    mock.deactivate_user = AsyncMock(return_value=True)

    # Mock token methods
    mock.create_tokens_for_user.return_value = {
        "access_token": "mock-access-token",
        "refresh_token": "mock-refresh-token",
        "token_type": "bearer",
    }
    mock.verify_token.return_value = {
        "sub": "test-user-id",
        "exp": 9999999999,
        "type": "access",
    }

    return mock


@pytest.fixture
def mock_token_blacklist():
    """
    Mock TokenBlacklist for testing logout functionality.
    """
    mock = MagicMock()
    mock.add = AsyncMock(return_value=True)
    mock.is_blacklisted = AsyncMock(return_value=False)
    mock.cleanup_expired = AsyncMock()
    return mock


@pytest.fixture
def di_override_cleanup():
    """
    Fixture to ensure DI overrides are cleaned up after tests.

    Use as a dependency for tests that use DI overrides:

        def test_something(di_override_cleanup, mock_book_parser):
            app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
            # test code...
    """
    yield
    app.dependency_overrides.clear()
    DependencyContainer.reset_all()
    DependencyContainer.clear_caches()


@pytest_asyncio.fixture
async def app_with_mock_services(
    override_get_database,
    mock_book_parser,
    mock_image_generator_service,
    mock_gemini_extractor,
):
    """
    Fixture that sets up the app with all mock services.

    Useful for integration tests that don't need real external services.
    Database is still real (test database).
    """
    app.dependency_overrides[get_book_parser_dep] = lambda: mock_book_parser
    app.dependency_overrides[get_image_generator_service_dep] = (
        lambda: mock_image_generator_service
    )
    app.dependency_overrides[get_gemini_extractor_dep] = lambda: mock_gemini_extractor

    yield app

    # Cleanup
    app.dependency_overrides.clear()
    DependencyContainer.reset_all()
    DependencyContainer.clear_caches()


# ============================================================================
# EXAMPLE TEST HELPERS
# ============================================================================


def create_mock_dependency_overrides(
    book_parser=None,
    image_generator=None,
    gemini_extractor=None,
    auth_service=None,
    book_service=None,
    token_blacklist=None,
) -> Dict:
    """
    Helper to create dependency overrides dictionary.

    Example:
        overrides = create_mock_dependency_overrides(
            book_parser=mock_book_parser,
            image_generator=mock_image_generator,
        )
        app.dependency_overrides.update(overrides)
    """
    overrides = {}

    if book_parser:
        overrides[get_book_parser_dep] = lambda: book_parser
    if image_generator:
        overrides[get_image_generator_service_dep] = lambda: image_generator
    if gemini_extractor:
        overrides[get_gemini_extractor_dep] = lambda: gemini_extractor
    if auth_service:
        overrides[get_auth_service_dep] = lambda: auth_service
    if book_service:
        overrides[get_book_service_dep] = lambda: book_service
    if token_blacklist:
        overrides[get_token_blacklist_dep] = lambda: token_blacklist

    return overrides

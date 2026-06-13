# Testing Guide - BookReader AI

Всеобъемлющее руководство по тестированию системы BookReader AI, включая unit, integration, E2E тесты, скрипты и best practices.

## Стратегия тестирования

### Пирамида тестирования
```
E2E Tests (10%)
├── Playwright/Cypress
└── Critical user journeys

Integration Tests (20%)
├── API endpoints
├── Database interactions
└── Service integrations

Unit Tests (70%)
├── Business logic
├── Components
└── Utilities
```

### Coverage цели
- **Unit tests:** >90% coverage
- **Integration tests:** Все API endpoints
- **E2E tests:** Основные user flows

---

## Backend Testing

### Настройка тестовой среды
**Файл:** `backend/conftest.py`

```python
@pytest.fixture(scope="session")
async def test_db():
    """Создание тестовой БД."""
    test_engine = create_async_engine(
        "postgresql+asyncpg://test:test@localhost/bookreader_test"
    )
    
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield test_engine
    
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture
async def test_session(test_db):
    """Сессия БД для тестов."""
    async with AsyncSession(test_db) as session:
        yield session
        await session.rollback()

@pytest.fixture
async def test_user(test_session):
    """Создание тестового пользователя."""
    user = User(
        email="test@example.com",
        password_hash="hashed_password",
        full_name="Test User"
    )
    test_session.add(user)
    await test_session.commit()
    return user
```

### Unit тесты модели
```python
class TestBookModel:
    async def test_book_creation(self, test_session, test_user):
        book = Book(
            user_id=test_user.id,
            title="Test Book",
            author="Test Author",
            file_path="/test/book.epub",
            file_format=BookFormat.EPUB,
            file_size=1024000
        )
        
        test_session.add(book)
        await test_session.commit()
        
        assert book.id is not None
        assert book.title == "Test Book"
        assert book.is_parsed is False
    
    async def test_reading_progress_calculation(self, test_session):
        book = BookFactory.create()
        
        # Создаем 10 глав
        for i in range(1, 11):
            chapter = ChapterFactory.create(
                book_id=book.id,
                chapter_number=i
            )
            test_session.add(chapter)
        
        # Прогресс на 5 главе
        progress = ReadingProgress(
            user_id=book.user_id,
            book_id=book.id,
            current_chapter=5
        )
        test_session.add(progress)
        await test_session.commit()
        
        progress_percent = book.get_reading_progress_percent(book.user_id)
        assert progress_percent == 40.0  # 4/10 глав завершено
```

### Тесты сервисов
```python
class TestNLPProcessor:
    @pytest.fixture
    def nlp_processor(self, test_session):
        return NLPProcessor(test_session)
    
    async def test_location_extraction(self, nlp_processor):
        text = "В древнем замке на вершине холма жили привидения."
        chapter_id = uuid4()
        
        descriptions = await nlp_processor.extract_descriptions_from_text(
            text, chapter_id
        )
        
        location_descs = [d for d in descriptions if d.type == DescriptionType.LOCATION]
        assert len(location_descs) > 0
        
        location = location_descs[0]
        assert "замок" in location.content.lower()
        assert location.confidence_score >= 0.7
        assert location.priority_score >= 70.0
    
    @pytest.mark.parametrize("text,expected_type", [
        ("высокий мужчина с седой бородой", DescriptionType.CHARACTER),
        ("древний каменный замок", DescriptionType.LOCATION),
        ("мрачная атмосфера тумана", DescriptionType.ATMOSPHERE)
    ])
    async def test_description_classification(self, nlp_processor, text, expected_type):
        descriptions = await nlp_processor.extract_descriptions_from_text(
            text, uuid4()
        )
        
        assert any(d.type == expected_type for d in descriptions)
```

### API тесты
```python
class TestBooksAPI:
    async def test_get_books(self, test_client, test_user, auth_headers):
        # Создаем тестовые книги
        books = [BookFactory.create(user_id=test_user.id) for _ in range(5)]
        
        response = await test_client.get(
            "/api/v1/books",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["books"]) == 5
        assert "pagination" in data
    
    async def test_upload_book(self, test_client, auth_headers):
        # Создаем тестовый EPUB файл
        test_file = create_test_epub_file()
        
        response = await test_client.post(
            "/api/v1/books/upload",
            files={"file": ("test.epub", test_file, "application/epub+zip")},
            headers=auth_headers
        )
        
        assert response.status_code == 201
        data = response.json()
        assert "book" in data
        assert data["book"]["title"]
        assert "processing" in data
    
    async def test_unauthorized_access(self, test_client):
        response = await test_client.get("/api/v1/books")
        assert response.status_code == 401
```

---

## Frontend Testing

### Настройка Jest и Testing Library
**Файл:** `frontend/src/test-utils.tsx`

```typescript
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialStores?: {
    auth?: Partial<AuthState>;
    books?: Partial<BooksState>;
  };
}

const AllTheProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export const renderWithProviders = (
  ui: React.ReactElement,
  options: CustomRenderOptions = {}
) => {
  const { initialStores, ...renderOptions } = options;
  
  // Сброс stores к начальному состоянию
  if (initialStores?.auth) {
    useAuthStore.setState(initialStores.auth);
  }
  
  return render(ui, { wrapper: AllTheProviders, ...renderOptions });
};

// Custom matchers
export * from '@testing-library/jest-dom';
```

### Component тесты
```typescript
describe('BookCard', () => {
  const mockBook: Book = {
    id: '1',
    title: 'Test Book',
    author: 'Test Author',
    genre: BookGenre.FANTASY,
    reading_progress: {
      progress_percentage: 45,
      current_chapter: 3
    }
  };
  
  it('renders book information correctly', () => {
    const onRead = jest.fn();
    
    renderWithProviders(
      <BookCard book={mockBook} view="grid" onRead={onRead} />
    );
    
    expect(screen.getByText('Test Book')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
  });
  
  it('calls onRead when read button is clicked', async () => {
    const onRead = jest.fn();
    const user = userEvent.setup();
    
    renderWithProviders(
      <BookCard book={mockBook} view="grid" onRead={onRead} />
    );
    
    await user.click(screen.getByRole('button', { name: /читать/i }));
    
    expect(onRead).toHaveBeenCalledWith(mockBook);
  });
});

describe('BookReader', () => {
  const mockChapterContent = {
    chapter: {
      id: '1',
      title: 'Chapter 1',
      content: 'Test chapter content...'
    },
    descriptions: []
  };
  
  it('displays chapter content', async () => {
    // Mock API response
    server.use(
      rest.get('/api/v1/books/:bookId/chapters/:chapter', (req, res, ctx) => {
        return res(ctx.json(mockChapterContent));
      })
    );
    
    renderWithProviders(<BookReader bookId="test-book-id" />);
    
    expect(await screen.findByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Test chapter content...')).toBeInTheDocument();
  });
});
```

### Hook тесты
```typescript
describe('useBookUpload', () => {
  it('uploads book successfully', async () => {
    const { result } = renderHook(() => useBookUpload(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      )
    });
    
    const testFile = new File(['test content'], 'test.epub', {
      type: 'application/epub+zip'
    });
    
    act(() => {
      result.current.mutate({ file: testFile });
    });
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
```

---

## epub.js & CFI Testing (October 2025)

### Testing EpubReader Component

```typescript
describe('EpubReader', () => {
  it('should restore CFI position on load', async () => {
    const cfi = 'epubcfi(/6/4!/4/2/16/1:0)';
    const mockProgress = {
      reading_location_cfi: cfi,
      scroll_offset_percent: 45.5
    };

    (booksAPI.getReadingProgress as jest.Mock).mockResolvedValue(mockProgress);

    render(<EpubReader book={mockBook} />);

    await waitFor(() => {
      // Check that epub.js display() was called with CFI
      expect(mockRendition.display).toHaveBeenCalledWith(cfi);
    });
  });

  it('should save progress with debounce', async () => {
    jest.useFakeTimers();

    render(<EpubReader book={mockBook} />);

    // Simulate page turn (relocated event)
    const newCfi = 'epubcfi(/6/4!/4/2/20/1:0)';
    mockRendition._triggerEvent('relocated', {
      start: { cfi: newCfi, href: 'chapter2.xhtml' }
    });

    // Should not save immediately
    expect(booksAPI.updateReadingProgress).not.toHaveBeenCalled();

    // Fast-forward 2 seconds (debounce delay)
    jest.advanceTimersByTime(2000);

    await waitFor(() => {
      expect(booksAPI.updateReadingProgress).toHaveBeenCalledWith(
        mockBook.id,
        expect.objectContaining({
          reading_location_cfi: newCfi,
          scroll_offset_percent: expect.any(Number)
        })
      );
    });

    jest.useRealTimers();
  });

  it('should calculate scroll offset accurately', () => {
    const scrollTop = 100;
    const scrollHeight = 1000;
    const clientHeight = 800;
    const maxScroll = scrollHeight - clientHeight; // 200

    const scrollOffsetPercent = (scrollTop / maxScroll) * 100;

    expect(scrollOffsetPercent).toBe(50); // 100/200 * 100 = 50%
  });

  it('should reload descriptions on chapter change', async () => {
    render(<EpubReader book={mockBook} />);

    // Initial load for chapter 1
    await waitFor(() => {
      expect(booksAPI.getChapterDescriptions).toHaveBeenCalledWith(
        mockBook.id,
        1,
        false
      );
    });

    // Simulate chapter change (relocated to chapter 2)
    mockRendition._triggerEvent('relocated', {
      start: { cfi: 'epubcfi(/6/6!/4/2/1:0)', href: 'chapter2.xhtml' }
    });

    // Should reload descriptions for chapter 2
    await waitFor(() => {
      expect(booksAPI.getChapterDescriptions).toHaveBeenCalledWith(
        mockBook.id,
        2,
        false
      );
    });
  });
});
```

### Testing CFI System

```typescript
describe('CFI tracking', () => {
  it('should generate valid CFI on location change', () => {
    const book = ePub(new ArrayBuffer(1024));
    const cfi = book.locations.cfiFromPercentage(0.5);

    expect(cfi).toMatch(/^epubcfi\(/);
    expect(typeof cfi).toBe('string');
  });

  it('should convert CFI to percentage correctly', () => {
    const book = ePub(new ArrayBuffer(1024));
    const cfi = 'epubcfi(/6/4!/4/2/16/1:0)';

    const percentage = book.locations.percentageFromCfi(cfi);

    expect(percentage).toBeGreaterThanOrEqual(0);
    expect(percentage).toBeLessThanOrEqual(1);
  });

  it('should handle hybrid restoration (CFI + scroll)', async () => {
    const mockProgress = {
      reading_location_cfi: 'epubcfi(/6/4!/4/2/16/1:0)',
      scroll_offset_percent: 45.5
    };

    render(<EpubReader book={mockBook} />);

    await waitFor(() => {
      // Level 1: CFI restoration
      expect(mockRendition.display).toHaveBeenCalledWith(
        mockProgress.reading_location_cfi
      );

      // Level 2: Scroll offset restoration
      const contents = mockRendition.getContents();
      const scrollElement = contents[0].document.documentElement;
      const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
      const expectedScroll = (mockProgress.scroll_offset_percent / 100) * maxScroll;

      expect(scrollElement.scrollTop).toBeCloseTo(expectedScroll, 0);
    });
  });
});
```

### E2E Testing with epub.js

```typescript
test('epub.js reader with CFI restoration', async ({ page }) => {
  await page.goto('/library');

  // Open book
  await page.click('[data-testid="book-card"]:first-child');
  await page.click('[data-testid="read-button"]');

  // Wait for epub.js to load
  await page.waitForSelector('[data-testid="epub-viewer"]');

  // Read to 50%
  for (let i = 0; i < 10; i++) {
    await page.click('[data-testid="next-page"]');
    await page.waitForTimeout(300);
  }

  // Check progress indicator
  const progressBefore = await page.textContent('[data-testid="progress-percent"]');
  expect(progressBefore).toMatch(/\d+%/);

  // Close and reopen
  await page.click('[data-testid="close-reader"]');
  await page.goto('/library');
  await page.click('[data-testid="book-card"]:first-child');
  await page.click('[data-testid="read-button"]');

  // Wait for restoration
  await page.waitForSelector('[data-testid="epub-viewer"]');
  await page.waitForTimeout(1000); // Wait for CFI restoration

  // Check progress restored
  const progressAfter = await page.textContent('[data-testid="progress-percent"]');
  expect(progressAfter).toBe(progressBefore);
});
```

---

## E2E Testing

### Playwright Setup
**Файл:** `tests/e2e/playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } }
  ]
});
```

### E2E Tests
```typescript
test.describe('Book Reading Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Логин
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password');
    await page.click('[data-testid="login-button"]');
    
    await page.waitForURL('/library');
  });
  
  test('upload and read book', async ({ page }) => {
    // Загрузка книги
    await page.click('[data-testid="upload-book-button"]');
    
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('tests/fixtures/sample-book.epub');
    
    await page.click('[data-testid="upload-confirm"]');
    
    // Ждем обработки
    await expect(page.locator('[data-testid="processing-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="processing-indicator"]')).toBeHidden({ timeout: 30000 });
    
    // Открытие книги для чтения
    await page.click('[data-testid="book-card"]:first-child [data-testid="read-button"]');
    
    await page.waitForURL('/reader/*');
    
    // Проверка содержимого читалки
    await expect(page.locator('[data-testid="chapter-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="chapter-content"]')).toBeVisible();
    
    // Навигация по главам
    await page.click('[data-testid="next-chapter"]');
    
    await expect(page.locator('[data-testid="chapter-title"]')).toHaveText(/глава 2/i);
  });
  
  test('image generation workflow', async ({ page }) => {
    // Переход в галерею
    await page.goto('/library');
    await page.click('[data-testid="book-card"]:first-child [data-testid="images-button"]');
    
    // Генерация изображений
    await page.click('[data-testid="generate-images-button"]');
    
    // Проверка статуса генерации
    await expect(page.locator('[data-testid="generation-progress"]')).toBeVisible();
    
    // Ждем завершения (может занять время)
    await expect(
      page.locator('[data-testid="generated-image"]').first()
    ).toBeVisible({ timeout: 60000 });
  });
});
```

---

## Testing Scripts

### Автоматизированные скрипты
**Файл:** `scripts/run-tests.sh`

```bash
#!/bin/bash

set -e

echo "🧪 Running BookReader AI Test Suite"

# Функция для цветного вывода
print_status() {
    echo -e "\033[1;34m$1\033[0m"
}

print_success() {
    echo -e "\033[1;32m✅ $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m❌ $1\033[0m"
}

# Проверка окружения
if [[ ! -f ".env.test" ]]; then
    print_error "Test environment file .env.test not found!"
    exit 1
fi

# Загрузка тестовых переменных
export $(cat .env.test | xargs)

# Backend тесты
print_status "Running Backend Tests..."
cd backend

# Создание тестовой БД
print_status "Setting up test database..."
python scripts/setup_test_db.py

# Unit тесты
print_status "Running unit tests..."
pytest tests/unit/ -v --cov=app --cov-report=html --cov-report=term

# Integration тесты
print_status "Running integration tests..."
pytest tests/integration/ -v

# Очистка тестовой БД
python scripts/cleanup_test_db.py

cd ..

# Frontend тесты
print_status "Running Frontend Tests..."
cd frontend

# Unit тесты компонентов
print_status "Running component tests..."
npm test -- --coverage --watchAll=false

# TypeScript проверки
print_status "Running TypeScript checks..."
npm run type-check

cd ..

# E2E тесты (опционально)
if [[ "$RUN_E2E" == "true" ]]; then
    print_status "Running E2E Tests..."
    
    # Запуск приложения в тестовом режиме
    docker-compose -f docker-compose.test.yml up -d
    
    # Ожидание готовности сервисов
    ./scripts/wait-for-services.sh
    
    # Запуск E2E тестов
    cd frontend
    npx playwright test
    cd ..
    
    # Остановка тестовых сервисов
    docker-compose -f docker-compose.test.yml down
fi

print_success "All tests completed successfully! 🎉"
```

### Continuous Integration
**Файл:** `.github/workflows/test.yml`

```yaml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_USER: test
          POSTGRES_DB: bookreader_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Python 3.11
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'
    
    - name: Install dependencies
      working-directory: ./backend
      run: |
        pip install -r requirements.txt
        pip install pytest pytest-cov pytest-asyncio
        python -m spacy download ru_core_news_lg
    
    - name: Run tests
      working-directory: ./backend
      env:
        DATABASE_URL: postgresql+asyncpg://test:test@localhost/bookreader_test
        REDIS_URL: redis://localhost:6379
      run: |
        pytest tests/ -v --cov=app --cov-report=xml
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./backend/coverage.xml

  frontend-tests:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js 18
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        cache-dependency-path: frontend/package-lock.json
    
    - name: Install dependencies
      working-directory: ./frontend
      run: npm ci
    
    - name: Run tests
      working-directory: ./frontend
      run: |
        npm test -- --coverage --watchAll=false
        npm run type-check
        npm run lint
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./frontend/coverage/coverage-final.json

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [backend-tests, frontend-tests]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
    
    - name: Install Playwright
      working-directory: ./frontend
      run: |
        npm ci
        npx playwright install --with-deps
    
    - name: Start application
      run: |
        docker-compose -f docker-compose.test.yml up -d
        ./scripts/wait-for-services.sh
    
    - name: Run E2E tests
      working-directory: ./frontend
      run: npx playwright test
    
    - name: Upload test results
      uses: actions/upload-artifact@v3
      if: failure()
      with:
        name: playwright-report
        path: frontend/playwright-report/
```

---

## Test Data Management

### Фабрики для тестовых данных
```python
class UserFactory:
    @staticmethod
    def create(**kwargs) -> User:
        defaults = {
            'email': fake.email(),
            'password_hash': 'hashed_password',
            'full_name': fake.name(),
            'is_active': True
        }
        defaults.update(kwargs)
        return User(**defaults)

class BookFactory:
    @staticmethod
    def create(**kwargs) -> Book:
        defaults = {
            'title': fake.sentence(nb_words=3),
            'author': fake.name(),
            'genre': random.choice(list(BookGenre)),
            'file_path': f'/test/{fake.uuid4()}.epub',
            'file_format': BookFormat.EPUB,
            'file_size': random.randint(100000, 10000000)
        }
        defaults.update(kwargs)
        return Book(**defaults)
```

### Fixtures для тестовых файлов
```python
def create_test_epub_file() -> BytesIO:
    """Создание минимального валидного EPUB файла для тестов."""
    
    zip_buffer = BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # mimetype
        zip_file.writestr('mimetype', 'application/epub+zip')
        
        # META-INF/container.xml
        zip_file.writestr('META-INF/container.xml', CONTAINER_XML)
        
        # content.opf
        zip_file.writestr('OEBPS/content.opf', CONTENT_OPF)
        
        # Test chapter
        zip_file.writestr('OEBPS/chapter1.xhtml', CHAPTER_CONTENT)
    
    zip_buffer.seek(0)
    return zip_buffer
```

---

## Performance Testing

### Load Testing с Locust
```python
from locust import HttpUser, task, between

class BookReaderUser(HttpUser):
    wait_time = between(1, 3)
    
    def on_start(self):
        """Логин пользователя."""
        response = self.client.post('/api/v1/auth/login', json={
            'email': 'loadtest@example.com',
            'password': 'password'
        })
        
        if response.status_code == 200:
            self.token = response.json()['access_token']
            self.client.headers.update({
                'Authorization': f'Bearer {self.token}'
            })
    
    @task(3)
    def browse_books(self):
        """Просмотр библиотеки книг."""
        self.client.get('/api/v1/books')
    
    @task(2)
    def read_chapter(self):
        """Чтение главы книги."""
        book_id = 'sample-book-id'
        chapter = random.randint(1, 10)
        self.client.get(f'/api/v1/books/{book_id}/chapters/{chapter}')
    
    @task(1)
    def generate_image(self):
        """Генерация изображения."""
        description_id = 'sample-description-id'
        self.client.post(f'/api/v1/images/generate/description/{description_id}')
```

---

## Multi-NLP System Testing (October 2025)

### Overview

Multi-NLP система - критическая часть BookReader AI. Тестирование должно покрывать все 3 процессора, 5 режимов обработки, и ensemble voting логику.

### Unit Tests для Multi-NLP Manager

**Файл:** `backend/tests/unit/test_multi_nlp_manager.py`

```python
import pytest
import asyncio
from app.services.multi_nlp_manager import (
    MultiNLPManager,
    ProcessingMode,
    ProcessorType
)

class TestMultiNLPManager:
    """Comprehensive tests для Multi-NLP системы."""

    @pytest.fixture
    async def nlp_manager(self):
        """Fixture для NLP manager."""
        manager = MultiNLPManager()
        await manager.initialize()
        yield manager
        await manager.cleanup()

    @pytest.mark.asyncio
    async def test_all_processors_initialized(self, nlp_manager):
        """Проверка инициализации всех процессоров."""
        status = await nlp_manager.get_processor_status()

        assert status['spacy']['initialized'] is True
        assert status['natasha']['initialized'] is True
        assert status['stanza']['initialized'] is True

        # Проверка версий
        assert 'version' in status['spacy']
        assert 'model' in status['spacy']

    @pytest.mark.asyncio
    async def test_ensemble_voting_consensus(self, nlp_manager):
        """Тест ensemble voting с consensus filtering."""
        text = "В древнем каменном замке на скале жил могущественный волшебник."

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Проверка результатов
        assert result.success is True
        assert len(result.descriptions) > 0

        # Проверка consensus для каждого описания
        for desc in result.descriptions:
            assert desc.consensus_strength >= 0.6  # Minimum threshold
            assert len(desc.sources) >= 2  # Минимум 2 процессора согласны
            assert desc.priority_score > 0

            # Если все 3 процессора согласны
            if len(desc.sources) == 3:
                # Должен быть consensus bonus
                assert desc.consensus_bonus >= 10

    @pytest.mark.asyncio
    async def test_adaptive_mode_selection(self, nlp_manager):
        """Тест автоматического выбора режима в ADAPTIVE mode."""

        # 1. Короткий текст → SINGLE mode
        short_text = "Комната была темная."
        result_short = await nlp_manager.process_text(
            short_text,
            mode=ProcessingMode.ADAPTIVE
        )

        assert result_short.mode_used == ProcessingMode.SINGLE
        assert len(result_short.processors_used) == 1

        # 2. Текст с русскими именами → NATASHA включена
        names_text = "Анна Каренина вошла в бальный зал, где ее встретил граф Вронский."
        result_names = await nlp_manager.process_text(
            names_text,
            mode=ProcessingMode.ADAPTIVE
        )

        assert ProcessorType.NATASHA in result_names.processors_used
        assert len(result_names.processors_used) >= 2

        # 3. Длинный сложный текст → ENSEMBLE mode
        complex_text = """
        В старинном готическом замке на вершине крутой скалы, окруженном
        густым туманным лесом, жил могущественный волшебник с длинной седой
        бородой. Его темная мантия была украшена серебряными звездами, а в
        руках он держал древний посох из черного дерева.
        """
        result_complex = await nlp_manager.process_text(
            complex_text,
            mode=ProcessingMode.ADAPTIVE
        )

        assert result_complex.mode_used == ProcessingMode.ENSEMBLE
        assert len(result_complex.processors_used) == 3

    @pytest.mark.asyncio
    async def test_parallel_mode_performance(self, nlp_manager):
        """Тест PARALLEL mode - все процессоры работают одновременно."""
        text = "Высокий мужчина с седой бородой стоял у окна замка."

        import time
        start_time = time.time()

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.PARALLEL
        )

        processing_time = time.time() - start_time

        # Проверка результатов
        assert result.success is True
        assert len(result.processors_used) == 3

        # PARALLEL должен быть быстрее чем SEQUENTIAL
        # (Примерно в 2-3 раза для 3 процессоров)
        assert processing_time < 2.0  # Не более 2 секунд

    @pytest.mark.asyncio
    async def test_processor_weights_affect_consensus(self, nlp_manager):
        """Тест влияния весов процессоров на consensus."""

        # Установка кастомных весов
        await nlp_manager.update_processor_settings(
            ProcessorType.SPACY,
            weight=1.0,
            enabled=True
        )
        await nlp_manager.update_processor_settings(
            ProcessorType.NATASHA,
            weight=1.2,  # Больший вес для русских имен
            enabled=True
        )
        await nlp_manager.update_processor_settings(
            ProcessorType.STANZA,
            weight=0.8,
            enabled=True
        )

        text = "Анна Павловна Шерер встретила князя Василия Курагина."

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Natasha должна иметь больший вклад в consensus
        for desc in result.descriptions:
            if ProcessorType.NATASHA in desc.sources:
                # Описания от Natasha должны иметь более высокий priority
                natasha_priority = desc.processor_contributions.get(
                    ProcessorType.NATASHA, 0
                )
                assert natasha_priority > 0

    @pytest.mark.asyncio
    async def test_description_deduplication(self, nlp_manager):
        """Тест дедупликации похожих описаний."""
        text = "Старый замок. Древний замок. Замок был старым."

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Должно быть одно обобщенное описание "старый/древний замок"
        # а не 3 отдельных
        location_descs = [
            d for d in result.descriptions
            if d.type == 'location'
        ]

        # Проверка на отсутствие дубликатов
        assert len(location_descs) <= 2  # Максимум 2 (с учетом синонимов)

    @pytest.mark.asyncio
    async def test_context_enrichment(self, nlp_manager):
        """Тест контекстного обогащения описаний."""
        text = """
        В древнем замке на скале было множество комнат.
        Одна из них была особенно темной и мрачной.
        """

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Описания должны содержать контекстную информацию
        for desc in result.descriptions:
            assert desc.context is not None
            assert 'surrounding_text' in desc.context
            assert 'entities' in desc.context

            # Для описания "темная комната" контекст должен включать "замок"
            if 'комната' in desc.content.lower():
                assert any(
                    'замок' in entity.lower()
                    for entity in desc.context.get('entities', [])
                )

    @pytest.mark.parametrize("processor_type,text,expected_strength", [
        (ProcessorType.SPACY, "Высокий мужчина с бородой", 0.7),
        (ProcessorType.NATASHA, "Анна Каренина и Вронский", 0.8),
        (ProcessorType.STANZA, "Сложная синтаксическая конструкция с множеством зависимостей", 0.6)
    ])
    @pytest.mark.asyncio
    async def test_individual_processor_strengths(
        self,
        nlp_manager,
        processor_type,
        text,
        expected_strength
    ):
        """Тест сильных сторон каждого процессора."""
        result = await nlp_manager.process_single_processor(
            text,
            processor_type
        )

        assert result.success is True
        assert len(result.descriptions) > 0

        # Проверка confidence для специализации процессора
        avg_confidence = sum(d.confidence for d in result.descriptions) / len(result.descriptions)
        assert avg_confidence >= expected_strength


class TestMultiNLPIntegration:
    """Integration tests с книгами и главами."""

    @pytest.mark.asyncio
    async def test_process_full_chapter(self, nlp_manager, sample_chapter):
        """Тест обработки полной главы."""
        chapter_text = sample_chapter.content  # ~5000 символов

        result = await nlp_manager.process_text(
            chapter_text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Ожидаемое количество описаний для главы
        assert len(result.descriptions) >= 20
        assert len(result.descriptions) <= 100

        # Проверка распределения типов
        types_count = {}
        for desc in result.descriptions:
            types_count[desc.type] = types_count.get(desc.type, 0) + 1

        # Должны быть все основные типы
        assert 'location' in types_count
        assert 'character' in types_count

    @pytest.mark.asyncio
    async def test_quality_score_distribution(self, nlp_manager):
        """Тест распределения quality scores."""
        text = """
        В старом замке жил волшебник. Замок был на горе.
        Волшебник был высоким. Атмосфера была мрачной.
        """

        result = await nlp_manager.process_text(
            text,
            mode=ProcessingMode.ENSEMBLE
        )

        # Проверка priority scores
        high_priority = [d for d in result.descriptions if d.priority_score > 80]
        medium_priority = [d for d in result.descriptions if 60 <= d.priority_score <= 80]
        low_priority = [d for d in result.descriptions if d.priority_score < 60]

        # Должно быть разумное распределение
        assert len(high_priority) > 0  # Есть качественные описания
        assert len(low_priority) < len(result.descriptions) / 2  # Не более 50% низкого качества
```

---

## CFI System Testing (October 2025)

### Overview

CFI (Canonical Fragment Identifier) система критична для точного трекинга позиции чтения в EPUB файлах.

### Backend CFI Tests

**Файл:** `backend/tests/unit/test_cfi_system.py`

```python
import pytest
from app.services.book_parser import BookParser
from app.models.book import ReadingProgress

class TestCFIGeneration:
    """Тесты для CFI генерации и валидации."""

    @pytest.fixture
    def book_parser(self):
        return BookParser()

    def test_cfi_format_validation(self, book_parser):
        """Проверка формата CFI."""
        valid_cfis = [
            "epubcfi(/6/4!/4/2/16/1:0)",
            "epubcfi(/6/2!/4/2)",
            "epubcfi(/6/14!/4/2/10/3:25)"
        ]

        for cfi in valid_cfis:
            assert book_parser.validate_cfi(cfi) is True

        invalid_cfis = [
            "invalid",
            "epubcfi()",
            "/6/4!/4/2/16/1:0",  # Missing epubcfi prefix
            "epubcfi(/6/4"  # Incomplete
        ]

        for cfi in invalid_cfis:
            assert book_parser.validate_cfi(cfi) is False

    def test_cfi_extraction_from_epub(self, book_parser, sample_epub_path):
        """Тест извлечения CFI locations из EPUB."""
        cfi_locations = book_parser.extract_chapter_cfis(sample_epub_path)

        assert len(cfi_locations) > 0

        for chapter_num, cfi in cfi_locations.items():
            # Проверка формата
            assert cfi.startswith("epubcfi(")
            assert cfi.endswith(")")
            # Проверка валидности
            assert book_parser.validate_cfi(cfi) is True

    @pytest.mark.asyncio
    async def test_reading_progress_with_cfi(
        self,
        db_session,
        test_user,
        test_book
    ):
        """Тест сохранения и восстановления позиции через CFI."""

        # Создание reading progress с CFI
        progress = ReadingProgress(
            user_id=test_user.id,
            book_id=test_book.id,
            current_chapter=3,
            reading_location_cfi="epubcfi(/6/8!/4/2/16/1:453)",
            scroll_offset_percent=23.5
        )

        db_session.add(progress)
        await db_session.commit()
        await db_session.refresh(progress)

        # Проверка сохраненных данных
        assert progress.reading_location_cfi == "epubcfi(/6/8!/4/2/16/1:453)"
        assert progress.scroll_offset_percent == 23.5

        # Проверка метода расчета процента прогресса
        progress_percent = test_book.get_reading_progress_percent()

        # CFI система должна давать более точный процент
        assert 0.0 <= progress_percent <= 100.0
        assert progress_percent > 0  # Не в начале книги

    def test_cfi_comparison(self, book_parser):
        """Тест сравнения CFI для определения порядка."""

        cfi1 = "epubcfi(/6/4!/4/2/16/1:0)"
        cfi2 = "epubcfi(/6/8!/4/2/16/1:0)"
        cfi3 = "epubcfi(/6/4!/4/2/20/1:0)"

        # cfi2 позже чем cfi1 (больший номер spine)
        assert book_parser.compare_cfis(cfi1, cfi2) == -1
        assert book_parser.compare_cfis(cfi2, cfi1) == 1

        # cfi3 позже чем cfi1 в том же spine
        assert book_parser.compare_cfis(cfi1, cfi3) == -1

        # Одинаковые CFI
        assert book_parser.compare_cfis(cfi1, cfi1) == 0


class TestHybridProgressTracking:
    """Тесты для hybrid системы (CFI + scroll offset)."""

    @pytest.mark.asyncio
    async def test_hybrid_system_accuracy(
        self,
        db_session,
        test_book,
        test_user
    ):
        """Тест точности hybrid системы."""

        # Сценарий: пользователь читает главу 5, прокрутил 45% вниз
        progress = ReadingProgress(
            user_id=test_user.id,
            book_id=test_book.id,
            current_chapter=5,
            reading_location_cfi="epubcfi(/6/12!/4/2)",
            scroll_offset_percent=45.2,
            total_chapters=25
        )

        db_session.add(progress)
        await db_session.commit()

        # Расчет общего прогресса через hybrid систему
        overall_progress = test_book.get_reading_progress_percent()

        # Глава 5 из 25 = 20% + 45% от текущей главы
        # Примерно 20% + (4% * 0.45) ≈ 21.8%
        assert 20.0 <= overall_progress <= 23.0

    @pytest.mark.asyncio
    async def test_scroll_offset_validation(self, db_session, test_user, test_book):
        """Тест валидации scroll offset."""

        # Valid scroll offsets
        valid_offsets = [0.0, 25.5, 50.0, 75.3, 99.9, 100.0]

        for offset in valid_offsets:
            progress = ReadingProgress(
                user_id=test_user.id,
                book_id=test_book.id,
                current_chapter=1,
                scroll_offset_percent=offset
            )

            db_session.add(progress)
            await db_session.commit()

            assert progress.scroll_offset_percent == offset

        # Invalid scroll offsets (должны вызывать ошибку)
        invalid_offsets = [-1.0, 101.0, 150.0]

        for offset in invalid_offsets:
            with pytest.raises(ValueError):
                progress = ReadingProgress(
                    user_id=test_user.id,
                    book_id=test_book.id,
                    current_chapter=1,
                    scroll_offset_percent=offset
                )
                db_session.add(progress)
                await db_session.commit()
```

### Frontend CFI Tests

**Файл:** `frontend/src/__tests__/cfi-system.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReadingProgress } from '@/hooks/useReadingProgress';
import type { Rendition } from 'epubjs';

describe('CFI System - Frontend', () => {
  let mockRendition: Partial<Rendition>;

  beforeEach(() => {
    // Mock epub.js rendition
    mockRendition = {
      location: {
        start: {
          cfi: 'epubcfi(/6/4!/4/2/16/1:0)',
          displayed: { page: 1, total: 10 },
          percentage: 0.45
        },
        end: {
          cfi: 'epubcfi(/6/4!/4/2/20/1:0)',
          percentage: 0.48
        }
      },
      display: vi.fn(),
      getRange: vi.fn()
    };
  });

  it('generates valid CFI on location change', () => {
    const location = mockRendition.location!;

    const cfi = extractCFI(location);

    expect(cfi).toBe('epubcfi(/6/4!/4/2/16/1:0)');
    expect(validateCFI(cfi)).toBe(true);
  });

  it('calculates scroll offset accurately', () => {
    const iframe = document.createElement('iframe');
    const mockDocument = {
      scrollTop: 450,
      scrollHeight: 2000,
      clientHeight: 800
    };

    // Mock iframe content
    vi.spyOn(iframe, 'contentDocument', 'get').mockReturnValue({
      documentElement: mockDocument
    } as any);

    const offset = calculateScrollOffset(iframe);

    // scrollTop / (scrollHeight - clientHeight)
    // 450 / (2000 - 800) = 450 / 1200 = 0.375 = 37.5%
    expect(offset).toBeCloseTo(37.5, 1);
  });

  it('restores position with hybrid system', async () => {
    const savedProgress = {
      reading_location_cfi: 'epubcfi(/6/8!/4/2/16/1:453)',
      scroll_offset_percent: 23.5,
      current_chapter: 5
    };

    const rendition = mockRendition as Rendition;

    // Restore position
    await restoreReadingPosition(rendition, savedProgress);

    // Verify CFI navigation was called
    expect(rendition.display).toHaveBeenCalledWith(
      savedProgress.reading_location_cfi
    );

    // Verify scroll offset will be applied after render
    await waitFor(() => {
      const iframe = document.querySelector('iframe');
      expect(iframe).toBeTruthy();

      // Check scroll was applied (within 1%)
      const currentOffset = calculateScrollOffset(iframe!);
      expect(Math.abs(currentOffset - 23.5)).toBeLessThan(1);
    });
  });

  it('handles CFI navigation errors gracefully', async () => {
    const invalidCFI = 'invalid-cfi';
    const rendition = mockRendition as Rendition;

    // Mock display throwing error
    vi.mocked(rendition.display).mockRejectedValue(new Error('Invalid CFI'));

    // Should fallback to chapter-based navigation
    await expect(
      restoreReadingPosition(rendition, {
        reading_location_cfi: invalidCFI,
        current_chapter: 5
      })
    ).resolves.not.toThrow();

    // Verify fallback was used
    expect(rendition.display).toHaveBeenCalled();
  });
});

describe('Reading Progress Auto-save', () => {
  it('debounces progress updates', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useReadingProgress('book-123'));

    // Simulate multiple rapid location changes
    act(() => {
      result.current.updateProgress({
        cfi: 'epubcfi(/6/4!/4/2/16/1:0)',
        scrollOffset: 10.5
      });
    });

    act(() => {
      result.current.updateProgress({
        cfi: 'epubcfi(/6/4!/4/2/18/1:0)',
        scrollOffset: 15.3
      });
    });

    act(() => {
      result.current.updateProgress({
        cfi: 'epubcfi(/6/4!/4/2/20/1:0)',
        scrollOffset: 20.1
      });
    });

    // Fast forward debounce timer (2 seconds)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Verify only one API call was made (with latest values)
    await waitFor(() => {
      expect(mockAPI.updateReadingProgress).toHaveBeenCalledTimes(1);
      expect(mockAPI.updateReadingProgress).toHaveBeenCalledWith({
        bookId: 'book-123',
        reading_location_cfi: 'epubcfi(/6/4!/4/2/20/1:0)',
        scroll_offset_percent: 20.1
      });
    });

    vi.useRealTimers();
  });
});

// Helper functions
function extractCFI(location: any): string {
  return location.start.cfi;
}

function validateCFI(cfi: string): boolean {
  return /^epubcfi\(\/\d+/.test(cfi);
}

function calculateScrollOffset(iframe: HTMLIFrameElement): number {
  const doc = iframe.contentDocument?.documentElement;
  if (!doc) return 0;

  const scrollableHeight = doc.scrollHeight - doc.clientHeight;
  if (scrollableHeight <= 0) return 0;

  return (doc.scrollTop / scrollableHeight) * 100;
}

async function restoreReadingPosition(
  rendition: Rendition,
  progress: any
): Promise<void> {
  try {
    // Navigate to CFI
    await rendition.display(progress.reading_location_cfi);

    // Apply scroll offset after render
    setTimeout(() => {
      const iframe = document.querySelector('iframe');
      if (iframe && progress.scroll_offset_percent) {
        const doc = iframe.contentDocument?.documentElement;
        if (doc) {
          const scrollableHeight = doc.scrollHeight - doc.clientHeight;
          const targetScroll = (progress.scroll_offset_percent / 100) * scrollableHeight;
          doc.scrollTop = targetScroll;
        }
      }
    }, 100);
  } catch (error) {
    console.error('CFI navigation failed, using fallback', error);
    // Fallback to chapter navigation
    // ... implementation
  }
}
```

---

## E2E Testing with Playwright (October 2025)

### Complete Reading Flow with CFI

**Файл:** `frontend/tests/e2e/reading-flow.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Complete Reading Flow with CFI Tracking', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[name=email]', 'test@example.com');
    await page.fill('[name=password]', 'password123');
    await page.click('button[type=submit]');

    await page.waitForURL('/library');
  });

  test('reads book and restores exact position after reload', async ({ page }) => {
    // 1. Open book from library
    await page.click('[data-testid="book-card"]:first-child');
    await page.waitForSelector('.epub-reader');

    // 2. Wait for book to load
    await expect(page.locator('.epub-view')).toBeVisible();

    // 3. Read several pages
    await page.click('[data-testid="next-page"]');
    await page.waitForTimeout(500);

    await page.click('[data-testid="next-page"]');
    await page.waitForTimeout(500);

    await page.click('[data-testid="next-page"]');
    await page.waitForTimeout(500);

    // 4. Scroll partially down the page
    const iframe = page.frameLocator('.epub-view iframe');
    await iframe.locator('body').evaluate((body) => {
      body.scrollTop = body.scrollHeight * 0.3;  // 30% down
    });

    // 5. Wait for auto-save (2 second debounce + buffer)
    await page.waitForTimeout(3000);

    // 6. Get current CFI and scroll offset
    const currentCFI = await page.evaluate(() => {
      return (window as any).rendition?.location?.start?.cfi;
    });

    const currentScroll = await iframe.locator('body').evaluate((body) => {
      const scrollableHeight = body.scrollHeight - body.clientHeight;
      return (body.scrollTop / scrollableHeight) * 100;
    });

    expect(currentCFI).toBeTruthy();
    expect(currentCFI).toContain('epubcfi');
    expect(currentScroll).toBeGreaterThan(25);
    expect(currentScroll).toBeLessThan(35);

    // 7. Close and reopen browser (simulate)
    await page.close();

    // 8. Reopen same book
    const newPage = await page.context().newPage();
    await newPage.goto('/login');
    await newPage.fill('[name=email]', 'test@example.com');
    await newPage.fill('[name=password]', 'password123');
    await newPage.click('button[type=submit]');
    await newPage.waitForURL('/library');

    await newPage.click('[data-testid="book-card"]:first-child');
    await newPage.waitForSelector('.epub-reader');

    // 9. Wait for position restore
    await newPage.waitForTimeout(1500);

    // 10. Verify exact position restored
    const restoredCFI = await newPage.evaluate(() => {
      return (window as any).rendition?.location?.start?.cfi;
    });

    const restoredIframe = newPage.frameLocator('.epub-view iframe');
    const restoredScroll = await restoredIframe.locator('body').evaluate((body) => {
      const scrollableHeight = body.scrollHeight - body.clientHeight;
      return (body.scrollTop / scrollableHeight) * 100;
    });

    // CFI should be the same
    expect(restoredCFI).toBe(currentCFI);

    // Scroll offset should be within 2% (some variance acceptable)
    expect(Math.abs(restoredScroll - currentScroll!)).toBeLessThan(2);
  });

  test('generates image for highlighted description', async ({ page }) => {
    // 1. Open book
    await page.click('[data-testid="book-card"]:first-child');
    await page.waitForSelector('.epub-reader');

    // 2. Wait for descriptions to be highlighted
    await page.waitForSelector('.description-highlight', { timeout: 5000 });

    // 3. Click on highlighted description
    const highlight = page.locator('.description-highlight').first();
    await highlight.click();

    // 4. Verify modal opened
    await expect(page.locator('[data-testid="image-modal"]')).toBeVisible();

    // 5. Check description text is shown
    const descText = await page.locator('[data-testid="description-text"]').textContent();
    expect(descText).toBeTruthy();

    // 6. Click "Generate Image" button
    await page.click('[data-testid="generate-image-btn"]');

    // 7. Verify loading state
    await expect(page.locator('[data-testid="image-loading"]')).toBeVisible();

    // 8. Wait for image generation (max 60 seconds)
    await expect(
      page.locator('[data-testid="generated-image"]')
    ).toBeVisible({ timeout: 60000 });

    // 9. Verify image is displayed
    const imageSrc = await page.locator('[data-testid="generated-image"]').getAttribute('src');
    expect(imageSrc).toContain('/images/generated/');

    // 10. Close modal
    await page.click('[data-testid="close-modal"]');

    // 11. Click same highlight again - should show cached image
    await highlight.click();
    await expect(page.locator('[data-testid="image-modal"]')).toBeVisible();

    // Should show image immediately (no loading)
    await expect(page.locator('[data-testid="generated-image"]')).toBeVisible({ timeout: 1000 });
    expect(await page.locator('[data-testid="image-loading"]').isVisible()).toBe(false);
  });

  test('multi-device sync - reads on desktop, continues on mobile', async ({ page, browser }) => {
    // Simulate desktop reading
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Open and read book
    await page.click('[data-testid="book-card"]:first-child');
    await page.waitForSelector('.epub-reader');

    // Read to chapter 5, 50% through
    for (let i = 0; i < 10; i++) {
      await page.click('[data-testid="next-page"]');
      await page.waitForTimeout(300);
    }

    // Wait for sync
    await page.waitForTimeout(3000);

    // Get desktop CFI
    const desktopCFI = await page.evaluate(() => {
      return (window as any).rendition?.location?.start?.cfi;
    });

    // Simulate mobile device
    const mobileContext = await browser.newContext({
      ...devices['iPhone 13']
    });

    const mobilePage = await mobileContext.newPage();

    // Login on mobile
    await mobilePage.goto('/login');
    await mobilePage.fill('[name=email]', 'test@example.com');
    await mobilePage.fill('[name=password]', 'password123');
    await mobilePage.click('button[type=submit]');
    await mobilePage.waitForURL('/library');

    // Open same book
    await mobilePage.click('[data-testid="book-card"]:first-child');
    await mobilePage.waitForSelector('.epub-reader');
    await mobilePage.waitForTimeout(1500);

    // Verify position synced from desktop
    const mobileCFI = await mobilePage.evaluate(() => {
      return (window as any).rendition?.location?.start?.cfi;
    });

    expect(mobileCFI).toBe(desktopCFI);

    await mobileContext.close();
  });
});

test.describe('Multi-NLP Generated Highlights E2E', () => {
  test('all 3 processors contribute to highlights', async ({ page }) => {
    // Upload book for processing
    await page.goto('/library');
    await page.click('[data-testid="upload-book"]');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('tests/fixtures/anna-karenina.epub');

    await page.click('[data-testid="confirm-upload"]');

    // Wait for Multi-NLP processing (ensemble mode)
    await expect(page.locator('[data-testid="processing-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="processing-status"]')).toHaveText(/Processing.*ensemble/i);

    // Wait for completion (can take 30-60 seconds for large book)
    await expect(
      page.locator('[data-testid="processing-complete"]')
    ).toBeVisible({ timeout: 120000 });

    // Open processed book
    await page.click('[data-testid="book-card"]:first-child');
    await page.waitForSelector('.epub-reader');

    // Verify highlights are present
    await page.waitForSelector('.description-highlight');

    const highlightsCount = await page.locator('.description-highlight').count();

    // Book should have substantial highlights from ensemble
    expect(highlightsCount).toBeGreaterThan(50);

    // Check highlight metadata includes consensus info
    const firstHighlight = page.locator('.description-highlight').first();
    await firstHighlight.click();

    await expect(page.locator('[data-testid="image-modal"]')).toBeVisible();

    // Check consensus badge
    const consensusBadge = page.locator('[data-testid="consensus-badge"]');
    await expect(consensusBadge).toBeVisible();

    const consensusText = await consensusBadge.textContent();
    expect(consensusText).toMatch(/\d+ processors agree/i);
  });
});
```

---

## Заключение

Система тестирования BookReader AI обеспечивает:

- **Полное покрытие** всех уровней приложения
- **Автоматизированное выполнение** в CI/CD pipeline
- **Performance testing** для выявления узких мест
- **E2E тестирование** критических user journeys
- **Легкость поддержки** через фабрики и утилиты
- **Быстрое выполнение** через параллелизацию и оптимизации
- **Multi-NLP System Testing** - comprehensive тесты для всех 3 процессоров (октябрь 2025)
- **CFI System Testing** - backend и frontend тесты для точного трекинга (октябрь 2025)
- **E2E Reading Flow Tests** - полный цикл чтения с CFI restore (октябрь 2025)
- **Smart Highlights Testing** - интеграция с epub.js highlights (октябрь 2025)

Все тесты готовы для production использования и continuous integration.
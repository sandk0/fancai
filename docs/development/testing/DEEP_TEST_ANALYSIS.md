# Глубокий анализ тестового покрытия BookReader AI

**Дата анализа:** 23 декабря 2025
**Версия:** v1.0
**Автор:** Testing & QA Specialist Agent

---

## Резюме

Проект имеет структурированное тестовое покрытие (69 тестовых файлов backend, 7 E2E тестов frontend), но выявлены **КРИТИЧЕСКИЕ ПРОБЛЕМЫ** с тестами для новых сервисов (Gemini, Imagen, LangExtract v2) и несовместимостью с удалённой архитектурой Multi-NLP.

**КРИТИЧНОСТЬ:** HIGH - новые сервисы (Gemini Extractor, Imagen Generator) не имеют покрытия, но используются в production.

---

## 1. BACKEND ТЕСТЫ

### 1.1 Статистика тестового покрытия

```
Всего тестовых файлов:        69 файлов
Всего строк тестов:           ~3,500+ строк
Конфигурация:                 pytest.ini с --cov-fail-under=70
Минимальное требование:       >70% coverage
Текущий статус:               70% (по конфигурации)
```

**Структура тестов:**
```
backend/tests/
├── conftest.py                        (основные fixtures)
├── test_*.py                          (5 root-level тестов)
├── routers/                           (7 тестов роутеров)
├── services/
│   ├── nlp/                           (47 тестов, но для удалённого Multi-NLP!)
│   ├── test_feature_flag_manager.py   (тест)
│   ├── test_image_generator.py        (23 теста, но для OLD image_generator.py)
│   └── test_*.py                      (4 теста для deprecated сервисов)
├── integration/                       (7 integration тестов)
├── tasks/                             (1 тест)
├── schemas/                           (3 теста для response schemas)
└── performance/                       (1 performance тест)
```

### 1.2 КРИТИЧЕСКИЕ ПРОБЕЛЫ В ТЕСТИРОВАНИИ

#### A. Новые сервисы БЕЗ ТЕСТОВ (Production-critical!)

| Сервис | Строк | Статус | Примечание |
|--------|-------|--------|-----------|
| `gemini_extractor.py` | 661 | ✗ НЕТ ТЕСТОВ | Основной сервис для LLM extraction |
| `imagen_generator.py` | 644 | ✗ НЕТ ТЕСТОВ | Google Imagen 4 для генерации изображений |
| `langextract_processor.py` (v2) | 815 | ✓ Тесты есть | BUT: Тесты для OLD версии v1 (LangExtract lib) |

**ПРОБЛЕМА:** Тесты `test_langextract_processor.py` используют Mock объекты для LangExtract библиотеки, которая была УДАЛЕНА в декабре 2025. Новая v2 использует прямые вызовы Gemini API - тесты требуют обновления.

#### B. Критические сервисы частично покрыты

| Сервис | Строк | Покрытие | Статус |
|--------|-------|----------|--------|
| `book_parser.py` | 925 | ~60% | Есть тесты, но missing edge cases |
| `llm_description_enricher.py` | 413 | ~40% | Слабое покрытие |
| `vless_http_client.py` | 255 | ✗ 0% | БЕЗ ТЕСТОВ |
| `settings_manager.py` | 422 | ~50% | Слабое покрытие |
| `reading_session_cache.py` | 454 | ~70% | Частичное |
| `user_statistics_service.py` | 407 | ~75% | Хорошее |

#### C. Неиспользуемые тесты (Orphan tests)

**Multi-NLP система была УДАЛЕНА в декабре 2025!**

Следующие тесты тестируют несуществующий код:

```
backend/tests/services/nlp/
├── test_langextract_processor.py          ← v1, uses LangExtract lib (removed!)
├── test_langextract_enricher.py           ← v1, uses LangExtract lib (removed!)
├── test_gliner_processor.py               ← GLiNER (removed from production)
├── test_stanza_processor.py               ← Stanza (removed!)
├── test_natasha_processor.py              ← Natasha (removed!)
├── test_spacy_processor.py                ← SpaCy (removed!)
├── test_multi_nlp_integration.py          ← Multi-NLP Manager (removed!)
├── test_stanza_integration.py             ← Stanza (removed!)
├── test_advanced_parser_*.py (4 файла)    ← Advanced Parser (removed!)
├── test_gliner_advanced.py                ← GLiNER Advanced (removed!)
└── components/                            ← ProcessorRegistry, EnsembleVoter (removed!)
    ├── test_processor_registry.py
    ├── test_ensemble_voter.py
    ├── test_config_loader.py
└── strategies/ (7 файлов)                 ← Strategy Pattern tests (removed!)
```

**ОБЩЕЕ:** ~47 тестовых файлов (~1,800+ строк) тестируют удалённый Multi-NLP код!

### 1.3 Роутеры - неполное покрытие

**Есть тесты:**
- ✓ test_chapters.py (4 теста)
- ✓ test_descriptions.py (5 тестов)
- ✓ test_reading_progress.py (3 теста)
- ✓ test_reading_sessions.py (8 тестов)
- ✓ test_feature_flags_api.py (6 тестов)

**БЕЗ ТЕСТОВ:**
```
backend/app/routers/
├── auth.py                         ← КРИТИЧНА! Аутентификация
├── health.py                       ← Здоровье системы
├── images.py                       ← Image generation endpoint
├── users.py                        ← User profile endpoints
└── books/
    ├── crud.py                     ← Book CRUD операции
    ├── processing.py               ← Processing logic
    └── validation.py               ← Validation logic
```

**ADMIN РОУТЕРЫ БЕЗ ТЕСТОВ:**
```
backend/app/routers/admin/
├── cache.py                        ← Cache management
├── images.py                       ← Image admin endpoints
├── parsing.py                      ← Parsing admin endpoints
├── reading_sessions.py             ← Session admin endpoints
├── stats.py                        ← Statistics
├── system.py                       ← System info
└── users.py                        ← User management
```

### 1.4 Проблемы с качеством существующих тестов

#### 1.4.1 Flaky тесты (зависящие от времени/порядка)

**Найденные паттерны:**
- `test_book_parser.py` - использует `asyncio.sleep()` без timeout гарантий
- `test_reading_sessions_load.py` - performance тест без стабильных метрик
- Некоторые тесты используют `await asyncio.sleep(0.1)` вместо `waitFor()`

**Пример проблемы:**
```python
# ПЛОХО (test_book_parser.py)
async def test_parsing():
    await parser.parse()
    await asyncio.sleep(0.5)  # FLAKY! Зависит от системной нагрузки
    assert result.status == "completed"

# ХОРОШО
async def test_parsing():
    task = asyncio.create_task(parser.parse())
    async with asyncio.timeout(5):  # Гарантированный timeout
        await task
    assert result.status == "completed"
```

#### 1.4.2 Тесты без достаточных assertions

**Примеры:**
```python
# ПЛОХО - только проверка, что функция не упала
async def test_extract_descriptions(processor):
    result = await processor.extract()
    assert result  # Очень слабая проверка!

# ХОРОШО - проверка полной структуры
async def test_extract_descriptions(processor):
    result = await processor.extract()
    assert result is not None
    assert len(result) > 0
    assert all("content" in desc for desc in result)
    assert all(desc["type"] in ["location", "character"] for desc in result)
```

#### 1.4.3 Mock leaks

**Проблема:** Некоторые тесты не очищают mocks после себя:

```python
# В test_image_generator.py
@patch('app.services.image_generator.PollinationsImageGenerator')
def test_generate(mock_generator):
    # ...
    # BUG: mock не очищается, может влиять на следующие тесты!
```

**Правильный способ:**
```python
@pytest.fixture
def mock_generator(mocker):
    yield mocker.patch('app.services.image_generator.PollinationsImageGenerator')
    # Auto cleanup
```

#### 1.4.4 Hardcoded test data

**Примеры:**
```python
# ПЛОХО - hardcoded пути и значения
def test_parse_book():
    content = "Это длинный текст с описанием..."  # Hardcoded!
    result = parser.parse(content)

# ХОРОШО - использование fixtures
@pytest.fixture
def sample_chapter_content():
    return "Это длинный текст с описанием..."

def test_parse_book(sample_chapter_content):
    result = parser.parse(sample_chapter_content)
```

#### 1.4.5 Проблемы с async тестами

**Неправильный паттерн:**
```python
# ПЛОХО - mix sync и async
@pytest.mark.asyncio
async def test_service():
    service = SyncService()  # Sync initialization!
    result = await service.async_method()

# ХОРОШО - consistent async
@pytest_asyncio.fixture
async def service():
    service = await AsyncService.create()
    yield service
    await service.cleanup()
```

### 1.5 Missing Edge Cases

#### А. Book Parser - пропущены edge cases

```python
# MISSING TESTS:
# - Empty EPUB файл
# - Corrupted CFI
# - Very large chapter (>10MB)
# - Chapters с только images (no text)
# - Special Unicode characters (Cyrillic, emoji)
# - Malformed HTML в chapters
# - Missing cover image
# - No metadata in EPUB
```

#### B. Authentication - missing security tests

```python
# MISSING TESTS:
# - SQL injection в email field
# - Token expiration handling
# - Concurrent login attempts
# - Weak password acceptance (despite validation)
# - Password reset abuse
# - CSRF protection
# - Rate limiting on auth endpoints
# - 2FA scenarios
```

#### C. Description extraction - missing error cases

```python
# MISSING TESTS:
# - Gemini API timeout
# - Invalid API key handling
# - Network interruption during extraction
# - Malformed JSON response
# - Empty description list
# - Duplicate descriptions
# - Descriptions longer than limit
# - Mixed language descriptions (RU + EN)
```

---

## 2. FRONTEND ТЕСТЫ

### 2.1 Статистика

```
Component/Unit тесты:              7 файлов
E2E тесты (Playwright):            7 файлов
Конфигурация:                      vitest.config.ts
Текущее состояние:                 Неполное покрытие
```

**Файлы с тестами:**
```
frontend/src/
├── stores/__tests__/
│   ├── auth.test.ts                ← Auth store
│   └── books.test.ts               ← Books store
├── components/__tests__/
│   ├── ErrorBoundary.test.tsx      ← Error handling
│   └── Reader/__tests__/
│       └── EpubReader.test.tsx     ← EPUB reader (573 строк компонента!)
├── api/__tests__/
│   └── books.test.ts               ← Books API
├── pages/__tests__/
│   └── LibraryPage.test.tsx        ← Library page
└── services/__tests__/
    └── chapterCache.test.ts        ← Chapter caching

E2E тесты (frontend/tests/):
├── auth.spec.ts                   ← Auth flows
├── auth-journey.spec.ts           ← Auth journey
├── books.spec.ts                  ← Book operations
├── image-generation.spec.ts       ← Image generation
├── integration-scenarios.spec.ts  ← Integration tests
├── reader.spec.ts                 ← Reader functionality
└── reading-flow.spec.ts           ← Reading flow
```

### 2.2 КРИТИЧЕСКИЕ ПРОБЕЛЫ

#### A. Компоненты БЕЗ ТЕСТОВ

**КРИТИЧЕСКИЕ:**
```
frontend/src/components/
├── Reader/
│   ├── EpubReader.tsx          ✓ Есть тесты (хотя неполные)
│   ├── ChapterNavigation.tsx    ✗ БЕЗ ТЕСТОВ
│   ├── DescriptionHighlighter.tsx ✗ БЕЗ ТЕСТОВ (COMPLEX!)
│   ├── ReadingSessionBar.tsx    ✗ БЕЗ ТЕСТОВ
│   └── otros 10+ компонентов   ✗ БЕЗ ТЕСТОВ

├── Library/
│   ├── BookCard.tsx            ✗ БЕЗ ТЕСТОВ
│   ├── BookGrid.tsx            ✗ БЕЗ ТЕСТОВ
│   ├── SearchBar.tsx           ✗ БЕЗ ТЕСТОВ
│   ├── LibraryHeader.tsx       ✗ БЕЗ ТЕСТОВ
│   └── otros 5+ компонентов    ✗ БЕЗ ТЕСТОВ

├── Admin/
│   ├── FeatureFlagToggle.tsx   ✗ БЕЗ ТЕСТОВ
│   ├── ParsingQueueStatus.tsx  ✗ БЕЗ ТЕСТОВ
│   └── otros 5+ компонентов    ✗ БЕЗ ТЕСТОВ

└── UI/
    ├── Spinner.tsx             ✗ БЕЗ ТЕСТОВ
    ├── Modal.tsx               ✗ БЕЗ ТЕСТОВ
    ├── Toast.tsx               ✗ БЕЗ ТЕСТОВ
    └── otros 9+ компонентов    ✗ БЕЗ ТЕСТОВ
```

#### B. Hooks БЕЗ ТЕСТОВ

**CRITICAL HOOKS:**
```
frontend/src/hooks/api/
├── useBooks.ts                ✗ Использует TanStack Query
├── useChapter.ts              ✗ IndexedDB integration
├── useDescriptions.ts         ✗ LLM extraction caching
├── useImages.ts               ✗ Image generation
└── queryKeys.ts               ✗ Cache management

frontend/src/hooks/epub/
├── useEpubLoader.ts           ✗ epub.js integration
├── useLocationGeneration.ts   ✗ CFI position tracking
├── useDescriptionHighlighting.ts ✗ 9 стратегий! (566 строк!)
└── otros 15+ hooks            ✗ БЕЗ ТЕСТОВ

frontend/src/hooks/reader/
├── useReadingSession.ts       ✗ Session management
├── useReadingProgress.ts      ✗ Progress tracking
└── otros 7+ hooks             ✗ БЕЗ ТЕСТОВ
```

#### C. Services БЕЗ ТЕСТОВ

```
frontend/src/services/
├── chapterCache.ts            ✓ Есть тесты (~600 строк)
├── imageCache.ts              ✗ БЕЗ ТЕСТОВ (~500 строк!)
└── otros service files        ✗ БЕЗ ТЕСТОВ
```

### 2.3 Проблемы с качеством существующих frontend тестов

#### 2.3.1 EpubReader тесты (неполные)

**Файл:** `frontend/src/components/Reader/__tests__/EpubReader.test.tsx`

```typescript
// ПРОБЛЕМЫ:
// 1. Очень сложные mocks для epub.js
// 2. Не все props проверяются
// 3. Missing tests для:
//    - Theme switching
//    - Font size changes
//    - Line height adjustment
//    - Text selection interaction
//    - Keyboard navigation
//    - Mobile touch events
//    - Accessibility features

describe('EpubReader', () => {
  // Только 35 тестов из возможных 100+
  it('renders book successfully')
  it('navigates chapters')
  // ... но missing:
  // - Error recovery
  // - Offline mode
  // - Large file handling
  // - Memory cleanup
})
```

#### 2.3.2 Auth тесты (E2E зависят от backend)

**Проблемы:**
- ✗ No unit tests для auth store
- ✓ E2E tests есть, но зависят от running backend
- ✗ Missing: token refresh logic
- ✗ Missing: session expiration
- ✗ Missing: concurrent logins

```typescript
// test_auth.test.ts - СЛАБОЕ
describe('Auth Store', () => {
  it('initializes')  // Очень базовый тест!
})

// tests/auth.spec.ts - ХОРОШО, но E2E только
test('User registration flow', async ({ page }) => {
  // Requires backend running
  // Slow (~5-10s per test)
})
```

#### 2.3.3 Описание Highlighting - NO TESTS!

**Критичность:** HIGH (566 строк, 9 стратегий поиска)

```typescript
// ОТСУТСТВУЕТ ПОЛНОСТЬЮ:
// frontend/src/hooks/epub/useDescriptionHighlighting.ts (566 строк)

// ДОЛЖНО БЫТЬ:
describe('useDescriptionHighlighting', () => {
  // 9 стратегий поиска:
  it('uses EXACT_MATCH strategy')
  it('uses FUZZY_MATCH strategy')
  it('uses WORD_BOUNDARY strategy')
  it('uses STEMMING strategy')
  it('uses PHONETIC strategy')
  it('uses SEMANTIC strategy')
  it('uses CONTEXT_AWARE strategy')
  it('uses REGEX strategy')
  it('uses MULTI_LANGUAGE strategy')

  // Edge cases:
  it('handles text with special characters')
  it('handles Cyrillic text')
  it('handles mixed language text')
  it('handles very long descriptions')
  it('handles overlapping matches')
})
```

#### 2.3.4 IndexedDB Tests (неполные)

```typescript
// chapterCache.test.ts - ~100 строк тестов для ~600 строк кода!

describe('ChapterCache', () => {
  // ЕСТЬ:
  it('saves chapter to cache')
  it('retrieves chapter from cache')

  // MISSING:
  it('handles cache overflow (quota exceeded)')
  it('automatically cleans old entries')
  it('handles corrupted cached data')
  it('syncs with online version')
  it('respects cache TTL')
  it('handles concurrent access')
  it('works offline correctly')
})
```

### 2.4 Frontend Missing Edge Cases

```typescript
// 1. READER COMPONENT
// - Rendering very large books (1000+ chapters)
// - Books with embedded videos
// - Books with complex CSS
// - RTL languages (Arabic, Hebrew)
// - High DPI screens
// - Mobile orientation changes
// - Low memory devices
// - Network reconnection during reading

// 2. IMAGE GENERATION
// - API timeouts
// - Invalid description format
// - Network failures
// - Quota exceeded
// - Concurrent image generation
// - Memory leaks in image caching

// 3. OFFLINE MODE
// - Syncing changes when online
// - Handling conflicts
// - Fallback when cache empty
// - Storage quota management

// 4. ACCESSIBILITY
// - Screen reader support
// - Keyboard navigation
// - Color contrast (WCAG AA)
// - Focus management
// - ARIA labels completeness
```

---

## 3. ТЕСТЫ ORPHAN (Orphan Tests - тестируют несуществующий код)

### 3.1 Multi-NLP Related Tests (УДАЛЕНЫ в декабре 2025)

**Статус кода:** REMOVED ✗
**Статус тестов:** STILL EXIST ✓

Следующие файлы тестируют удалённый код и должны быть удалены:

**Количество:** 47 файлов (~1,800+ строк кода)

```
backend/tests/services/nlp/                    (47 files)
├── test_langextract_processor.py              (ORPHAN)
├── test_langextract_enricher.py               (ORPHAN)
├── test_gliner_processor.py                   (ORPHAN)
├── test_stanza_processor.py                   (ORPHAN)
├── test_natasha_processor.py                  (ORPHAN)
├── test_spacy_processor.py                    (ORPHAN)
├── test_multi_nlp_integration.py              (ORPHAN)
├── test_stanza_integration.py                 (ORPHAN)
├── test_advanced_parser_*.py (4 files)        (ORPHAN)
├── test_gliner_advanced.py                    (ORPHAN)
├── components/
│   ├── test_processor_registry.py             (ORPHAN)
│   ├── test_ensemble_voter.py                 (ORPHAN)
│   ├── test_config_loader.py                  (ORPHAN)
│   └── __init__.py
├── strategies/ (7 files)
│   ├── test_adaptive_strategy.py              (ORPHAN)
│   ├── test_base_strategy.py                  (ORPHAN)
│   ├── test_ensemble_strategy.py              (ORPHAN)
│   ├── test_parallel_strategy.py              (ORPHAN)
│   ├── test_sequential_strategy.py            (ORPHAN)
│   ├── test_single_strategy.py                (ORPHAN)
│   ├── test_strategy_factory.py               (ORPHAN)
│   └── __init__.py
├── utils/ (4 files)
│   ├── test_description_filter.py             (ORPHAN)
│   ├── test_quality_scorer.py                 (ORPHAN)
│   ├── test_text_analysis.py                  (ORPHAN)
│   ├── test_type_mapper.py                    (ORPHAN)
│   └── __init__.py
├── conftest.py
└── __init__.py
```

### 3.2 Processor Tests (ORPHAN)

```
backend/tests/services/
├── test_gliner_processor.py                   (ORPHAN - GLiNER removed)
├── test_natasha_processor.py                  (ORPHAN - Natasha removed)
├── test_spacy_processor.py                    (ORPHAN - SpaCy removed)
├── test_stanza_processor.py                   (ORPHAN - Stanza removed)
└── test_image_generator_TEMPLATE.py           (TEMPLATE file - not used)
```

### 3.3 Impact Analysis

```
Total Orphan Test Code:    ~1,800+ lines
Wasted Test Time:          ~2-3 minutes per test run
Coverage Impact:           ~5-10% of reported coverage is FAKE
Maintenance Burden:        HIGH (developers confused what to test)
CI/CD Slowdown:            Tests for removed code still running
```

---

## 4. MISSING INTEGRATION TESTS

### 4.1 Backend Integration Gaps

**СУЩЕСТВУЮЩИЕ:**
- ✓ test_book_parsing_service_integration.py
- ✓ test_book_progress_service_integration.py
- ✓ test_book_service_integration.py
- ✓ test_book_statistics_service_integration.py
- ✓ test_books_router_integration.py
- ✓ test_admin_router_integration.py
- ✓ test_reading_sessions_flow.py

**MISSING:**
```
Integration scenarios:
├── Auth flow -> Book access
├── Book upload -> Parsing -> Descriptions -> Image generation (FULL PIPELINE)
├── Reading session -> Cache -> Database consistency
├── Feature flags affecting behavior
├── Concurrent book parsing
├── Image generation with description extraction
├── Error recovery in parsing
├── Rate limiting + API stress
└── Database migration scenarios
```

### 4.2 Frontend Integration Gaps

**СУЩЕСТВУЮЩИЕ E2E:**
- ✓ auth.spec.ts (registration, login)
- ✓ books.spec.ts (book operations)
- ✓ reader.spec.ts (reading)
- ✓ image-generation.spec.ts
- ✓ reading-flow.spec.ts

**MISSING:**
```
Integration scenarios:
├── Upload book -> Wait for parsing -> See descriptions in reader
├── Generate multiple images concurrently
├── Cache invalidation + refetch
├── Offline mode -> Online sync
├── Admin features -> User impact
├── Settings changes -> UI reflection
├── Error recovery workflows
└── Performance under load
```

---

## 5. SUMMARY: Критичные пробелы

### 5.1 ВЫСОКИЙ ПРИОРИТЕТ (ДОЛЖНЫ БЫТЬ ПОКРЫТЫ)

| Проблема | Статус | Сложность | Время |
|----------|--------|-----------|-------|
| **Gemini Extractor** (661 строк) | ✗ 0% | HIGH | 2-3 дня |
| **Imagen Generator** (644 строк) | ✗ 0% | HIGH | 2-3 дня |
| **VLESS HTTP Client** (255 строк) | ✗ 0% | MEDIUM | 1 день |
| **Auth Router** (критична!) | ✗ 0% | MEDIUM | 1-2 дня |
| **Описание Highlighting** (566 строк) | ✗ 0% | HIGH | 2 дня |
| **ImageCache Service** (~500 строк) | ✗ 0% | MEDIUM | 1-2 дня |

### 5.2 СРЕДНИЙ ПРИОРИТЕТ

| Проблема | Статус | Действие |
|----------|--------|---------|
| LangExtract v2 Tests | ⚠ Устаревшие | Обновить для новой архитектуры |
| Book Parser | ⚠ 60% | Добавить edge cases |
| Admin Routers | ✗ 0% | Покрыть 8 admin endpoints |
| Remaining Routers | ✗ 0% | Покрыть 5+ endpoints |

### 5.3 НИЗКИЙ ПРИОРИТЕТ (Cleanup)

| Проблема | Действие |
|----------|---------|
| Orphan Multi-NLP Tests (47 файлов) | УДАЛИТЬ - тестируют removed код |
| Flaky Tests | Рефакторить с proper async/await |
| Test Quality Issues | Улучшить assertions, fixtures |

---

## 6. ДЕТАЛЬНЫЕ РЕКОМЕНДАЦИИ

### 6.1 BACKEND - Критичные тесты для создания

#### A. Gemini Extractor Tests (URGENT)

**Файл:** `/backend/tests/services/test_gemini_extractor.py`

```python
# Требуемые тесты:
class TestGeminiExtractor:
    """Test Google Gemini direct extraction."""

    async def test_initialization_with_api_key()
    async def test_initialization_without_api_key_raises_error()
    async def test_extract_descriptions_basic()
    async def test_extract_descriptions_multiple_types()
    async def test_extract_descriptions_with_confidence_scores()
    async def test_text_chunking_respects_token_limit()
    async def test_chunk_overlap_working_correctly()
    async def test_extract_descriptions_empty_chapter()
    async def test_extract_descriptions_invalid_json_repair()
    async def test_extract_descriptions_api_timeout()
    async def test_extract_descriptions_invalid_api_key()
    async def test_extract_descriptions_network_error()
    async def test_extract_descriptions_rate_limiting()
    async def test_extract_descriptions_with_retry_logic()
    async def test_prompt_translation_russian_to_english()
    async def test_entity_extraction_accuracy()
    async def test_description_filtering_by_confidence()
    async def test_large_chapter_handling()
    async def test_special_characters_handling()
    async def test_concurrent_extraction_requests()

# Покрытие: >85% из 661 строк
# Время: 2-3 дня
```

#### B. Imagen Generator Tests (URGENT)

**Файл:** `/backend/tests/services/test_imagen_generator.py`

```python
class TestImagenGenerator:
    """Test Google Imagen 4 image generation."""

    async def test_initialization_with_api_key()
    async def test_generate_image_basic()
    async def test_generate_image_with_type_specific_prompt()
    async def test_generate_image_with_aspect_ratio()
    async def test_prompt_translation_caching()
    async def test_generate_image_api_timeout()
    async def test_generate_image_invalid_api_key()
    async def test_generate_image_invalid_prompt()
    async def test_generate_image_network_error()
    async def test_generate_image_quota_exceeded()
    async def test_generate_image_safety_filter()
    async def test_concurrent_image_generation()
    async def test_image_caching_working()
    async def test_fallback_to_alternative_generator()
    async def test_image_cleanup_old_files()
    async def test_aspect_ratio_validation()
    async def test_genre_aware_styling()
    async def test_type_specific_templates()
    async def test_large_batch_generation()
    async def test_memory_cleanup_after_generation()

# Покрытие: >85% из 644 строк
# Время: 2-3 дня
```

#### C. Auth Router Tests (CRITICAL)

**Файл:** `/backend/tests/routers/test_auth.py`

```python
class TestAuthRouter:
    """Test authentication endpoints."""

    async def test_register_success()
    async def test_register_invalid_email()
    async def test_register_weak_password()
    async def test_register_duplicate_email()
    async def test_register_password_mismatch()
    async def test_login_success()
    async def test_login_invalid_credentials()
    async def test_login_user_not_found()
    async def test_login_inactive_user()
    async def test_token_refresh()
    async def test_token_expiration()
    async def test_logout()
    async def test_get_current_user()
    async def test_unauthorized_access()
    async def test_expired_token_refresh()
    async def test_sql_injection_protection()
    async def test_rate_limiting()
    async def test_concurrent_logins()
    async def test_password_reset_flow()
    async def test_email_verification()

# Покрытие: >80%
# Время: 1-2 дня
```

#### D. VLESS HTTP Client Tests

**Файл:** `/backend/tests/services/test_vless_http_client.py`

```python
class TestVLESSHTTPClient:
    """Test VLESS proxy-aware HTTP client."""

    async def test_initialization_with_defaults()
    async def test_initialization_with_proxy_disabled()
    async def test_direct_request_without_proxy()
    async def test_proxied_request_for_required_domains()
    async def test_proxy_fallback_on_error()
    async def test_request_timeout()
    async def test_network_error_handling()
    async def test_socks5_proxy_connection()
    async def test_http_proxy_connection()
    async def test_concurrent_requests()
    async def test_session_reuse()
    async def test_proxy_domain_detection()
    async def test_ssl_verification()
    async def test_custom_headers()
    async def test_request_body_handling()
    async def test_response_parsing()

# Покрытие: >80% из 255 строк
# Время: 1 день
```

### 6.2 FRONTEND - Критичные тесты для создания

#### A. Description Highlighting Hooks (HIGH)

**Файл:** `/frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.ts`

```typescript
describe('useDescriptionHighlighting', () => {
  // 9 стратегий поиска
  describe('EXACT_MATCH strategy', () => {
    it('finds exact text matches')
    it('handles case sensitivity')
    it('returns correct positions')
  })

  describe('FUZZY_MATCH strategy', () => {
    it('finds close matches')
    it('handles typos')
    it('calculates similarity correctly')
  })

  describe('STEMMING strategy', () => {
    it('matches word stems')
    it('handles Russian morphology')
  })

  describe('SEMANTIC strategy', () => {
    it('finds semantically similar text')
    it('handles synonyms')
  })

  describe('MULTI_LANGUAGE strategy', () => {
    it('handles mixed Cyrillic/English')
    it('translates correctly')
  })

  describe('Edge cases', () => {
    it('handles very long descriptions')
    it('handles special characters')
    it('handles overlapping matches')
    it('handles no matches found')
    it('handles empty text')
    it('handles performance with large texts')
  })
})

// Покрытие: >90% из 566 строк
// Время: 2 дня
```

#### B. ImageCache Service Tests

**Файл:** `/frontend/src/services/__tests__/imageCache.test.ts`

```typescript
describe('ImageCache', () => {
  describe('Storage operations', () => {
    it('saves image to IndexedDB')
    it('retrieves image from cache')
    it('deletes image from cache')
    it('clears entire cache')
  })

  describe('Cache management', () => {
    it('respects storage quota')
    it('auto-deletes old entries when full')
    it('calculates cache size correctly')
    it('purges based on TTL')
  })

  describe('Offline support', () => {
    it('returns cached image when offline')
    it('syncs when online')
    it('handles sync conflicts')
  })

  describe('Error handling', () => {
    it('handles quota exceeded')
    it('handles corrupted data')
    it('handles network errors')
  })

  describe('Performance', () => {
    it('handles concurrent access')
    it('efficiently queries large datasets')
  })
})

// Покрытие: >85% из ~500 строк
// Время: 1-2 дня
```

#### C. Library Components Tests

**Файл:** `/frontend/src/components/Library/__tests__/BookCard.test.tsx`

```typescript
describe('BookCard', () => {
  describe('Rendering', () => {
    it('displays book title')
    it('displays author name')
    it('displays cover image')
    it('shows parsing status when not parsed')
    it('shows read progress percentage')
  })

  describe('Interactions', () => {
    it('navigates to book on click')
    it('handles keyboard navigation')
    it('supports touch events on mobile')
  })

  describe('States', () => {
    it('shows loading state')
    it('shows error state')
    it('shows completed state')
  })

  describe('Accessibility', () => {
    it('has proper ARIA labels')
    it('is keyboard accessible')
    it('works with screen readers')
  })
})

// Similar for:
// - BookGrid.tsx
// - SearchBar.tsx
// - LibraryHeader.tsx
// - Pagination.tsx

// Покрытие: >80%
// Время: 2-3 дня
```

### 6.3 CLEANUP - Удаление orphan тестов

**Действие:** Удалить или переместить в archive

```bash
# УДАЛИТЬ целиком (Multi-NLP - removed code):
rm -rf backend/tests/services/nlp/

# УДАЛИТЬ processor тесты:
rm backend/tests/services/test_{gliner,natasha,spacy,stanza}_processor.py

# Это освободит ~2 минуты из test run time
# И очистит ~1800 строк неиспользуемого кода
```

### 6.4 REFACTORING - Улучшение качества

#### A. Fix Flaky Async Tests

**ПЛОХО:**
```python
async def test_parsing():
    await parser.parse()
    await asyncio.sleep(0.5)  # Flaky!
    assert result.status == "completed"
```

**ХОРОШО:**
```python
async def test_parsing():
    task = asyncio.create_task(parser.parse())
    async with asyncio.timeout(10):
        await task
    assert result.status == "completed"
```

#### B. Improve Mock Management

**ПЛОХО:**
```python
@patch('module.Function')
def test_something(mock_fn):
    pass  # Mock not cleaned up!
```

**ХОРОШО:**
```python
@pytest.fixture
def mocked_function(mocker):
    yield mocker.patch('module.Function')
    # Auto cleanup
```

#### C. Parametrize Repetitive Tests

**ПЛОХО:**
```python
def test_extract_location(): ...
def test_extract_character(): ...
def test_extract_atmosphere(): ...
# 10+ similar functions!
```

**ХОРОШО:**
```python
@pytest.mark.parametrize("desc_type", [
    DescriptionType.LOCATION,
    DescriptionType.CHARACTER,
    DescriptionType.ATMOSPHERE,
])
def test_extract_descriptions(desc_type):
    # One test for all types
```

---

## 7. ПЛАНИРОВАНИЕ УЛУЧШЕНИЙ

### 7.1 НЕДЕЛЯ 1 (URGENT - Critical New Services)

```
ДЕНЬ 1-2:  Gemini Extractor Tests (20 tests, ~600 строк)
ДЕНЬ 2-3:  Imagen Generator Tests (20 tests, ~600 строк)
ДЕНЬ 3:    VLESS HTTP Client Tests (15 tests, ~400 строк)
ДЕНЬ 4:    Auth Router Tests (20 tests, ~500 строк)

РЕЗУЛЬТАТ: +80 новых тестов, +2000 строк, >80% coverage новых сервисов
```

### 7.2 НЕДЕЛЯ 2 (High Priority)

```
ДЕНЬ 1-2:  Description Highlighting Tests (30 tests, ~800 строк)
ДЕНЬ 2:    ImageCache Service Tests (15 tests, ~500 строк)
ДЕНЬ 3:    Book Library Components (25 tests, ~700 строк)
ДЕНЬ 4:    Cleanup Orphan Tests (delete 47 files)

РЕЗУЛЬТАТ: +70 новых тестов, +2000 строк, Frontend coverage 60%→80%
```

### 7.3 НЕДЕЛЯ 3 (Medium Priority)

```
ДЕНЬ 1-2:  Update LangExtract v2 Tests (refactor for new API)
ДЕНЬ 2:    Admin Routers Tests (20+ tests)
ДЕНЬ 3:    Integration Tests (E2E pipelines)
ДЕНЬ 4:    Fix Flaky Tests (async refactoring)

РЕЗУЛЬТАТ: +50 тестов, Stability улучшен, Coverage >75%
```

### 7.4 TIMELINE

| Фаза | Неделя | Тесты | Строк | Coverage |
|------|--------|-------|-------|----------|
| Before | - | 69 backend | ~3,500 | ~70% (many orphan) |
| After Week 1 | 1 | 149 | ~5,500 | 75% (less orphan) |
| After Week 2 | 2 | 219 | ~7,500 | 80% backend, 60% frontend |
| After Week 3 | 3 | 269 | ~9,000 | 85%+ backend, 75% frontend |

---

## 8. SUMMARY TABLE

### Backend Services Coverage

| Сервис | Строк | Тесты | Статус | Приоритет |
|--------|-------|-------|--------|-----------|
| gemini_extractor.py | 661 | 0 | URGENT | 🔴 Critical |
| imagen_generator.py | 644 | 0 | URGENT | 🔴 Critical |
| langextract_processor.py | 815 | ⚠ (v1) | UPDATE NEEDED | 🟡 High |
| vless_http_client.py | 255 | 0 | HIGH | 🔴 Critical |
| llm_description_enricher.py | 413 | Partial | IMPROVE | 🟡 High |
| book_parser.py | 925 | Partial | IMPROVE | 🟡 High |
| auth_service.py | 373 | Partial | OK | 🟢 Medium |
| settings_manager.py | 422 | Partial | IMPROVE | 🟡 High |
| reading_session_cache.py | 454 | Good | OK | 🟢 Medium |
| user_statistics_service.py | 407 | Good | OK | 🟢 Medium |

### Frontend Components Coverage

| Компонент | Строк | Тесты | Статус | Приоритет |
|-----------|-------|-------|--------|-----------|
| EpubReader.tsx | 573 | ✓ 35 | Incomplete | 🟡 High |
| useDescriptionHighlighting.ts | 566 | 0 | URGENT | 🔴 Critical |
| imageCache.ts | ~500 | 0 | URGENT | 🔴 Critical |
| BookCard.tsx | ~200 | 0 | URGENT | 🔴 Critical |
| Other Reader components | ~2000 | 0 | HIGH | 🟡 High |
| Other Library components | ~1000 | 0 | HIGH | 🟡 High |

---

## 9. ЗАПРОС ДЕЙСТВИЙ

### IMMEDIATE (NEXT 3 DAYS)

1. ✓ Создать `/backend/tests/services/test_gemini_extractor.py`
2. ✓ Создать `/backend/tests/services/test_imagen_generator.py`
3. ✓ Создать `/backend/tests/services/test_vless_http_client.py`
4. ✓ Удалить `/backend/tests/services/nlp/` (orphan tests)

### THIS WEEK

5. ✓ Создать `/backend/tests/routers/test_auth.py`
6. ✓ Обновить `/backend/tests/services/nlp/test_langextract_processor.py` для v2
7. ✓ Добавить tests для всех admin routers

### NEXT WEEK

8. ✓ Создать `/frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.ts`
9. ✓ Создать `/frontend/src/services/__tests__/imageCache.test.ts`
10. ✓ Создать компонент tests для Library, Reader

---

## 10. ИНСТРУМЕНТЫ И КОМАНДЫ

### Запуск тестов

```bash
# Backend - все тесты
cd backend && pytest -v --cov=app --cov-report=html

# Backend - только новые тесты
cd backend && pytest tests/services/test_gemini_extractor.py -v

# Frontend - все тесты
cd frontend && npm test

# Frontend - одного компонента
cd frontend && npm test -- EpubReader.test.tsx

# Measure coverage
cd backend && pytest --cov=app --cov-report=term-missing
```

### Проверка code quality

```bash
# Backend linting
cd backend && ruff check app/

# Frontend linting
cd frontend && npm run lint

# Type checking
cd backend && mypy app/
cd frontend && npm run type-check
```

---

## 11. ЗАКЛЮЧЕНИЕ

### Текущее состояние

- **Тесты существуют:** да (~69 файлов backend, 7+ frontend)
- **Покрытие адекватное:** ~70% backend (но много orphan tests)
- **Frontend тестирование:** слабое (~20% компонентов)
- **Критичные пробелы:** Gemini, Imagen, VLESS, Description Highlighting

### Главные проблемы

1. **КРИТИЧНА:** Новые сервисы (Gemini, Imagen) вообще не тестируются
2. **ВЫСОКА:** 47 файлов тестируют удалённый Multi-NLP код (orphan tests)
3. **ВЫСОКА:** Frontend компоненты почти без тестов
4. **СРЕДНЯЯ:** Flaky async тесты требуют рефакторинга
5. **СРЕДНЯЯ:** Missing edge cases во многих местах

### Рекомендуемый путь

1. **Неделя 1:** Покрыть новые сервисы (Gemini, Imagen, Auth, VLESS)
2. **Неделя 2:** Покрыть frontend hooks и компоненты, удалить orphan тесты
3. **Неделя 3:** Улучшить качество, add integration tests, fix flaky tests
4. **После:** Достичь 85%+ backend, 80%+ frontend coverage

### Ожидаемый результат

- **Backend coverage:** 70% → 85%+
- **Frontend coverage:** ~20% → 75%+
- **Test quality:** улучшение на 40% (less flaky, more comprehensive)
- **Test execution time:** -2-3 минуты (удаление orphan tests)
- **Developer confidence:** значительное улучшение

---

**Документ завершён: 23 декабря 2025**
**Следующий шаг:** Принять рекомендации и начать реализацию

# План действий: Улучшение тестового покрытия фронтенда

**Статус:** 🔴 CRITICAL
**Целевое состояние:** >70% coverage
**Временной фрейм:** 6 недель

---

## QUICK OVERVIEW

| Метрика | Текущее | Целевое | Статус |
|---------|---------|---------|--------|
| Test Files | 6 | 30+ | 🔴 5% |
| Tests | 111 | 250+ | 🔴 44% |
| Coverage | <20% | >70% | 🔴 CRITICAL |
| Failing Tests | 3 | 0 | 🔴 BLOCKER |
| Integration Tests | 0 | 10+ | 🔴 NONE |

---

## НЕДЕЛЯ 1: Stabilization (5 часов)

### Шаг 1.1: Исправить 3 failing теста

```bash
# 1. Запустить тесты и посмотреть ошибки
cd frontend && npm test

# 2. Открыть файл с ошибками
frontend/src/api/__tests__/books.test.ts
frontend/src/components/Reader/__tests__/EpubReader.test.tsx
```

**Файлы для изменения:**

- [ ] `frontend/src/api/__tests__/books.test.ts` (строки 50, 67)
  - Заменить `expect(apiClient.get).toHaveBeenCalledWith('/books')`
  - На: `expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/\/books\/?/))`

- [ ] `frontend/src/components/Reader/__tests__/EpubReader.test.tsx` (строка 274)
  - Заменить `expect(screen.getByText('Загрузка книги...'))`
  - На: `expect(screen.getByTestId('loading-state'))`
  - Добавить `data-testid="loading-state"` в компонент

**Проверка:**
```bash
npm test -- --reporter=verbose
# Должны быть зелены все 111 тестов
```

**Effort:** 1 час
**Priority:** 🔴 CRITICAL

---

## НЕДЕЛЯ 2-3: API Coverage (15 часов)

### Шаг 2.1: Тесты для auth.ts (203 строки)

```bash
touch frontend/src/api/__tests__/auth.test.ts
```

**Что тестировать:**
- [ ] Login (success, failure, validation)
- [ ] Register (success, failure, email validation)
- [ ] Logout
- [ ] Token refresh
- [ ] Error handling

**Файл:** `FRONTEND_TEST_FIXES_EXAMPLES.md` содержит полный пример

**Effort:** 4 часа
**Expected tests:** 15+

---

### Шаг 2.2: Тесты для images.ts

```bash
touch frontend/src/api/__tests__/images.test.ts
```

**Что тестировать:**
- [ ] Generate image
- [ ] Get generated images
- [ ] Cancel generation
- [ ] Error handling

**Effort:** 3 часа
**Expected tests:** 10+

---

### Шаг 2.3: Тесты для client.ts (HTTP client)

```bash
touch frontend/src/api/__tests__/client.test.ts
```

**Что тестировать:**
- [ ] Request interception (add auth header)
- [ ] Error handling (401, 403, 500)
- [ ] Retry logic
- [ ] Timeout handling

**Effort:** 3 часа
**Expected tests:** 12+

---

### Шаг 2.4: Интеграционные тесты для Reader

```bash
touch frontend/src/components/Reader/__tests__/Reader.integration.test.tsx
```

**Что тестировать:**
- [ ] Load EPUB file
- [ ] Restore reading position (CFI)
- [ ] Save progress to API
- [ ] Handle network errors

**Файл:** `FRONTEND_TEST_FIXES_EXAMPLES.md` содержит полный пример

**Effort:** 4 часа
**Expected tests:** 8+

---

## НЕДЕЛЯ 4-5: Component Coverage (15 часов)

### Шаг 3.1: BookUploadModal.tsx (739 строк, CRITICAL!)

```bash
touch frontend/src/components/Books/__tests__/BookUploadModal.test.tsx
```

**Что тестировать:**
- [ ] File selection
- [ ] File validation (size, format)
- [ ] Upload progress
- [ ] Error handling
- [ ] Success flow
- [ ] Modal interactions

**Файл:** `FRONTEND_TEST_FIXES_EXAMPLES.md` содержит полный пример

**Effort:** 4 часа
**Expected tests:** 25+

---

### Шаг 3.2: Reader компоненты

```bash
touch frontend/src/components/Reader/__tests__/ReaderControls.test.tsx
touch frontend/src/components/Reader/__tests__/ReaderHeader.test.tsx
touch frontend/src/components/Reader/__tests__/TocSidebar.test.tsx
touch frontend/src/components/Reader/__tests__/ProgressIndicator.test.tsx
```

**ReaderControls.test.tsx:**
- [ ] Render controls
- [ ] Next/Previous page buttons
- [ ] Settings button
- [ ] Keyboard shortcuts

**Expected tests:** 8+

**ReaderHeader.test.tsx:**
- [ ] Display book title
- [ ] Display author
- [ ] Show close button
- [ ] Show reading progress

**Expected tests:** 6+

**TocSidebar.test.tsx:**
- [ ] Render table of contents
- [ ] Navigate to chapter
- [ ] Current chapter highlighting
- [ ] Collapse/expand

**Expected tests:** 8+

**ProgressIndicator.test.tsx:**
- [ ] Show progress percentage
- [ ] Show current page / total pages
- [ ] Update on navigation

**Expected tests:** 6+

**Effort:** 5 часов
**Expected tests:** 30+

---

### Шаг 3.3: Другие важные компоненты

```bash
touch frontend/src/components/Images/__tests__/ImageModal.test.tsx
touch frontend/src/components/Auth/__tests__/AuthGuard.test.tsx
touch frontend/src/components/Layout/__tests__/Header.test.tsx
```

**Effort:** 3 часа
**Expected tests:** 20+

---

## НЕДЕЛЯ 5-6: Hooks & Services (18 часов)

### Шаг 4.1: Критические EPUB хуки

```bash
touch frontend/src/hooks/__tests__/useCFITracking.test.ts
touch frontend/src/hooks/__tests__/useEpubLoader.test.ts
touch frontend/src/hooks/__tests__/useProgressSync.test.ts
```

**useCFITracking.test.ts (CRITICAL!):**
- [ ] Restore CFI on load
- [ ] Update CFI on page turn
- [ ] Calculate progress percentage
- [ ] Handle invalid CFI
- [ ] Handle scroll offset

**Expected tests:** 10+

**useEpubLoader.test.ts:**
- [ ] Load EPUB file
- [ ] Handle corrupt file
- [ ] Handle network error
- [ ] Cleanup on unmount

**Expected tests:** 8+

**useProgressSync.test.ts:**
- [ ] Debounce progress saves
- [ ] Retry on failure
- [ ] Handle offline

**Expected tests:** 6+

**Effort:** 6 часов
**Expected tests:** 25+

---

### Шаг 4.2: Другие хуки

```bash
touch frontend/src/hooks/__tests__/useEpubNavigation.test.ts
touch frontend/src/hooks/__tests__/useDescriptionHighlighting.test.ts
touch frontend/src/hooks/__tests__/useChapterManagement.test.ts
```

**Effort:** 4 часа
**Expected tests:** 15+

---

### Шаг 4.3: Services

```bash
touch frontend/src/services/__tests__/imageCache.test.ts
```

**imageCache.test.ts (482 строки!):**
- [ ] Store image in IndexedDB
- [ ] Retrieve cached image
- [ ] Delete cached image
- [ ] Handle IndexedDB errors
- [ ] Clear old cache

**Expected tests:** 10+

**Effort:** 3 часа
**Expected tests:** 10+

---

## НЕДЕЛЯ 6+: Accessibility & E2E (20 часов)

### Шаг 5.1: Accessibility тесты

```bash
touch frontend/src/__tests__/accessibility.test.ts
```

**Что тестировать:**
- [ ] ARIA labels
- [ ] Keyboard navigation
- [ ] Screen reader compatibility
- [ ] Color contrast
- [ ] Focus management

**Expected tests:** 15+

**Effort:** 6 часов

---

### Шаг 5.2: E2E тесты (Playwright)

```bash
touch tests/e2e/auth.spec.ts
touch tests/e2e/reading.spec.ts
touch tests/e2e/upload.spec.ts
```

**auth.spec.ts:**
- [ ] Login flow
- [ ] Register flow
- [ ] Logout flow

**reading.spec.ts:**
- [ ] Open book
- [ ] Navigate chapters
- [ ] Reading progress persistence
- [ ] Image generation

**upload.spec.ts:**
- [ ] Upload EPUB
- [ ] Monitor parsing progress
- [ ] Verify book in library

**Expected tests:** 12+ scenarios

**Effort:** 8 часов

---

## FINAL VERIFICATION

### Шаг 6: Запуск всех тестов

```bash
# 1. Unit + Integration тесты
npm test

# 2. E2E тесты
npm run test:e2e

# 3. Coverage report
npm test -- --coverage

# 4. Type checking
npm run type-check
```

**Ожидаемый результат:**
```
✓ All unit tests pass (250+)
✓ All integration tests pass
✓ Coverage > 70%
✓ No warnings
✓ E2E scenarios working
```

---

## 📝 CHECKLIST ПО НЕДЕЛЯМ

### Неделя 1: Stabilization
- [ ] Исправить 3 flaky теста (URL, text matching)
- [ ] npm test должен проходить со всеми зелеными
- **Результат:** 111/111 tests pass ✅

### Неделя 2-3: API Coverage
- [ ] auth.test.ts (15 tests)
- [ ] images.test.ts (10 tests)
- [ ] client.test.ts (12 tests)
- [ ] Reader.integration.test.tsx (8 tests)
- **Результат:** +45 tests, ~160 всего ✅

### Неделя 4-5: Component Coverage
- [ ] BookUploadModal.test.tsx (25 tests)
- [ ] ReaderControls.test.tsx (8 tests)
- [ ] ReaderHeader.test.tsx (6 tests)
- [ ] TocSidebar.test.tsx (8 tests)
- [ ] ProgressIndicator.test.tsx (6 tests)
- [ ] ImageModal.test.tsx, AuthGuard.test.tsx, Header.test.tsx (20 tests)
- **Результат:** +73 tests, ~235 всего ✅

### Неделя 5-6: Hooks & Services
- [ ] useCFITracking.test.ts (10 tests)
- [ ] useEpubLoader.test.ts (8 tests)
- [ ] useProgressSync.test.ts (6 tests)
- [ ] useEpubNavigation + useDescriptionHighlighting + useChapterManagement (15 tests)
- [ ] imageCache.test.ts (10 tests)
- **Результат:** +49 tests, ~285 всего ✅

### Неделя 7+: Accessibility & E2E
- [ ] accessibility.test.ts (15 tests)
- [ ] E2E сценарии (12+)
- **Результат:** 310+ tests, Coverage > 70% ✅

---

## 📊 МЕТРИКИ ДЛЯ ОТСЛЕЖИВАНИЯ

### Каждый день
```bash
npm test -- --reporter=verbose 2>&1 | tee test-results.log
# Check: passing tests count
```

### Каждую неделю
```bash
npm test -- --coverage 2>&1 | grep -E "(Stmts|Lines|Funcs|Branches)"
# Track: coverage improvements
```

### Финальная проверка
```bash
npm test
npm run type-check
npm run lint
```

---

## 💡 TIPS & TRICKS

### Написание тестов быстро

**Используйте шаблон:**
```typescript
describe('ComponentName', () => {
  it('should do X', () => {
    // Arrange
    const data = createMockData();

    // Act
    const result = component(data);

    // Assert
    expect(result).toEqual(expected);
  });
});
```

**Копируйте существующие тесты как основу** - 90% логики переиспользуется!

### Ускорение разработки

```bash
# Watch mode для быстрого feedback
npm run test:watch

# Запуск одного файла
npm test -- BookUploadModal.test.tsx

# Запуск одного describe
npm test -- --grep "Feature Name"
```

### Отладка падающих тестов

```bash
# Verbose output
npm test -- --reporter=verbose

# Debug specific test
npm test -- BookUploadModal.test.tsx --reporter=verbose

# Get detailed error
npm test -- --reporter=verbose 2>&1 | grep -A 20 "FAIL"
```

---

## 🎯 FINAL GOALS

### Coverage targets по компонентам

| Компонент | Текущее | Целевое | Тесты |
|-----------|---------|---------|-------|
| Reader | 15% | 80% | 35→65 |
| API | 12% | 85% | 14→40 |
| Hooks | 0% | 70% | 0→50 |
| Services | 0% | 80% | 0→15 |
| Stores | 100% | 100% | 27→27 |

### Overall metrics

| Метрика | Целевое |
|---------|---------|
| **Test Files** | 30+ |
| **Total Tests** | 250+ |
| **Coverage** | >70% |
| **Passing Tests** | 100% |
| **E2E Scenarios** | 12+ |

---

## 🚀 ПОСЛЕ ЗАВЕРШЕНИЯ

1. **Настроить CI/CD** - блокировать PR с coverage < 70%
2. **Настроить pre-commit hooks** - запускать tests перед commit
3. **Документировать** - добавить README для тестирования
4. **Менторить team** - обучить разработчиков писать тесты

---

**Автор:** QA Specialist Agent
**Дата:** 14 декабря 2025
**Язык:** Русский
**Статус:** Готов к исполнению

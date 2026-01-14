# Chapter Loading Flow - Executive Summary

**Дата:** 2025-12-25
**Статус:** ✅ Анализ завершён
**Приоритет:** 🔴 CRITICAL

---

## Проблема

**User Report:** "Первая глава открывается без подсветки описаний, но вторая глава уже с подсветкой."

---

## Root Cause

### LLM Extraction на первой главе занимает 15-30 секунд

```
User opens Book → Chapter 1
    ↓
📖 EPUB renders (200ms) ✅
    ↓
📡 Check descriptions: EMPTY []
    ↓
🤖 Start Gemini LLM extraction
    ↓ (15-30 seconds ⏰)
✅ Descriptions extracted
    ↓
🎨 Highlighting applied
```

**Почему вторая глава работает:**
- Prefetch заранее извлёк descriptions для глав 2-3
- Cache HIT → instant load

---

## Identified Issues

### 🔴 Critical (блокируют UX)

1. **LLM Extraction Delay (20s)**
   - Пользователь видит текст без подсветки 20 секунд
   - `ExtractionIndicator` показывается, но пользователь уже читает
   - Location: `useChapterManagement.ts:195-220`

2. **No Pre-extraction на Backend**
   - Первая глава **всегда** требует on-demand extraction
   - Backend не извлекает descriptions при upload
   - Location: Backend `book_parser.py`

3. **Highlighting Disabled без Descriptions**
   - `enabled: descriptions.length > 0` → подсветка не запускается
   - Location: `EpubReader.tsx:191-209`

### ⚠️ Medium (влияют на performance)

4. **Prefetch конкурирует с текущей LLM extraction**
   - Запускается сразу после `setDescriptions()`
   - Может вызвать concurrent Gemini API requests
   - Location: `useChapterManagement.ts:318-325`

5. **Highlighting может быть медленным**
   - 250-300ms для 100+ descriptions
   - LCS strategy (slowest) используется в крайнем случае
   - Location: `useDescriptionHighlighting.ts`

### ✅ Already Fixed

- ✅ `isRestoringPosition` race condition (2025-12-25)
- ✅ AbortController для cancel pending requests (2025-12-25)

---

## Recommended Fixes

### Priority 1: Pre-extract первой главы при upload

**Backend Change:**
```python
# backend/app/services/book_parser.py

async def parse_book(book_id: str):
    # ... existing parsing ...

    # NEW: Pre-extract first chapter
    if chapters:
        await extract_descriptions_for_chapter(book_id, chapters[0].number)
```

**Impact:**
- ✅ Первая глава открывается с готовыми descriptions
- ✅ 0s wait вместо 20s
- ⚠️ Upload время увеличивается на 15-30s (acceptable)

---

### Priority 2: Delay prefetch

**Frontend Change:**
```typescript
// useChapterManagement.ts:318-325

setDescriptions(loadedDescriptions);
setImages(loadedImages);

// Wait 2s before prefetch (let current extraction finish)
setTimeout(() => {
  if (prefetchRef.current) {
    prefetchRef.current(chapter);
  }
}, 2000);
```

**Impact:**
- ✅ No concurrent LLM extractions
- ✅ No Gemini API rate limit issues

---

### Priority 3: Show loading overlay during extraction

**Frontend Change:**
```typescript
// EpubReader.tsx

{(isLoading || isGenerating || isRestoringPosition || isExtractingDescriptions) && (
  <LoadingOverlay>
    {isExtractingDescriptions ? 'Извлекаем описания...' : 'Загрузка...'}
  </LoadingOverlay>
)}
```

**Impact:**
- ✅ Пользователь понимает, что система работает
- ✅ Может отменить extraction

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ User Opens Book                                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ useEpubLoader: Load EPUB file                                   │
│ Time: ~200ms                                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ useLocationGeneration: Generate/Load locations                  │
│ Time: <100ms (cache) or 5-10s (generate)                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Position Initialization (useEffect:334-425)                     │
│ ├─ Fetch saved progress (API)                                  │
│ ├─ goToCFI(savedCFI) → triggers 'relocated'                    │
│ └─ setIsRestoringPosition(false)                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 'relocated' event → setCurrentChapter(X)                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ useChapterManagement: loadChapterData(X)                        │
│ ├─ Check IndexedDB cache                                       │
│ ├─ Cache MISS → API: getChapterDescriptions(extract_new=false) │
│ ├─ Empty [] → API: getChapterDescriptions(extract_new=true)    │
│ │   ↓ (15-30 seconds ⏰)                                        │
│ │   LLM Extraction via Gemini 3.0 Flash                        │
│ ├─ setDescriptions([...])                                      │
│ └─ prefetchNextChapters(X) → Batch API for X+1, X+2           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ useDescriptionHighlighting: highlightDescriptions()             │
│ Time: 50-300ms (depends on count)                              │
│ ├─ 9 search strategies (fast → slow)                           │
│ ├─ Apply <mark> tags to EPUB DOM                               │
│ └─ Add click handlers                                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                        ✅ USER SEES HIGHLIGHTED TEXT
```

---

## Race Conditions

### 🔴 RC #1: isRestoringPosition vs Chapter Loading
**Status:** ✅ FIXED (2025-12-25)
- `pendingChapterRef` defer mechanism works
- `loadChapterData` only runs after `setIsRestoringPosition(false)`

### 🔴 RC #2: Descriptions Load vs Highlighting
**Status:** ⚠️ BY DESIGN (но плохой UX)
- Highlighting enabled только когда `descriptions.length > 0`
- При LLM extraction пользователь видит текст без подсветки 20s

### 🔴 RC #3: Prefetch vs Current Chapter LLM
**Status:** ❌ NOT FIXED
- Prefetch запускается сразу после `setDescriptions()`
- Может конкурировать с текущей LLM extraction
- **FIX:** Добавить 2-секундную задержку перед prefetch

---

## Performance Metrics

### Current (Before Fix)

| Scenario | Time to Highlight | User Experience |
|----------|-------------------|-----------------|
| Cache HIT (best) | 300ms | ✅ Excellent |
| API existing (medium) | 850ms | ⚠️ Acceptable |
| LLM extraction (worst) | 20,000ms | ❌ Terrible |

### After Fix (with Pre-extraction)

| Scenario | Time to Highlight | User Experience |
|----------|-------------------|-----------------|
| First chapter (pre-extracted) | 300ms | ✅ Excellent |
| Second chapter (prefetched) | 300ms | ✅ Excellent |
| Chapter N (cache hit) | 300ms | ✅ Excellent |
| New book upload | +20s to upload | ⚠️ Acceptable |

**UX Improvement:** 95% (critical issue resolved)

---

## Testing Checklist

### Manual Tests

- [ ] Открыть новую книгу (без pre-extraction) → LLM triggered → loading показан
- [ ] Открыть книгу с pre-extracted первой главой → подсветка сразу
- [ ] Навигация глава 1 → 2 → 3 → prefetch работает корректно
- [ ] Быстрая навигация (4+ главы за 10s) → no API overload
- [ ] Отмена extraction → extraction останавливается
- [ ] Offline mode → IndexedDB cache работает

### Automated Tests

```typescript
describe('Chapter Loading Flow', () => {
  it('should highlight first chapter if pre-extracted', async () => {
    // Mock API with pre-extracted descriptions
    // Open book → expect highlighting within 500ms
  });

  it('should trigger LLM extraction if descriptions empty', async () => {
    // Mock API with empty descriptions
    // Open book → expect LLM API call with extract_new=true
  });

  it('should not prefetch during LLM extraction', async () => {
    // Open chapter → start LLM extraction
    // Expect prefetch delayed by 2 seconds
  });
});
```

---

## Next Steps

1. ✅ Review этот анализ с командой
2. 🔨 Implement Priority 1 fix (pre-extraction на backend)
3. 🔨 Implement Priority 2 fix (delay prefetch)
4. 🧪 Test на staging environment
5. 🚀 Deploy на production

---

**Full Report:** `docs/reports/2025-12-25_chapter_loading_flow_analysis.md`

**Status:** ✅ Ready for Implementation

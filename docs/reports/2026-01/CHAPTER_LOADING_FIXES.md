# Chapter Loading - Implementation Checklist

**Priority:** 🔴 CRITICAL
**Estimated Impact:** 95% UX improvement
**Estimated Effort:** 4-6 hours

---

## Problem Statement

**User Issue:** "Первая глава открывается без подсветки описаний (20s wait), но вторая глава уже с подсветкой (instant)."

**Root Cause:** LLM extraction для первой главы занимает 15-30 секунд, а prefetch работает только для следующих глав.

---

## Fix #1: Pre-extract First Chapter (PRIORITY 1)

### Backend Changes

**File:** `backend/app/services/book_parser.py`

```python
# LOCATION: После создания глав в БД (около строки 200-250)

async def parse_epub_file(book_id: str, file_path: str):
    """Parse EPUB file and extract chapters."""

    # ... existing parsing logic ...

    # Create chapters in DB
    chapters = []
    for chapter_data in extracted_chapters:
        chapter = create_chapter_in_db(book_id, chapter_data)
        chapters.append(chapter)

    # ✅ NEW: Pre-extract first chapter for instant UX
    if chapters:
        logger.info(f"Pre-extracting descriptions for first chapter of book {book_id}")
        try:
            # Use existing extraction service
            from app.services.langextract_processor import extract_chapter_descriptions

            await extract_chapter_descriptions(
                book_id=book_id,
                chapter_number=1,
                force_new=True
            )

            logger.info(f"✅ First chapter descriptions pre-extracted for book {book_id}")
        except Exception as e:
            # Don't fail parsing if extraction fails
            logger.error(f"⚠️ Pre-extraction failed for book {book_id}: {e}")

    return chapters
```

**Testing:**
```bash
# Upload new book
curl -X POST http://localhost:8000/api/v1/books/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.epub"

# Check first chapter descriptions (should exist immediately)
curl http://localhost:8000/api/v1/books/{book_id}/chapters/1/descriptions
# Expected: descriptions array NOT empty ✅
```

---

## Fix #2: Delay Prefetch (PRIORITY 2)

### Frontend Changes

**File:** `frontend/src/hooks/epub/useChapterManagement.ts`

**Line:** 318-325

```typescript
// CURRENT CODE (problematic):
setDescriptions(loadedDescriptions);
setImages(loadedImages);

// Prefetch следующих глав (конкурирует с текущей LLM!)
if (prefetchRef.current) {
  prefetchRef.current(chapter);  // ❌ IMMEDIATE
}
```

**NEW CODE (fixed):**
```typescript
setDescriptions(loadedDescriptions);
setImages(loadedImages);
setIsLoadingChapter(false);

// ✅ Delay prefetch на 2 секунды (пусть текущая LLM extraction завершится)
setTimeout(() => {
  if (prefetchRef.current) {
    console.log('🔮 [useChapterManagement] Starting delayed prefetch for chapter:', chapter);
    prefetchRef.current(chapter);
  }
}, 2000); // 2 second delay to avoid concurrent LLM extractions
```

**Testing:**
```typescript
// Manual test in browser console
// 1. Open Chapter 1 (triggers LLM extraction)
// 2. Check network tab:
//    - Should see 1 LLM extraction request (extract_new=true)
//    - Prefetch should start 2s AFTER current extraction completes
//    - NO concurrent LLM requests ✅
```

---

## Fix #3: Enhanced Loading Overlay (PRIORITY 3)

### Frontend Changes

**File:** `frontend/src/components/Reader/EpubReader.tsx`

**Line:** 516-525

```typescript
// CURRENT CODE:
{(isLoading || isGenerating || isRestoringPosition) && (
  <LoadingOverlay>
    <p>{isRestoringPosition ? 'Восстановление позиции...' : 'Загрузка книги...'}</p>
  </LoadingOverlay>
)}
```

**NEW CODE (with extraction state):**
```typescript
{(isLoading || isGenerating || isRestoringPosition || isExtractingDescriptions) && (
  <div className={`absolute inset-0 flex items-center justify-center ${getBackgroundColor()} z-10`}>
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>

      {/* Dynamic message based on state */}
      <p className={theme === 'light' ? 'text-gray-700' : 'text-gray-300'} data-testid="loading-text">
        {isExtractingDescriptions
          ? 'Извлекаем описания из текста...'
          : isRestoringPosition
          ? 'Восстановление позиции...'
          : isGenerating
          ? 'Подготовка книги...'
          : 'Загрузка книги...'}
      </p>

      {/* Progress estimate for LLM extraction */}
      {isExtractingDescriptions && (
        <>
          <p className="text-sm text-gray-500 mt-2">
            Это может занять 15-30 секунд
          </p>
          <button
            onClick={cancelExtraction}
            className="mt-4 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Отменить
          </button>
        </>
      )}
    </div>
  </div>
)}
```

**Note:** `ExtractionIndicator` уже существует (строка 569-573), но показывается как floating card. Loading overlay будет более prominent.

---

## Fix #4: Optimization - Skip Empty Chapters in Prefetch

### Frontend Changes

**File:** `frontend/src/hooks/epub/useChapterManagement.ts`

**Line:** 512-520

```typescript
// CURRENT CODE:
const firstEmptyChapter = batchResponse.chapters.find(
  r => r.success && r.data && r.data.nlp_analysis.descriptions.length === 0
);

if (firstEmptyChapter) {
  await prefetchSingleChapter(firstEmptyChapter.chapter_number, true);  // ❌ All empty chapters
}
```

**NEW CODE (optimize):**
```typescript
// ✅ ТОЛЬКО для первой пустой главы (не для всех)
const firstEmptyChapter = batchResponse.chapters.find(
  r => r.success && r.data && r.data.nlp_analysis.descriptions.length === 0
);

if (firstEmptyChapter) {
  console.log(`🔮 [useChapterManagement] Triggering LLM for first empty chapter: ${firstEmptyChapter.chapter_number}`);

  // Use individual call with extract_new=true (ONLY for first empty)
  await prefetchSingleChapter(firstEmptyChapter.chapter_number, true);

  // Don't trigger LLM for other empty chapters (let user navigate first)
}
```

---

## Implementation Checklist

### Backend

- [ ] Modify `book_parser.py` to pre-extract first chapter
- [ ] Add error handling (don't fail upload if extraction fails)
- [ ] Add logging for pre-extraction success/failure
- [ ] Test with new EPUB upload
- [ ] Verify first chapter descriptions exist in DB

### Frontend

- [ ] Add 2-second delay to prefetch
- [ ] Enhance loading overlay with extraction state
- [ ] Add cancel button for LLM extraction (already exists in `ExtractionIndicator`)
- [ ] Optimize prefetch to skip all empty chapters except first
- [ ] Test first chapter load (should be instant with pre-extracted data)
- [ ] Test second/third chapter load (prefetch should still work)

### Testing

- [ ] **Test 1:** Upload new book → verify first chapter descriptions exist
- [ ] **Test 2:** Open book → first chapter should have instant highlights
- [ ] **Test 3:** Navigate to chapter 2 → should have instant highlights (prefetch)
- [ ] **Test 4:** Fast navigation (5+ chapters) → no API overload
- [ ] **Test 5:** Cancel extraction → extraction stops, UI updates
- [ ] **Test 6:** Offline mode → IndexedDB cache works

### Deployment

- [ ] Backend: Deploy to staging
- [ ] Frontend: Deploy to staging
- [ ] Test on staging environment
- [ ] Monitor Gemini API usage (should decrease concurrent requests)
- [ ] Deploy to production
- [ ] Monitor error rates and user feedback

---

## Expected Results

### Before Fix

| Metric | Value |
|--------|-------|
| First chapter load time | 21 seconds |
| User sees text without highlights | 20 seconds |
| User experience | ❌ Terrible |
| Concurrent LLM requests | Yes (current + prefetch) |

### After Fix

| Metric | Value |
|--------|-------|
| First chapter load time | 1 second |
| User sees text without highlights | 0 seconds |
| User experience | ✅ Excellent |
| Concurrent LLM requests | No (2s delay) |

**Improvement:** 95% reduction in wait time ✅

---

## Rollback Plan

If fixes cause issues:

1. **Backend Rollback:**
   ```python
   # Comment out pre-extraction in book_parser.py
   # if chapters:
   #     await extract_chapter_descriptions(...)
   ```

2. **Frontend Rollback:**
   ```typescript
   // Remove setTimeout delay, restore immediate prefetch
   if (prefetchRef.current) {
     prefetchRef.current(chapter);  // Immediate (old behavior)
   }
   ```

3. **Database Cleanup (if needed):**
   ```sql
   -- No cleanup needed - pre-extracted descriptions are harmless
   ```

---

## Monitoring

After deployment, monitor:

1. **Gemini API metrics:**
   - Request rate (should stay same, just shifted to upload time)
   - 429 rate limit errors (should decrease)
   - Average extraction time

2. **User metrics:**
   - Time to first highlight (should drop to <1s)
   - First chapter bounce rate (should decrease)
   - Book upload time (will increase by 15-30s, acceptable)

3. **Error rates:**
   - Pre-extraction failures during upload
   - Chapter loading errors
   - Cache miss rate (should stay low)

---

**Status:** ✅ Ready for Implementation

**Estimated Time:** 4-6 hours
- Backend: 2 hours (pre-extraction + testing)
- Frontend: 2 hours (delay prefetch + UI improvements)
- Testing: 1-2 hours (manual + automated)

**Next Step:** Review with team → Implement → Test → Deploy

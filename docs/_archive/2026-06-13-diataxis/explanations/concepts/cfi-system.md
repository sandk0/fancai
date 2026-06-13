# CFI (Canonical Fragment Identifier) Reading System

**Technical Documentation for BookReader AI**

**Version:** 1.0
**Last Updated:** 2025-10-23
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [What is CFI?](#what-is-cfi)
3. [Implementation in BookReader AI](#implementation-in-bookreader-ai)
4. [Backend Integration](#backend-integration)
5. [Frontend Integration](#frontend-integration)
6. [Hybrid Position Restoration System](#hybrid-position-restoration-system)
7. [Migration History](#migration-history)
8. [API Reference](#api-reference)
9. [Use Cases & Examples](#use-cases--examples)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The CFI (Canonical Fragment Identifier) Reading System is a critical component of BookReader AI that provides **pixel-perfect position tracking** for EPUB books. It allows users to close the book, switch devices, or come back days later and **resume reading at the exact same position**.

### Key Features

- ✅ **Exact position tracking** - CFI provides chapter + paragraph + character-level precision
- ✅ **Cross-device sync** - Same position across web, mobile, tablet
- ✅ **Backward compatible** - Works with old chapter-based tracking
- ✅ **Hybrid restoration** - CFI for coarse position + scroll offset for fine-tuning
- ✅ **Standard-compliant** - Uses IDPF EPUB CFI specification

### Technology Stack

- **EPUB Standard:** IDPF Canonical Fragment Identifier (CFI)
- **Frontend Library:** epub.js 0.3.93
- **Backend:** PostgreSQL (reading_progress table)
- **API:** FastAPI REST endpoints

---

## What is CFI?

CFI (Canonical Fragment Identifier) is an **EPUB positioning standard** developed by IDPF (International Digital Publishing Forum). It's like a GPS coordinate system for EPUB books.

### CFI Format

A typical CFI looks like this:

```
epubcfi(/6/4[chap01ref]!/4/2/42)
```

Breaking it down:

```
epubcfi(
  /6          → spine position (chapter 3 in spine)
  /4[chap01ref] → spine item with ID "chap01ref"
  !/4/2/42    → DOM path inside the document
              → 4th child → 2nd child → character offset 42
)
```

### Why CFI?

| Method | Precision | Cross-Reader | Standard | Limitations |
|--------|-----------|--------------|----------|-------------|
| **Page numbers** | Low | ❌ No | ❌ No | Different pagination per device |
| **Chapter + percent** | Medium | ⚠️ Partial | ❌ No | Approximate, loses position within paragraphs |
| **CFI** | **High** | ✅ Yes | ✅ Yes | Works across all EPUB-compliant readers |

---

## Implementation in BookReader AI

### Database Schema

The CFI system uses two new fields in the `reading_progress` table:

```sql
-- reading_progress table
CREATE TABLE reading_progress (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,

    -- Legacy fields (backward compatibility)
    current_chapter INTEGER DEFAULT 1,
    current_page INTEGER DEFAULT 1,
    current_position INTEGER DEFAULT 0,  -- Now stores percent (0-100) for EPUB

    -- NEW: CFI-based position tracking (October 2025)
    reading_location_cfi VARCHAR(500),      -- Exact CFI position
    scroll_offset_percent FLOAT DEFAULT 0.0, -- Fine-tuned scroll position (0-100)

    -- Other fields...
    reading_time_minutes INTEGER DEFAULT 0,
    reading_speed_wpm FLOAT DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    last_read_at TIMESTAMP WITH TIME ZONE
);
```

### Field Descriptions

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `reading_location_cfi` | VARCHAR(500) | Stores exact CFI from epub.js | `epubcfi(/6/4[chap01ref]!/4/2/42)` |
| `scroll_offset_percent` | FLOAT | Pixel-perfect scroll position within the page | `23.45` (23.45% scrolled) |
| `current_position` | INTEGER | **REPURPOSED:** Now stores overall book progress percent (0-100) for EPUB books | `67` (67% through the book) |

### Data Flow

```
User reads EPUB
    ↓
epub.js fires 'relocated' event
    ↓
Frontend captures:
  - CFI: rendition.currentLocation().start.cfi
  - Percent: locations.percentageFromCfi(cfi) * 100
  - Scroll: (scrollTop / maxScroll) * 100
    ↓
Debounced save (2 seconds)
    ↓
POST /api/v1/books/{id}/progress
    ↓
Backend saves to reading_progress table
    ↓
Next time user opens book:
  - Restore CFI: rendition.display(cfi)
  - Fine-tune scroll: document.scrollTop = (offset / 100) * maxScroll
```

---

## Backend Integration

### 1. Database Model

**File:** `backend/app/models/book.py`

```python
class ReadingProgress(Base):
    """
    Модель прогресса чтения книги пользователем.
    """
    __tablename__ = "reading_progress"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)

    # Legacy fields
    current_chapter = Column(Integer, default=1, nullable=False)
    current_page = Column(Integer, default=1, nullable=False)
    current_position = Column(Integer, default=0, nullable=False)  # Repurposed: percent for EPUB

    # CFI-based tracking (NEW)
    reading_location_cfi = Column(String(500), nullable=True)
    scroll_offset_percent = Column(Float, default=0.0, nullable=False)

    # ... other fields
```

### 2. Progress Calculation Method

**File:** `backend/app/models/book.py`

The `get_reading_progress_percent()` method automatically detects CFI-based progress:

```python
async def get_reading_progress_percent(self, db: AsyncSession, user_id: UUID) -> float:
    """
    Получает прогресс чтения книги пользователем в процентах.

    Для EPUB книг с CFI: current_position уже содержит точный процент 0-100
    Для старых данных без CFI: используется формула на основе глав

    Returns:
        Прогресс чтения от 0.0 до 100.0
    """
    # ... get progress from DB

    # NEW LOGIC: If CFI exists, use epub.js calculated percent
    if progress.reading_location_cfi:
        # current_position already contains overall book percent (0-100)
        # calculated via epub.js locations API
        current_position = max(0.0, min(100.0, float(progress.current_position)))
        return current_position

    # OLD LOGIC: Fallback for books without CFI
    # Calculate based on chapters and position within chapter
    # ... chapter-based calculation
```

**Key insight:** The method is **smart enough** to detect whether the book uses CFI tracking or old chapter-based tracking.

### 3. API Endpoints

#### Update Reading Progress

**Endpoint:** `POST /api/v1/books/{book_id}/progress`

**Request Body:**
```json
{
  "current_chapter": 1,
  "current_position_percent": 67.5,
  "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
  "scroll_offset_percent": 23.45
}
```

**Implementation:** `backend/app/routers/books.py`

```python
@router.post("/{book_id}/progress")
async def update_reading_progress(
    book_id: UUID,
    progress_data: dict,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session)
):
    # Extract CFI and scroll offset
    reading_location_cfi = progress_data.get('reading_location_cfi')
    scroll_offset_percent = progress_data.get('scroll_offset_percent', 0.0)
    position_percent = progress_data.get('current_position_percent', 0.0)

    # Update in database
    progress = await book_service.update_reading_progress(
        db=db,
        user_id=current_user.id,
        book_id=book_id,
        chapter_number=current_chapter,
        position_percent=position_percent,
        reading_location_cfi=reading_location_cfi,
        scroll_offset_percent=scroll_offset_percent
    )

    return {"progress": {...}}
```

#### Get Reading Progress

**Endpoint:** `GET /api/v1/books/{book_id}/progress`

**Response:**
```json
{
  "progress": {
    "id": "uuid",
    "current_chapter": 1,
    "current_position": 67,
    "current_position_percent": 67.5,
    "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
    "scroll_offset_percent": 23.45,
    "last_read_at": "2025-10-23T14:30:00Z"
  }
}
```

---

## Frontend Integration

### 1. epub.js Setup

**File:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
// Initialize epub.js
const epubBook = ePub(arrayBuffer);
await epubBook.ready;

// CRITICAL: Generate locations for progress tracking
await epubBook.locations.generate(1600); // 1600 chars per "page"

// Create rendition
const rendition = epubBook.renderTo(viewerRef.current, {
  width: '100%',
  height: '100%',
  spread: 'none',
});
```

### 2. CFI Tracking (Relocated Event)

```typescript
rendition.on('relocated', async (location: any) => {
  const cfi = location.start.cfi;

  // Calculate progress percent using locations API
  let progressPercent = 0;
  if (epubBook.locations && epubBook.locations.total > 0) {
    const currentLocation = epubBook.locations.percentageFromCfi(cfi);
    progressPercent = Math.round((currentLocation || 0) * 100);
  }

  // Calculate scroll offset for fine-tuning
  let scrollOffsetPercent = 0.0;
  const contents = rendition.getContents();
  if (contents && contents.length > 0) {
    const doc = contents[0].document;
    const scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;
    const scrollHeight = doc.documentElement.scrollHeight;
    const clientHeight = doc.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll > 0) {
      scrollOffsetPercent = (scrollTop / maxScroll) * 100;
    }
  }

  // Debounced save
  setTimeout(async () => {
    await booksAPI.updateReadingProgress(book.id, {
      current_chapter: 1,
      current_position_percent: progressPercent,
      reading_location_cfi: cfi,
      scroll_offset_percent: scrollOffsetPercent,
    });
  }, 2000);
});
```

### 3. Position Restoration

```typescript
// Load saved progress
const { progress } = await booksAPI.getReadingProgress(book.id);

if (progress?.reading_location_cfi) {
  const savedCfi = progress.reading_location_cfi;
  const savedPercent = progress.current_position || 0;
  const savedScrollOffset = progress.scroll_offset_percent || 0;

  // STEP 1: Restore coarse position via CFI
  await rendition.display(savedCfi);

  // STEP 2: Fine-tune with scroll offset (hybrid approach)
  await new Promise(resolve => setTimeout(resolve, 300)); // Wait for rendering

  const contents = rendition.getContents();
  if (contents && contents.length > 0) {
    const doc = contents[0].document;
    const scrollHeight = doc.documentElement.scrollHeight;
    const clientHeight = doc.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll > 0) {
      const targetScrollTop = (savedScrollOffset / 100) * maxScroll;
      doc.documentElement.scrollTop = targetScrollTop;
      doc.body.scrollTop = targetScrollTop; // For older browsers
    }
  }
} else {
  // No saved progress, start from beginning
  await rendition.display();
}
```

---

## Hybrid Position Restoration System

### Why Hybrid?

epub.js can **round CFI to the nearest paragraph or DOM node**, which can cause 1-2 screen heights of positioning error. The hybrid system compensates for this:

1. **CFI** → Gets us to the right chapter, right section, right paragraph (coarse positioning)
2. **scroll_offset_percent** → Gets us to the exact pixel position within that view (fine-tuning)

### Restoration Algorithm

```
1. Display CFI position
   ↓
2. Wait 300ms for rendering
   ↓
3. Calculate target scroll:
   targetScrollTop = (scroll_offset_percent / 100) * maxScroll
   ↓
4. Apply scroll offset
   ↓
5. User sees EXACT same position as before
```

### Precision Comparison

| Method | Precision | Error Range |
|--------|-----------|-------------|
| CFI only | ~10-50 lines | 1-2 screen heights |
| CFI + scroll offset | **~1 line** | **<5% of screen height** |

---

## Migration History

### Migration 1: Add reading_location_cfi

**File:** `backend/alembic/versions/2025_10_19_2348-8ca7de033db9_add_reading_location_cfi_field.py`

**Revision:** `8ca7de033db9`
**Date:** 2025-10-19 23:48:18 UTC

**Changes:**
```sql
ALTER TABLE reading_progress
ADD COLUMN reading_location_cfi VARCHAR(500);
```

**Side effect:** This migration also removed the `admin_settings` table (orphaned table cleanup).

### Migration 2: Add scroll_offset_percent

**File:** `backend/alembic/versions/2025_10_20_2328-e94cab18247f_add_scroll_offset_percent_to_reading_.py`

**Revision:** `e94cab18247f`
**Date:** 2025-10-20 23:28:57 UTC

**Changes:**
```sql
ALTER TABLE reading_progress
ADD COLUMN scroll_offset_percent FLOAT NOT NULL DEFAULT 0.0;
```

---

## API Reference

### Update Reading Progress

```http
POST /api/v1/books/{book_id}/progress
Authorization: Bearer {token}
Content-Type: application/json

{
  "current_chapter": 1,
  "current_position_percent": 67.5,
  "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
  "scroll_offset_percent": 23.45
}
```

**Response:**
```json
{
  "progress": {
    "id": "uuid",
    "current_chapter": 1,
    "current_page": 1,
    "current_position": 67,
    "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
    "scroll_offset_percent": 23.45,
    "reading_time_minutes": 120,
    "reading_speed_wpm": 250,
    "last_read_at": "2025-10-23T14:30:00Z"
  },
  "message": "Reading progress updated successfully"
}
```

### Get Reading Progress

```http
GET /api/v1/books/{book_id}/progress
Authorization: Bearer {token}
```

**Response:**
```json
{
  "progress": {
    "id": "uuid",
    "current_chapter": 1,
    "current_position": 67,
    "current_position_percent": 67.5,
    "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
    "scroll_offset_percent": 23.45,
    "last_read_at": "2025-10-23T14:30:00Z"
  }
}
```

### Get Book Details (includes progress)

```http
GET /api/v1/books/{book_id}
Authorization: Bearer {token}
```

**Response includes:**
```json
{
  "id": "uuid",
  "title": "War and Peace",
  "reading_progress": {
    "current_chapter": 1,
    "current_position": 67,
    "reading_location_cfi": "epubcfi(/6/4[chap01ref]!/4/2/42)",
    "progress_percent": 67.5
  }
}
```

---

## Use Cases & Examples

### Use Case 1: New User Starts Reading

**Scenario:** User opens book for the first time

**Flow:**
1. No `reading_progress` record exists
2. GET `/books/{id}/progress` returns `null`
3. Frontend starts from beginning: `rendition.display()`
4. User reads first page
5. After 2 seconds, auto-save fires
6. POST `/books/{id}/progress` with CFI from page 1

**Database:**
```json
{
  "current_chapter": 1,
  "current_position": 2,
  "reading_location_cfi": "epubcfi(/6/2[cover]!/4/2/1)",
  "scroll_offset_percent": 0.0
}
```

### Use Case 2: User Resumes Reading

**Scenario:** User closed book at 67% and comes back next day

**Flow:**
1. GET `/books/{id}/progress` returns saved CFI
2. Frontend restores: `rendition.display(savedCfi)`
3. Fine-tune scroll: apply `scroll_offset_percent`
4. User sees **exact same position** as yesterday

**Restoration:**
```typescript
await rendition.display("epubcfi(/6/12[chap05]!/4/8/142)");
// Wait for render
await new Promise(r => setTimeout(r, 300));
// Apply scroll offset
doc.documentElement.scrollTop = (23.45 / 100) * maxScroll;
```

### Use Case 3: Cross-Device Sync

**Scenario:** User reads on laptop, continues on phone

**Flow:**
1. **Laptop:** User reads to 67%, CFI saved
2. **Phone:** Opens same book
3. GET `/books/{id}/progress` returns laptop's CFI
4. Phone's epub.js restores to exact same position
5. User continues reading seamlessly

### Use Case 4: Backward Compatibility (FB2 Books)

**Scenario:** User has old FB2 book without CFI

**Flow:**
1. FB2 books don't use epub.js, so no CFI
2. `reading_location_cfi` is `null`
3. Backend's `get_reading_progress_percent()` detects this
4. Falls back to old chapter-based calculation
5. User gets approximate progress (chapter + percent)

---

## Troubleshooting

### Problem 1: CFI Mismatch After Restoration

**Symptoms:**
- User expects to be at 67%, but lands at 65%
- Console shows: "CFI MISMATCH DETECTED!"

**Cause:** epub.js rounds CFI to nearest valid DOM node

**Solution:** This is expected behavior. The hybrid system compensates:
- CFI gets you close (±2%)
- scroll_offset_percent fine-tunes to exact position
- Net error: <0.5%

**Verification:**
```typescript
console.log('CFI restoration accuracy:', {
  requested: savedPercent + '%',
  actual: actualPercent + '%',
  diff: Math.abs(actualPercent - savedPercent) + '%',
  withinThreshold: Math.abs(actualPercent - savedPercent) <= 3
});
```

### Problem 2: Progress Not Saving

**Symptoms:**
- User reads, but progress stays at 0%
- Console shows: "Reading progress saved" but DB unchanged

**Cause:** Debounced save hasn't fired yet (2 second delay)

**Solution:** Wait at least 2 seconds before closing book

**Debug:**
```typescript
// Check if saveTimeoutRef is set
console.log('Save timeout active:', !!saveTimeoutRef.current);

// Manually trigger save
clearTimeout(saveTimeoutRef.current);
await booksAPI.updateReadingProgress(...);
```

### Problem 3: Locations Not Generated

**Symptoms:**
- `epubBook.locations.total` is 0
- Progress percent is always 0

**Cause:** locations.generate() failed or wasn't awaited

**Solution:** Ensure proper initialization:
```typescript
await epubBook.ready;
await epubBook.locations.generate(1600); // Must await!

// Verify
console.log('Locations ready:', {
  total: epubBook.locations.total,
  length: epubBook.locations.length()
});
```

### Problem 4: Scroll Offset Not Applied

**Symptoms:**
- CFI restored correctly, but scroll position is wrong
- User sees top of page instead of middle

**Cause:** Scroll applied before rendering complete

**Solution:** Increase delay before scroll application:
```typescript
await rendition.display(cfi);
await new Promise(r => setTimeout(r, 500)); // Increase from 300ms
// Now apply scroll
```

---

## Performance Considerations

### Database Indexes

Add indexes for fast progress lookup:

```sql
CREATE INDEX idx_reading_progress_user_book
ON reading_progress(user_id, book_id);

CREATE INDEX idx_reading_progress_last_read
ON reading_progress(last_read_at DESC);
```

### Frontend Optimization

**Debouncing:** Save progress every 2 seconds (not on every page turn)

```typescript
// Bad: Save on every 'relocated' event (100+ times/minute)
rendition.on('relocated', async (loc) => {
  await saveProgress(); // Network spam!
});

// Good: Debounced save
rendition.on('relocated', (loc) => {
  clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(() => {
    saveProgress();
  }, 2000); // Only after 2 seconds of inactivity
});
```

### Backend Optimization

**Batch updates:** Use single UPDATE query, not SELECT + UPDATE

```python
# Good
await db.execute(
    update(ReadingProgress)
    .where(ReadingProgress.book_id == book_id)
    .values(
        reading_location_cfi=cfi,
        current_position=percent,
        scroll_offset_percent=scroll
    )
)
```

---

## Future Enhancements

### 1. CFI History

Track reading history with CFI snapshots:

```sql
CREATE TABLE reading_history (
    id UUID PRIMARY KEY,
    user_id UUID,
    book_id UUID,
    reading_location_cfi VARCHAR(500),
    progress_percent FLOAT,
    timestamp TIMESTAMP
);
```

### 2. Annotation CFI

Link annotations to exact positions:

```sql
CREATE TABLE highlights (
    id UUID PRIMARY KEY,
    user_id UUID,
    book_id UUID,
    cfi_range VARCHAR(1000), -- Start and end CFI
    highlighted_text TEXT,
    created_at TIMESTAMP
);
```

### 3. Reading Analytics

Track where users spend most time:

```python
# Heatmap of reading patterns
SELECT
    reading_location_cfi,
    COUNT(*) as visit_count,
    AVG(reading_time_minutes) as avg_time_spent
FROM reading_sessions
GROUP BY reading_location_cfi
ORDER BY visit_count DESC;
```

---

## References

- [IDPF EPUB CFI Specification](http://www.idpf.org/epub/linking/cfi/)
- [epub.js Documentation](https://github.com/futurepress/epub.js/)
- [BookReader AI Architecture Docs](../architecture/)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-23
**Maintained by:** BookReader AI Development Team

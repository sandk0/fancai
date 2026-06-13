# epub.js Integration Guide

**Technical Documentation for BookReader AI**

**Version:** 1.0
**Last Updated:** 2025-10-23
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [EpubReader Component](#epubreader-component)
5. [EPUB File Loading](#epub-file-loading)
6. [Location System](#location-system)
7. [CFI Tracking and Restoration](#cfi-tracking-and-restoration)
8. [Smart Highlight System](#smart-highlight-system)
9. [Progress Saving](#progress-saving)
10. [Component Lifecycle](#component-lifecycle)
11. [State Management](#state-management)
12. [Event Handling](#event-handling)
13. [Performance Optimization](#performance-optimization)
14. [Troubleshooting](#troubleshooting)

---

## Overview

BookReader AI uses **epub.js** for professional EPUB rendering with pixel-perfect reading position tracking. The integration provides a Netflix-like reading experience with seamless resume, smart highlights, and AI-generated images for descriptions.

### Key Features

- ✅ **Professional EPUB rendering** - Full support for EPUB 2.0 and 3.0
- ✅ **CFI-based position tracking** - Resume at exact position across devices
- ✅ **2000 generated locations** - Precise progress calculation per book
- ✅ **Smart highlighting** - Click descriptions to view AI-generated images
- ✅ **Auto-save progress** - Debounced every 2 seconds
- ✅ **Responsive design** - Works on desktop, tablet, mobile
- ✅ **Dark theme** - Eye-friendly reading experience

### Integration Timeline

| Date | Commit | Feature |
|------|--------|---------|
| 2025-10-19 | `661f56e` | epub.js + react-reader integration |
| 2025-10-19 | `8ca7de033db9` | CFI field added to database |
| 2025-10-20 | `1c0c888` | EPUB file loading with authorization |
| 2025-10-20 | `545b74d` | Complete EpubReader rewrite with tracking |
| 2025-10-20 | `207df98` | Locations generation fix |
| 2025-10-20 | `e94cab18247f` | scroll_offset_percent field added |

---

## Technology Stack

### Core Libraries

```json
{
  "epubjs": "0.3.93",
  "react-reader": "2.0.15",
  "react": "18+",
  "typescript": "5+"
}
```

### Backend Integration

- **FastAPI endpoint:** `GET /api/v1/books/{id}/file`
- **Authorization:** Bearer token in headers
- **Response:** EPUB file as `application/epub+zip`

### Database Schema

```sql
-- reading_progress table
reading_location_cfi VARCHAR(500)      -- CFI from epub.js
scroll_offset_percent FLOAT DEFAULT 0.0 -- Fine-tuned scroll position
current_position INTEGER               -- Overall book percent (0-100)
```

---

## Architecture

### Component Hierarchy

```
BookReaderPage (Route: /reader/:bookId)
    ↓
EpubReader (Main component, 835 lines)
    ↓
    ├─ epub.js Book instance (bookRef)
    ├─ Rendition instance (renditionRef)
    ├─ Viewer container (viewerRef)
    ├─ ImageModal (for description images)
    └─ Navigation buttons (Prev/Next)
```

### Data Flow

```
1. Component Mount
   ↓
2. Initialize epub.js
   ↓
3. Load EPUB file (with auth)
   ↓
4. Generate 2000 locations
   ↓
5. Create rendition
   ↓
6. Restore saved position (CFI)
   ↓
7. Apply dark theme
   ↓
8. Load descriptions for current chapter
   ↓
9. Highlight descriptions in text
   ↓
10. Track user navigation
    ↓
11. Auto-save progress (debounced)
```

### File Structure

```
frontend/src/
├── components/
│   └── Reader/
│       ├── EpubReader.tsx          # Main component (835 lines)
│       ├── PageControls.tsx        # Navigation buttons
│       └── ProgressBar.tsx         # Reading progress indicator
├── api/
│   └── books.ts                    # API client functions
├── types/
│   └── api.ts                      # TypeScript types
└── stores/
    └── readerStore.ts              # Zustand state management
```

---

## EpubReader Component

**File:** `frontend/src/components/Reader/EpubReader.tsx` (835 lines)

### Component Props

```typescript
interface EpubReaderProps {
  book: BookDetail; // Book metadata with ID, title, author, etc.
}

export const EpubReader: React.FC<EpubReaderProps> = ({ book }) => {
  // Component implementation
};
```

### State Variables

```typescript
// Loading and error states
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string>('');
const [isReady, setIsReady] = useState(false);
const [renditionReady, setRenditionReady] = useState(false);

// Data states
const [descriptions, setDescriptions] = useState<Description[]>([]);
const [images, setImages] = useState<GeneratedImage[]>([]);
const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
const [currentChapter, setCurrentChapter] = useState<number>(1);

// Refs (persistent across renders)
const viewerRef = useRef<HTMLDivElement>(null);           // DOM container
const renditionRef = useRef<Rendition | null>(null);      // epub.js rendition
const bookRef = useRef<Book | null>(null);                // epub.js book
const saveTimeoutRef = useRef<NodeJS.Timeout>();          // Debounce timer
const restoredCfi = useRef<string | null>(null);          // Track restored position
```

### Core Functionality

The component handles:

1. **EPUB initialization** - Load and parse EPUB file
2. **Position restoration** - Resume from saved CFI
3. **Chapter detection** - Track current chapter from spine
4. **Description loading** - Fetch descriptions for current chapter
5. **Smart highlighting** - Highlight descriptions in rendered text
6. **Progress tracking** - Save CFI + scroll offset every 2 seconds
7. **Navigation** - Next/previous page buttons
8. **Image modal** - Show AI-generated images on click

---

## EPUB File Loading

### Backend Endpoint

**File:** `backend/app/routers/books.py`

```python
@router.get("/{book_id}/file")
async def get_book_file(
    book_id: UUID,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session)
):
    """
    Возвращает EPUB файл для чтения в epub.js.
    """
    book = await book_service.get_book_by_id(db, book_id, current_user.id)

    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not os.path.exists(book.file_path):
        raise HTTPException(status_code=404, detail="Book file not found")

    return FileResponse(
        path=book.file_path,
        media_type="application/epub+zip",
        filename=f"{book.title}.epub"
    )
```

### Frontend Loading

**File:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
// Load EPUB file with authorization
const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
const response = await fetch(booksAPI.getBookFileUrl(book.id), {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

if (!response.ok) {
  throw new Error(`Failed to download EPUB: ${response.statusText}`);
}

const arrayBuffer = await response.arrayBuffer();

// Initialize epub.js with ArrayBuffer
const epubBook = ePub(arrayBuffer);
bookRef.current = epubBook;

// Wait for book to load
await epubBook.ready;
```

### Authorization Fix (Commit 1567da0)

**Problem:** Initial implementation didn't include auth headers, resulting in 401 Unauthorized

**Solution:**
```typescript
// ❌ Before (broken)
const epubBook = ePub(booksAPI.getBookFileUrl(book.id));

// ✅ After (working)
const response = await fetch(booksAPI.getBookFileUrl(book.id), {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
const arrayBuffer = await response.arrayBuffer();
const epubBook = ePub(arrayBuffer);
```

---

## Location System

### What are Locations?

epub.js **locations** are virtual page breaks generated by splitting the book into chunks of ~1600 characters. They provide a stable way to calculate reading progress.

### Generation

**File:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
// Generate locations for progress tracking (AFTER book.ready)
await epubBook.locations.generate(1600); // 1600 chars per "page"

const locationsTotal = (epubBook.locations as any).total || 0;
console.log('✅ Locations generated:', locationsTotal);

// Example output: "✅ Locations generated: 2147"
// (For a 500-page book, ~2000 locations is typical)
```

### Why 1600 Characters?

- **Too small (e.g., 500):** Too many locations, slow generation
- **Too large (e.g., 5000):** Too few locations, imprecise progress
- **1600:** Sweet spot - ~1 paragraph, fast generation, accurate progress

### Locations API

```typescript
// Get total number of locations
const total = epubBook.locations.total;

// Convert CFI to percent
const cfi = "epubcfi(/6/4[chap01]!/4/2/42)";
const percent = epubBook.locations.percentageFromCfi(cfi); // 0.675 (67.5%)

// Convert percent to CFI
const percent = 0.675;
const cfi = epubBook.locations.cfiFromPercentage(percent);
// Returns: "epubcfi(/6/4[chap01]!/4/2/42)"

// Get location count
const count = epubBook.locations.length(); // 2147
```

### Locations Generation Fix (Commit 207df98)

**Problem:** Locations were generated BEFORE `book.ready`, resulting in 0 locations

**Solution:**
```typescript
// ❌ Before (broken)
const epubBook = ePub(arrayBuffer);
await epubBook.locations.generate(1600); // Fails silently!
await epubBook.ready;

// ✅ After (working)
const epubBook = ePub(arrayBuffer);
await epubBook.ready; // Wait first!
await epubBook.locations.generate(1600); // Now works
```

---

## CFI Tracking and Restoration

### Tracking Current Position

**File:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
rendition.on('relocated', async (location: any) => {
  const cfi = location.start.cfi;

  // Calculate progress percent
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

  // Debounced save (2 seconds)
  setTimeout(async () => {
    await booksAPI.updateReadingProgress(book.id, {
      current_chapter: 1,
      current_position_percent: progressPercent,
      reading_location_cfi: cfi,
      scroll_offset_percent: scrollOffsetPercent,
    });
    console.log('💾 Progress saved:', {
      cfi: cfi.substring(0, 50),
      progress: progressPercent + '%',
      scrollOffset: scrollOffsetPercent.toFixed(2) + '%'
    });
  }, 2000);
});
```

### Restoring Saved Position

```typescript
// Load saved progress
const { progress } = await booksAPI.getReadingProgress(book.id);

if (progress?.reading_location_cfi) {
  const savedCfi = progress.reading_location_cfi;
  const savedPercent = progress.current_position || 0;
  const savedScrollOffset = progress.scroll_offset_percent || 0;

  // Try cfiFromPercentage for more accurate restoration
  let cfiToRestore = savedCfi;
  if (epubBook.locations && epubBook.locations.total > 0 && savedPercent > 0) {
    const percentValue = savedPercent / 100;
    const cfiFromPercent = epubBook.locations.cfiFromPercentage(percentValue);

    if (cfiFromPercent && cfiFromPercent !== 'epubcfi()') {
      cfiToRestore = cfiFromPercent;
      console.log('✅ Using cfiFromPercentage for accurate restoration');
    }
  }

  // Remember restored CFI (to avoid auto-save on first relocate)
  restoredCfi.current = cfiToRestore;

  // Display at CFI
  await rendition.display(cfiToRestore);

  // Wait for rendering
  await new Promise(resolve => setTimeout(resolve, 300));

  // Apply fine-tuned scroll offset (HYBRID APPROACH)
  if (savedScrollOffset > 0) {
    const contents = rendition.getContents();
    if (contents && contents.length > 0) {
      const doc = contents[0].document;
      const scrollHeight = doc.documentElement.scrollHeight;
      const clientHeight = doc.documentElement.clientHeight;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll > 0) {
        const targetScrollTop = (savedScrollOffset / 100) * maxScroll;
        doc.documentElement.scrollTop = targetScrollTop;
        doc.body.scrollTop = targetScrollTop;
      }
    }
  }
} else {
  // No saved progress, start from beginning
  await rendition.display();
}
```

### Preventing Auto-Save on Restore

**Problem:** When restoring position, epub.js fires `relocated` event, which triggers auto-save with the same CFI

**Solution:** Track restored CFI and skip first `relocated` event

```typescript
// Skip relocated events for restored CFI
if (restoredCfi.current && cfi === restoredCfi.current) {
  console.log('⏳ Skipping relocated event - EXACT match with restored position');
  return;
}

// Also check if within 3% (epub.js rounding)
if (restoredCfi.current) {
  const restoredPercent = Math.round(
    (epubBook.locations.percentageFromCfi(restoredCfi.current) || 0) * 100
  );
  const currentPercent = Math.round(
    (epubBook.locations.percentageFromCfi(cfi) || 0) * 100
  );

  if (Math.abs(currentPercent - restoredPercent) <= 3) {
    console.log('⏳ Skipping - within 3% of restored position (epub.js rounding)');
    restoredCfi.current = null; // Clear flag
    return;
  }
}

// Now save (this is a real page turn)
restoredCfi.current = null;
saveProgress();
```

---

## Smart Highlight System

### Overview

The smart highlight system detects descriptions in the rendered EPUB text and makes them clickable to view AI-generated images.

### Architecture

```
1. Load descriptions for current chapter
   ↓
2. Wait for rendition to render page
   ↓
3. Search for each description text in DOM
   ↓
4. Wrap matches in <span class="description-highlight">
   ↓
5. Add click handler to show image modal
   ↓
6. User clicks → modal opens with AI image
```

### Implementation

**File:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
const highlightDescriptionsInText = useCallback(() => {
  if (!renditionRef.current || descriptions.length === 0) {
    return;
  }

  const rendition = renditionRef.current;
  const contents = rendition.getContents();

  if (!contents || contents.length === 0) {
    return;
  }

  const iframe = contents[0];
  const doc = iframe.document;

  // Remove old highlights
  const oldHighlights = doc.querySelectorAll('.description-highlight');
  oldHighlights.forEach((el: Element) => {
    const parent = el.parentNode;
    if (parent) {
      const textNode = doc.createTextNode(el.textContent || '');
      parent.replaceChild(textNode, el);
      parent.normalize();
    }
  });

  // Add new highlights
  descriptions.forEach((desc) => {
    const text = desc.content;

    // Skip chapter headers
    const chapterHeaderMatch = text.match(/^(Глава .*?)\s+/i);
    let searchText = text;
    if (chapterHeaderMatch) {
      searchText = text.substring(chapterHeaderMatch[0].length).trim();
    }

    // Search in DOM
    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.nodeValue || '';
      const index = nodeText.indexOf(searchText.substring(0, 50));

      if (index !== -1) {
        const parent = node.parentNode;

        // Create highlight span
        const span = doc.createElement('span');
        span.className = 'description-highlight';
        span.setAttribute('data-description-id', desc.id);
        span.style.cssText = `
          background-color: rgba(96, 165, 250, 0.2);
          border-bottom: 2px solid #60a5fa;
          cursor: pointer;
          transition: background-color 0.2s;
        `;

        // Hover effect
        span.addEventListener('mouseenter', () => {
          span.style.backgroundColor = 'rgba(96, 165, 250, 0.3)';
        });
        span.addEventListener('mouseleave', () => {
          span.style.backgroundColor = 'rgba(96, 165, 250, 0.2)';
        });

        // Click handler
        span.addEventListener('click', () => {
          const image = images.find(img => img.description?.id === desc.id);

          if (image) {
            setSelectedImage(image);
          } else {
            // Generate image on demand
            imagesAPI.generateImageForDescription(desc.id)
              .then(result => {
                const newImage = {
                  id: result.image_id,
                  description_id: result.description_id,
                  image_url: result.image_url,
                  description: desc,
                };
                setSelectedImage(newImage);
                setImages(prev => [...prev, newImage]);
              })
              .catch(console.error);
          }
        });

        // Insert highlighted span
        const before = nodeText.substring(0, index);
        const highlighted = nodeText.substring(index, index + searchText.length);
        const after = nodeText.substring(index + searchText.length);

        const beforeNode = before ? doc.createTextNode(before) : null;
        const afterNode = after ? doc.createTextNode(after) : null;
        span.textContent = highlighted;

        parent.insertBefore(span, node);
        if (beforeNode) parent.insertBefore(beforeNode, span);
        if (afterNode) parent.insertBefore(afterNode, span.nextSibling);
        parent.removeChild(node);

        break; // Only highlight first match
      }
    }
  });
}, [descriptions, images]);
```

### Highlighting Trigger

```typescript
useEffect(() => {
  if (!renditionReady || !renditionRef.current || descriptions.length === 0) {
    return;
  }

  const rendition = renditionRef.current;

  // Apply highlights when page is rendered
  const handleRendered = () => {
    setTimeout(() => {
      highlightDescriptionsInText();
    }, 300);
  };

  rendition.on('rendered', handleRendered);

  // Initial highlighting
  handleRendered();

  return () => {
    rendition.off('rendered', handleRendered);
  };
}, [descriptions, highlightDescriptionsInText, renditionReady]);
```

---

## Progress Saving

### Debounced Auto-Save

**Strategy:** Save progress 2 seconds after user stops navigating

```typescript
// Bad: Save immediately on every page turn
rendition.on('relocated', async (location) => {
  await saveProgress(); // 100+ API calls per minute!
});

// Good: Debounced save
rendition.on('relocated', (location) => {
  if (saveTimeoutRef.current) {
    clearTimeout(saveTimeoutRef.current);
  }

  saveTimeoutRef.current = setTimeout(async () => {
    await saveProgress();
  }, 2000); // Only after 2 seconds of no activity
});
```

### Save Function

```typescript
const saveProgress = async (cfi: string, progressPercent: number, scrollOffsetPercent: number) => {
  try {
    await booksAPI.updateReadingProgress(book.id, {
      current_chapter: 1,
      current_position_percent: progressPercent,
      reading_location_cfi: cfi,
      scroll_offset_percent: scrollOffsetPercent,
    });

    console.log('💾 Reading progress saved:', {
      cfi: cfi.substring(0, 50),
      progress: progressPercent + '%',
      scrollOffset: scrollOffsetPercent.toFixed(2) + '%'
    });
  } catch (error) {
    console.error('❌ Error saving reading progress:', error);
  }
};
```

---

## Component Lifecycle

### Initialization Flow

```
1. Component mounts
   ↓
2. useEffect sets isReady = true (100ms delay)
   ↓
3. Main initialization useEffect triggers
   ↓
4. Download EPUB file with auth
   ↓
5. Initialize epub.js book
   ↓
6. Wait for book.ready
   ↓
7. Generate locations (2000)
   ↓
8. Create rendition
   ↓
9. Apply dark theme
   ↓
10. Subscribe to 'relocated' event
    ↓
11. Load saved progress
    ↓
12. Restore CFI position
    ↓
13. Apply scroll offset
    ↓
14. Set renditionReady = true (500ms delay)
    ↓
15. Load descriptions for current chapter
    ↓
16. Highlight descriptions in text
    ↓
17. User starts reading
```

### Cleanup

```typescript
useEffect(() => {
  // Initialization...

  return () => {
    if (renditionRef.current) {
      renditionRef.current.destroy();
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
  };
}, [book.id, isReady]);
```

---

## State Management

### Local State (useState)

```typescript
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string>('');
const [descriptions, setDescriptions] = useState<Description[]>([]);
const [currentChapter, setCurrentChapter] = useState<number>(1);
```

### Persistent Refs (useRef)

```typescript
const viewerRef = useRef<HTMLDivElement>(null);      // DOM container
const renditionRef = useRef<Rendition | null>(null); // epub.js instance
const bookRef = useRef<Book | null>(null);           // epub.js book
```

### External State (API)

- **Reading progress:** Stored in PostgreSQL via `booksAPI.updateReadingProgress()`
- **Descriptions:** Fetched via `booksAPI.getChapterDescriptions()`
- **Images:** Fetched via `imagesAPI.getBookImages()`

---

## Event Handling

### epub.js Events

```typescript
// Page navigation
rendition.on('relocated', (location) => {
  // Track position, save progress
});

// Page rendered
rendition.on('rendered', () => {
  // Apply highlights
});

// User selection
rendition.on('selected', (cfiRange, contents) => {
  // Handle text selection for annotations
});
```

### React Events

```typescript
// Next page button
const handleNextPage = useCallback(() => {
  if (renditionRef.current) {
    renditionRef.current.next();
  }
}, []);

// Previous page button
const handlePrevPage = useCallback(() => {
  if (renditionRef.current) {
    renditionRef.current.prev();
  }
}, []);
```

---

## Performance Optimization

### 1. Virtualization (Future)

For very large books (1000+ pages), consider virtualizing rendition:

```typescript
// Only render current chapter + prev/next
await rendition.display(cfiRange, {
  width: '100%',
  height: '100%',
  minSpreadWidth: 800
});
```

### 2. Debouncing

Already implemented for progress saving (2 seconds).

### 3. React.memo

```typescript
const EpubReader = React.memo<EpubReaderProps>(({ book }) => {
  // Component
}, (prevProps, nextProps) => {
  return prevProps.book.id === nextProps.book.id;
});
```

### 4. Lazy Loading Descriptions

```typescript
// Only load descriptions for current chapter
useEffect(() => {
  if (currentChapter > 0) {
    loadDescriptionsForChapter(currentChapter);
  }
}, [currentChapter]);
```

---

## Troubleshooting

### Problem 1: EPUB Not Loading

**Symptoms:** Spinner forever, no errors

**Causes:**
- Missing auth token
- EPUB file not found on server
- Cors issues

**Debug:**
```typescript
console.log('Token:', localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN));
console.log('File URL:', booksAPI.getBookFileUrl(book.id));

// Check network tab
const response = await fetch(url, { headers });
console.log('Response status:', response.status);
console.log('Response headers:', response.headers);
```

### Problem 2: Locations Not Generated

**Symptoms:** Progress always 0%, `locations.total` is 0

**Solution:** Ensure `locations.generate()` is called AFTER `book.ready`

```typescript
// ✅ Correct
await epubBook.ready;
await epubBook.locations.generate(1600);

// ❌ Wrong
await epubBook.locations.generate(1600);
await epubBook.ready;
```

### Problem 3: Highlights Not Appearing

**Symptoms:** Descriptions loaded but not highlighted

**Debug:**
```typescript
console.log('Rendition ready:', renditionReady);
console.log('Descriptions count:', descriptions.length);
console.log('Contents:', rendition.getContents());

// Check if DOM is ready
const contents = rendition.getContents();
if (contents && contents[0]) {
  console.log('Document body:', contents[0].document.body);
}
```

### Problem 4: Progress Not Saving

**Symptoms:** Progress saves locally but not to server

**Debug:**
```typescript
// Check API response
try {
  const result = await booksAPI.updateReadingProgress(...);
  console.log('Save result:', result);
} catch (error) {
  console.error('Save error:', error.response?.data);
}

// Check network tab
// Look for 401 (auth), 500 (server error), etc.
```

---

## API Reference

### booksAPI Methods

```typescript
// Get book file URL
booksAPI.getBookFileUrl(bookId: string): string

// Get reading progress
booksAPI.getReadingProgress(bookId: string): Promise<{
  progress: ReadingProgress | null
}>

// Update reading progress
booksAPI.updateReadingProgress(
  bookId: string,
  data: {
    current_chapter: number,
    current_position_percent: number,
    reading_location_cfi: string,
    scroll_offset_percent: number
  }
): Promise<{ progress: ReadingProgress }>

// Get chapter descriptions
booksAPI.getChapterDescriptions(
  bookId: string,
  chapterNumber: number,
  extractNew: boolean = false
): Promise<{
  chapter_info: ChapterInfo,
  nlp_analysis: {
    total_descriptions: number,
    descriptions: Description[]
  }
}>
```

---

## Future Enhancements

### 1. Annotations

```typescript
// Highlight text and save to database
rendition.on('selected', async (cfiRange, contents) => {
  const text = contents.window.getSelection().toString();
  await annotationsAPI.create({
    book_id: book.id,
    cfi_range: cfiRange,
    text,
    note: ''
  });

  rendition.annotations.highlight(cfiRange);
});
```

### 2. Text-to-Speech

```typescript
// Read aloud current page
const contents = rendition.getContents()[0];
const text = contents.document.body.innerText;

const utterance = new SpeechSynthesisUtterance(text);
speechSynthesis.speak(utterance);
```

### 3. Font Customization

```typescript
// User can change font, size, line height
rendition.themes.fontSize('120%');
rendition.themes.font('Arial');
rendition.themes.default({
  'line-height': '1.8'
});
```

---

## References

- [epub.js GitHub](https://github.com/futurepress/epub.js/)
- [epub.js API Documentation](https://github.com/futurepress/epub.js/blob/master/documentation/README.md)
- [react-reader Documentation](https://github.com/gerhardsletten/react-reader)
- [EPUB CFI Specification](http://www.idpf.org/epub/linking/cfi/)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-23
**Component Size:** 835 lines
**Maintained by:** BookReader AI Development Team

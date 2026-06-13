# 📊 DATABASE SCHEMA DIAGRAM & ER MODEL

**Version:** 2.1 (CFI + epub.js support)
**Database:** PostgreSQL 15+
**Last Updated:** 2025-11-03

---

## COMPLETE SCHEMA DIAGRAM

```
╔═════════════════════════════════════════════════════════════════════════════╗
║                                                                             ║
║                         BOOKREADER AI DATABASE SCHEMA                       ║
║                                                                             ║
╚═════════════════════════════════════════════════════════════════════════════╝

                          ┌─────────────────────────┐
                          │       USERS (10)        │
                          ├─────────────────────────┤
                          │ id (UUID) [PK]          │
                          │ email (VARCHAR) [UQ]    │
                          │ password_hash           │
                          │ full_name               │
                          │ is_active               │
                          │ is_verified             │
                          │ is_admin                │
                          │ created_at              │
                          │ updated_at              │
                          │ last_login              │
                          └─────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    │ 1:1 owns      │ 1:N owns    │ 1:N has
                    │ [CASCADE]     │ [CASCADE]   │ [CASCADE]
                    ▼               ▼               ▼
            ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
            │  SUBSCRIPTIONS   │   │      BOOKS       │   │ READING_PROGRESS │
            │      (12)        │   │      (20)        │   │      (13)        │
            ├──────────────────┤   ├──────────────────┤   ├──────────────────┤
            │ id [PK]          │   │ id [PK]          │   │ id [PK]          │
            │ user_id [FK]     │   │ user_id [FK]     │   │ user_id [FK]     │
            │ plan [ENUM]      │   │ title            │   │ book_id [FK]     │
            │ status [ENUM]    │   │ author           │   │ current_chapter  │
            │ start_date       │   │ genre [VARCHAR]  │   │ current_page     │
            │ end_date         │   │ language         │   │ current_position │
            │ auto_renewal     │   │ file_path        │   │ reading_location │
            │ books_uploaded   │   │ file_format      │   │   _cfi [CFI!]    │
            │ images_gen_mo    │   │ file_size        │   │ scroll_offset_%  │
            │ last_reset       │   │ cover_image      │   │ reading_time_min │
            │ created_at       │   │ description      │   │ reading_speed_wpm│
            │ updated_at       │   │ book_metadata    │   │ created_at       │
            │                  │   │   [JSONB]        │   │ updated_at       │
            │                  │   │ total_pages      │   │ last_read_at     │
            │                  │   │ est_reading_time │   └──────────────────┘
            │                  │   │ is_parsed        │
            │                  │   │ parsing_progress │
            │                  │   │ parsing_error    │
            │                  │   │ created_at       │
            │                  │   │ updated_at       │
            │                  │   │ last_accessed    │
            │                  │   └──────────────────┘
            │                  │            │
            │                  │    1:N has │
            │                  │  [CASCADE] │
            │                  ▼            ▼
            │                  ┌──────────────────┐
            │                  │    CHAPTERS      │
            │                  │      (13)        │
            │                  ├──────────────────┤
            │                  │ id [PK]          │
            │                  │ book_id [FK]     │
            │                  │ chapter_number   │
            │                  │ title            │
            │                  │ content          │
            │                  │ html_content     │
            │                  │ word_count       │
            │                  │ est_read_time    │
            │                  │ is_desc_parsed   │
            │                  │ descriptions_fnd │
            │                  │ parsing_progress │
            │                  │ created_at       │
            │                  │ updated_at       │
            │                  │ parsed_at        │
            │                  └──────────────────┘
            │                          │
            │                  1:N has │
            │                [CASCADE] │
            │                          ▼
            │                  ┌──────────────────┐
            │                  │  DESCRIPTIONS    │
            │                  │      (17)        │
            │                  ├──────────────────┤
            │                  │ id [PK]          │
            │                  │ chapter_id [FK]  │
            │                  │ type [ENUM]      │
            │                  │   ├─ LOCATION    │
            │                  │   ├─ CHARACTER   │
            │                  │   ├─ ATMOSPHERE  │
            │                  │   ├─ OBJECT      │
            │                  │   └─ ACTION      │
            │                  │ content          │
            │                  │ context          │
            │                  │ confidence_score │
            │                  │ position_in_ch   │
            │                  │ word_count       │
            │                  │ is_suitable      │
            │                  │ priority_score   │
            │                  │ entities_ment    │
            │                  │ emotional_tone   │
            │                  │ complexity_level │
            │                  │ image_generated  │
            │                  │ gen_requested    │
            │                  │ created_at       │
            │                  │ updated_at       │
            │                  └──────────────────┘
            │                          │
            │                  1:N has │
            │                [CASCADE] │
            │                          ▼
            │                  ┌──────────────────────┐
            │                  │ GENERATED_IMAGES (25)│
            │                  ├──────────────────────┤
            │                  │ id [PK]              │
            │                  │ description_id [FK]  │
            │                  │ user_id [FK]         │
            │                  │ service_used         │
            │                  │   ├─ pollinations    │
            │                  │   ├─ openai_dalle    │
            │                  │   ├─ midjourney      │
            │                  │   └─ stable_diffusion│
            │                  │ status               │
            │                  │   ├─ pending         │
            │                  │   ├─ generating      │
            │                  │   ├─ completed       │
            │                  │   ├─ failed          │
            │                  │   └─ moderated       │
            │                  │ image_url            │
            │                  │ local_path           │
            │                  │ prompt_used          │
            │                  │ gen_parameters[JSON] │
            │                  │ gen_time_seconds     │
            │                  │ file_size            │
            │                  │ image_width          │
            │                  │ image_height         │
            │                  │ file_format          │
            │                  │ quality_score        │
            │                  │ is_moderated         │
            │                  │ moderation_result[J] │
            │                  │ moderation_notes     │
            │                  │ view_count           │
            │                  │ download_count       │
            │                  │ error_message        │
            │                  │ retry_count          │
            │                  │ created_at           │
            │                  │ updated_at           │
            │                  │ generated_at         │
            │                  └──────────────────────┘
            └──────────────────────────────────────────────────────────────┘
                                                │
                                    1:N has ────┤ [CASCADE]
                                                │
                                                ▼
                                    ┌──────────────────────┐
                                    │ READING_SESSIONS(14) │
                                    ├──────────────────────┤
                                    │ id [PK]              │
                                    │ user_id [FK]         │
                                    │ book_id [FK]         │
                                    │ started_at           │
                                    │ ended_at             │
                                    │ duration_minutes     │
                                    │ start_position       │
                                    │ end_position         │
                                    │ pages_read           │
                                    │ words_read           │
                                    │ is_active            │
                                    │ created_at           │
                                    │ updated_at           │
                                    │ notes                │
                                    └──────────────────────┘
```

---

## ENTITY-RELATIONSHIP MODEL

### Core Entities

**USERS**
- Central entity
- Owns: books, subscriptions, reading progress
- Has: reading sessions, generated images

**BOOKS**
- Contains: chapters
- Belongs to: user
- Has: reading progress, reading sessions
- Metadata: JSONB for flexible storage

**CHAPTERS**
- Part of: book
- Contains: descriptions
- No direct user association

**DESCRIPTIONS**
- Extracted from: chapters
- For: image generation
- Types: location, character, atmosphere, object, action

**GENERATED_IMAGES**
- Generated from: descriptions
- Owned by: user
- Multiple services supported
- Moderation workflow included

**READING_PROGRESS**
- Tracks: user reading position in book
- Features: CFI support, scroll offset
- Unique per user-book pair

**READING_SESSIONS**
- Detailed analytics per session
- Time tracking and statistics
- Pattern analysis for recommendations

**SUBSCRIPTIONS**
- One per user (unique)
- Plans: FREE, PREMIUM, ULTIMATE
- Usage tracking (books, image generation)

---

## RELATIONSHIP TYPES & CASCADE BEHAVIOR

### User → Books (1:N, CASCADE)
```
1 User owns N Books
├─ On user delete: All books deleted
├─ Index: idx_books_user_created
└─ Common query: List user's library
```

### User → Subscriptions (1:1, CASCADE)
```
1 User has 1 Subscription
├─ On user delete: Subscription deleted
├─ Index: ix_subscriptions_user_id
└─ Common query: Get user's current plan
```

### User → ReadingProgress (1:N, CASCADE)
```
1 User tracks N Books
├─ On user delete: All progress deleted
├─ Index: idx_reading_progress_user_book
└─ Common query: Get progress for user's book
```

### User → GeneratedImages (1:N, CASCADE)
```
1 User has N Generated Images
├─ On user delete: All images deleted
├─ Index: ix_generated_images_user_id
└─ Common query: User's image gallery
```

### User → ReadingSessions (1:N, NO CASCADE) ⚠️
```
1 User has N Reading Sessions
├─ On user delete: FAILS (need explicit delete or SET NULL)
├─ Index: idx_reading_sessions_user_active_partial
└─ Common query: Reading history, analytics
```

### Book → Chapters (1:N, CASCADE)
```
1 Book contains N Chapters
├─ On book delete: All chapters deleted → descriptions → images
├─ Index: idx_chapters_book_number
└─ Common query: List chapters in book
```

### Chapter → Descriptions (1:N, CASCADE)
```
1 Chapter contains N Descriptions
├─ On chapter delete: All descriptions deleted → images
├─ Index: idx_descriptions_chapter_priority
└─ Common query: Get descriptions for image generation
```

### Description → GeneratedImages (1:N, CASCADE)
```
1 Description has N Generated Images
├─ On description delete: All images deleted
├─ Index: idx_generated_images_description
└─ Common query: Get images for description
```

### Book → ReadingSessions (1:N, NO CASCADE) ⚠️
```
1 Book has N Reading Sessions
├─ On book delete: FAILS (need explicit delete or SET NULL)
├─ Index: idx_reading_sessions_book
└─ Common query: Book reading analytics
```

---

## DATA FLOW DIAGRAMS

### Book Import & Processing Pipeline

```
User Upload
    │
    ▼
[EPUB/FB2 File]
    │
    ├─ Extract chapters → CHAPTERS table
    │       │
    │       ├─ Extract text → content
    │       ├─ Calculate word count
    │       └─ Estimate reading time
    │
    ├─ Parse descriptions → DESCRIPTIONS table
    │       │
    │       ├─ Run NLP analysis
    │       │   ├─ SpaCy (entity recognition)
    │       │   ├─ Natasha (Russian NER)
    │       │   └─ Stanza (dependency parsing)
    │       │
    │       ├─ Calculate confidence_score
    │       ├─ Calculate priority_score
    │       └─ Generate entities_mentioned
    │
    └─ Extract metadata → book_metadata (JSONB)
            ├─ Author, cover, language
            ├─ Publication date
            └─ Genre classification

Queue: descriptions with priority_score > threshold
    │
    ▼
[Image Generation Pipeline]
    │
    ├─ Use description → GENERATED_IMAGES
    │       ├─ Build prompt from type + content
    │       ├─ Call service (pollinations, DALL-E, etc.)
    │       ├─ Track status: pending → generating → completed
    │       └─ Store parameters (JSONB)
    │
    └─ Moderation & Storage
            ├─ Check NSFW (moderation_result JSONB)
            ├─ Store image_url or local_path
            └─ Update is_moderated flag
```

### Reading Analytics Pipeline

```
User Opens Book
    │
    └─ Create ReadingSession (is_active=true)
            │
            ├─ Track: started_at
            ├─ Track: start_position
            └─ Keep: is_active=true

During Reading
    │
    └─ Update ReadingProgress (for current book)
            ├─ Update: current_chapter
            ├─ Update: current_position
            ├─ Update: reading_location_cfi (for epub.js)
            ├─ Update: scroll_offset_percent (0-100%)
            └─ Update: last_read_at

User Closes Book
    │
    └─ Update ReadingSession
            ├─ Set: ended_at = now()
            ├─ Set: is_active = false
            ├─ Calculate: duration_minutes
            ├─ Calculate: pages_read
            ├─ Calculate: words_read
            └─ Calculate: reading speed

Nightly Aggregation
    │
    └─ Refresh Materialized Views
            ├─ reading_sessions_daily_stats
            │   └─ Pre-computed daily totals
            └─ user_reading_patterns
                └─ User behavior analysis
```

---

## INDEX HIERARCHY

### Performance-Critical Indexes (Tier 1)

```
idx_books_user_created (user_id, created_at)
    ↑ Used: ~60% of all queries
    └─ Purpose: List user's books sorted by date

idx_reading_progress_user_book (user_id, book_id)
    ↑ Used: ~15% of all queries
    └─ Purpose: Lookup progress for specific book

idx_descriptions_chapter_priority (chapter_id, priority_score)
    ↑ Used: ~10% of all queries
    └─ Purpose: Image generation queue ordering

idx_images_status_created (status, created_at)
    ↑ Used: ~8% of all queries
    └─ Purpose: Status tracking and pagination
```

### High-Priority Indexes (Tier 2)

```
idx_reading_sessions_user_started (user_id, started_at)
    └─ Purpose: Reading history queries

idx_books_user_unparsed (PARTIAL: user_id, is_parsed=false)
    └─ Purpose: Parsing queue (partial index saves space)

idx_reading_sessions_user_active_partial (PARTIAL: user_id) WHERE is_active=true
    └─ Purpose: Active session queries (smaller index)

idx_books_metadata_gin (GIN on book_metadata JSONB)
    └─ Purpose: Fast JSON metadata queries
```

### Moderate-Priority Indexes (Tier 3)

```
Individual FK indexes (18 total)
    └─ Purpose: Foreign key lookups

Single-column indexes (10 total)
    └─ Purpose: Filter by status, type, etc.

Additional composite indexes (5 total)
    └─ Purpose: Multi-column queries
```

---

## CONSTRAINTS HIERARCHY

### Data Integrity Tier

```
PRIMARY KEY Constraints (9)
├─ Ensure uniqueness of each record
└─ Enable fast lookups by ID

FOREIGN KEY Constraints (8)
├─ Enforce referential integrity
├─ Define cascade behavior
└─ Prevent orphaned records

UNIQUE Constraints (2)
├─ users.email - One email per user
└─ subscriptions.user_id - One subscription per user

CHECK Constraints (4)
├─ books.genre - 9 allowed values
├─ books.file_format - 2 allowed values
├─ generated_images.service_used - 4 allowed values
└─ generated_images.status - 5 allowed values

NOT NULL Constraints (45+)
└─ Ensure required fields always present
```

---

## ENUM TYPES IN DATABASE

### Active PostgreSQL ENUM Types (3)

**descriptiontype**
```sql
CREATE TYPE descriptiontype AS ENUM (
  'LOCATION',      -- 75% priority
  'CHARACTER',     -- 60% priority
  'ATMOSPHERE',    -- 45% priority
  'OBJECT',        -- 40% priority
  'ACTION'         -- 30% priority
);
```

**subscriptionplan**
```sql
CREATE TYPE subscriptionplan AS ENUM (
  'FREE',          -- Basic plan
  'PREMIUM',       -- Enhanced features
  'ULTIMATE'       -- All features
);
```

**subscriptionstatus**
```sql
CREATE TYPE subscriptionstatus AS ENUM (
  'ACTIVE',        -- Currently active
  'EXPIRED',       -- Plan expired
  'CANCELLED',     -- User cancelled
  'PENDING'        -- Awaiting confirmation
);
```

### Application Enums (Defined in Python, not DB)

**BookFormat**
```python
EPUB = "epub"
FB2 = "fb2"
```
Storage: VARCHAR(10) with CHECK constraint

**BookGenre**
```python
FANTASY, DETECTIVE, SCIFI, HISTORICAL,
ROMANCE, THRILLER, HORROR, CLASSIC, OTHER
```
Storage: VARCHAR(50) with CHECK constraint

**ImageService**
```python
POLLINATIONS, OPENAI_DALLE, MIDJOURNEY, STABLE_DIFFUSION
```
Storage: VARCHAR(50) with CHECK constraint

**ImageStatus**
```python
PENDING, GENERATING, COMPLETED, FAILED, MODERATED
```
Storage: VARCHAR(20) with CHECK constraint

---

## MATERIALIZED VIEWS

### reading_sessions_daily_stats
```
Daily aggregation of reading sessions
┌──────────────────────────────────┐
│ date                             │
│ total_sessions                   │
│ total_reading_minutes            │
│ avg_session_duration             │
│ total_pages_read                 │
│ active_users                     │
└──────────────────────────────────┘

Index: UNIQUE on date
Refresh: Nightly
Purpose: Dashboard metrics
```

### user_reading_patterns
```
User behavior analytics
┌──────────────────────────────────┐
│ user_id                          │
│ total_reading_time               │
│ avg_session_duration             │
│ favorite_time_of_day             │
│ reading_frequency                │
│ avg_reading_speed                │
│ books_in_progress                │
│ completed_books                  │
└──────────────────────────────────┘

Index: On user_id
Refresh: Weekly
Purpose: Recommendations, analytics
```

---

## STORAGE & PERFORMANCE ESTIMATES

### Table Sizes (for 1 Million Books)

| Table | Est. Rows | Est. Size | Primary Purpose |
|-------|-----------|-----------|-----------------|
| users | 100K | 10 MB | User accounts |
| books | 1M | 200 MB | Book metadata |
| chapters | 20M | 4 GB | Chapter content |
| descriptions | 50M | 8 GB | NLP descriptions |
| generated_images | 30M | 2 GB | Generated images |
| reading_progress | 50M | 2 GB | User reading pos |
| reading_sessions | 100M | 3 GB | Session tracking |
| subscriptions | 100K | 5 MB | Subscription data |
| **TOTAL** | **~250M** | **~19 GB** | |

### Index Sizes

| Index Category | Count | Est. Size |
|---|---|---|
| Primary keys | 9 | 500 MB |
| Foreign keys | 18 | 1 GB |
| Composite indexes | 15 | 2 GB |
| Single column | 10 | 1 GB |
| Partial indexes | 3 | 200 MB |
| GIN (JSONB) | 3 | 1 GB |
| **TOTAL** | **58** | **~5.7 GB** |

**Index overhead: ~30% of data size** (typical for well-indexed schemas)

---

## QUERY PATTERNS & INDEX USAGE

### Top 10 Query Patterns

```
1. List user's books (sorted by date)
   SELECT * FROM books WHERE user_id=? ORDER BY created_at DESC
   └─ Index: idx_books_user_created
   └─ Frequency: ~60% of all queries

2. Get reading progress
   SELECT * FROM reading_progress WHERE user_id=? AND book_id=?
   └─ Index: idx_reading_progress_user_book
   └─ Frequency: ~15% of queries

3. Get unparsed books for processing
   SELECT * FROM books WHERE user_id=? AND is_parsed=false
   └─ Index: idx_books_user_unparsed (PARTIAL)
   └─ Frequency: ~10% of queries

4. Get descriptions ordered by priority
   SELECT * FROM descriptions WHERE chapter_id=? ORDER BY priority_score DESC
   └─ Index: idx_descriptions_chapter_priority
   └─ Frequency: ~8% of queries

5. Get images by status
   SELECT * FROM generated_images WHERE status=? ORDER BY created_at DESC
   └─ Index: idx_images_status_created
   └─ Frequency: ~5% of queries

6. Get user's reading history
   SELECT * FROM reading_sessions WHERE user_id=? ORDER BY started_at DESC
   └─ Index: idx_reading_sessions_user_started
   └─ Frequency: ~3% of queries

7. Get active reading sessions
   SELECT * FROM reading_sessions WHERE user_id=? AND is_active=true
   └─ Index: idx_reading_sessions_user_active_partial
   └─ Frequency: ~2% of queries

8. Search book metadata
   SELECT * FROM books WHERE book_metadata @> '{"author": "?"}'
   └─ Index: idx_books_metadata_gin
   └─ Frequency: ~1% of queries

9. Get book with all chapters
   SELECT * FROM books WHERE id=? WITH (chapters)
   └─ Index: idx_chapters_book_id
   └─ Frequency: ~2% of queries

10. Get chapter with descriptions
    SELECT * FROM chapters WHERE book_id=? WITH (descriptions)
    └─ Index: idx_descriptions_chapter_id
    └─ Frequency: ~1% of queries
```

---

## SCHEMA EVOLUTION ROADMAP

### Current Version: 2.1 (CFI + epub.js)

### Future Versions

**v2.2 (Q1 2026) - Analytics Enhancement**
- [ ] Add reading_patterns table
- [ ] Add user_preferences table
- [ ] Full-text search indexes
- [ ] Book recommendations view

**v2.3 (Q2 2026) - Monetization**
- [ ] Payment history table
- [ ] User spending patterns
- [ ] Revenue analytics views
- [ ] Subscription tier tracking

**v3.0 (Q3 2026) - Scale & Archive**
- [ ] Reading sessions partitioning by date
- [ ] Archive table for old sessions
- [ ] Performance optimizations
- [ ] Replication strategy

---

## DEPLOYMENT CHECKLIST

- ✅ All tables created
- ✅ All columns added
- ✅ All indexes built
- ✅ All constraints defined
- ✅ All relationships configured
- ✅ JSONB migration complete
- ✅ Materialized views created
- ✅ Migration chain clean
- ⚠️ Reading sessions cascade policy (pending decision)
- ⚠️ Admin settings cleanup (pending deletion)

---

**End of Schema Documentation**

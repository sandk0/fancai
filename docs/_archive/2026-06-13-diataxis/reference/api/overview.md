# API Documentation - BookReader AI

Полная документация REST API для BookReader AI. API построен на FastAPI с автоматической генерацией OpenAPI схемы.

## Общая информация

- **Base URL:** `http://localhost:8000/api/v1` (development) | `https://yourdomain.com/api/v1` (production)
- **API Version:** v1.3.0 (updated: ноябрь 2025)
- **Total Endpoints:** 76 endpoints (20 router files)
- **Authentication:** JWT Bearer tokens
- **Content-Type:** `application/json`
- **Interactive Docs:** `/docs` (Swagger UI) | `/redoc` (ReDoc)

## Key Features (v1.3.0)

- **Multi-NLP System:** 3 процессора (SpaCy, Natasha, Stanza) с 5 режимами обработки
- **Custom EPUB Reader:** Полная поддержка EPUB чтения через GET /books/{id}/file (EpubReader.tsx, 835 строк)
- **CFI Support:** Canonical Fragment Identifier для точного трекинга прогресса
- **Ensemble Voting:** Consensus алгоритм для максимального качества NLP
- **Adaptive Processing:** Автоматический выбор оптимального режима обработки
- **Admin Multi-NLP Management:** 5 endpoints для управления процессорами
- **Admin Cache Management:** 4 endpoints для управления Redis кэшем
- **Admin Reading Sessions:** 3 endpoints для управления сессиями чтения

## Аутентификация

BookReader AI использует JWT токены с системой refresh tokens для безопасной аутентификации.

### Схема аутентификации

```http
Authorization: Bearer <access_token>
```

**Токены:**
- **Access Token** - срок жизни 30 минут, для API запросов
- **Refresh Token** - срок жизни 7 дней, для обновления access token

---

## Auth Endpoints

### POST /auth/register

Регистрация нового пользователя.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "full_name": "John Doe"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid-string",
    "email": "user@example.com",
    "full_name": "John Doe",
    "is_active": true,
    "created_at": "2025-08-24T12:00:00Z"
  },
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "token_type": "bearer"
}
```

**Errors:**
- `400` - Email already registered
- `422` - Validation error (weak password, invalid email)

### POST /auth/login

Вход в систему.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "token_type": "bearer",
  "user": {
    "id": "uuid-string",
    "email": "user@example.com",
    "full_name": "John Doe",
    "is_active": true
  }
}
```

**Errors:**
- `401` - Invalid credentials
- `403` - Account disabled

### POST /auth/refresh

Обновление access token.

**Request Body:**
```json
{
  "refresh_token": "jwt-refresh-token"
}
```

**Response (200):**
```json
{
  "access_token": "new-jwt-access-token",
  "refresh_token": "new-jwt-refresh-token",
  "token_type": "bearer"
}
```

### GET /auth/me

Получение информации о текущем пользователе.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "id": "uuid-string",
  "email": "user@example.com",
  "full_name": "John Doe",
  "is_active": true,
  "is_superuser": false,
  "created_at": "2025-08-24T12:00:00Z",
  "reader_settings": {
    "theme": "light",
    "fontSize": 16,
    "fontFamily": "serif"
  }
}
```

### POST /auth/logout

Выход из системы (инвалидация refresh token).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "refresh_token": "jwt-refresh-token"
}
```

**Response (200):**
```json
{
  "message": "Successfully logged out"
}
```

---

## Books Endpoints

### GET /books/parser-status

Проверка статуса парсера книг.

**Response (200):**
```json
{
  "supported_formats": ["epub", "fb2"],
  "nlp_available": true,
  "parser_ready": true,
  "max_file_size_mb": 50,
  "message": "Book parser supports: epub, fb2"
}
```

### POST /books/validate-file

Валидация файла книги без сохранения.

**Request:** `multipart/form-data`
```
file: <binary-file>
```

**Response (200):**
```json
{
  "filename": "book.epub",
  "file_size_bytes": 1024000,
  "file_size_mb": 1.02,
  "validation": {
    "is_valid": true,
    "format": "epub",
    "has_metadata": true,
    "chapters_found": 15
  },
  "message": "File validated successfully"
}
```

**Errors:**
- `400` - Unsupported file type, file too large/small
- `422` - File validation failed

### POST /books/upload

Загрузка и обработка книги.

**Headers:** `Authorization: Bearer <token>`
**Request:** `multipart/form-data`
```
file: <binary-file>
```

**Response (201):**
```json
{
  "message": "Book uploaded and processing started",
  "book": {
    "id": "uuid-string",
    "title": "Sample Book",
    "author": "Author Name",
    "genre": "fantasy",
    "file_format": "epub",
    "file_size": 1024000,
    "is_parsed": false,
    "parsing_progress": 0,
    "created_at": "2025-08-24T12:00:00Z"
  },
  "processing": {
    "task_id": "celery-task-id",
    "estimated_time_minutes": 5,
    "status": "started"
  }
}
```

### GET /books

Получение списка книг пользователя.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `page` (int, default=1) - Номер страницы
- `page_size` (int, default=10) - Размер страницы
- `search` (string) - Поиск по названию/автору
- `genre` (string) - Фильтр по жанру
- `is_parsed` (boolean) - Фильтр по статусу обработки

**Response (200):**
```json
{
  "books": [
    {
      "id": "uuid-string",
      "title": "Sample Book",
      "author": "Author Name",
      "genre": "fantasy",
      "language": "ru",
      "file_format": "epub",
      "file_size": 1024000,
      "cover_image": "/covers/book-uuid.jpg",
      "description": "Book description...",
      "total_pages": 250,
      "estimated_reading_time": 300,
      "is_parsed": true,
      "parsing_progress": 100,
      "created_at": "2025-08-24T12:00:00Z",
      "last_accessed": "2025-08-24T15:30:00Z",
      "reading_progress": {
        "current_chapter": 5,
        "current_page": 23,
        "progress_percentage": 18.5,
        "reading_time_minutes": 45
      }
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 10,
    "total_books": 25,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

### GET /books/{book_id}

Получение детальной информации о книге.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "id": "uuid-string",
  "title": "Sample Book",
  "author": "Author Name",
  "genre": "fantasy",
  "language": "ru",
  "file_format": "epub",
  "file_size": 1024000,
  "cover_image": "/covers/book-uuid.jpg",
  "description": "Detailed book description...",
  "book_metadata": {
    "publisher": "Publisher Name",
    "publication_date": "2023-01-15",
    "isbn": "978-0123456789",
    "series": "Fantasy Series #1"
  },
  "total_pages": 250,
  "estimated_reading_time": 300,
  "is_parsed": true,
  "parsing_progress": 100,
  "created_at": "2025-08-24T12:00:00Z",
  "chapters": [
    {
      "id": "chapter-uuid",
      "chapter_number": 1,
      "title": "The Beginning",
      "word_count": 2500,
      "estimated_reading_time": 12,
      "is_processed": true
    }
  ],
  "reading_progress": {
    "current_chapter": 5,
    "current_page": 23,
    "current_position": 1250,
    "progress_percentage": 18.5,
    "reading_time_minutes": 45,
    "reading_speed_wpm": 185.5,
    "last_read_at": "2025-08-24T15:30:00Z"
  },
  "statistics": {
    "descriptions_found": 125,
    "images_generated": 45,
    "last_image_generated": "2025-08-24T14:20:00Z"
  }
}
```

### GET /books/{book_id}/chapters/{chapter_number}

Получение содержимого главы с описаниями.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "chapter": {
    "id": "chapter-uuid",
    "book_id": "book-uuid",
    "chapter_number": 1,
    "title": "The Beginning",
    "content": "Chapter content with <span class='description' data-id='desc-uuid'>highlighted descriptions</span>...",
    "word_count": 2500,
    "estimated_reading_time": 12,
    "is_processed": true,
    "created_at": "2025-08-24T12:05:00Z"
  },
  "descriptions": [
    {
      "id": "desc-uuid",
      "content": "ancient stone castle",
      "context": "The ancient stone castle loomed against the stormy sky...",
      "type": "location",
      "confidence_score": 0.89,
      "priority_score": 85.5,
      "entities_mentioned": "castle,stone,ancient",
      "text_position_start": 156,
      "text_position_end": 175,
      "generated_image": {
        "id": "image-uuid",
        "image_url": "/images/generated/image-uuid.jpg",
        "status": "completed",
        "generation_time_seconds": 12.3,
        "created_at": "2025-08-24T12:10:00Z"
      }
    }
  ],
  "navigation": {
    "previous_chapter": 0,
    "next_chapter": 2,
    "total_chapters": 15
  }
}
```

### POST /books/{book_id}/progress

Обновление прогресса чтения (ОБНОВЛЕНО: поддержка CFI для epub.js).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "current_chapter": 5,
  "current_page": 23,
  "current_position": 1250,
  "current_position_percent": 45.5,
  "reading_location_cfi": "epubcfi(/6/4[chapter01]!/4/2/8[para05],/1:125,/1:250)",
  "scroll_offset_percent": 32.8,
  "reading_time_minutes": 45
}
```

**Request Fields:**
- `current_chapter` (int, обязательно) - номер текущей главы
- `current_position_percent` (float, опционально) - процент прочитанного в главе 0-100
- `reading_location_cfi` (string, опционально) - CFI (Canonical Fragment Identifier) для epub.js
- `scroll_offset_percent` (float, опционально) - точный процент скролла внутри страницы 0-100
- `current_page` (int, опционально) - номер страницы (обратная совместимость)
- `reading_time_minutes` (int, опционально) - время чтения в минутах

**Response (200):**
```json
{
  "message": "Reading progress updated successfully",
  "progress": {
    "id": "progress-uuid",
    "current_chapter": 5,
    "current_page": 23,
    "current_position": 1250,
    "reading_location_cfi": "epubcfi(/6/4[chapter01]!/4/2/8[para05],/1:125,/1:250)",
    "scroll_offset_percent": 32.8,
    "reading_time_minutes": 45,
    "reading_speed_wpm": 185.5,
    "last_read_at": "2025-10-23T15:30:00Z"
  }
}
```

**CFI (Canonical Fragment Identifier):**
CFI используется в epub.js для точного указания позиции в EPUB книге. Формат:
- `epubcfi(/6/4[chapter01]!/4/2/8,/1:0,/1:100)` - полный CFI с главой и позицией
- Обеспечивает корректное восстановление позиции чтения после перезагрузки

### GET /books/{book_id}/statistics

Получение статистики по книге.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "book_id": "book-uuid",
  "reading_stats": {
    "total_reading_time_minutes": 180,
    "average_reading_speed_wpm": 185.5,
    "pages_read": 89,
    "progress_percentage": 35.6,
    "estimated_completion_time_hours": 2.5
  },
  "nlp_stats": {
    "descriptions_total": 125,
    "by_type": {
      "location": 45,
      "character": 38,
      "atmosphere": 25,
      "object": 12,
      "action": 5
    },
    "confidence_average": 0.78,
    "priority_average": 65.2
  },
  "generation_stats": {
    "images_total": 45,
    "images_pending": 3,
    "images_failed": 2,
    "average_generation_time": 11.8,
    "last_generated": "2025-08-24T14:20:00Z"
  }
}
```

### DELETE /books/{book_id}

Удаление книги и всех связанных данных.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "message": "Book deleted successfully",
  "deleted": {
    "book_id": "book-uuid",
    "chapters": 15,
    "descriptions": 125,
    "images": 45,
    "files_removed": ["book.epub", "cover.jpg", "45 image files"]
  }
}
```

### GET /books/{book_id}/cover

Получение обложки книги.

**Response:** Binary image data (JPEG/PNG)
- **Content-Type:** `image/jpeg` or `image/png`
- **Cache-Control:** `max-age=3600`

### GET /books/{book_id}/file

Получение EPUB файла для чтения в epub.js (NEW: октябрь 2025).

**Headers:** `Authorization: Bearer <token>`

**Response:** Binary EPUB file
- **Content-Type:** `application/epub+zip`
- **Content-Disposition:** `attachment; filename="book_title.epub"`

**Errors:**
- `404` - Book not found или file not found on server
- `403` - Access denied (book doesn't belong to user)

**Usage:**
Этот endpoint используется frontend компонентом EpubReader.tsx для загрузки полного EPUB файла в epub.js библиотеку.

---

## Images Endpoints

### GET /images/generation/status

Статус системы генерации изображений.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "service_status": {
    "pollinations": {
      "available": true,
      "average_response_time": 8.5,
      "queue_length": 12
    },
    "openai": {
      "available": false,
      "reason": "API key not configured"
    }
  },
  "user_limits": {
    "plan": "PREMIUM",
    "images_this_month": 45,
    "images_limit": 500,
    "remaining": 455,
    "priority_generation": true
  },
  "queue_info": {
    "user_queue_length": 3,
    "estimated_wait_time_minutes": 2
  }
}
```

### POST /images/generate/description/{description_id}

Генерация изображения для конкретного описания.

**Headers:** `Authorization: Bearer <token>`

**Request Body (optional):**
```json
{
  "style": "realistic",
  "negative_prompt": "blurry, low quality",
  "priority": false
}
```

**Response (202):**
```json
{
  "message": "Image generation started",
  "task": {
    "task_id": "celery-task-uuid",
    "description_id": "desc-uuid",
    "estimated_time_seconds": 15,
    "queue_position": 5
  },
  "description": {
    "id": "desc-uuid",
    "content": "ancient stone castle",
    "type": "location",
    "priority_score": 85.5
  }
}
```

### POST /images/generate/chapter/{chapter_id}

Пакетная генерация изображений для топ-описаний главы.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "limit": 10,
  "min_priority_score": 70.0,
  "types_filter": ["location", "character"]
}
```

**Response (202):**
```json
{
  "message": "Batch generation started for chapter",
  "task": {
    "task_id": "batch-task-uuid",
    "chapter_id": "chapter-uuid",
    "descriptions_selected": 8,
    "estimated_time_minutes": 3
  },
  "selected_descriptions": [
    {
      "id": "desc-uuid-1",
      "content": "ancient stone castle",
      "type": "location",
      "priority_score": 85.5
    }
  ]
}
```

### GET /images/book/{book_id}

Получение всех изображений книги.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `type` (string) - Фильтр по типу описания
- `status` (string) - Фильтр по статусу генерации
- `page` (int) - Пагинация

**Response (200):**
```json
{
  "images": [
    {
      "id": "image-uuid",
      "description": {
        "id": "desc-uuid",
        "content": "ancient stone castle",
        "type": "location",
        "context": "The ancient stone castle loomed...",
        "chapter_number": 1,
        "priority_score": 85.5
      },
      "service_used": "pollinations",
      "status": "completed",
      "image_url": "/images/generated/image-uuid.jpg",
      "local_path": "/storage/images/image-uuid.jpg",
      "prompt_used": "A majestic ancient stone castle...",
      "generation_time_seconds": 12.3,
      "image_width": 1024,
      "image_height": 768,
      "file_size": 245760,
      "created_at": "2025-08-24T12:10:00Z",
      "completed_at": "2025-08-24T12:10:12Z"
    }
  ],
  "pagination": {
    "page": 1,
    "total_images": 45,
    "total_pages": 5
  },
  "statistics": {
    "by_status": {
      "completed": 42,
      "pending": 2,
      "failed": 1
    },
    "by_type": {
      "location": 18,
      "character": 15,
      "atmosphere": 9,
      "object": 3
    }
  }
}
```

### POST /images/{image_id}/regenerate

Перегенерация существующего изображения.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "style": "fantasy_art",
  "negative_prompt": "cartoon, anime",
  "service": "pollinations"
}
```

**Response (202):**
```json
{
  "message": "Image regeneration started",
  "task": {
    "task_id": "regen-task-uuid",
    "original_image_id": "image-uuid",
    "estimated_time_seconds": 12
  }
}
```

### DELETE /images/{image_id}

Удаление сгенерированного изображения.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "message": "Image deleted successfully",
  "deleted": {
    "image_id": "image-uuid",
    "files_removed": ["image-uuid.jpg"],
    "storage_freed_bytes": 245760
  }
}
```

---

## NLP Endpoints

### GET /nlp/status (ОБНОВЛЕНО: Multi-NLP с 3 процессорами)

Статус Advanced Multi-NLP системы с поддержкой 3 процессоров и 5 режимов обработки.

**Response (200):**
```json
{
  "multi_nlp_available": true,
  "available_processors": ["spacy", "natasha", "stanza"],
  "default_processor": "spacy",
  "processing_mode": "adaptive",
  "available_modes": ["single", "parallel", "sequential", "ensemble", "adaptive"],
  "processors": {
    "spacy": {
      "type": "spacy",
      "loaded": true,
      "available": true,
      "model": "ru_core_news_lg",
      "version": "3.7.2",
      "weight": 1.0,
      "confidence_threshold": 0.3,
      "literary_patterns": true
    },
    "natasha": {
      "type": "natasha",
      "loaded": true,
      "available": true,
      "weight": 1.2,
      "confidence_threshold": 0.4,
      "literary_boost": 1.3
    },
    "stanza": {
      "type": "stanza",
      "loaded": false,
      "available": false,
      "weight": 0.8,
      "confidence_threshold": 0.5
    }
  },
  "global_config": {
    "max_parallel_processors": 3,
    "ensemble_voting_threshold": 0.6,
    "adaptive_text_analysis": true
  },
  "statistics": {
    "total_processed": 1547,
    "processor_usage": {
      "spacy": 892,
      "natasha": 655
    },
    "average_quality_scores": {
      "spacy": 0.78,
      "natasha": 0.82
    }
  },
  "supported_languages": ["ru", "en"],
  "description_types": ["location", "character", "atmosphere", "object", "action"],
  "performance": {
    "average_processing_time_per_1000_chars": 0.16,
    "queue_length": 0,
    "last_processing_result": {
      "descriptions_found": 2171,
      "processing_time_seconds": 4.2,
      "processors_used": ["spacy", "natasha"],
      "mode_used": "parallel"
    }
  }
}
```

### POST /nlp/extract-descriptions (ОБНОВЛЕНО: Multi-NLP с режимами)

Извлечение описаний через Advanced Multi-NLP систему с поддержкой 5 режимов обработки.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "text": "В старом замке на холме жили привидения...",
  "chapter_id": "chapter-uuid",
  "language": "ru",
  "types_filter": ["location", "character"],
  "min_confidence": 0.7,
  "processing_mode": "ensemble",
  "processor_name": "spacy"
}
```

**Processing Modes (NEW):**
- `single` - один процессор (быстро, min latency)
- `parallel` - параллельная обработка всеми процессорами (максимальное покрытие)
- `sequential` - последовательная обработка (контролируемый порядок)
- `ensemble` - ensemble voting с consensus алгоритмом (максимальное качество)
- `adaptive` - автоматический выбор режима на основе анализа текста (интеллектуально)

**Response (200) - Multi-NLP Result:**
```json
{
  "text_length": 156,
  "processing_time_seconds": 0.28,
  "descriptions_found": 8,
  "processing_result": {
    "descriptions": [
      {
        "content": "старый замок на холме",
        "context": "В старом замке на холме жили...",
        "type": "location",
        "confidence_score": 0.91,
        "priority_score": 82.7,
        "entities_mentioned": "замок,холм",
        "text_position_start": 2,
        "text_position_end": 22,
        "sources": ["spacy", "natasha"],
        "consensus_strength": 0.67
      }
    ],
    "processor_results": {
      "spacy": 5,
      "natasha": 6
    },
    "processors_used": ["spacy", "natasha"],
    "quality_metrics": {
      "spacy": 0.78,
      "natasha": 0.85
    },
    "recommendations": [
      "Processor natasha showed excellent results.",
      "Used ensemble voting for improved accuracy"
    ]
  },
  "multi_nlp_info": {
    "mode_used": "adaptive",
    "total_processors_available": 2,
    "ensemble_filtering_applied": true,
    "deduplication_applied": true
  },
  "statistics": {
    "by_type": {
      "location": 4,
      "character": 3,
      "atmosphere": 1
    },
    "average_confidence": 0.87,
    "average_priority": 79.3,
    "consensus_scores": {
      "high_consensus": 6,
      "medium_consensus": 2,
      "low_consensus": 0
    }
  }
}
```

### GET /nlp/test-book-sample

Демонстрация работы NLP на примере текста.

**Response (200):**
```json
{
  "sample_text": "В древнем лесу, где вековые дубы...",
  "processing_result": {
    "descriptions_found": 5,
    "descriptions": [...],
    "processing_time_seconds": 0.45
  },
  "explanation": {
    "how_it_works": "NLP processor uses spaCy for entity recognition...",
    "type_detection": "Location descriptions are identified by...",
    "priority_calculation": "Priority scores are based on..."
  }
}
```

---

## Users Endpoints

### GET /users/profile

Получение расширенного профиля пользователя.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "is_active": true,
    "created_at": "2025-01-15T10:00:00Z",
    "last_login_at": "2025-08-24T09:00:00Z"
  },
  "subscription": {
    "plan_type": "PREMIUM",
    "status": "ACTIVE",
    "books_limit": 100,
    "images_per_month": 500,
    "priority_generation": true,
    "expires_at": "2025-09-24T00:00:00Z"
  },
  "statistics": {
    "total_books": 12,
    "total_reading_time_hours": 45.5,
    "images_generated_this_month": 89,
    "average_reading_speed_wpm": 185,
    "books_completed": 3,
    "favorite_genres": ["fantasy", "detective", "science_fiction"]
  },
  "settings": {
    "reader_theme": "dark",
    "font_size": 16,
    "font_family": "serif",
    "auto_generate_images": true,
    "notification_preferences": {
      "generation_complete": true,
      "new_books_processing": false
    }
  }
}
```

### PUT /users/profile

Обновление профиля пользователя.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "full_name": "John Smith",
  "reader_settings": {
    "theme": "sepia",
    "fontSize": 18,
    "fontFamily": "sans-serif"
  }
}
```

### GET /users/subscription

Получение информации о подписке.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "current_plan": {
    "type": "PREMIUM",
    "status": "ACTIVE",
    "started_at": "2025-07-24T00:00:00Z",
    "expires_at": "2025-09-24T00:00:00Z",
    "auto_renew": true
  },
  "usage_this_month": {
    "books_uploaded": 3,
    "books_limit": 100,
    "images_generated": 89,
    "images_limit": 500,
    "generation_time_saved_priority": 450
  },
  "available_plans": [
    {
      "type": "FREE",
      "price_per_month": 0,
      "books_limit": 5,
      "images_per_month": 50,
      "features": ["Basic reading", "Standard generation"]
    },
    {
      "type": "PREMIUM",
      "price_per_month": 9.99,
      "books_limit": 100,
      "images_per_month": 500,
      "features": ["Unlimited books", "Priority generation", "Advanced analytics"]
    }
  ]
}
```

---

## Admin Endpoints

### GET /admin/stats

Системная статистика (только для администраторов).

**Headers:** `Authorization: Bearer <admin_token>`

**Response (200):**
```json
{
  "total_users": 1250,
  "total_books": 15750,
  "total_descriptions": 125000,
  "total_images": 45000,
  "processing_rate": 85.5,
  "generation_rate": 36.2,
  "active_parsing_tasks": 2,
  "queue_size": 5
}
```

### GET /admin/multi-nlp-settings (NEW: Multi-NLP Management)

Получение полных настроек Multi-NLP системы со всеми процессорами.

**Headers:** `Authorization: Bearer <admin_token>`

**Response (200):**
```json
{
  "processing_mode": "adaptive",
  "default_processor": "spacy",
  "max_parallel_processors": 3,
  "ensemble_voting_threshold": 0.6,
  "adaptive_text_analysis": true,
  "quality_monitoring": true,
  "auto_processor_selection": true,

  "spacy_settings": {
    "enabled": true,
    "weight": 1.0,
    "confidence_threshold": 0.3,
    "model_name": "ru_core_news_lg",
    "literary_patterns": true,
    "character_detection_boost": 1.2,
    "location_detection_boost": 1.1,
    "atmosphere_keywords": ["мрачный", "светлый", "таинственный"]
  },

  "natasha_settings": {
    "enabled": true,
    "weight": 1.2,
    "confidence_threshold": 0.4,
    "literary_boost": 1.3,
    "enable_morphology": true,
    "enable_syntax": true,
    "enable_ner": true,
    "person_patterns": ["юноша", "девушка", "старик"],
    "location_patterns": ["дворец", "замок", "крепость"]
  },

  "stanza_settings": {
    "enabled": false,
    "weight": 0.8,
    "confidence_threshold": 0.5,
    "model_name": "ru",
    "processors": ["tokenize", "pos", "lemma", "ner"],
    "complex_syntax_analysis": true,
    "dependency_parsing": true
  },

  "available_processors": ["spacy", "natasha", "stanza", "ensemble", "adaptive"]
}
```

### PUT /admin/multi-nlp-settings (NEW: Update Multi-NLP Config)

Обновление настроек Multi-NLP системы.

**Headers:** `Authorization: Bearer <admin_token>`

**Request Body:** (полный объект MultiNLPSettings как в GET)

**Response (200):**
```json
{
  "message": "Multi-NLP settings updated successfully",
  "settings": { /* обновленные настройки */ },
  "processors_reloaded": true
}
```

### GET /admin/multi-nlp-settings/status (NEW: Processor Status)

Получение детального статуса всех NLP процессоров.

**Headers:** `Authorization: Bearer <admin_token>`

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "multi_nlp_available": true,
    "available_processors": ["spacy", "natasha"],
    "processing_mode": "adaptive",
    "processors": {
      "spacy": {
        "type": "spacy",
        "loaded": true,
        "available": true,
        "model": "ru_core_news_lg",
        "version": "3.7.2",
        "weight": 1.0
      },
      "natasha": {
        "type": "natasha",
        "loaded": true,
        "available": true,
        "weight": 1.2
      },
      "stanza": {
        "type": "stanza",
        "loaded": false,
        "available": false
      }
    },
    "statistics": {
      "total_processed": 1547,
      "processor_usage": {
        "spacy": 892,
        "natasha": 655
      }
    }
  },
  "timestamp": "2025-10-23T12:00:00Z"
}
```

### POST /admin/multi-nlp-settings/test (NEW: Test Processors)

Тестирование NLP процессоров с образцом текста.

**Headers:** `Authorization: Bearer <admin_token>`

**Request Body:**
```json
{
  "text": "В старом замке на холме жили привидения...",
  "processors": ["spacy", "natasha"],
  "mode": "ensemble"
}
```

**Response (200):**
```json
{
  "status": "success",
  "test_text": "В старом замке на холме жили привидения...",
  "processing_mode": "ensemble",
  "processors_used": ["spacy", "natasha"],
  "total_descriptions": 8,
  "processing_time_seconds": 0.28,
  "quality_metrics": {
    "spacy": 0.78,
    "natasha": 0.85
  },
  "recommendations": [
    "Processor natasha showed excellent results.",
    "Used ensemble voting for improved accuracy"
  ],
  "processor_results": {
    "spacy": {
      "count": 5,
      "sample_descriptions": [/* первые 3 */]
    },
    "natasha": {
      "count": 6,
      "sample_descriptions": [/* первые 3 */]
    }
  },
  "best_descriptions": [/* топ 5 с consensus */],
  "timestamp": "2025-10-23T12:00:00Z"
}
```

### GET /admin/nlp-processor-status (NEW: Detailed Processor Info)

Детальная информация о статусе всех NLP процессоров.

**Headers:** `Authorization: Bearer <admin_token>`

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "multi_nlp_available": true,
    "available_processors": ["spacy", "natasha"],
    "processing_mode": "adaptive",
    "processors": { /* детали процессоров */ },
    "global_config": {
      "max_parallel_processors": 3,
      "ensemble_voting_threshold": 0.6,
      "adaptive_text_analysis": true
    }
  },
  "timestamp": "2025-10-23T12:00:00Z"
}
```

### GET /users/admin/stats

Системная статистика (только для администраторов).

**Headers:** `Authorization: Bearer <admin_token>`

**Response (200):**
```json
{
  "users": {
    "total": 1250,
    "active_today": 89,
    "new_this_month": 156,
    "by_plan": {
      "FREE": 950,
      "PREMIUM": 280,
      "ULTIMATE": 20
    }
  },
  "books": {
    "total": 15750,
    "uploaded_today": 45,
    "by_format": {
      "epub": 12500,
      "fb2": 3250
    },
    "average_size_mb": 3.2
  },
  "processing": {
    "books_in_queue": 12,
    "images_in_queue": 156,
    "average_book_processing_time": 125,
    "average_image_generation_time": 11.8
  },
  "storage": {
    "total_books_gb": 48.5,
    "total_images_gb": 156.8,
    "total_covers_gb": 2.1
  }
}
```

---

## Error Handling

### HTTP Status Codes

- **200 OK** - Успешный запрос
- **201 Created** - Ресурс создан
- **202 Accepted** - Запрос принят к обработке (async)
- **400 Bad Request** - Неверные параметры запроса
- **401 Unauthorized** - Требуется аутентификация
- **403 Forbidden** - Доступ запрещен
- **404 Not Found** - Ресурс не найден
- **413 Payload Too Large** - Файл слишком большой
- **422 Unprocessable Entity** - Ошибки валидации
- **429 Too Many Requests** - Превышен rate limit
- **500 Internal Server Error** - Внутренняя ошибка сервера

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "field": "email",
      "reason": "Email already exists"
    },
    "timestamp": "2025-08-24T12:00:00Z",
    "request_id": "req-uuid"
  }
}
```

### Common Error Codes

- `AUTHENTICATION_FAILED` - Неверные учетные данные
- `TOKEN_EXPIRED` - JWT token истек
- `VALIDATION_ERROR` - Ошибки валидации данных
- `FILE_TOO_LARGE` - Превышен размер файла
- `UNSUPPORTED_FORMAT` - Неподдерживаемый формат файла
- `QUOTA_EXCEEDED` - Превышена квота пользователя
- `RESOURCE_NOT_FOUND` - Ресурс не найден
- `PROCESSING_FAILED` - Ошибка обработки
- `GENERATION_FAILED` - Ошибка генерации изображения

---

## Rate Limiting

### Limits by Plan

**FREE Plan:**
- API calls: 1000/hour
- File uploads: 10/hour
- Image generation: 50/month

**PREMIUM Plan:**
- API calls: 10000/hour
- File uploads: 100/hour
- Image generation: 500/month

**ULTIMATE Plan:**
- API calls: Unlimited
- File uploads: Unlimited
- Image generation: Unlimited

### Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset: 1692876000
```

---

## Webhooks (Planned)

Для уведомлений о завершении long-running операций:

- `book.processing.completed`
- `book.processing.failed`
- `image.generation.completed`
- `image.generation.failed`

---

## SDK Examples

### JavaScript/TypeScript

```typescript
import { BookReaderAPI } from '@bookreader/api-client';

const api = new BookReaderAPI({
  baseURL: 'https://api.bookreader.com/v1',
  token: 'your-jwt-token'
});

// Upload book
const book = await api.books.upload(fileBlob);

// Get chapters
const chapter = await api.books.getChapter(bookId, 1);

// Generate images
await api.images.generateForChapter(chapterId, { limit: 5 });
```

### Python

```python
from bookreader_client import BookReaderClient

client = BookReaderClient(
    base_url="https://api.bookreader.com/v1",
    token="your-jwt-token"
)

# Upload book
book = client.books.upload("book.epub")

# Generate images
task = client.images.generate_for_description(description_id)
```

---

## API Endpoints Summary

### Total Endpoints: 76 (across 20 router files)

**Books Router (10 endpoints):**
- books/crud.py (5 endpoints):
  - GET /books/
  - POST /books/upload
  - GET /books/{book_id}
  - GET /books/{book_id}/file
  - GET /books/{book_id}/cover
- books/validation.py (3 endpoints):
  - GET /books/parser-status
  - POST /books/validate-file
  - POST /books/parse-preview
- books/processing.py (2 endpoints):
  - POST /books/{book_id}/process
  - GET /books/{book_id}/parsing-status

**Chapters Router (2 endpoints):**
- GET /books/{book_id}/chapters
- GET /books/{book_id}/chapters/{number}

**Descriptions Router (3 endpoints):**
- GET /books/{book_id}/descriptions
- GET /books/{book_id}/chapters/{number}/descriptions
- POST /books/analyze-chapter

**Reading Progress Router (2 endpoints):**
- GET /books/{book_id}/progress
- POST /books/{book_id}/progress

**Reading Sessions Router (6 endpoints):**
- POST /reading-sessions/start
- PUT /reading-sessions/{session_id}/end
- GET /reading-sessions/
- GET /reading-sessions/{session_id}
- GET /reading-sessions/active
- GET /reading-sessions/statistics

**Admin Router (21 endpoints):**
- admin/stats.py (1 endpoint):
  - GET /admin/stats
- admin/nlp_settings.py (5 endpoints):
  - GET /admin/multi-nlp-settings
  - PUT /admin/multi-nlp-settings
  - GET /admin/multi-nlp-settings/status
  - POST /admin/multi-nlp-settings/test
  - GET /admin/nlp-processor-status
- admin/parsing.py (5 endpoints):
  - GET /admin/parsing-settings
  - PUT /admin/parsing-settings
  - GET /admin/queue-status
  - POST /admin/clear-queue
  - POST /admin/unlock-parsing
- admin/images.py (2 endpoints):
  - GET /admin/image-generation-settings
  - PUT /admin/image-generation-settings
- admin/users.py (1 endpoint):
  - GET /admin/users
- admin/system.py (3 endpoints):
  - GET /admin/health
  - POST /admin/maintenance/start
  - POST /admin/maintenance/end
- admin/cache.py (4 endpoints):
  - GET /admin/cache/stats
  - POST /admin/cache/clear
  - GET /admin/cache/keys
  - DELETE /admin/cache/keys/{key}
- admin/reading_sessions.py (3 endpoints):
  - GET /admin/reading-sessions/
  - GET /admin/reading-sessions/{session_id}
  - DELETE /admin/reading-sessions/{session_id}

**NLP Router (4 endpoints):**
- GET /nlp/status
- POST /nlp/extract-descriptions
- GET /nlp/test-book-sample
- GET /nlp/test-libraries

**Auth Router (7 endpoints):**
- POST /auth/register
- POST /auth/login
- POST /auth/refresh
- GET /auth/me
- POST /auth/logout
- POST /auth/verify-email
- POST /auth/reset-password

**Users Router (6 endpoints):**
- GET /users/profile
- PUT /users/profile
- GET /users/subscription
- GET /users/reading-statistics
- GET /users/books
- DELETE /users/account

**Images Router (8 endpoints):**
- GET /images/generation/status
- POST /images/generate/description/{description_id}
- POST /images/generate/chapter/{chapter_id}
- GET /images/book/{book_id}
- POST /images/{image_id}/regenerate
- DELETE /images/{image_id}
- GET /images/{image_id}
- GET /images/{image_id}/thumbnail

**Health Router (4 endpoints):**
- GET /health
- GET /health/ready
- GET /health/live
- GET /health/db

---

## Changelog

### v1.3.0 (2025-11-14) - Admin & Cache Management Expansion
- NEW: Admin Cache Management (4 endpoints)
  - GET /admin/cache/stats - Redis кэш статистика
  - POST /admin/cache/clear - Очистка кэша
  - GET /admin/cache/keys - Список ключей кэша
  - DELETE /admin/cache/keys/{key} - Удаление конкретного ключа
- NEW: Admin Reading Sessions (3 endpoints)
  - GET /admin/reading-sessions/
  - GET /admin/reading-sessions/{session_id}
  - DELETE /admin/reading-sessions/{session_id}
- NEW: Admin System Management (3 endpoints)
  - GET /admin/health
  - POST /admin/maintenance/start
  - POST /admin/maintenance/end
- UPDATED: Total API endpoints: 76 (was 35+)
- UPDATED: Custom EPUB Reader component (EpubReader.tsx, 835 строк) - react-reader библиотека удалена
- FIXED: Документация API endpoints актуализирована

### v1.2.0 (2025-10-23) - Multi-NLP & Custom EPUB Reader
- NEW: GET /books/{book_id}/file - EPUB file endpoint для кастомной читалки
- UPDATED: POST /books/{book_id}/progress - поддержка CFI и scroll_offset_percent
- NEW: 5 Admin endpoints для управления Multi-NLP системой
- UPDATED: GET /nlp/status - показывает все 3 процессора (spaCy, Natasha, Stanza)
- UPDATED: POST /nlp/extract-descriptions - 5 режимов обработки (single, parallel, sequential, ensemble, adaptive)
- Advanced Multi-NLP Manager с ensemble voting и consensus алгоритмом
- CFI (Canonical Fragment Identifier) для точного трекинга прогресса

### v1.1.0 (2025-09-15) - Advanced NLP System
- Advanced Multi-NLP Manager с 3 процессорами
- Ensemble voting с weighted consensus
- Adaptive processing mode
- Processor-specific settings API
- Quality monitoring и usage statistics

### v1.0.0 (2025-08-24) - Initial Release
- Initial API release
- Authentication with JWT
- Book upload and processing
- NLP description extraction
- AI image generation
- Reading progress tracking
- User management

---

## Interactive Documentation

- **Swagger UI:** `https://yourdomain.com/docs`
- **ReDoc:** `https://yourdomain.com/redoc`
- **OpenAPI JSON:** `https://yourdomain.com/openapi.json`
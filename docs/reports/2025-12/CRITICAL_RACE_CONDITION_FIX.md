# 🚨 КРИТИЧЕСКОЕ: Race Condition в Обработке Первой Главы

**Обнаружено:** 2025-12-25
**Серьезность:** CRITICAL (P0)
**Статус:** ТРЕБУЕТ НЕМЕДЛЕННОГО ИСПРАВЛЕНИЯ

---

## Проблема

Глава 1 может быть **НЕПРАВИЛЬНО** помечена как служебная страница и **НИКОГДА** не получить описаний из-за race condition между Celery task и API endpoint.

### Сценарий

```
1. Пользователь загружает книгу
2. Celery task начинает парсить первые 5 глав (асинхронно)
3. Пользователь открывает главу 1 ДО завершения Celery task
4. API endpoint определяет is_service_page = True (неправильно)
5. API endpoint коммитит is_service_page = True СРАЗУ
6. Celery task коммитит is_service_page = False ПОЗЖЕ (через 10-30 сек)
7. Результат: Конфликт в БД, глава может остаться без описаний
```

---

## Временное Окно Уязвимости

**10-30 секунд** между началом Celery task и batch commit
- Celery обрабатывает 5 глав через LLM API (~2-6 сек каждая)
- Batch commit происходит в конце
- API endpoint коммитит is_service_page СРАЗУ

---

## P0 FIX (СРОЧНО)

### FIX 1: Distributed Lock для is_service_page

**Файл:** `backend/app/routers/descriptions.py:95-102`

**ЗАМЕНИТЬ:**
```python
# P1.1 OPTIMIZATION: Use cached method from Chapter model
is_service_page = chapter.check_is_service_page()

# Cache the result if not already cached
if chapter.is_service_page is None:
    chapter.is_service_page = is_service_page
    await db.commit()
    logger.debug(f"📝 Cached is_service_page={is_service_page} for chapter {chapter.id}")
```

**НА:**
```python
# P0 FIX: Distributed lock to prevent race condition with Celery task
lock_key = f"chapter_metadata_lock:{chapter.id}"
lock_acquired = await cache_manager.acquire_lock(lock_key, ttl=60)

if lock_acquired:
    try:
        is_service_page = chapter.check_is_service_page()

        if chapter.is_service_page is None:
            chapter.is_service_page = is_service_page
            await db.commit()
            logger.info(
                f"📝 [LOCK ACQUIRED] Cached is_service_page={is_service_page} "
                f"for chapter {chapter.id}"
            )
    finally:
        await cache_manager.release_lock(lock_key)
else:
    # Someone else is processing this chapter - use current value or wait
    logger.warning(
        f"⏳ [LOCK WAIT] Another process is updating chapter {chapter.id} metadata"
    )
    is_service_page = chapter.check_is_service_page()
```

---

### FIX 2: Commit is_service_page СРАЗУ в Celery Task

**Файл:** `backend/app/core/tasks.py:172-179`

**ЗАМЕНИТЬ:**
```python
# P1.1: Use cached is_service_page method
if chapter.is_service_page is None:
    chapter.is_service_page = is_service_page

if is_service_page:
    print(f"⏭️ [ASYNC TASK] Skipping service page: {chapter.title}")
    chapter.is_description_parsed = True
    chapter.parsed_at = datetime.now(timezone.utc)
    continue
```

**НА:**
```python
# P0 FIX: Acquire lock and commit is_service_page immediately
lock_key = f"chapter_metadata_lock:{chapter.id}"
lock_acquired = await cache_manager.acquire_lock(lock_key, ttl=60)

if lock_acquired:
    try:
        if chapter.is_service_page is None:
            chapter.is_service_page = is_service_page
            await db.commit()  # 💾 COMMIT IMMEDIATELY
            print(f"📝 [CELERY] Cached is_service_page={is_service_page} for {chapter.title}")
    finally:
        await cache_manager.release_lock(lock_key)
else:
    # API endpoint is processing this chapter - skip to avoid conflict
    print(f"⏭️ [CELERY] Skipping {chapter.title} (being processed by API endpoint)")
    continue

if is_service_page:
    print(f"⏭️ [CELERY] Skipping service page: {chapter.title}")
    chapter.is_description_parsed = True
    chapter.parsed_at = datetime.now(timezone.utc)
    await db.commit()  # Commit service page flag
    continue
```

---

## P1 FIX (Важно, но не срочно)

### FIX 3: Улучшить check_is_service_page()

**Файл:** `backend/app/models/chapter.py:140-167`

**Проблемы:**
1. Первые 500 символов недостаточно (нужно 2000+)
2. "Пролог" на 5000 слов = ложноположительное срабатывание
3. Нет весов для разных критериев

**ЗАМЕНИТЬ:**
```python
def check_is_service_page(self) -> bool:
    if self.is_service_page is not None:
        return self.is_service_page

    chapter_title_lower = (self.title or "").lower()
    chapter_content_lower = (self.content or "")[:500].lower()

    is_service = any(
        keyword in chapter_title_lower or keyword in chapter_content_lower
        for keyword in self.SERVICE_PAGE_KEYWORDS
    )

    if self.word_count and self.word_count < 100:
        is_service = True

    return is_service
```

**НА:**
```python
def check_is_service_page(self) -> bool:
    """
    Определяет, является ли глава служебной страницей.

    IMPROVED LOGIC (2025-12-25):
    - Проверяет больше контента (2000 символов вместо 500)
    - Исключает "Пролог"/"Эпилог" с большим word_count
    - Использует счетчик совпадений ключевых слов
    """
    if self.is_service_page is not None:
        return self.is_service_page

    # 1. Проверяем title
    title_lower = (self.title or "").lower()

    # ИСКЛЮЧЕНИЕ: "Пролог", "Эпилог" с большим word_count = НЕ служебная
    if ("пролог" in title_lower or "эпилог" in title_lower):
        if self.word_count and self.word_count > 500:
            return False

    # Другие ключевые слова в title = служебная страница
    if any(keyword in title_lower for keyword in self.SERVICE_PAGE_KEYWORDS):
        return True

    # 2. Проверяем контент (УВЕЛИЧЕНО с 500 до 2000 символов)
    content_sample = (self.content or "")[:2000].lower()

    # Считаем совпадения ключевых слов
    keyword_matches = sum(
        1 for keyword in self.SERVICE_PAGE_KEYWORDS
        if keyword in content_sample
    )

    # Если >= 3 ключевых слов = служебная страница
    # (защита от случайных упоминаний одного слова в тексте)
    if keyword_matches >= 3:
        return True

    # 3. Очень короткие главы
    if self.word_count and self.word_count < 100:
        return True

    return False
```

---

## P2 FIX (Долгосрочное Решение)

### FIX 4: Endpoint для Переобработки Глав

**Файл:** `backend/app/routers/descriptions.py` (новый endpoint)

```python
@router.post(
    "/{book_id}/chapters/{chapter_number}/reprocess",
    response_model=ChapterDescriptionsResponse,
    summary="Reprocess chapter (force re-extraction)",
    description="Forces re-extraction of descriptions even if chapter is marked as processed. "
                "Useful for fixing incorrectly detected service pages."
)
async def reprocess_chapter(
    book_id: UUID,
    chapter_number: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> ChapterDescriptionsResponse:
    """
    Переобрабатывает главу даже если она помечена is_description_parsed = True.

    Используется для исправления неправильно определенных служебных страниц.

    Args:
        book_id: ID книги
        chapter_number: Номер главы
        current_user: Текущий пользователь
        db: Сессия базы данных

    Returns:
        ChapterDescriptionsResponse: Описания главы после переобработки
    """
    # Get book and chapter
    book = await book_service.get_book_by_id(db=db, book_id=book_id, user_id=current_user.id)
    if not book:
        raise BookNotFoundException(book_id)

    chapter = None
    for c in book.chapters:
        if c.chapter_number == chapter_number:
            chapter = c
            break

    if not chapter:
        raise ChapterNotFoundException(chapter_number, book_id)

    logger.info(
        f"🔄 [REPROCESS] Forcing re-extraction for chapter {chapter.id} "
        f"(title: {chapter.title}, was_parsed: {chapter.is_description_parsed})"
    )

    # RESET FLAGS to force re-extraction
    chapter.is_description_parsed = False
    chapter.is_service_page = None  # Force re-check
    chapter.descriptions_found = 0
    await db.commit()

    # Call standard extraction with extract_new=True
    return await get_chapter_descriptions(
        book_id=book_id,
        chapter_number=chapter_number,
        extract_new=True,
        current_user=current_user,
        db=db
    )
```

---

## Testing Plan

### Тест 1: Race Condition Simulation

```python
# test_race_condition.py
import asyncio
import pytest

async def test_race_condition_is_service_page():
    """
    Симулирует race condition между Celery task и API endpoint.
    """
    # 1. Создаем книгу с главой
    book = create_test_book()
    chapter = book.chapters[0]

    # 2. Запускаем Celery task (асинхронно)
    celery_task = asyncio.create_task(
        process_book_task(str(book.id))
    )

    # 3. Пауза 2 секунды (имитация загрузки страницы)
    await asyncio.sleep(2)

    # 4. Вызываем API endpoint (до завершения Celery)
    api_response = await get_chapter_descriptions(
        book_id=book.id,
        chapter_number=1,
        extract_new=False
    )

    # 5. Ждем завершения Celery
    await celery_task

    # 6. ПРОВЕРЯЕМ: is_service_page должен быть консистентным
    chapter_after = await db.get(Chapter, chapter.id)
    assert chapter_after.is_service_page is not None
    # И должен совпадать между API и Celery
```

### Тест 2: False Positive "Пролог"

```python
async def test_prologue_not_service_page():
    """
    Проверяет, что "Пролог" с большим word_count НЕ служебная страница.
    """
    chapter = Chapter(
        title="Пролог",
        content="Это была тёмная и бурная ночь..." * 1000,  # 5000+ слов
        word_count=5000
    )

    is_service = chapter.check_is_service_page()
    assert is_service is False  # Должен быть НЕ служебной страницей
```

### Тест 3: Reprocess Endpoint

```python
async def test_reprocess_chapter():
    """
    Проверяет, что reprocess endpoint корректно сбрасывает флаги.
    """
    # 1. Создаем главу с неправильным is_service_page
    chapter = create_chapter(is_service_page=True, is_description_parsed=True)

    # 2. Вызываем reprocess
    response = await reprocess_chapter(
        book_id=chapter.book_id,
        chapter_number=chapter.chapter_number
    )

    # 3. ПРОВЕРЯЕМ: флаги сброшены, описания извлечены
    chapter_after = await db.get(Chapter, chapter.id)
    assert chapter_after.is_service_page is False
    assert chapter_after.is_description_parsed is True
    assert chapter_after.descriptions_found > 0
```

---

## Мониторинг

### Grafana Dashboard

```yaml
# is_service_page conflicts
- expr: |
    count by (chapter_id) (
      chapter_service_page_check{source="celery_task"} != bool
      chapter_service_page_check{source="api_endpoint"}
    )
  alert: ServicePageConflict
  for: 1m
  annotations:
    summary: "Detected is_service_page conflict for chapter {{ $labels.chapter_id }}"
```

### Логи для Отладки

**В Celery task:**
```python
logger.info(
    "chapter_metadata_update",
    extra={
        "chapter_id": str(chapter.id),
        "is_service_page": is_service_page,
        "source": "celery_task",
        "lock_acquired": lock_acquired,
        "timestamp": time.time(),
    }
)
```

**В API endpoint:**
```python
logger.info(
    "chapter_metadata_update",
    extra={
        "chapter_id": str(chapter.id),
        "is_service_page": is_service_page,
        "source": "api_endpoint",
        "lock_acquired": lock_acquired,
        "timestamp": time.time(),
    }
)
```

---

## Rollout Plan

1. **Stage 1: Code Review** (30 min)
   - Review FIX 1 и FIX 2
   - Проверить корректность distributed lock logic

2. **Stage 2: Testing** (1 hour)
   - Запустить unit tests
   - Запустить integration tests
   - Manual testing на staging

3. **Stage 3: Staging Deployment** (30 min)
   - Deploy на staging
   - Monitor logs для race conditions
   - Load testing (100+ одновременных uploads)

4. **Stage 4: Production Deployment** (Канареечный релиз)
   - Deploy на 10% production servers
   - Monitor 24 hours
   - Gradual rollout to 100%

5. **Stage 5: Monitoring** (Постоянно)
   - Grafana alerts для conflicts
   - Weekly review логов
   - User feedback monitoring

---

## Откат (Rollback Plan)

Если проблемы после deployment:

1. **Immediate Rollback**
   ```bash
   git revert <commit_hash>
   docker-compose up -d --build backend
   ```

2. **Database Cleanup** (если нужно)
   ```sql
   -- Сброс неправильных is_service_page для глав с описаниями
   UPDATE chapters
   SET is_service_page = NULL
   WHERE is_service_page = TRUE
     AND descriptions_found > 0;
   ```

3. **Manual Reprocessing** (для пострадавших пользователей)
   ```bash
   # Admin endpoint для batch reprocess
   curl -X POST "https://fancai.ru/api/v1/admin/reprocess-all-chapter-1"
   ```

---

**Приоритет:** CRITICAL (P0)
**Estimated Effort:** 2-4 hours (implementation + testing)
**Risk:** HIGH (race condition может привести к потере данных)
**Impact:** HIGH (пользователи не видят описаний для первых глав)

**Рекомендация:** Внедрить FIX 1 и FIX 2 СРОЧНО (сегодня)

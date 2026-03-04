"""
Book processing Celery tasks.
"""

from app.core.celery_app import celery_app
import asyncio
from typing import Dict, Any, cast
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select, func

from difflib import get_close_matches
from typing import Optional

from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.book import Book
from app.models.entity import Entity
from app.models.entity_relationship import EntityRelationship
from app.models.chapter import Chapter
from app.services.gemini_extractor import get_gemini_extractor
from app.services.consistency_manager import ConsistencyManager
from app.core.pubsub import publish_book_progress, publish_entities_updated
from app.services.push_notification_service import push_notification_service


def find_entity_fuzzy(
    entity_name: str, entity_map: Dict[str, Entity], cutoff: float = 0.7
) -> Optional[Entity]:
    """
    Find entity with fuzzy matching fallback.

    Strategy:
    1. Exact match (casefolded)
    2. Close string match (difflib, cutoff=0.7)
    3. Substring containment (either direction)
    """
    name_lower = entity_name.casefold().strip()

    if name_lower in entity_map:
        return entity_map[name_lower]

    matches = get_close_matches(name_lower, entity_map.keys(), n=1, cutoff=cutoff)
    if matches:
        logger.debug(f"Fuzzy match: '{entity_name}' -> '{matches[0]}'")
        return entity_map[matches[0]]

    for key, entity in entity_map.items():
        if name_lower in key or key in name_lower:
            logger.debug(f"Substring match: '{entity_name}' -> '{key}'")
            return entity

    return None


@celery_app.task(
    name="process_book",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    time_limit=10800,  # 3 hours hard limit
    soft_time_limit=10500,  # 2 hours 55 minutes soft limit
    track_started=True,  # Celery 5.6+: Track STARTED state
)
def process_book_task(self, book_id_str: str) -> Dict[str, Any]:
    """
    Асинхронная обработка книги: валидация и подготовка к on-demand извлечению.

    После удаления NLP системы эта задача только:
    - Валидирует книгу и главы
    - Проверяет доступность LLM
    - Помечает книгу как готовую к обработке

    Phase 2 Improvements:
    - SoftTimeLimitExceeded handling for graceful timeout
    - Finally block for atomic state cleanup
    - Redis lock cleanup on all exit paths

    Phase 4 Improvements:
    - Redis distributed lock to prevent duplicate processing

    Args:
        book_id_str: String ID книги для обработки (UUID)

    Returns:
        Результат обработки
    """
    from celery.exceptions import SoftTimeLimitExceeded
    import redis
    from app.core.config import settings

    book_id = None
    redis_lock = None
    lock_key = f"book:processing:{book_id_str}"

    # Define async wrapper to keep everything in ONE event loop
    async def task_wrapper():
        nonlocal book_id, redis_lock

        # Fix: asyncio.run() creates a new event loop each call and closes it after.
        # The module-level SQLAlchemy engine's connection pool retains connections
        # bound to the old (closed) loop. Disposing forces fresh connections.
        from app.core.database import engine

        await engine.dispose()

        try:
            # Phase 4: Acquire distributed lock
            # Note: redis-py is sync here, but that's fine inside async wrapper
            # provided we don't block for long.
            # Ideally we'd use redis.asyncio, but we are reusing the existing sync client pattern
            # for the lock acquisition part which is fast.
            # Or better: keep sync lock logic outside, only run async process inside.
            # BUT: cleanup needs async DB session. So cleanup must be in the loop.

            # Since Redis Lock logic is sync, let's keep it here.

            logger.info(
                "Starting book processing", book_id=book_id_str, task="process_book"
            )
            book_id = UUID(book_id_str)

            # RUN MAIN PROCESSING
            result = await _process_book_async(book_id)

            logger.info(
                "Book processing completed",
                book_id=book_id_str,
                status=result.get("status"),
                chapters_processed=result.get("chapters_processed"),
            )
            return result

        except SoftTimeLimitExceeded:
            # Celery 5.6+: Graceful timeout handling
            logger.warning(
                "Book processing soft time limit exceeded",
                book_id=book_id_str,
                timeout_seconds=10500,
            )
            if book_id:
                try:
                    await _atomic_cleanup_book_state(
                        book_id, "Timeout: soft limit exceeded (2h 55m)"
                    )
                except Exception as cleanup_e:
                    logger.error(f"Cleanup failed during timeout: {cleanup_e}")
            raise  # Re-raise so Celery marks task as failed

        except Exception as e:
            logger.opt(exception=True).error(
                f"Error processing book: {e}",
                book_id=book_id_str,
            )
            # Ensure we update the book state in DB so it doesn't get stuck processing
            if book_id:
                try:
                    # Run cleanup in the SAME loop
                    await _atomic_cleanup_book_state(book_id, str(e))
                except Exception as db_e:
                    logger.error(
                        "Failed to update book error state",
                        book_id=book_id_str,
                        error=str(db_e),
                    )

            return {"book_id": book_id_str, "status": "failed", "error": str(e)}

    # Acquire lock first (SYNC)
    # TD-P18-4: Use sync Redis properly with explicit cleanup
    redis_client = None
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        redis_lock = redis_client.lock(
            lock_key,
            timeout=10800,
            blocking=False,  # 3 hours (match task time limit)
        )

        if not redis_lock.acquire(blocking=False):
            logger.warning(
                "Book already being processed (lock exists)",
                book_id=book_id_str,
                lock_key=lock_key,
            )
            return {
                "book_id": book_id_str,
                "status": "skipped",
                "error": "Book is already being processed by another worker",
            }

        # Run everything in ONE loop
        return asyncio.run(task_wrapper())

    except Exception as outer_e:
        # If redis fails or asyncio.run fails totally
        logger.error(f"Critical task failure: {outer_e}")
        raise outer_e

    finally:
        if redis_lock is not None:
            try:
                redis_lock.release()
                logger.debug(f"Released Redis lock for book {book_id_str}")
            except Exception as lock_e:
                logger.warning(f"Failed to release Redis lock: {lock_e}")
        if redis_client is not None:
            try:
                redis_client.close()
            except Exception:
                pass


async def _atomic_cleanup_book_state(book_id: UUID, error_msg: str):
    """
    Atomic cleanup of book processing state.

    Guaranteed to:
    1. Set is_processing=False
    2. Set error message
    3. Invalidate user cache
    4. Clear Redis processing lock

    Phase 2: Replaces _handle_book_processing_error_async with more robust handling.
    """
    try:
        async with AsyncSessionLocal() as db:
            book_result = await db.execute(select(Book).where(Book.id == book_id))
            book = book_result.scalar_one_or_none()

            if book:
                book.is_processing = False
                book.descriptions_processing_error = error_msg
                await db.commit()

                # Invalidate cache
                try:
                    from app.core.cache import cache_manager

                    pattern = f"user:{book.user_id}:books:*"
                    await cache_manager.delete_pattern(pattern)
                except Exception as cache_e:
                    logger.warning(f"Cache invalidation failed: {cache_e}")

        # Clear Redis processing lock
        try:
            import redis.asyncio as aioredis
            from app.core.config import settings

            redis_client = await aioredis.from_url(settings.REDIS_URL)
            await redis_client.delete(f"book:processing:{str(book_id)}")
            await redis_client.close()
        except Exception as redis_e:
            logger.warning(f"Redis lock cleanup failed: {redis_e}")

    except Exception as e:
        logger.error(
            "Error in _atomic_cleanup_book_state", book_id=str(book_id), error=str(e)
        )


async def _process_book_async(book_id: UUID) -> Dict[str, Any]:
    """
    Асинхронная функция обработки книги.

    После загрузки:
    1. Валидирует книгу и главы
    2. Парсит первые 2 главы с помощью LLM для предзагрузки
    3. Помечает книгу как готовую
    """
    async with AsyncSessionLocal() as db:
        logger.debug("Starting async processing", book_id=str(book_id))

        # Initialize services
        gemini_extractor = get_gemini_extractor()
        consistency_manager = ConsistencyManager(db)

        # Import DescriptionType for DB mapping
        from app.models.description import DescriptionType

        # Проверяем доступность LLM
        llm_available = gemini_extractor.is_available()

        if not llm_available:
            logger.warning("Gemini extractor not available", book_id=str(book_id))

        # Получаем книгу
        book_result = await db.execute(select(Book).where(Book.id == book_id))
        book = book_result.scalar_one_or_none()

        if not book:
            logger.error("Book not found", book_id=str(book_id))
            raise ValueError(f"Book with id {book_id} not found")

        logger.info(
            "Found book", book_id=str(book_id), title=book.title, author=book.author
        )

        # Получаем главы
        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.book_id == book_id)
            .order_by(Chapter.chapter_number)
        )
        chapters = chapters_result.scalars().all()

        logger.info(
            "Found chapters", book_id=str(book_id), chapters_count=len(chapters)
        )

        # ИЗМЕНЕНО: Обрабатываем ВСЕ главы книги (ранее было только 5)
        # Теперь обработка запускается вручную, поэтому обрабатываем полностью
        chapters_processed = 0
        total_descriptions = 0
        total_chapters = len(chapters)

        if llm_available and chapters:
            logger.info(
                "Starting parallel chapter processing (v16 Async Architecture)",
                book_id=str(book_id),
            )

            # Semaphore to limit massive concurrency
            chapter_semaphore = asyncio.Semaphore(10)

            # Progress tracking
            chapters_done_count = 0
            progress_lock = asyncio.Lock()

            async def process_chapter_safe(idx: int, chapter_id: UUID):
                """Process a single chapter. Catches ALL exceptions to prevent sibling task cancellation."""
                try:
                    async with AsyncSessionLocal() as session:
                        async with chapter_semaphore:
                            local_chapter = None
                            try:
                                stmt = select(Chapter).where(Chapter.id == chapter_id)
                                res = await session.execute(stmt)
                                local_chapter = res.scalar_one_or_none()

                                if not local_chapter:
                                    return

                                # Skip if already parsed
                                if local_chapter.is_description_parsed:
                                    return

                                # 2. Check Service Page (Table of Contents, etc)
                                SERVICE_PAGE_KEYWORDS = [
                                    "содержание",
                                    "оглавление",
                                    "table of contents",
                                    "contents",
                                    "от автора",
                                    "слово автора",
                                    "предисловие",
                                    "послесловие",
                                    "аннотация",
                                    "annotation",
                                    "synopsis",
                                    "эпиграф",
                                    "epigraph",
                                    "цитата",
                                    "посвящение",
                                    "dedication",
                                    "благодарности",
                                    "acknowledgments",
                                    "примечания",
                                    "notes",
                                    "сноски",
                                    "библиография",
                                    "bibliography",
                                    "references",
                                    "об авторе",
                                    "about the author",
                                    "биография",
                                    "copyright",
                                    "издательство",
                                    "publisher",
                                    "isbn",
                                    "все права защищены",
                                    "all rights reserved",
                                ]

                                content_lower = (local_chapter.content or "")[
                                    :500
                                ].lower()
                                title_lower = (local_chapter.title or "").lower()

                                is_service = any(
                                    k in title_lower or k in content_lower
                                    for k in SERVICE_PAGE_KEYWORDS
                                )
                                if (
                                    local_chapter.word_count
                                    and local_chapter.word_count < 100
                                ):
                                    is_service = True

                                if is_service:
                                    local_chapter.is_service_page = True
                                    local_chapter.is_description_parsed = True
                                    local_chapter.parsed_at = datetime.now(timezone.utc)
                                    await session.commit()
                                    return

                                # 3. Analyze with Gemini
                                # Extractor has its own internal semaphore/rate-limiting too
                                result = await gemini_extractor.analyze_chapter(
                                    local_chapter.content
                                )

                                # 4. Consistency & Logic (Map Phase)
                                # Use a local ConsistencyManager with this session
                                local_mgr = ConsistencyManager(session)
                                entity_map = await local_mgr.process_chapter_analysis(
                                    str(book_id),
                                    result,
                                    chapter_id=str(local_chapter.id),
                                    chapter_index=idx,
                                )

                                # 4b. Create EntityEvents from extraction
                                from app.models.entity_event import EntityEvent

                                for raw_entity in result.entities:
                                    if raw_entity.chapter_event_action:
                                        resolved = entity_map.get(
                                            raw_entity.name.casefold()[:255]
                                        )
                                        if resolved:
                                            event = EntityEvent(
                                                entity_id=resolved.id,
                                                chapter_id=local_chapter.id,
                                                chapter_number=idx,
                                                event_action=raw_entity.chapter_event_action,
                                                event_inner_state=raw_entity.chapter_event_inner,
                                            )
                                            session.add(event)

                                # 5. Save Descriptions and create DescriptionEntity links
                                descriptions_data = result.descriptions or []
                                from app.models.description import (
                                    Description as DescriptionModel,
                                )
                                from app.models.description_entity import (
                                    DescriptionEntity,
                                )

                                for i, d in enumerate(descriptions_data):
                                    d_dict = cast(
                                        Dict[str, Any],
                                        (
                                            d.to_dict()
                                            if hasattr(d, "to_dict")
                                            else (
                                                dict(d)
                                                if isinstance(d, dict)
                                                else {"content": str(d)}
                                            )
                                        ),
                                    )
                                    try:
                                        d_type = DescriptionType(
                                            d_dict.get("type", "location")
                                        )
                                    except ValueError:
                                        logger.warning(
                                            f"Invalid description type '{d_dict.get('type')}', defaulting to LOCATION"
                                        )
                                        d_type = DescriptionType.LOCATION

                                    new_desc = DescriptionModel(
                                        chapter_id=local_chapter.id,
                                        type=d_type,
                                        content=d_dict.get("content", ""),
                                        confidence_score=d_dict.get(
                                            "confidence_score", 0.8
                                        ),
                                        priority_score=d_dict.get(
                                            "priority_score", 0.5
                                        ),
                                        position_in_chapter=i,
                                        word_count=d_dict.get("word_count", 0),
                                    )
                                    session.add(new_desc)
                                    await session.flush()  # Get new_desc.id

                                    # Create DescriptionEntity links for spoiler protection
                                    entities_mentioned = d_dict.get(
                                        "entities_mentioned", []
                                    )
                                    entities_linked = 0
                                    entities_not_found = []

                                    for entity_name in entities_mentioned:
                                        if not entity_name:
                                            continue
                                        entity = find_entity_fuzzy(
                                            entity_name, entity_map
                                        )
                                        if entity:
                                            desc_entity = DescriptionEntity(
                                                description_id=new_desc.id,
                                                entity_id=entity.id,
                                                confidence=d_dict.get(
                                                    "confidence_score", 0.8
                                                ),
                                                mention_text=entity_name,
                                            )
                                            session.add(desc_entity)
                                            entities_linked += 1
                                        else:
                                            entities_not_found.append(entity_name)

                                    # Diagnostic logging for entity lookup
                                    if entities_mentioned:
                                        logger.debug(
                                            f"Description {i + 1}: entities_mentioned={entities_mentioned}, "
                                            f"linked={entities_linked}, not_found={entities_not_found}, "
                                            f"entity_map_keys={list(entity_map.keys())[:10]}..."
                                        )
                                        if entities_not_found:
                                            logger.warning(
                                                f"Entity lookup miss in chapter {local_chapter.chapter_number}: "
                                                f"not_found={entities_not_found}, available_keys_sample={list(entity_map.keys())[:5]}"
                                            )

                                local_chapter.descriptions_found = len(
                                    descriptions_data
                                )
                                local_chapter.is_description_parsed = True
                                local_chapter.parsed_at = datetime.now(timezone.utc)
                                local_chapter.parsing_error = None
                                local_chapter.parse_attempts += 1

                                await session.commit()

                                num_descriptions = len(descriptions_data)
                                logger.info(
                                    f"Chapter {local_chapter.chapter_number} parsed: {num_descriptions} descriptions"
                                )

                                # Update progress
                                nonlocal chapters_done_count, total_descriptions
                                async with progress_lock:
                                    chapters_done_count += 1
                                    total_descriptions += num_descriptions
                                    current_progress = int(
                                        (chapters_done_count / total_chapters) * 80
                                    )

                                await publish_book_progress(
                                    book_id=str(book_id),
                                    progress=current_progress,
                                    chapter=local_chapter.chapter_number,
                                    total_chapters=total_chapters,
                                    status="processing",
                                    message=f"Обработка главы {local_chapter.chapter_number} из {total_chapters}",
                                )

                            except Exception as e:
                                logger.opt(exception=True).error(
                                    f"Error parsing chapter {idx + 1}: {e}"
                                )
                                try:
                                    await session.rollback()
                                    if local_chapter:
                                        local_chapter = await session.get(
                                            Chapter, chapter_id
                                        )
                                        # Use chapter_id (function arg) instead of local_chapter.id
                                        # because after rollback the ORM object is expired and .id access triggers MissingGreenlet
                                        if local_chapter:
                                            local_chapter.parsing_error = str(e)[:1000]
                                            local_chapter.parse_attempts += 1
                                            await session.commit()
                                except Exception as commit_err:
                                    logger.opt(exception=True).error(
                                        f"Failed to record chapter {idx + 1} error: {commit_err}"
                                    )
                                    try:
                                        await session.rollback()
                                    except Exception:
                                        pass
                except BaseException as fatal_err:
                    # Catch-all: CancelledError, session creation failures, context manager cleanup errors.
                    # Prevents ANY exception from propagating and affecting sibling tasks.
                    logger.opt(exception=True).error(
                        f"Fatal error in chapter {idx + 1} processing: "
                        f"{type(fatal_err).__name__}: {fatal_err}"
                    )

            logger.info(f"Spawning {len(chapters)} parallel tasks...")
            results = await asyncio.gather(
                *(
                    process_chapter_safe(idx, chapter.id)
                    for idx, chapter in enumerate(chapters, start=1)
                ),
                return_exceptions=True,
            )

            # Log results and retry failed chapters sequentially
            succeeded = sum(1 for r in results if not isinstance(r, BaseException))
            failed_indices = [
                i for i, r in enumerate(results) if isinstance(r, BaseException)
            ]

            for i in failed_indices:
                logger.error(
                    f"Chapter task {i + 1} returned exception: "
                    f"{type(results[i]).__name__}: {results[i]}"
                )

            # Retry failed chapters sequentially (once)
            if failed_indices:
                logger.warning(
                    f"Retrying {len(failed_indices)} failed chapters sequentially..."
                )
                for i in failed_indices:
                    try:
                        await process_chapter_safe(i, chapters[i].id)
                        succeeded += 1
                    except BaseException as retry_err:
                        logger.opt(exception=True).error(
                            f"Chapter {i + 1} retry also failed: {retry_err}"
                        )

            logger.info(
                f"Parallel processing complete. "
                f"{chapters_done_count}/{total_chapters} chapters processed, "
                f"{total_descriptions} descriptions extracted."
            )

            # Update book progress to 100% (approximate)
            book.parsing_progress = 100
            chapters_processed = chapters_done_count

        # 4. Phase 2: Map-Reduce Barrier & Graph Analysis
        # Executed once after all chapters are extracted.

        # A. Reduce Phase: Merge Duplicates & Filter Garbage
        try:
            async with db.begin_nested():
                logger.info(
                    "Running Entity Optimization (Reduce Phase)...",
                    book_id=str(book_id),
                )
            await publish_book_progress(
                book_id=str(book_id),
                progress=85,
                status="processing",
                message="Оптимизация сущностей...",
            )
            await consistency_manager.optimize_book_entities(str(book_id))

            from app.models.entity import Entity

            entities_count_result = await db.execute(
                select(func.count(Entity.id)).where(Entity.book_id == book_id)
            )
            entities_count = entities_count_result.scalar() or 0

            await publish_entities_updated(
                book_id=str(book_id),
                entities_count=entities_count,
                message=f"Обнаружено {entities_count} сущностей",
            )
        except Exception as e:
            logger.error(f"Reduce phase failed: {e}")

        # C. LLM-based Deduplication Phase (EC-1.2)
        try:
            from app.services.entity_deduplication_service import (
                EntityDeduplicationService,
            )

            logger.info("Running LLM Entity Deduplication...", book_id=str(book_id))
            dedup_service = EntityDeduplicationService(db=db)
            dedup_response = await dedup_service.suggest_merges(book_id)

            if dedup_response.merge_groups:
                from app.routers.admin.entities import _merge_entities_internal

                auto_merged = 0
                for group in dedup_response.merge_groups:
                    if group.confidence >= 0.75:
                        try:
                            await _merge_entities_internal(
                                db=db,
                                master_id=UUID(group.master_id),
                                duplicate_ids=[
                                    UUID(did) for did in group.duplicate_ids
                                ],
                            )
                            auto_merged += len(group.duplicate_ids)
                            logger.info(
                                f"Auto-merged {len(group.duplicate_ids)} entities (conf={group.confidence})"
                            )
                        except Exception as merge_err:
                            logger.warning(f"Auto-merge failed: {merge_err}")

                if auto_merged > 0:
                    logger.info(
                        f"LLM Dedup: auto-merged {auto_merged} entities",
                        book_id=str(book_id),
                    )
        except Exception as e:
            logger.warning(f"LLM deduplication phase failed (non-critical): {e}")

        # D. Entity Synthesis Phase (Phase 2 — milestones, roles, relationships)
        try:
            from app.services.entity_synthesis_service import EntitySynthesisService
            from app.models.entity_event import EntityEvent

            logger.info("Running Entity Synthesis...", book_id=str(book_id))
            await publish_book_progress(
                book_id=str(book_id),
                progress=88,
                status="processing",
                message="Синтез энциклопедии...",
            )

            # Load entities and events
            entities_q = await db.execute(
                select(Entity).where(Entity.book_id == book_id)
            )
            all_entities = entities_q.scalars().all()

            events_q = await db.execute(
                select(EntityEvent).where(
                    EntityEvent.entity_id.in_([e.id for e in all_entities])
                )
            )
            all_events = events_q.scalars().all()

            entities_data = [
                {
                    "name": e.name,
                    "type": e.type,
                    "visual_summary": e.visual_summary or "",
                }
                for e in all_entities
            ]
            events_data = [
                {
                    "entity_name": next(
                        (ent.name for ent in all_entities if ent.id == ev.entity_id), ""
                    ),
                    "chapter_number": ev.chapter_number,
                    "action": ev.event_action,
                    "inner_state": ev.event_inner_state,
                }
                for ev in all_events
            ]

            synthesis_service = EntitySynthesisService()
            synthesis_result = await synthesis_service.synthesize_book_entities(
                book_id=str(book_id),
                entities=entities_data,
                events=events_data,
                genre=getattr(book, "genre", "") or "",
                language=getattr(book, "language", "ru") or "ru",
            )

            # Save synthesis results to DB
            entity_name_map = {e.name_lower: e for e in all_entities}
            for synth_entity in synthesis_result.get("entities", []):
                name = synth_entity.get("name", "")
                db_entity = entity_name_map.get(name.casefold()[:255])
                if db_entity:
                    db_entity.base_role = synth_entity.get("base_role")
                    db_entity.biography_milestones = synth_entity.get("milestones", [])
                    db.add(db_entity)

            # Save relationship milestones
            for rel_ms in synthesis_result.get("relationship_milestones", []):
                source_name = rel_ms.get("source", "").casefold()[:255]
                target_name = rel_ms.get("target", "").casefold()[:255]
                source_entity = entity_name_map.get(source_name)
                target_entity = entity_name_map.get(target_name)
                if source_entity and target_entity:
                    rel_q = await db.execute(
                        select(EntityRelationship).where(
                            EntityRelationship.source_id == source_entity.id,
                            EntityRelationship.target_id == target_entity.id,
                        )
                    )
                    rel = rel_q.scalar_one_or_none()
                    if rel:
                        rel.relationship_milestones = rel_ms.get("milestones", [])
                        db.add(rel)

            await db.commit()
            logger.info(
                f"Entity Synthesis complete: {len(synthesis_result.get('entities', []))} entities",
                book_id=str(book_id),
            )
        except Exception as e:
            logger.warning(f"Entity synthesis phase failed (non-critical): {e}")

        # B. Graph Phase: PageRank & Importance
        try:
            async with db.begin_nested():
                from app.services.graph_service import get_graph_service
            graph_service = get_graph_service(db)
            logger.info("Calculating Graph Metrics (PageRank)...", book_id=str(book_id))
            await publish_book_progress(
                book_id=str(book_id),
                progress=90,
                status="processing",
                message="Анализ связей графа...",
            )
            await graph_service.calculate_pagerank(str(book_id))
        except Exception as e:
            logger.error(f"Graph analysis failed: {e}")

        # 5. Generate Master References for optimized entities
        # This is done once after all chapters are processed to ensure global consistency
        try:
            async with db.begin_nested():
                logger.info(
                    "Generating Master References for entities...", book_id=str(book_id)
                )
            await publish_book_progress(
                book_id=str(book_id),
                progress=95,
                status="processing",
                message="Финальная сборка...",
            )
            await consistency_manager.generate_master_references(str(book_id))
        except Exception as e:
            logger.error("Failed to generate master references", error=str(e))

        # Помечаем книгу как готовую с извлечёнными описаниями
        book.is_processing = False
        book.is_parsed = True
        book.parsing_progress = 100
        book.descriptions_extracted = True  # НОВОЕ: флаг успешного извлечения
        book.descriptions_processing_error = None  # Сбрасываем ошибку
        await db.commit()

        # Публикуем завершение через WebSocket
        try:
            await publish_book_progress(
                book_id=str(book_id),
                progress=100,
                chapter=total_chapters,
                total_chapters=total_chapters,
                status="completed",
                message="Обработка завершена успешно!",
            )
        except Exception as ws_err:
            logger.warning("Failed to publish WebSocket completion", error=str(ws_err))

        # Инвалидируем кэш
        try:
            from app.core.cache import cache_manager

            logger.debug("Invalidating book list cache", user_id=str(book.user_id))
            pattern = f"user:{book.user_id}:books:*"
            deleted_count = await cache_manager.delete_pattern(pattern)
            logger.debug("Cache invalidated", keys_deleted=deleted_count)

            # Invalidate the entity network RAW cache so users see fresh entity data
            # after reprocessing instead of stale data until TTL expires.
            entity_cache_key = f"book:{book_id}:entity_network_raw_v5"
            await cache_manager.delete(entity_cache_key)
            logger.debug("Entity network cache invalidated", cache_key=entity_cache_key)
        except Exception as e:
            logger.warning("Failed to invalidate cache", error=str(e))

        failed_chapters_result = await db.execute(
            select(Chapter.chapter_number, Chapter.parsing_error)
            .where(Chapter.book_id == book_id)
            .where(Chapter.parsing_error.isnot(None))
        )
        failed_chapters = [
            (r[0], r[1][:100]) for r in failed_chapters_result.fetchall()
        ]

        if failed_chapters:
            logger.warning(
                f"Book {book_id} has {len(failed_chapters)} failed chapters: "
                f"{[c[0] for c in failed_chapters]}"
            )

        result = {
            "book_id": str(book_id),
            "status": "completed" if not failed_chapters else "completed_with_errors",
            "chapters_count": len(chapters),
            "chapters_processed": chapters_processed,
            "chapters_failed": len(failed_chapters),
            "failed_chapter_numbers": [c[0] for c in failed_chapters],
            "descriptions_extracted": total_descriptions,
            "llm_available": llm_available,
            "extraction_mode": "full_book",
            "message": f"Book processed. {chapters_processed} chapters, {len(failed_chapters)} failed.",
        }

        logger.info(
            "Book processing finished",
            book_id=str(book_id),
            chapters_count=len(chapters),
            chapters_processed=chapters_processed,
            descriptions_extracted=total_descriptions,
        )

        # Send push notification to user (non-blocking)
        try:
            await push_notification_service.send_book_ready_notification(
                db=db,
                user_id=book.user_id,
                book_id=book.id,
                book_title=book.title,
            )
            logger.debug("Push notification sent for book ready", book_id=str(book_id))
        except Exception as e:
            # Don't fail the task if push notification fails
            logger.warning("Failed to send book ready push notification", error=str(e))

        return result

"""
Глобальный менеджер парсинга с приоритезацией и блокировкой.

Управляет очередью парсинга книг с учетом тарифных планов и
глобальной блокировкой для предотвращения перегрузки системы.
"""

from typing import Optional, Dict, Any
from datetime import datetime, timezone
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import logging

from ..models.user import User, SubscriptionPlan
from ..core.config import settings

logger = logging.getLogger(__name__)


class ParsingManager:
    """Менеджер парсинга с глобальной блокировкой и приоритезацией."""

    def __init__(self):
        self.redis_client = None
        self.parsing_lock_key = "global:parsing:lock"
        self.parsing_queue_key = "global:parsing:queue"
        self.parsing_status_key = "global:parsing:status:{book_id}"
        self.max_concurrent_parsing = (
            1  # Глобальная блокировка - только 1 парсинг одновременно
        )
        self.lock_timeout = 1800  # 30 минут максимум на парсинг

    async def _get_redis(self) -> redis.Redis:
        """Получить Redis клиент."""
        if not self.redis_client:
            self.redis_client = await redis.from_url(
                settings.REDIS_URL, decode_responses=True
            )
        return self.redis_client

    async def get_user_priority(self, user: User, db: AsyncSession) -> int:
        """
        Получить приоритет пользователя по тарифному плану.

        Returns:
            Приоритет (чем выше число, тем выше приоритет):
            - FREE: 1
            - PREMIUM: 5
            - ULTIMATE: 10
        """
        # Получаем активную подписку пользователя
        from ..models.user import Subscription, SubscriptionStatus

        result = await db.execute(
            select(Subscription)
            .where(Subscription.user_id == user.id)
            .where(Subscription.status == SubscriptionStatus.ACTIVE)
        )
        subscription = result.scalar_one_or_none()

        if not subscription:
            return 1  # FREE план по умолчанию

        priority_map = {
            SubscriptionPlan.FREE: 1,
            SubscriptionPlan.PREMIUM: 5,
            SubscriptionPlan.ULTIMATE: 10,
        }

        return priority_map.get(subscription.plan, 1)

    async def can_start_parsing(self) -> tuple[bool, str]:
        """
        Проверить, можно ли начать новый парсинг.

        Returns:
            (можно_парсить, сообщение)
        """
        r = await self._get_redis()

        # Проверяем глобальную блокировку
        lock = await r.get(self.parsing_lock_key)
        if lock:
            lock_data = json.loads(lock)
            remaining_time = self.lock_timeout - (
                datetime.now(timezone.utc).timestamp() - lock_data["started_at"]
            )

            if remaining_time > 0:
                return (
                    False,
                    f"Parsing in progress for book {lock_data['book_id']}. Wait {int(remaining_time)}s",
                )
            else:
                # Блокировка истекла, снимаем её
                await r.delete(self.parsing_lock_key)

        return True, "Parsing can be started"

    async def acquire_parsing_lock(self, book_id: str, user_id: str) -> bool:
        """
        Попытаться получить блокировку для парсинга.

        Returns:
            True если блокировка получена, False если парсинг уже идет
        """
        r = await self._get_redis()

        lock_data = {
            "book_id": book_id,
            "user_id": user_id,
            "started_at": datetime.now(timezone.utc).timestamp(),
        }

        # Используем SET NX для атомарной операции
        result = await r.set(
            self.parsing_lock_key,
            json.dumps(lock_data),
            nx=True,  # Only set if not exists
            ex=self.lock_timeout,
        )

        if result:
            logger.info(f"Parsing lock acquired for book {book_id}")
            return True
        else:
            logger.warning(f"Failed to acquire parsing lock for book {book_id}")
            return False

    async def release_parsing_lock(self, book_id: str):
        """Освободить блокировку парсинга."""
        r = await self._get_redis()

        # Проверяем, что снимаем правильную блокировку
        lock = await r.get(self.parsing_lock_key)
        if lock:
            lock_data = json.loads(lock)
            if lock_data["book_id"] == book_id:
                await r.delete(self.parsing_lock_key)
                logger.info(f"Parsing lock released for book {book_id}")

    async def add_to_parsing_queue(
        self, book_id: str, user_id: str, priority: int, db: AsyncSession
    ) -> Dict[str, Any]:
        """
        Добавить книгу в очередь парсинга с приоритетом.

        Returns:
            Информация о позиции в очереди
        """
        r = await self._get_redis()

        # Создаем задачу для очереди
        task = {
            "book_id": book_id,
            "user_id": user_id,
            "priority": priority,
            "added_at": datetime.now(timezone.utc).isoformat(),
            "status": "queued",
        }

        # Добавляем в sorted set с приоритетом как score
        # Отрицательный приоритет, чтобы большие значения были первыми
        await r.zadd(self.parsing_queue_key, {json.dumps(task): -priority})

        # Получаем позицию в очереди
        position = await r.zrank(self.parsing_queue_key, json.dumps(task))
        queue_size = await r.zcard(self.parsing_queue_key)

        # Обновляем статус парсинга в Redis
        status_key = self.parsing_status_key.format(book_id=book_id)
        await r.setex(
            status_key,
            3600,  # TTL 1 час
            json.dumps(
                {
                    "status": "queued",
                    "position": position + 1 if position is not None else queue_size,
                    "total_in_queue": queue_size,
                    "progress": 0,
                    "message": f"Position {position + 1 if position is not None else queue_size} of {queue_size} in queue",
                }
            ),
        )

        return {
            "position": position + 1 if position is not None else queue_size,
            "total_in_queue": queue_size,
            "estimated_wait_time": (
                position + 1 if position is not None else queue_size
            )
            * 120,  # ~2 мин на книгу
        }

    async def get_next_from_queue(self) -> Optional[Dict[str, Any]]:
        """
        Получить следующую книгу из очереди для парсинга.

        Returns:
            Задача парсинга или None если очередь пуста
        """
        r = await self._get_redis()

        # Получаем элемент с наивысшим приоритетом
        items = await r.zrange(self.parsing_queue_key, 0, 0)

        if items:
            task_json = items[0]
            # Удаляем из очереди
            await r.zrem(self.parsing_queue_key, task_json)

            task = json.loads(task_json)
            return task

        return None

    async def update_parsing_status(
        self,
        book_id: str,
        status: str,
        progress: int = 0,
        message: str = "",
        chapters_processed: int = 0,
        total_chapters: int = 0,
        descriptions_found: int = 0,
    ):
        """Обновить статус парсинга книги."""
        r = await self._get_redis()

        status_key = self.parsing_status_key.format(book_id=book_id)
        status_data = {
            "status": status,
            "progress": progress,
            "message": message,
            "chapters_processed": chapters_processed,
            "total_chapters": total_chapters,
            "descriptions_found": descriptions_found,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        await r.setex(status_key, 3600, json.dumps(status_data))  # TTL 1 час

        logger.info(
            f"Parsing status updated for book {book_id}: {status} ({progress}%)"
        )

    async def get_parsing_status(self, book_id: str) -> Optional[Dict[str, Any]]:
        """Получить текущий статус парсинга книги."""
        r = await self._get_redis()

        status_key = self.parsing_status_key.format(book_id=book_id)
        status_json = await r.get(status_key)

        if status_json:
            return json.loads(status_json)

        return None

    async def process_parsing_queue(self, db: AsyncSession):
        """
        Обработать очередь парсинга (запускается периодически).

        Этот метод должен вызываться Celery Beat каждую минуту.
        """
        # Проверяем, можно ли начать парсинг
        can_parse, message = await self.can_start_parsing()

        if not can_parse:
            logger.info(f"Cannot start parsing: {message}")
            return

        # Получаем следующую задачу из очереди
        task = await self.get_next_from_queue()

        if not task:
            logger.debug("Parsing queue is empty")
            return

        book_id = task["book_id"]
        user_id = task["user_id"]

        # Пытаемся получить блокировку
        if not await self.acquire_parsing_lock(book_id, user_id):
            # Если не удалось, возвращаем задачу в очередь
            await self.add_to_parsing_queue(book_id, user_id, task["priority"], db)
            return

        try:
            # Запускаем парсинг через Celery
            from ..core.tasks import process_book_task

            logger.info(f"Starting parsing for book {book_id} (user: {user_id})")

            # Обновляем статус
            await self.update_parsing_status(
                book_id,
                status="processing",
                progress=0,
                message="Starting book parsing...",
            )

            # Запускаем асинхронную задачу
            process_book_task.delay(book_id)

        except Exception as e:
            logger.error(f"Error starting parsing for book {book_id}: {e}")
            # Освобождаем блокировку в случае ошибки
            await self.release_parsing_lock(book_id)

            # Обновляем статус
            await self.update_parsing_status(
                book_id, status="error", message=f"Failed to start parsing: {str(e)}"
            )


# Глобальный экземпляр менеджера парсинга
parsing_manager = ParsingManager()

"""
WebSocket Router for real-time book processing progress.

Phase 5: WebSocket Implementation

Features:
- Real-time progress updates for book processing
- Redis PubSub for multi-worker support
- Graceful connection management
- JWT authentication via query param

Usage:
    ws://host/ws/book-progress/{book_id}?token={jwt_token}
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query, HTTPException
from fastapi.websockets import WebSocketState
from typing import Optional, Dict, Any
import asyncio
import json
import logging
from uuid import UUID

from app.core.config import settings
from app.services.auth_service import get_current_user_from_token
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


class ConnectionManager:
    """
    Manages active WebSocket connections per book.
    
    Uses Redis PubSub for cross-worker communication.
    """
    
    def __init__(self):
        self.active_connections: Dict[str, list[WebSocket]] = {}
        self._redis_client = None
        self._pubsub = None
        self._pubsub_task = None
    
    async def _get_redis(self):
        """Lazy initialization of Redis client."""
        if self._redis_client is None:
            import redis.asyncio as aioredis
            self._redis_client = await aioredis.from_url(settings.REDIS_URL)
        return self._redis_client
    
    async def connect(self, book_id: str, websocket: WebSocket) -> bool:
        """Accept and register a WebSocket connection."""
        try:
            await websocket.accept()
            
            if book_id not in self.active_connections:
                self.active_connections[book_id] = []
            self.active_connections[book_id].append(websocket)
            
            logger.info(f"WebSocket connected for book {book_id}, total: {len(self.active_connections[book_id])}")
            return True
        except Exception as e:
            logger.error(f"WebSocket connection failed: {e}")
            return False
    
    def disconnect(self, book_id: str, websocket: WebSocket):
        """Remove WebSocket from active connections."""
        if book_id in self.active_connections:
            if websocket in self.active_connections[book_id]:
                self.active_connections[book_id].remove(websocket)
            if not self.active_connections[book_id]:
                del self.active_connections[book_id]
        logger.info(f"WebSocket disconnected for book {book_id}")
    
    async def send_progress(self, book_id: str, data: Dict[str, Any]):
        """Send progress update to all connected clients for this book."""
        if book_id not in self.active_connections:
            return
        
        message = json.dumps(data)
        disconnected = []
        
        for connection in self.active_connections[book_id]:
            try:
                if connection.client_state == WebSocketState.CONNECTED:
                    await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                disconnected.append(connection)
        
        # Cleanup disconnected sockets
        for conn in disconnected:
            self.disconnect(book_id, conn)
    
    async def broadcast_via_redis(self, book_id: str, data: Dict[str, Any]):
        """Publish progress to Redis for cross-worker distribution."""
        redis = await self._get_redis()
        channel = f"book_progress:{book_id}"
        await redis.publish(channel, json.dumps(data))
    
    async def subscribe_to_book(self, book_id: str):
        """Subscribe to Redis channel for book progress."""
        redis = await self._get_redis()
        pubsub = redis.pubsub()
        channel = f"book_progress:{book_id}"
        await pubsub.subscribe(channel)
        return pubsub
    
    async def listen_to_pubsub(self, pubsub, websocket: WebSocket, book_id: str):
        """Listen to Redis PubSub and forward messages to WebSocket."""
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    try:
                        if websocket.client_state == WebSocketState.CONNECTED:
                            # Redis PubSub returns bytes, decode to str
                            data = message["data"]
                            if isinstance(data, bytes):
                                data = data.decode('utf-8')
                            
                            logger.info(f"Forwarding PubSub message to WebSocket: {data[:100]}...")
                            await websocket.send_text(data)
                    except Exception as e:
                        logger.error(f"Error forwarding message: {e}")
                        break
        except Exception as e:
            logger.error(f"PubSub listener error: {e}")
        finally:
            await pubsub.unsubscribe(f"book_progress:{book_id}")


# Global connection manager
manager = ConnectionManager()


async def get_user_from_ws_token(token: str) -> Optional[User]:
    """Validate JWT token from WebSocket query param."""
    try:
        user = await get_current_user_from_token(token)
        return user
    except Exception as e:
        logger.warning(f"WebSocket auth failed: {e}")
        return None


@router.websocket("/book-progress/{book_id}")
async def websocket_book_progress(
    websocket: WebSocket,
    book_id: str,
    token: str = Query(None)
):
    """
    WebSocket endpoint for real-time book processing progress.
    
    Query params:
        token: JWT access token for authentication
    
    Message format (server -> client):
        {
            "type": "progress" | "completed" | "error" | "ping",
            "book_id": "uuid",
            "progress": 0-100,
            "chapter": 1,
            "total_chapters": 10,
            "status": "processing" | "completed" | "failed",
            "message": "Optional status message"
        }
    
    Message format (client -> server):
        {
            "type": "ping" | "cancel"
        }
    """
    # Validate UUID
    try:
        book_uuid = UUID(book_id)
    except ValueError:
        await websocket.close(code=4000, reason="Invalid book ID")
        return
    
    # Authenticate
    if not token:
        await websocket.close(code=4001, reason="Token required")
        return
    
    user = await get_user_from_ws_token(token)
    if not user:
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    # Connect
    if not await manager.connect(book_id, websocket):
        return
    
    # Subscribe to Redis PubSub for this book
    pubsub = await manager.subscribe_to_book(book_id)
    
    # Create listener task
    listener_task = asyncio.create_task(
        manager.listen_to_pubsub(pubsub, websocket, book_id)
    )
    
    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "book_id": book_id,
            "message": "Subscribed to progress updates"
        })
        
        # Handle incoming messages (ping/pong, cancel)
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=30.0  # Send ping every 30s
                )
                
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif data.get("type") == "cancel":
                    # Forward cancel request (implementation in tasks.py)
                    logger.info(f"Cancel request received for book {book_id}")
                    await websocket.send_json({
                        "type": "cancel_ack",
                        "message": "Cancel request received"
                    })
                    
            except asyncio.TimeoutError:
                # Send keepalive ping
                if websocket.client_state == WebSocketState.CONNECTED:
                    await websocket.send_json({"type": "ping"})
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected normally for book {book_id}")
    except Exception as e:
        logger.error(f"WebSocket error for book {book_id}: {e}")
    finally:
        listener_task.cancel()
        manager.disconnect(book_id, websocket)
        try:
            await pubsub.close()
        except Exception as e:
            logger.debug(f"Error closing pubsub: {e}")


# Helper function to publish progress from tasks.py
async def publish_book_progress(
    book_id: str,
    progress: int,
    chapter: int = 0,
    total_chapters: int = 0,
    status: str = "processing",
    message: str = ""
):
    """
    Publish book processing progress to Redis PubSub.
    
    Called from tasks.py during book processing.
    
    Args:
        book_id: Book UUID string
        progress: 0-100 percent
        chapter: Current chapter number
        total_chapters: Total chapters in book
        status: "processing", "completed", "failed"
        message: Optional status message
    """
    try:
        import redis.asyncio as aioredis
        redis_client = await aioredis.from_url(settings.REDIS_URL)
        
        data = {
            "type": "progress",
            "book_id": book_id,
            "progress": progress,
            "chapter": chapter,
            "total_chapters": total_chapters,
            "status": status,
            "message": message
        }
        
        channel = f"book_progress:{book_id}"
        await redis_client.publish(channel, json.dumps(data))
        await redis_client.close()
        
    except Exception as e:
        logger.warning(f"Failed to publish progress: {e}")

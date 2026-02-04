"""
VLESS Proxy-aware HTTP Client для fancai

Этот модуль предоставляет умный HTTP клиент, который автоматически
использует VLESS прокси для определенных доменов.

Использование:
    from app.services.vless_http_client import get_http_client

    async with get_http_client() as client:
        response = await client.get('https://pollinations.ai/api/health')
        data = response.json()
"""

import httpx
import os
from typing import Optional, Any, List
from urllib.parse import urlparse

from app.core.logging import logger


class VLESSHTTPClient:
    """
    HTTP клиент с поддержкой VLESS прокси.

    Автоматически использует прокси для определенных доменов,
    остальные запросы идут напрямую.
    """

    def __init__(
        self,
        use_proxy: bool = True,
        proxy_required_domains: Optional[List[str]] = None,
        http_proxy_url: Optional[str] = None,
        socks5_proxy_url: Optional[str] = None,
        timeout: float = 30.0,
    ):
        """
        Инициализация HTTP клиента.

        Args:
            use_proxy: Использовать ли прокси (можно отключить через env)
            proxy_required_domains: Домены, требующие прокси
            http_proxy_url: URL HTTP прокси (default: http://vless-proxy:8123)
            socks5_proxy_url: URL SOCKS5 прокси (default: socks5://vless-proxy:1080)
            timeout: Таймаут запросов в секундах
        """
        # Проверка feature flag
        self.use_proxy = (
            use_proxy and os.getenv("USE_VLESS_PROXY", "true").lower() == "true"
        )

        # Домены, требующие прокси
        if proxy_required_domains is None:
            domains_str = os.getenv(
                "PROXY_REQUIRED_DOMAINS", "pollinations.ai,api.openai.com"
            )
            self.proxy_required_domains = [d.strip() for d in domains_str.split(",")]
        else:
            self.proxy_required_domains = proxy_required_domains

        # URL прокси
        self.http_proxy_url = http_proxy_url or os.getenv(
            "HTTP_PROXY", "http://vless-proxy:8123"
        )
        self.socks5_proxy_url = socks5_proxy_url or os.getenv(
            "SOCKS5_PROXY", "socks5://vless-proxy:1080"
        )

        # Таймаут
        self.timeout = timeout

        # Создание клиентов
        self._proxy_client: Optional[httpx.AsyncClient] = None
        self._direct_client: Optional[httpx.AsyncClient] = None

        logger.info(
            "VLESSHTTPClient initialized",
            use_proxy=self.use_proxy,
            proxy_domains=self.proxy_required_domains,
        )

    async def __aenter__(self):
        """Асинхронный контекстный менеджер (вход)."""
        # Прокси клиент (HTTP прокси)
        if self.use_proxy:
            self._proxy_client = httpx.AsyncClient(
                proxies={"all://": self.http_proxy_url},
                timeout=self.timeout,
                follow_redirects=True,
            )
            logger.debug("Proxy client initialized", proxy_url=self.http_proxy_url)

        # Прямой клиент (без прокси)
        self._direct_client = httpx.AsyncClient(
            timeout=self.timeout,
            follow_redirects=True,
        )
        logger.debug("Direct client initialized")

        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Асинхронный контекстный менеджер (выход)."""
        if self._proxy_client:
            await self._proxy_client.aclose()
        if self._direct_client:
            await self._direct_client.aclose()

    def _should_use_proxy(self, url: str) -> bool:
        """
        Определяет, нужно ли использовать прокси для данного URL.

        Args:
            url: URL для проверки

        Returns:
            True если нужно использовать прокси, False иначе
        """
        if not self.use_proxy:
            return False

        domain = urlparse(url).netloc

        # Проверка, входит ли домен в список прокси-доменов
        for required_domain in self.proxy_required_domains:
            if required_domain in domain:
                logger.debug("Using proxy for domain", domain=domain)
                return True

        logger.debug("Direct connection for domain", domain=domain)
        return False

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """
        Выполняет HTTP запрос (с прокси или напрямую).

        Args:
            method: HTTP метод (GET, POST, PUT, DELETE, etc.)
            url: URL для запроса
            **kwargs: Дополнительные параметры для httpx.request()

        Returns:
            httpx.Response объект

        Raises:
            httpx.HTTPError: При ошибках HTTP запроса
        """
        # Выбор клиента (прокси или прямой)
        if self._should_use_proxy(url):
            client = self._proxy_client
            if client is None:
                raise RuntimeError(
                    "Proxy client not initialized. Use 'async with' context manager."
                )
        else:
            client = self._direct_client
            if client is None:
                raise RuntimeError(
                    "Direct client not initialized. Use 'async with' context manager."
                )

        # Выполнение запроса
        try:
            response = await client.request(method, url, **kwargs)
            logger.debug(
                "HTTP request completed",
                method=method,
                url=url,
                status=response.status_code,
            )
            return response
        except httpx.HTTPError as e:
            logger.error("HTTP error", method=method, url=url, error=str(e))
            raise

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        """GET запрос."""
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        """POST запрос."""
        return await self.request("POST", url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        """PUT запрос."""
        return await self.request("PUT", url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        """DELETE запрос."""
        return await self.request("DELETE", url, **kwargs)

    async def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        """PATCH запрос."""
        return await self.request("PATCH", url, **kwargs)


# Singleton instance (для переиспользования)
_http_client: Optional[VLESSHTTPClient] = None


def get_http_client() -> VLESSHTTPClient:
    """
    Возвращает singleton instance HTTP клиента.

    Returns:
        VLESSHTTPClient instance

    Example:
        async with get_http_client() as client:
            response = await client.get('https://pollinations.ai/api/health')
            data = response.json()
    """
    global _http_client
    if _http_client is None:
        _http_client = VLESSHTTPClient()
    return _http_client


# Пример использования
async def example_usage():
    """Пример использования VLESSHTTPClient."""

    # Вариант 1: Context manager (рекомендуется)
    async with get_http_client() as client:
        # Этот запрос пойдет через прокси (pollinations.ai в списке прокси-доменов)
        response = await client.get("https://pollinations.ai/api/health")
        logger.info("Pollinations health", response=response.json())

        # Этот запрос пойдет напрямую (example.com не в списке)
        response = await client.get("https://example.com")
        logger.info("Example.com status", status_code=response.status_code)

    # Вариант 2: POST запрос с JSON
    async with get_http_client() as client:
        response = await client.post(
            "https://pollinations.ai/api/v1/generate",
            json={"prompt": "A beautiful sunset over mountains"},
            headers={"Content-Type": "application/json"},
        )
        image_data = response.json()
        logger.info("Generated image", data=image_data)

    # Вариант 3: Custom конфигурация
    custom_client = VLESSHTTPClient(
        use_proxy=True,
        proxy_required_domains=["api.openai.com", "custom-api.example.com"],
        timeout=60.0,
    )

    async with custom_client as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": "Bearer sk-..."},
            json={
                "model": "gpt-4",
                "messages": [{"role": "user", "content": "Hello!"}],
            },
        )
        chat_response = response.json()
        logger.info("OpenAI response", response=chat_response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(example_usage())

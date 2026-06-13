# Исследование VLESS Proxy решений для fancai
**Дата:** 2025-11-30
**Цель:** Найти оптимальное решение для проксирования HTTP запросов через VLESS протокол в Docker окружении

---

## Executive Summary

**Рекомендация:** Использовать **Xray-core** в отдельном Docker контейнере с образом **samuelhbne/proxy-xray**

**Ключевые преимущества:**
- ✅ Готовый Docker образ с минимальной конфигурацией
- ✅ Поддержка SOCKS5 (порт 1080) + HTTP proxy (порт 8123)
- ✅ Поддержка VLESS-TCP-REALITY-XTLS (современный протокол)
- ✅ Малый footprint (~50-70 MB RAM)
- ✅ Работает на x86/arm/arm64 (включая Raspberry Pi)
- ✅ Встроенная поддержка QR кодов для конфигурации

---

## 1. Сравнение VLESS клиентов

### 1.1 Xray-core

**Описание:** Fork v2fly-core с множеством улучшений и поддержкой XTLS протокола

**Технические характеристики:**
- Протоколы: VMess, VLESS, Shadowsocks, Trojan, WireGuard, SOCKS, HTTP
- XTLS/REALITY: ✅ Да (эксклюзивная функция)
- Память: ~50-70 MB
- Поддержка KCP/XHTTP: ✅ Да
- Docker образы: `teddysun/xray`, `samuelhbne/proxy-xray`

**Преимущества:**
- Лучшая совместимость с REALITY протоколом
- Активная разработка (XTLS Project)
- Зрелый проект с большим community
- Отличная документация

**Недостатки:**
- Больше памяти чем sing-box
- Не поддерживает Hysteria2/TUIC

**Оценка:** ⭐⭐⭐⭐⭐ (5/5) - **Рекомендуется**

---

### 1.2 sing-box

**Описание:** Легковесная альтернатива с фокусом на производительность

**Технические характеристики:**
- Протоколы: VMess, VLESS, Shadowsocks, Trojan, Hysteria2, TUIC, WireGuard, SOCKS, HTTP
- XTLS/REALITY: ✅ Да
- Память: ~35 MB (самый легковесный!)
- Поддержка Hysteria2/TUIC: ✅ Да
- Docker образы: `itdoginfo/sing-box`, custom builds

**Преимущества:**
- Минимальное потребление памяти (35 MB)
- Лучшая производительность в бенчмарках
- Поддержка современных протоколов (Hysteria2, TUIC)
- Модульная архитектура

**Недостатки:**
- Не поддерживает KCP/XHTTP
- Меньше готовых Docker образов
- Сообщения о memory leaks в ранних версиях (1.2.7-1.3.0)
- Менее зрелый проект

**Оценка:** ⭐⭐⭐⭐ (4/5) - Хорошая альтернатива

---

### 1.3 v2ray-core (v2fly)

**Описание:** Оригинальный v2ray проект (предшественник Xray)

**Технические характеристики:**
- Протоколы: VMess, VLESS, Shadowsocks, Trojan, SOCKS, HTTP
- XTLS/REALITY: ❌ Нет
- Память: ~240+ MB
- Docker образы: `v2fly/v2fly-core`

**Преимущества:**
- Стабильный проект
- Широкая поддержка клиентов

**Недостатки:**
- Большое потребление памяти (240+ MB)
- Не поддерживает XTLS/REALITY
- Устаревающий (сообщество мигрирует на Xray)

**Оценка:** ⭐⭐⭐ (3/5) - Не рекомендуется

---

## 2. Анализ nginx для VLESS

### 2.1 Поддерживает ли nginx VLESS?

**Ответ:** ❌ **Нет, напрямую не поддерживает**

**Пояснение:**
- VLESS - это протокол прикладного уровня (application-layer protocol)
- nginx работает на уровне HTTP/HTTPS и TCP/UDP (stream module)
- nginx **НЕ** понимает VLESS протокол

### 2.2 Как nginx используется с VLESS?

nginx может выступать как **SNI router** (L4 load balancer) для перенаправления трафика:

```nginx
# nginx stream module (L4 routing)
stream {
    map $ssl_preread_server_name $backend {
        vless.example.com  127.0.0.1:8443;  # Xray VLESS server
        web.example.com    127.0.0.1:8080;  # Web application
    }

    server {
        listen 443;
        ssl_preread on;
        proxy_pass $backend;
    }
}
```

**Вывод:** nginx может маршрутизировать трафик к VLESS серверу по SNI, но **НЕ** может быть VLESS клиентом/прокси.

---

## 3. Рекомендуемая архитектура для fancai

### 3.1 Вариант 1: Отдельный Docker контейнер (✅ РЕКОМЕНДУЕТСЯ)

**Архитектура:**
```
┌─────────────────────────────────────────────┐
│  fancai Docker Compose Stack        │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐      ┌──────────────┐   │
│  │   Backend    │─────▶│  VLESS Proxy │   │
│  │  (FastAPI)   │ HTTP │  (Xray-core) │   │
│  │              │ req  │   SOCKS5/    │   │
│  │              │      │   HTTP proxy │   │
│  └──────────────┘      └──────┬───────┘   │
│                                │            │
│                                │ VLESS      │
│                                │ protocol   │
│                                ▼            │
│                         Internet (VPN)      │
└─────────────────────────────────────────────┘
```

**Docker Compose конфигурация:**

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    environment:
      # Использовать SOCKS5 прокси для outbound HTTP запросов
      - HTTP_PROXY=http://vless-proxy:8123
      - HTTPS_PROXY=http://vless-proxy:8123
      # Альтернатива: SOCKS5
      # - ALL_PROXY=socks5://vless-proxy:1080
    depends_on:
      - vless-proxy
    networks:
      - backend-network

  vless-proxy:
    image: samuelhbne/proxy-xray:latest
    container_name: vless-proxy
    restart: always
    command: >
      --cn-direct --dns-local-cn
      --ltrx ${VLESS_UUID}@${VLESS_SERVER}:${VLESS_PORT},d=${VLESS_FAKE_DOMAIN},pub=${VLESS_PUBLIC_KEY}
    ports:
      - "127.0.0.1:1080:1080"     # SOCKS5 proxy (только localhost)
      - "127.0.0.1:8123:8123"     # HTTP proxy (только localhost)
      - "127.0.0.1:53:53/udp"     # DNS (опционально)
    networks:
      - backend-network
    healthcheck:
      test: ["CMD", "curl", "-f", "-x", "socks5h://127.0.0.1:1080", "https://www.google.com"]
      interval: 60s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 128M
        reservations:
          memory: 64M

networks:
  backend-network:
    driver: bridge
```

**Переменные окружения (.env.production):**
```bash
# VLESS Proxy Configuration
VLESS_UUID=your-uuid-here
VLESS_SERVER=your-vless-server.com
VLESS_PORT=443
VLESS_FAKE_DOMAIN=yahoo.com
VLESS_PUBLIC_KEY=your-public-key-here
```

**Преимущества:**
- ✅ Изоляция: VLESS прокси изолирован от backend
- ✅ Масштабируемость: Легко добавить новые сервисы
- ✅ Безопасность: Порты прокси не экспонированы наружу (127.0.0.1)
- ✅ Мониторинг: Health checks для контроля доступности
- ✅ Управление ресурсами: CPU/Memory limits
- ✅ Переиспользование: Другие сервисы могут использовать прокси

**Недостатки:**
- Дополнительный контейнер (но минимальный overhead ~64 MB)

---

### 3.2 Вариант 2: VLESS клиент внутри backend контейнера (❌ НЕ РЕКОМЕНДУЕТСЯ)

**Архитектура:**
```
┌─────────────────────────────┐
│   Backend Container         │
├─────────────────────────────┤
│  ┌──────────────┐           │
│  │   FastAPI    │           │
│  │  Application │           │
│  └──────┬───────┘           │
│         │ HTTP requests     │
│         ▼                   │
│  ┌──────────────┐           │
│  │ Xray binary  │           │
│  │ (VLESS proxy)│           │
│  └──────┬───────┘           │
└─────────┼───────────────────┘
          │ VLESS protocol
          ▼
      Internet (VPN)
```

**Dockerfile (backend):**
```dockerfile
FROM python:3.11-slim

# Установка Xray
RUN apt-get update && apt-get install -y curl unzip && \
    curl -L https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip -o xray.zip && \
    unzip xray.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/xray && \
    rm xray.zip

# Копирование Xray config
COPY xray-config.json /etc/xray/config.json

# Копирование application code
COPY . /app
WORKDIR /app

# Установка Python зависимостей
RUN pip install -r requirements.txt

# Supervisor для запуска двух процессов
RUN apt-get install -y supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

CMD ["/usr/bin/supervisord"]
```

**Недостатки:**
- ❌ Нарушение Single Responsibility Principle (два процесса в одном контейнере)
- ❌ Сложнее отладка (логи смешаны)
- ❌ Сложнее масштабирование (нельзя масштабировать прокси отдельно)
- ❌ Больший размер образа
- ❌ Supervisor overhead

**Преимущества:**
- Меньше контейнеров (но это антипаттерн)

---

## 4. Конфигурационные примеры

### 4.1 Python код для использования SOCKS5/HTTP прокси

**Вариант 1: requests с HTTP прокси**
```python
# backend/app/services/image_generation.py

import requests
import os

class ImageGenerationService:
    def __init__(self):
        # Автоматически используется из переменных окружения
        # HTTP_PROXY, HTTPS_PROXY
        self.session = requests.Session()

        # Или явно:
        self.proxies = {
            'http': os.getenv('HTTP_PROXY', 'http://vless-proxy:8123'),
            'https': os.getenv('HTTPS_PROXY', 'http://vless-proxy:8123'),
        }

    async def generate_image(self, prompt: str):
        response = self.session.post(
            'https://pollinations.ai/api/v1/generate',
            json={'prompt': prompt},
            proxies=self.proxies,  # Использовать прокси
            timeout=30
        )
        return response.json()
```

**Вариант 2: aiohttp с SOCKS5 прокси**
```python
# Установить: pip install aiohttp aiohttp-socks

from aiohttp import ClientSession
from aiohttp_socks import ProxyConnector
import os

class ImageGenerationService:
    async def generate_image(self, prompt: str):
        # SOCKS5 прокси
        connector = ProxyConnector.from_url(
            os.getenv('SOCKS5_PROXY', 'socks5://vless-proxy:1080')
        )

        async with ClientSession(connector=connector) as session:
            async with session.post(
                'https://pollinations.ai/api/v1/generate',
                json={'prompt': prompt},
                timeout=30
            ) as response:
                return await response.json()
```

**Вариант 3: httpx (современная альтернатива)**
```python
# Установить: pip install httpx[socks]

import httpx
import os

class ImageGenerationService:
    async def generate_image(self, prompt: str):
        # Поддержка HTTP и SOCKS5
        proxies = {
            'http://': os.getenv('HTTP_PROXY', 'http://vless-proxy:8123'),
            'https://': os.getenv('HTTPS_PROXY', 'http://vless-proxy:8123'),
        }

        async with httpx.AsyncClient(proxies=proxies) as client:
            response = await client.post(
                'https://pollinations.ai/api/v1/generate',
                json={'prompt': prompt},
                timeout=30.0
            )
            return response.json()
```

---

### 4.2 Xray config.json (reference)

Если потребуется custom конфигурация Xray:

```json
{
  "log": {
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "port": 1080,
      "protocol": "socks",
      "settings": {
        "auth": "noauth",
        "udp": true
      },
      "tag": "socks-in"
    },
    {
      "port": 8123,
      "protocol": "http",
      "tag": "http-in"
    }
  ],
  "outbounds": [
    {
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "your-vless-server.com",
            "port": 443,
            "users": [
              {
                "id": "your-uuid-here",
                "encryption": "none",
                "flow": "xtls-rprx-vision"
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "serverName": "yahoo.com",
          "publicKey": "your-public-key-here",
          "shortId": "",
          "spiderX": ""
        }
      },
      "tag": "vless-out"
    }
  ],
  "routing": {
    "rules": [
      {
        "type": "field",
        "inboundTag": ["socks-in", "http-in"],
        "outboundTag": "vless-out"
      }
    ]
  }
}
```

---

## 5. Тестирование и мониторинг

### 5.1 Проверка работы VLESS прокси

**Health check скрипт:**
```bash
#!/bin/bash
# scripts/check-vless-proxy.sh

echo "Testing SOCKS5 proxy..."
curl -x socks5h://127.0.0.1:1080 https://checkip.amazonaws.com
SOCKS5_EXIT_CODE=$?

echo "Testing HTTP proxy..."
curl -x http://127.0.0.1:8123 https://checkip.amazonaws.com
HTTP_EXIT_CODE=$?

if [ $SOCKS5_EXIT_CODE -eq 0 ] && [ $HTTP_EXIT_CODE -eq 0 ]; then
    echo "✅ VLESS proxy is working!"
    exit 0
else
    echo "❌ VLESS proxy failed!"
    exit 1
fi
```

### 5.2 Мониторинг через Prometheus

**Prometheus exporter для Xray:**
```yaml
# docker-compose.monitoring.yml
services:
  xray-exporter:
    image: wi1dcard/xray-exporter:latest
    command:
      - --xray-api-endpoint=vless-proxy:8080
    depends_on:
      - vless-proxy
    networks:
      - monitoring
```

**Grafana dashboard метрики:**
- Uptime прокси
- Количество активных соединений
- Throughput (bytes in/out)
- Error rate

---

## 6. Сценарии использования

### 6.1 Conditional Proxy (только для определенных запросов)

Если нужно использовать прокси только для **pollinations.ai**, а остальные запросы напрямую:

```python
# backend/app/core/config.py
from pydantic import BaseSettings

class Settings(BaseSettings):
    # Домены, требующие прокси
    PROXY_REQUIRED_DOMAINS: list[str] = ['pollinations.ai', 'api.openai.com']

    # VLESS proxy URLs
    HTTP_PROXY: str = 'http://vless-proxy:8123'
    SOCKS5_PROXY: str = 'socks5://vless-proxy:1080'

settings = Settings()

# backend/app/services/http_client.py
import httpx
from app.core.config import settings
from urllib.parse import urlparse

class SmartHTTPClient:
    def __init__(self):
        self.proxy_client = httpx.AsyncClient(
            proxies={'all://': settings.HTTP_PROXY}
        )
        self.direct_client = httpx.AsyncClient()

    async def request(self, method: str, url: str, **kwargs):
        domain = urlparse(url).netloc

        # Использовать прокси только для определенных доменов
        if any(d in domain for d in settings.PROXY_REQUIRED_DOMAINS):
            return await self.proxy_client.request(method, url, **kwargs)
        else:
            return await self.direct_client.request(method, url, **kwargs)

    async def close(self):
        await self.proxy_client.aclose()
        await self.direct_client.aclose()
```

---

## 7. Безопасность

### 7.1 Рекомендации по безопасности

1. **Не экспонировать порты прокси наружу:**
   ```yaml
   ports:
     - "127.0.0.1:1080:1080"  # ✅ Только localhost
     # - "0.0.0.0:1080:1080"  # ❌ Опасно!
   ```

2. **Использовать secrets для конфигурации:**
   ```yaml
   # docker-compose.yml
   services:
     vless-proxy:
       environment:
         - VLESS_UUID_FILE=/run/secrets/vless_uuid
       secrets:
         - vless_uuid

   secrets:
     vless_uuid:
       external: true
   ```

3. **Ограничить ресурсы контейнера:**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '0.5'
         memory: 128M
   ```

4. **Логирование только ошибок (не весь трафик):**
   ```json
   {
     "log": {
       "loglevel": "warning"  // ✅ warning/error только
       // "loglevel": "debug"  // ❌ Не в production!
     }
   }
   ```

---

## 8. Сравнительная таблица решений

| Критерий | Xray-core | sing-box | v2ray-core | Nginx |
|----------|-----------|----------|------------|-------|
| **VLESS поддержка** | ✅ Полная | ✅ Полная | ✅ Полная | ❌ Нет |
| **REALITY** | ✅ Да | ✅ Да | ❌ Нет | ❌ Нет |
| **Память (MB)** | ~70 | ~35 | ~240 | N/A |
| **SOCKS5** | ✅ Да | ✅ Да | ✅ Да | ❌ Нет |
| **HTTP Proxy** | ✅ Да | ✅ Да | ✅ Да | ✅ Да (не VLESS) |
| **Docker образы** | ✅ Много | ⚠️ Мало | ✅ Есть | ✅ Есть |
| **Документация** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Community** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Стабильность** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Рекомендация** | ✅ **ДА** | ⚠️ Альтернатива | ❌ Нет | ❌ Нет (для VLESS) |

---

## 9. Итоговая рекомендация

### Выбранное решение: Xray-core в отдельном контейнере

**Docker образ:** `samuelhbne/proxy-xray:latest`

**Почему Xray-core:**
1. ✅ Лучшая поддержка REALITY (эксклюзивный протокол)
2. ✅ Зрелый проект с активным развитием
3. ✅ Готовый Docker образ с минимальной конфигурацией
4. ✅ Отличная документация и большое сообщество
5. ✅ Малое потребление ресурсов (~70 MB)

**Почему отдельный контейнер:**
1. ✅ Следование Docker best practices (один процесс = один контейнер)
2. ✅ Изоляция и безопасность
3. ✅ Легкое масштабирование
4. ✅ Простота отладки
5. ✅ Переиспользование (другие сервисы могут использовать прокси)

**Почему НЕ nginx:**
- ❌ nginx не поддерживает VLESS протокол
- ❌ nginx может быть только SNI router, но не VLESS клиентом

**Почему НЕ sing-box (пока):**
- ⚠️ Меньше готовых Docker образов
- ⚠️ Сообщения о memory leaks в ранних версиях
- ⚠️ Менее зрелое сообщество
- ✅ Можно рассмотреть как альтернативу в будущем (меньше памяти)

---

## 10. План внедрения

### Фаза 1: Proof of Concept (1-2 часа)
1. ✅ Добавить `vless-proxy` сервис в docker-compose.yml
2. ✅ Настроить переменные окружения
3. ✅ Протестировать подключение (curl через прокси)

### Фаза 2: Backend Integration (2-3 часа)
1. ✅ Обновить `backend/requirements.txt` (добавить httpx[socks] или aiohttp-socks)
2. ✅ Создать `SmartHTTPClient` для conditional proxy
3. ✅ Обновить `ImageGenerationService` для использования прокси
4. ✅ Добавить unit tests

### Фаза 3: Monitoring & Production (2-3 часа)
1. ✅ Добавить health checks для vless-proxy
2. ✅ Настроить Prometheus metrics (опционально)
3. ✅ Обновить документацию
4. ✅ Деплой в production с feature flag

### Фаза 4: Optimization (опционально)
1. ⚠️ Оценить sing-box как альтернативу (если нужно экономить память)
2. ⚠️ Настроить routing rules (bypass для локального трафика)
3. ⚠️ Добавить fallback механизм (если прокси недоступен)

---

## 11. Референсы и источники

### Документация
- [Xray-core GitHub](https://github.com/XTLS/Xray-core)
- [samuelhbne/proxy-xray Docker Hub](https://github.com/samuelhbne/proxy-xray)
- [sing-box Official Docs](https://sing-box.sagernet.org/)
- [VLESS Protocol Specification](https://xtls.github.io/en/config/outbound/vless.html)

### Статьи и гайды
- [Xray with Nginx over VLESS](https://j3ffyang.medium.com/xray-with-nginx-over-vless-63e9af97b192)
- [Quick guide to setting up a VLESS Reality Proxy server](https://vless.dev/)
- [Bypassing censorship on OpenWRT using Sing-box](https://andrevi.ch/2024/04/14/bypassing-censorship-on-openwrt-using-sing-box-vless-vmess-trojan-ss2022-and-geoip-geosite-databases/)

### Сравнения
- [Comparison with xray-core (sing-box issue)](https://github.com/SagerNet/sing-box/issues/838)
- [Xray Core vs Sing-box Discussion](https://github.com/SagerNet/sing-box/issues/586)
- [Why Sing-Box?](https://vpnrouter.homes/singbox/)

### Инструменты
- [reality-ezpz](https://github.com/aleskxyz/reality-ezpz) - One-command install для sing-box/xray
- [3X-UI Panel](https://hostkey.com/blog/54-personal-shadowsocksxray-xtls-vpn-server-with-3x-ui-control-panel/) - Графический UI для управления

---

## 12. Примеры использования

### Пример 1: Базовый VLESS-TCP-REALITY setup

```bash
# .env.production
VLESS_UUID=b8c8e24e-4f61-4c9a-9f3a-7d8e6f5a4b3c
VLESS_SERVER=your-server.example.com
VLESS_PORT=443
VLESS_FAKE_DOMAIN=yahoo.com
VLESS_PUBLIC_KEY=qAaJnTE_zYWNuXuIdlpIfSt5beveuV4PyBaP76WE7jU
```

```bash
# Запуск
docker-compose up -d vless-proxy

# Тестирование
curl -x socks5h://127.0.0.1:1080 https://checkip.amazonaws.com
curl -x http://127.0.0.1:8123 https://api.pollinations.ai/health

# Логи
docker-compose logs -f vless-proxy
```

### Пример 2: Использование в Python коде

```python
# backend/app/services/image_generation.py
import httpx
from app.core.config import settings

async def generate_image_via_proxy(prompt: str):
    async with httpx.AsyncClient(
        proxies={'all://': settings.HTTP_PROXY},
        timeout=30.0
    ) as client:
        response = await client.post(
            'https://pollinations.ai/api/v1/generate',
            json={'prompt': prompt}
        )
        return response.json()
```

---

## Версия документа

- **v1.0** (2025-11-30) - Первичное исследование и рекомендации
- **Автор:** DevOps Engineer Agent (Claude Code)
- **Статус:** ✅ Ready for implementation

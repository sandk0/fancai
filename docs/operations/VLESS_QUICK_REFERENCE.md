# VLESS Proxy - Краткая справка

**Быстрый доступ к командам и конфигурациям для VLESS прокси**

---

## 🚀 Quick Start (Копируй-Вставляй)

### 1. Добавить в .env.production

```bash
# VLESS Proxy
USE_VLESS_PROXY=true
VLESS_UUID=YOUR_UUID_HERE
VLESS_SERVER=your-server.example.com
VLESS_PORT=443
VLESS_FAKE_DOMAIN=yahoo.com
VLESS_PUBLIC_KEY=YOUR_PUBLIC_KEY_HERE
PROXY_REQUIRED_DOMAINS=pollinations.ai,api.openai.com
```

### 2. Запуск

```bash
docker-compose -f docker-compose.yml -f docker-compose.vless-proxy.yml up -d
```

### 3. Тест

```bash
curl -x http://127.0.0.1:8123 https://checkip.amazonaws.com
```

---

## 📋 Команды

| Действие | Команда |
|----------|---------|
| **Запустить прокси** | `docker-compose up -d vless-proxy` |
| **Остановить прокси** | `docker-compose stop vless-proxy` |
| **Перезапустить** | `docker-compose restart vless-proxy` |
| **Логи (real-time)** | `docker-compose logs -f vless-proxy` |
| **Статус** | `docker-compose ps vless-proxy` |
| **Health check** | `docker inspect bookreader-vless-proxy \| grep Health` |
| **QR код конфига** | `docker exec -it bookreader-vless-proxy /qrcode` |
| **Зайти в контейнер** | `docker-compose exec vless-proxy sh` |

---

## 🧪 Тестирование

| Тест | Команда |
|------|---------|
| **SOCKS5 прокси** | `curl -x socks5h://127.0.0.1:1080 https://checkip.amazonaws.com` |
| **HTTP прокси** | `curl -x http://127.0.0.1:8123 https://checkip.amazonaws.com` |
| **Pollinations.ai** | `curl -x http://127.0.0.1:8123 https://pollinations.ai/api/health` |
| **Из backend** | `docker-compose exec backend curl -x http://vless-proxy:8123 https://www.google.com` |
| **Python скрипт** | `docker-compose exec backend python scripts/test_vless_proxy.py` |

---

## 🔧 Конфигурация

### Порты

| Порт | Протокол | Описание |
|------|----------|----------|
| **1080** | SOCKS5 | SOCKS5 прокси (TCP/UDP) |
| **8123** | HTTP | HTTP/HTTPS прокси |
| **53** | DNS | DNS resolver (опционально) |

### Docker Compose Override

```yaml
# docker-compose.override.yml
services:
  vless-proxy:
    environment:
      - VLESS_LOG_LEVEL=debug  # Для отладки
```

---

## 🐍 Python Использование

### Вариант 1: VLESSHTTPClient (рекомендуется)

```python
from app.services.vless_http_client import get_http_client

async with get_http_client() as client:
    response = await client.get('https://pollinations.ai/api/health')
    data = response.json()
```

### Вариант 2: httpx напрямую

```python
import httpx

proxies = {'all://': 'http://vless-proxy:8123'}
async with httpx.AsyncClient(proxies=proxies) as client:
    response = await client.get('https://pollinations.ai/api/health')
```

### Вариант 3: aiohttp + aiohttp-socks

```python
from aiohttp_socks import ProxyConnector
import aiohttp

connector = ProxyConnector.from_url('socks5://vless-proxy:1080')
async with aiohttp.ClientSession(connector=connector) as session:
    async with session.get('https://pollinations.ai/api/health') as resp:
        data = await resp.json()
```

---

## 🔍 Troubleshooting

| Проблема | Решение |
|----------|---------|
| **Connection refused** | `docker-compose logs vless-proxy` → проверить ошибки |
| **Timeout** | Проверить VLESS_SERVER доступность: `ping your-server.com` |
| **403 Forbidden** | Обновить VLESS_FAKE_DOMAIN на более популярный домен |
| **Медленно** | Проверить latency: `docker exec vless-proxy ping -c 5 $VLESS_SERVER` |
| **Health check failed** | `docker inspect bookreader-vless-proxy` → проверить статус |

---

## 📊 Мониторинг

### Prometheus Metrics

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'xray-proxy'
    static_configs:
      - targets: ['xray-exporter:9550']
```

### Grafana Queries

```promql
# Uptime
xray_up

# Active connections
xray_connections_active

# Traffic (MB)
rate(xray_traffic_downlink_bytes_total[5m]) / 1024 / 1024
```

---

## 🔐 Безопасность

### ✅ Best Practices

- ✅ Bind порты на `127.0.0.1` (не `0.0.0.0`)
- ✅ Использовать Docker secrets для credentials
- ✅ Ограничить CPU/Memory (см. docker-compose)
- ✅ Логировать только ошибки (не весь трафик)
- ✅ Feature flag для быстрого отключения

### ❌ НЕ делать

- ❌ Хранить credentials в git
- ❌ Экспонировать прокси порты наружу
- ❌ Использовать `loglevel: debug` в production
- ❌ Запускать без health checks

---

## 📦 Сравнение решений

| Решение | Память | Протоколы | Рекомендация |
|---------|--------|-----------|--------------|
| **Xray-core** | ~70 MB | VLESS, VMess, XTLS, REALITY | ✅ **Да** |
| **sing-box** | ~35 MB | + Hysteria2, TUIC | ⚠️ Альтернатива |
| **v2ray-core** | ~240 MB | Без XTLS/REALITY | ❌ Нет |
| **nginx** | N/A | Не поддерживает VLESS | ❌ Нет |

---

## 📚 Документация

| Ресурс | Ссылка |
|--------|--------|
| **Полное исследование** | `docs/operations/VLESS_PROXY_RESEARCH_2025-11-30.md` |
| **Гайд по интеграции** | `backend/VLESS_INTEGRATION_GUIDE.md` |
| **Docker Compose** | `docker-compose.vless-proxy.yml` |
| **Python клиент** | `backend/app/services/vless_http_client.py` |

---

## 🎯 Архитектура (Схема)

```
┌────────────────────────────────────────────┐
│  fancai Production Stack           │
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────┐        ┌──────────────┐     │
│  │ Backend  │───────▶│ VLESS Proxy  │     │
│  │ (FastAPI)│ HTTP   │ (Xray-core)  │     │
│  │          │        │              │     │
│  │ pollinations.ai   │ SOCKS5: 1080 │     │
│  │ api.openai.com ───│ HTTP:   8123 │     │
│  └──────────┘        └──────┬───────┘     │
│                              │             │
│                              │ VLESS       │
│                              │ protocol    │
│                              ▼             │
│                       Internet (VPN)       │
└────────────────────────────────────────────┘
```

---

## 🚦 Deployment Checklist

**Перед production:**

- [ ] VLESS credentials проверены и работают
- [ ] Feature flag `USE_VLESS_PROXY=true` установлен
- [ ] Health checks настроены
- [ ] Мониторинг подключен
- [ ] Логи ротируются
- [ ] Тесты прошли
- [ ] Fallback стратегия готова
- [ ] Документация обновлена

**После deployment:**

- [ ] Прокси работает (health check OK)
- [ ] Image generation через прокси работает
- [ ] Latency приемлемый (<500ms)
- [ ] Логи чистые (нет ошибок)
- [ ] Метрики собираются

---

## 💡 Полезные ссылки

**Проекты:**
- [Xray-core GitHub](https://github.com/XTLS/Xray-core)
- [samuelhbne/proxy-xray](https://github.com/samuelhbne/proxy-xray)
- [sing-box](https://sing-box.sagernet.org/)

**Гайды:**
- [VLESS Protocol](https://xtls.github.io/config/outbound/vless.html)
- [REALITY Setup](https://vless.dev/)
- [Xray with Nginx](https://j3ffyang.medium.com/xray-with-nginx-over-vless-63e9af97b192)

---

**Версия:** v1.0 (2025-11-30)
**Автор:** DevOps Engineer Agent (Claude Code)
**Статус:** ✅ Production Ready

# Caddy + статика

**Дата исследования:** 2026-03-01
**Источник:** Infrastructure Audit v4 — секция 7

---

## 1. Текущая архитектура → Новая

**Было:** Client → nginx proxy → nginx frontend → static file (2 контейнера, ~500 строк конфига)

**Стало:** Client → Caddy → static file / backend (1 контейнер, ~80 строк конфига)

## 2. Что получаем

| Плюс                                           | Влияние                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| Автоматический HTTPS (Let's Encrypt + ZeroSSL) | Нет certbot, нет ручного обновления сертификатов |
| HTTP/3 (QUIC) из коробки                       | Лучшая мобильная производительность (PWA)        |
| -1 контейнер (frontend nginx)                  | Меньше ресурсов, проще deployment                |
| Убран double-hop                               | Ниже latency для статики                         |
| WebSocket auto-detect                          | Не нужен `proxy_set_header Upgrade`              |
| Built-in Prometheus metrics                    | Не нужен nginx-exporter                          |
| ~80 строк vs ~500 строк конфига                | Проще поддерживать                               |

## 3. Что теряем

| Потеря                     | Критичность | Решение                                                     |
| -------------------------- | ----------- | ----------------------------------------------------------- |
| Built-in rate limiting     | **HIGH**    | xcaddy + caddy-ratelimit плагин ИЛИ FastAPI slowapi (лучше) |
| Connection limiting        | MEDIUM      | iptables / app-layer                                        |
| sendfile/epoll kernel opts | LOW         | Нерелевантно при ~50 пользователях                          |
| Brotli compression         | LOW         | gzip + zstd достаточно                                      |
| ~40MB больше RAM           | LOW         | 0.5% от 32GB                                                |

## 4. Рекомендация по rate limiting

Перенести rate limiting на уровень приложения (FastAPI `slowapi`) — это лучшая практика, так как позволяет rate limit по user ID, а не только по IP.

## 5. Docker архитектура

Multi-stage Dockerfile: build frontend → copy to Caddy container. Один self-contained image.

---

## Источники

- [Caddy Common Patterns](https://caddyserver.com/docs/caddyfile/patterns)
- [Caddy vs Nginx Benchmark](https://blog.tjll.net/reverse-proxy-hot-dog-eating-contest-caddy-vs-nginx/)
- [caddy-ratelimit plugin](https://github.com/mholt/caddy-ratelimit)

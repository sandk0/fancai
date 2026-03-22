# Аудит изменений сессии 2026-03-21

**Дата:** 2026-03-21
**Версия:** v4 (финальная)
**Область:** Обложки книг, WebSocket аутентификация, AuthenticatedImage, Service Worker
**Коммиты:**
- `a5f560e` — AuthenticatedImage: стабилизация useEffect deps
- `a00a610` — WebSocket: передача JWT через query param + cookie path="/"
- `3498a85` — Исправления по аудиту v1: WS auth via message, cookie cleanup, SW routing
- `2a5ac72` — Исправление по аудиту v3: fallthrough auth при невалидной cookie

---

## 1. AuthenticatedImage

**Файл:** `frontend/src/components/UI/AuthenticatedImage.tsx`
**Статус: ✅ Корректно**

- Refs для callback-props — effect зависит только от `[src]`
- `setBlobUrl(null)` при смене src — нет показа revoked blob URL
- Cleanup: `isMounted` flag + `URL.revokeObjectURL`

Замечаний нет.

---

## 2. WebSocket аутентификация

**Файлы:** `frontend/src/hooks/useBookProgressWS.ts`, `backend/app/routers/websocket.py`
**Статус: ✅ Корректно**

### Фронтенд
- URL без токена — не попадает в access-логи
- Auth через first message `{"type":"auth","token":"..."}` после onopen
- Token из localStorage при каждом connect/reconnect — всегда свежий
- Docstring обновлён

### Бэкенд
- `get_user_from_websocket()` перебирает кандидатов (cookie → explicit token) с `continue` при неудаче
- accept → cookie/query check → если нет user, ждёт first-message (5s) → auth или close
- Duplicate auth в основном цикле игнорируется
- Module docstring обновлён

### Замечания

**2.1 [LOW] Фронт ставит `status='connected'` до подтверждения auth**

`onopen` handler вызывает `setStatus('connected')` до получения `{"type":"connected"}` от сервера. Если auth провалится, status кратковременно неточен — `onclose` переведёт в 'disconnected' и сработает fallback к polling. Функционально безопасно.

---

## 3. Cookie path

**Файл:** `backend/app/routers/auth.py`
**Статус: ✅ Корректно**

- `set_cookie(path="/")` в register, login, refresh
- `delete_cookie(path="/")` + `delete_cookie()` в logout — покрывает legacy и новые cookies

Замечаний нет.

---

## 4. Service Worker

**Файл:** `frontend/src/sw.ts`
**Статус: ✅ Корректно**

- `/api/` cover requests исключены из SW caching
- Authenticated fetch не перехватывается SW — нет ложных 401 при revalidation

**4.1 [INFO]** Cover caching rule фактически неактивен — все обложки через `/api/`. Не вредит.

---

## 5. Восстановление обложек

**Статус: ✅ Разовый фикс выполнен**

Оставшиеся рекомендации (pre-existing, не из этой сессии):

**5.1 [LOW]** Нет health check storage volume при старте FastAPI.
**5.2 [LOW]** `has_cover` проверяет `bool(cover_image)`, не файл на диске.

---

## Итоговая сводка

| # | Severity | Компонент | Проблема | Статус |
|---|----------|-----------|----------|--------|
| 2.1 | 🟢 LOW | useBookProgressWS.ts | status='connected' до подтверждения auth | Архитектурное, безопасно |
| 4.1 | ℹ️ INFO | sw.ts | Cover caching rule фактически неактивен | Не вредит |
| 5.1 | 🟢 LOW | book_service.py | Нет health check storage | Pre-existing |
| 5.2 | 🟢 LOW | crud.py | has_cover vs реальный файл | Pre-existing |

### Полная история исправлений v1 → v4

| Проблема | v1 | v4 |
|----------|----|----|
| JWT в URL логируется | 🔴 HIGH | ✅ auth via first message |
| Cookie не удаляется при logout | 🔴 HIGH | ✅ delete_cookie с path="/" |
| Невалидная cookie блокирует first-message auth | 🟡 MEDIUM | ✅ fallthrough с continue |
| Legacy cookies дублируются | 🟡 MEDIUM | ✅ двойной delete |
| SW revalidation без auth → 401 | 🟡 MEDIUM | ✅ /api/ excluded |
| Blob URL leak при смене src | 🟢 LOW | ✅ setBlobUrl(null) |
| Module docstring устарел | 🟢 LOW | ✅ обновлён |
| Endpoint docstring устарел | 🟢 LOW | ✅ обновлён |

**Все HIGH и MEDIUM проблемы устранены. Оставшиеся — LOW/INFO, не требующие немедленного действия.**

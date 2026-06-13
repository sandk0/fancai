# План деплоя PWA на fancai.ru

**Дата:** 2026-01-10
**Сервер:** 77.246.106.109
**Compose файл:** docker-compose.lite.yml (эталон)

---

## Выполненные изменения (готовы к деплою)

### Docker инфраструктура
- [x] Frontend использует `Dockerfile.prod` (nginx вместо Vite dev server)
- [x] Frontend порт: 5173:80 (nginx внутри контейнера)
- [x] VAPID переменные добавлены в backend и celery-worker
- [x] Docker образы обновлены: postgres:17, redis:7.4, node:22, python:3.12, nginx:1.27
- [x] nginx.prod.conf создан с PWA заголовками для SW и manifest

### Backend PWA
- [x] Push notification service (`app/services/push_notification_service.py`)
- [x] Push router (`app/routers/push.py`)
- [x] Push subscription model и schema
- [x] Миграция `2026_01_09_0001_add_push_subscriptions_table.py`

---

## Требуется выполнить ДО деплоя

### 1. Исправить двойную регистрацию Service Worker [КРИТИЧНО]

**Файл:** `frontend/src/main.tsx`

Удалить строки 6-36 (импорт registerSW и весь блок регистрации):

```typescript
// УДАЛИТЬ:
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() { /* ... */ },
  onRegisteredSW(swUrl, registration) {
    setInterval(() => registration.update(), 60 * 60 * 1000)
  },
})
;(window as any).__pwa_updateSW = updateSW
```

**Причина:** PWAUpdatePrompt.tsx уже использует useRegisterSW, двойная регистрация вызывает конфликты.

---

### 2. Создать иконку 512x512 [КРИТИЧНО]

**Путь:** `frontend/public/icon-512.png`

```bash
# Вариант 1: ImageMagick
convert frontend/public/icon-192.png -resize 512x512 frontend/public/icon-512.png

# Вариант 2: Создать в Figma/Photoshop
# Размер: 512x512 px, PNG, прозрачный фон
# Safe zone для maskable: центральные 80% (409x409 px)
```

---

### 3. Исправить домен в метаданных [ВАЖНО]

**Файл:** `frontend/index.html`

Заменить `fancai.app` на `fancai.ru`:
- og:url
- og:image
- twitter:url
- twitter:image

---

### 4. Удалить или создать скриншоты [ОПЦИОНАЛЬНО]

**Файл:** `frontend/public/manifest.json`

**Вариант A:** Удалить раздел `screenshots` (строки 43-72)

**Вариант B:** Создать скриншоты в `frontend/public/screenshots/`:
- library-desktop.png (1280x720)
- reader-desktop.png (1280x720)
- library-mobile.png (375x812)
- reader-mobile.png (375x812)

---

## Действия на сервере

### Архитектура nginx на сервере

```
┌─────────────────────────────────────────────────────────┐
│ Клиент (браузер)                                        │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS :443
                             ▼
┌─────────────────────────────────────────────────────────┐
│ Системный nginx (/etc/nginx)                            │
│ - SSL termination (Let's Encrypt)                       │
│ - Proxy к Docker контейнерам                           │
│ - [НУЖНО] PWA заголовки для SW                         │
└────────────────────────────┬────────────────────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ frontend:80  │ │ backend:8000 │ │ celery:...   │
    │ (nginx)      │ │ (uvicorn)    │ │              │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### 5. Обновить системный nginx для PWA [КРИТИЧНО]

**Файл на сервере:** `/etc/nginx/sites-enabled/fancai.ru`

Добавить в блок `server { listen 443 ssl; }`:

```nginx
    # PWA Service Worker - НЕ кешировать
    location = /sw.js {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Критично для Service Worker
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Service-Worker-Allowed "/" always;
        expires off;
    }

    # PWA Manifest
    location = /manifest.json {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;

        add_header Cache-Control "no-cache" always;
        add_header Content-Type "application/manifest+json" always;
    }

    # HSTS для PWA (требуется iOS)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

После изменения:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

### 6. Сгенерировать VAPID ключи

```bash
# На сервере или локально
npx web-push generate-vapid-keys
```

### 7. Добавить в .env на сервере

**Файл:** `/root/fancai-vibe-hackathon/.env`

```env
# PWA Push Notifications
VAPID_PUBLIC_KEY=<сгенерированный_публичный_ключ>
VAPID_PRIVATE_KEY=<сгенерированный_приватный_ключ>
VAPID_SUBJECT=mailto:admin@fancai.ru
```

---

## Последовательность деплоя

```bash
# 1. SSH на сервер
ssh root@77.246.106.109

# 2. Перейти в директорию
cd /root/fancai-vibe-hackathon

# 3. Создать бэкап текущего состояния
docker compose -f docker-compose.lite.yml exec postgres pg_dump -U postgres bookreader_dev > backup_$(date +%Y%m%d_%H%M%S).sql

# 4. Получить изменения
git pull origin main

# 5. Проверить .env (VAPID ключи)
cat .env | grep VAPID

# 6. Пересобрать frontend с production build
docker compose -f docker-compose.lite.yml build --no-cache frontend

# 7. Остановить и перезапустить
docker compose -f docker-compose.lite.yml down
docker compose -f docker-compose.lite.yml up -d

# 8. Выполнить миграции (создаст push_subscriptions)
docker compose -f docker-compose.lite.yml exec backend alembic upgrade head

# 9. Обновить системный nginx (если ещё не сделано)
sudo nano /etc/nginx/sites-enabled/fancai.ru
# Добавить PWA location блоки
sudo nginx -t && sudo systemctl reload nginx

# 10. Проверить логи
docker compose -f docker-compose.lite.yml logs -f frontend backend --tail=50
```

---

## Проверка после деплоя

### Автоматические проверки

```bash
# Service Worker headers
curl -I https://fancai.ru/sw.js 2>/dev/null | grep -E "(Cache-Control|Service-Worker)"
# Ожидание: Cache-Control: no-store, no-cache...
# Ожидание: Service-Worker-Allowed: /

# Manifest headers
curl -I https://fancai.ru/manifest.json 2>/dev/null | grep -E "(Content-Type|Cache-Control)"
# Ожидание: Content-Type: application/manifest+json

# Icon 512
curl -I https://fancai.ru/icon-512.png 2>/dev/null | grep "HTTP"
# Ожидание: HTTP/2 200

# HSTS
curl -I https://fancai.ru/ 2>/dev/null | grep "Strict-Transport"
# Ожидание: Strict-Transport-Security: max-age=31536000...
```

### Ручная проверка в браузере

1. **Chrome DevTools > Application > Service Workers**
   - SW статус: activated and is running
   - Нет ошибок регистрации

2. **Chrome DevTools > Application > Manifest**
   - Иконки загружаются
   - Нет ошибок

3. **Chrome DevTools > Network**
   - sw.js возвращает 200
   - manifest.json возвращает 200
   - Нет 404 на PWA ресурсы

4. **Lighthouse PWA Audit**
   - Ожидаемый результат: 90-100

5. **Установка PWA**
   - Chrome Desktop: появляется иконка установки в адресной строке
   - Android Chrome: появляется баннер "Добавить на главный экран"
   - iOS Safari: "Поделиться" > "На экран Домой"

---

## Откат при проблемах

```bash
# Откатить git изменения
git checkout HEAD~1

# Пересобрать
docker compose -f docker-compose.lite.yml build --no-cache frontend
docker compose -f docker-compose.lite.yml up -d

# Восстановить БД (если нужно)
cat backup_YYYYMMDD_HHMMSS.sql | docker compose -f docker-compose.lite.yml exec -T postgres psql -U postgres bookreader_dev
```

---

## Чеклист готовности

### Код (до git push)
- [ ] Удалена двойная регистрация SW в main.tsx
- [ ] Создана icon-512.png
- [ ] Исправлены домены в index.html (fancai.ru)
- [ ] Решён вопрос со скриншотами в manifest.json

### Сервер (после git pull)
- [ ] VAPID ключи в .env
- [ ] Системный nginx обновлён для PWA
- [ ] Миграция push_subscriptions выполнена

### Проверка
- [ ] SW регистрируется без ошибок
- [ ] Manifest загружается
- [ ] Иконки доступны (192, 512)
- [ ] HTTPS работает
- [ ] PWA устанавливается

---

## Контакты

При проблемах:
1. Логи: `docker compose -f docker-compose.lite.yml logs -f`
2. nginx: `sudo tail -f /var/log/nginx/error.log`
3. DevTools > Application > Service Workers

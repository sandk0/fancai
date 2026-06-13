# План доработки PWA для fancai.ru

**Дата:** 2026-01-10
**Приоритет:** Критический (блокирует деплой)
**Оценка времени:** 2-4 часа

---

## Этап 1: Критические исправления (БЛОКИРУЮЩИЕ)

### 1.1 Исправить двойную регистрацию Service Worker

**Файл:** `frontend/src/main.tsx`

**Текущий код (удалить строки 6-36):**
```typescript
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() { /* ... */ },
  // ...
})
;(window as any).__pwa_updateSW = updateSW
```

**Новый код:**
```typescript
// Service Worker регистрация перемещена в PWAUpdatePrompt.tsx
// Там же происходит управление обновлениями через useRegisterSW hook
```

**Действие:** Удалить импорт `registerSW` и весь блок регистрации из main.tsx. Компонент `PWAUpdatePrompt` уже использует `useRegisterSW` который сам регистрирует SW.

---

### 1.2 Создать иконку 512x512

**Действие:** Создать PNG иконку 512x512 пикселей

**Способ 1:** Масштабировать существующую icon-192.png (может потерять качество)
```bash
# Через ImageMagick (если установлен)
convert frontend/public/icon-192.png -resize 512x512 frontend/public/icon-512.png
```

**Способ 2:** Создать новую иконку в дизайн-инструменте (Figma, Photoshop) с размером 512x512 и экспортировать как PNG.

**Требования к иконке:**
- Формат: PNG
- Размер: 512x512 px
- Прозрачный фон (для maskable)
- Safe zone для maskable: центральные 80% (409x409 px)

---

### 1.3 Добавить заголовки кеширования в nginx

**Файл:** `nginx/nginx.prod.conf.template`

**Добавить после строки 201 (перед `location /`):**

```nginx
        # PWA Service Worker - без кеширования для быстрых обновлений
        location = /sw.js {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Критично: Service Worker не должен кешироваться
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
            add_header Service-Worker-Allowed "/" always;
            expires 0;
        }

        # PWA Manifest
        location = /manifest.json {
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;

            add_header Cache-Control "no-cache, must-revalidate" always;
            add_header Content-Type "application/manifest+json" always;
        }
```

---

### 1.4 Исправить домен в метаданных

**Файл:** `frontend/index.html`

**Изменить строки 29-39:**

```html
<!-- Open Graph / Facebook -->
<meta property="og:type" content="website" />
<meta property="og:url" content="https://fancai.ru/" />
<meta property="og:title" content="fancai - Read with AI-Generated Illustrations" />
<meta property="og:description" content="Transform your reading experience with AI-powered image generation from book descriptions." />
<meta property="og:image" content="https://fancai.ru/og-image.jpg" />

<!-- Twitter -->
<meta property="twitter:card" content="summary_large_image" />
<meta property="twitter:url" content="https://fancai.ru/" />
<meta property="twitter:title" content="fancai - Read with AI-Generated Illustrations" />
<meta property="twitter:description" content="Transform your reading experience with AI-powered image generation from book descriptions." />
<meta property="twitter:image" content="https://fancai.ru/twitter-image.jpg" />
```

---

## Этап 2: Важные исправления (до деплоя)

### 2.1 Обработать отсутствующие скриншоты

**Вариант A (быстрый):** Удалить раздел screenshots из manifest.json

**Файл:** `frontend/public/manifest.json`

Удалить строки 43-72 (весь раздел `"screenshots"`).

**Вариант B (правильный):** Создать скриншоты

Создать 4 скриншота в `frontend/public/screenshots/`:
- `library-desktop.png` (1280x720)
- `reader-desktop.png` (1280x720)
- `library-mobile.png` (375x812)
- `reader-mobile.png` (375x812)

---

### 2.2 Исправить VAPID_SUBJECT по умолчанию

**Файл:** `docker-compose.lite.yml`

**Строка 128 и 183:**
```yaml
- VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@fancai.ru}
```

---

### 2.3 Создать OG и Twitter изображения

Создать в `frontend/public/`:
- `og-image.jpg` (1200x630 px) - для Facebook/LinkedIn
- `twitter-image.jpg` (1200x628 px) - для Twitter

Можно использовать одно изображение для обоих.

---

## Этап 3: Подготовка сервера

### 3.1 Сгенерировать VAPID ключи

**На сервере или локально:**
```bash
npx web-push generate-vapid-keys
```

**Результат (пример):**
```
Public Key: BLBxLlG...
Private Key: tXYpOa...
```

### 3.2 Добавить ключи в .env на сервере

**Файл:** `/root/fancai-vibe-hackathon/.env` (на сервере)

```env
VAPID_PUBLIC_KEY=BLBxLlG...сгенерированный_ключ...
VAPID_PRIVATE_KEY=tXYpOa...сгенерированный_ключ...
VAPID_SUBJECT=mailto:admin@fancai.ru
```

### 3.3 Выполнить миграцию базы данных

**На сервере после деплоя:**
```bash
docker compose -f docker-compose.lite.yml exec backend alembic upgrade head
```

Это создаст таблицу `push_subscriptions`.

---

## Этап 4: Проверка перед деплоем

### 4.1 Локальное тестирование PWA

**Способ 1: ngrok (для реального HTTPS)**
```bash
ngrok http 5173
# Затем открыть https://xxx.ngrok.io в браузере
```

**Способ 2: Chrome DevTools**
```bash
cd frontend && npm run dev
# Открыть http://localhost:5173
# Chrome DevTools > Application > Service Workers
```

### 4.2 Чеклист проверки

- [ ] Service Worker регистрируется без ошибок
- [ ] Manifest.json загружается (Network tab)
- [ ] Иконка 512x512 доступна
- [ ] Install prompt появляется (Chrome Desktop)
- [ ] Offline режим работает (после загрузки страницы)
- [ ] Push notification permission запрашивается
- [ ] Console не содержит 404 ошибок на PWA ресурсы

### 4.3 Lighthouse Audit

```bash
# В Chrome DevTools
# Lighthouse > Progressive Web App > Generate report

# Ожидаемый результат после исправлений:
# PWA Score: 100
```

---

## Этап 5: Деплой

### 5.1 Последовательность команд

```bash
# 1. SSH на сервер
ssh root@77.246.106.109

# 2. Перейти в директорию проекта
cd /root/fancai-vibe-hackathon

# 3. Получить изменения
git pull origin main

# 4. Остановить контейнеры
docker compose -f docker-compose.lite.yml down

# 5. Пересобрать с новым кодом
docker compose -f docker-compose.lite.yml build --no-cache frontend

# 6. Запустить контейнеры
docker compose -f docker-compose.lite.yml up -d

# 7. Выполнить миграции
docker compose -f docker-compose.lite.yml exec backend alembic upgrade head

# 8. Проверить логи
docker compose -f docker-compose.lite.yml logs -f frontend backend
```

### 5.2 Проверка после деплоя

```bash
# Проверить Service Worker
curl -I https://fancai.ru/sw.js
# Ожидание: Cache-Control: no-cache, no-store, must-revalidate

# Проверить Manifest
curl -I https://fancai.ru/manifest.json
# Ожидание: Content-Type: application/manifest+json

# Проверить иконку
curl -I https://fancai.ru/icon-512.png
# Ожидание: HTTP/2 200
```

---

## Приоритеты

| Задача | Приоритет | Блокирует деплой? |
|--------|-----------|-------------------|
| 1.1 Двойная регистрация SW | P0 | Да |
| 1.2 Иконка 512x512 | P0 | Да |
| 1.3 Заголовки nginx | P0 | Да |
| 1.4 Домен в метаданных | P1 | Нет |
| 2.1 Скриншоты | P2 | Нет |
| 2.2 VAPID_SUBJECT | P2 | Нет |
| 2.3 OG/Twitter images | P2 | Нет |
| 3.1-3.3 Сервер | P0 | Да |

---

## Файлы для изменения

### Frontend
1. `src/main.tsx` - удалить registerSW
2. `public/icon-512.png` - создать новый файл
3. `public/manifest.json` - удалить screenshots (опционально)
4. `index.html` - исправить домены

### Backend/Infra
5. `nginx/nginx.prod.conf.template` - добавить location для sw.js
6. `docker-compose.lite.yml` - исправить VAPID_SUBJECT default

### Сервер
7. `.env` - добавить VAPID ключи
8. База данных - миграция push_subscriptions

---

## Оценка времени

| Этап | Время |
|------|-------|
| Этап 1 (критические) | 30-60 мин |
| Этап 2 (важные) | 30-60 мин |
| Этап 3 (сервер) | 15-30 мин |
| Этап 4 (проверка) | 30-60 мин |
| Этап 5 (деплой) | 15-30 мин |
| **Итого** | **2-4 часа** |

---

## Контакты для вопросов

При возникновении проблем:
1. Проверить логи: `docker compose logs -f`
2. Проверить Service Worker в DevTools > Application
3. Проверить Network tab на 4xx/5xx ошибки

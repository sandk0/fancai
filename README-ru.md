<div align="center">

# fancai

**Читай с визуализацией: ИИ генерирует иллюстрации к твоим книгам**

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.125-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.4-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/Лицензия-Проприетарная-red)](LICENSE)

[Демо](https://fancai.ru) · [Документация](docs/README.md) · [Сообщить об ошибке](https://github.com/sandk0/fancai/issues) · [Предложить функцию](https://github.com/sandk0/fancai/issues)

---

**[English](README.md)** | Русский

</div>

---

## О проекте

fancai — современное веб-приложение для чтения художественной литературы с **автоматической генерацией ИИ-изображений** по описаниям сцен. Приложение извлекает визуальные описания из текста и создаёт потрясающие иллюстрации с помощью передовых моделей ИИ.

### Как это работает

```
📖 Загрузка книги → 🔍 ИИ извлекает описания → 🎨 Генерация изображений → ✨ Чтение с иллюстрациями
```

1. **Загрузите** книгу в формате EPUB или FB2
2. **Читайте** в красивом, настраиваемом ридере
3. **Открывайте** подсвеченные описания по мере чтения
4. **Генерируйте** ИИ-иллюстрации для любой сцены одним кликом
5. **Сохраняйте** прогресс и позицию чтения автоматически

### Ключевые возможности

| Функция | Описание |
|---------|----------|
| 📚 **Мульти-формат** | Поддержка EPUB и FB2 с полным извлечением метаданных |
| 🤖 **LLM-извлечение** | Google Gemini распознаёт персонажей, сцены и обстановку |
| 🎨 **ИИ-генерация** | Google Imagen 4 создаёт качественные иллюстрации |
| 📍 **Умное отслеживание** | CFI-позиционирование с точным восстановлением |
| 🌙 **Тёмная тема** | Комфортное чтение днём и ночью |
| 📱 **PWA** | Установка как приложение, работа офлайн |
| 🔐 **Подписки** | Тарифы FREE / PREMIUM / ULTIMATE |

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Технологии

### Frontend
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![TanStack Query](https://img.shields.io/badge/TanStack_Query-5.90-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)](https://tanstack.com/query)

### Backend
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.125-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15.7-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.4-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![Celery](https://img.shields.io/badge/Celery-5.4-37814A?style=for-the-badge&logo=celery&logoColor=white)](https://docs.celeryq.dev)

### ИИ-сервисы
[![Google Gemini](https://img.shields.io/badge/Gemini-3.0_Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![Google Imagen](https://img.shields.io/badge/Imagen-4.0-EA4335?style=for-the-badge&logo=google&logoColor=white)](https://cloud.google.com/vertex-ai/docs/generative-ai/image/overview)

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Быстрый старт

Запустите Fancai локально за 5 минут.

### Требования

- [Docker](https://docs.docker.com/get-docker/) и Docker Compose
- [Git](https://git-scm.com/)
- API-ключ Google Cloud (для Gemini + Imagen) — [Получить здесь](https://ai.google.dev/)

### Установка

```bash
# Клонирование репозитория
git clone https://github.com/sandk0/fancai.git
cd bookreader-ai

# Копирование шаблона окружения
cp .env.example .env

# Редактирование .env и добавление API-ключей
nano .env  # или другой редактор

# Запуск всех сервисов
docker-compose up -d

# Открыть в браузере
open http://localhost:5173
```

### Переменные окружения

Создайте файл `.env` с обязательными переменными:

```env
# Обязательные
DB_PASSWORD=your_secure_password
REDIS_PASSWORD=your_redis_password
SECRET_KEY=your_jwt_secret_key

# ИИ-сервисы (для генерации изображений)
GOOGLE_API_KEY=your_google_api_key

# Опциональные
DEBUG=true
CORS_ORIGINS=http://localhost:5173
```

> **Примечание:** Полный список опций в [.env.example](.env.example).

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Клиент (Браузер)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ React 19    │  │ epub.js      │  │ TanStack Query + IndexedDB │  │
│  │ + TypeScript│  │ EPUB-рендер  │  │ Слой кэширования           │  │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ REST API
┌────────────────────────────────┴────────────────────────────────────┐
│                        FastAPI Backend                              │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │ Auth (JWT)   │  │ Парсер книг   │  │ Экстрактор описаний      │  │
│  │              │  │ EPUB/FB2      │  │ (Google Gemini 3.0 Flash)│  │
│  └──────────────┘  └───────────────┘  └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │           Генератор изображений (Google Imagen 4)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
    ┌──────────┴──────────┐        ┌─────────┴─────────┐
    │   PostgreSQL 15     │        │     Redis 7.4     │
    │   (Хранение данных) │        │ (Кэш + очередь)   │
    └─────────────────────┘        └───────────────────┘
```

### Основные сервисы

| Сервис | Назначение | Строк кода |
|--------|------------|------------|
| `book_parser.py` | Парсинг EPUB/FB2, извлечение глав, генерация CFI | 925 |
| `gemini_extractor.py` | LLM-извлечение описаний через Gemini API | 661 |
| `imagen_generator.py` | Генерация ИИ-изображений через Imagen 4 | 644 |
| `reading_session_cache.py` | Redis-кэширование сессий | 454 |
| `auth_service.py` | JWT-аутентификация и авторизация | 373 |

> **Всего backend:** 15+ сервисов, 7 757 строк кода

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Справочник API

### Аутентификация
```http
POST /api/v1/auth/register    # Регистрация
POST /api/v1/auth/login       # Получение JWT-токена
POST /api/v1/auth/refresh     # Обновление токена
```

### Книги
```http
GET    /api/v1/books          # Список книг пользователя
POST   /api/v1/books/upload   # Загрузка EPUB/FB2
GET    /api/v1/books/{id}     # Детали книги
DELETE /api/v1/books/{id}     # Удаление книги
```

### Чтение
```http
GET  /api/v1/chapters/{id}              # Содержимое главы
PUT  /api/v1/books/{id}/progress        # Обновление позиции
GET  /api/v1/descriptions/{chapter_id}  # Извлечённые описания
```

### Изображения
```http
POST /api/v1/images/generate/{description_id}  # Генерация изображения
GET  /api/v1/images/{id}                       # Получение изображения
```

> **Полная документация API:** Доступна по адресу `/docs` (Swagger UI) при локальном запуске.

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Производительность

### Бенчмарки

| Метрика | Значение | Улучшение |
|---------|----------|-----------|
| Время запроса к БД | <5мс | 100x быстрее (было 500мс) |
| Ответ API (кэш) | <50мс | 83% быстрее |
| TTI фронтенда | 1.2с | 66% быстрее |
| Размер бандла | 386KB gzipped | 29% меньше |
| Использование RAM | 2-3 GB | 75% снижение |
| Docker-образ | 800 MB | 68% меньше |

### Применённые оптимизации

- **База данных:** JSONB + GIN-индексы для 100x ускорения
- **Кэширование:** Redis с 85% попаданий в кэш
- **Frontend:** TanStack Query со стратегией stale-while-revalidate
- **Офлайн:** IndexedDB-кэширование глав и изображений
- **Алгоритмы:** O(n) подсветка текста (было O(n²))

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Дорожная карта

- [x] Парсинг EPUB/FB2 книг
- [x] LLM-извлечение описаний (Gemini)
- [x] ИИ-генерация изображений (Imagen 4)
- [x] Отслеживание прогресса (CFI)
- [x] Офлайн-поддержка (PWA + IndexedDB)
- [x] Система подписок
- [x] Устойчивые API-вызовы (exponential backoff)
- [x] JWT token blacklist (безопасный logout)
- [x] Офлайн-очередь синхронизации
- [x] Интеграционные тесты
- [x] Система тем (Light/Dark/Sepia)
- [x] iOS Mobile-оптимизации (scroll/zoom fixes, safe-area)
- [ ] Мобильные приложения (React Native)
- [ ] Социальные функции (шеринг, комментарии)
- [ ] Поддержка нескольких ИИ-моделей
- [ ] Рекомендации книг

Смотрите [открытые issues](https://github.com/sandk0/fancai/issues) для планируемых функций и известных проблем.

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Участие в разработке

Вклад в проект делает open-source сообщество удивительным. Любой вклад **высоко ценится**.

1. Сделайте Fork проекта
2. Создайте ветку для функции (`git checkout -b feature/AmazingFeature`)
3. Закоммитьте изменения (`git commit -m 'Add some AmazingFeature'`)
4. Запушьте ветку (`git push origin feature/AmazingFeature`)
5. Откройте Pull Request

Подробнее в [CONTRIBUTING.md](CONTRIBUTING.md).

### Настройка окружения разработчика

```bash
# Backend-разработка
cd backend
pip install -r requirements.txt
pytest -v --cov=app           # Запуск тестов
mypy app/                     # Проверка типов

# Frontend-разработка
cd frontend
npm install
npm test                      # Запуск тестов
npm run type-check            # Проверка TypeScript
```

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Структура проекта

```
fancai/
├── frontend/                 # React + TypeScript фронтенд
│   ├── src/
│   │   ├── components/       # UI-компоненты (86 всего)
│   │   │   ├── Reader/       # EPUB-ридер (15 компонентов)
│   │   │   ├── Settings/     # Настройки (8 компонентов)
│   │   │   ├── Library/      # Библиотека книг (6 компонентов)
│   │   │   ├── Admin/        # Админ-панель (5 компонентов)
│   │   │   └── UI/           # Общие UI (20+ компонентов)
│   │   ├── hooks/            # React-хуки (56 всего)
│   │   │   ├── api/          # TanStack Query хуки (5 файлов)
│   │   │   ├── epub/         # Хуки EPUB-ридера (22 файла)
│   │   │   ├── reader/       # Логика ридера (9 файлов)
│   │   │   └── [15 top-level хуков]
│   │   ├── services/         # Сервисы кэширования (9 файлов)
│   │   ├── stores/           # Zustand stores (6 файлов)
│   │   └── pages/            # Страницы (13 страниц)
│   └── tests/                # Тесты Vitest
├── backend/                  # FastAPI + Python бэкенд
│   ├── app/
│   │   ├── routers/          # API-эндпоинты (70+ эндпоинтов)
│   │   ├── services/         # Бизнес-логика (17+ сервисов)
│   │   ├── models/           # SQLAlchemy-модели (9 моделей)
│   │   └── core/             # Конфиг, БД, исключения, retry
│   └── tests/
│       ├── services/         # Unit-тесты (35+ файлов)
│       └── integration/      # Интеграционные тесты (8 файлов)
├── docs/                     # Документация (Diataxis)
├── docker-compose.lite.yml   # Production-стек
└── scripts/                  # Скрипты деплоя
```

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Документация

Документация следует фреймворку [Diataxis](https://diataxis.fr/):

| Категория | Описание | Ссылка |
|-----------|----------|--------|
| **Руководства** | Пошаговые туториалы и how-to | [docs/guides/](docs/guides/) |
| **Справочник** | API, БД, спецификации компонентов | [docs/reference/](docs/reference/) |
| **Пояснения** | Архитектура и проектные решения | [docs/explanations/](docs/explanations/) |
| **Операции** | Деплой и обслуживание | [docs/operations/](docs/operations/) |

**Быстрые ссылки:**
- [Быстрый старт](docs/guides/getting-started/quick-start.md)
- [Документация API](docs/reference/api/overview.md)
- [Руководство по деплою](docs/guides/deployment/production-deployment.md)
- [Обзор архитектуры](docs/explanations/architecture/system-architecture.md)

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Лицензия

Проприетарное ПО. Все права защищены.

Подробнее в [LICENSE](LICENSE).

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

## Благодарности

- [epub.js](https://github.com/futurepress/epub.js) — рендеринг EPUB
- [TanStack Query](https://tanstack.com/query) — управление серверным состоянием
- [FastAPI](https://fastapi.tiangolo.com/) — Python веб-фреймворк
- [Google AI](https://ai.google.dev/) — Gemini и Imagen API
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) — вдохновение для README

<p align="right">(<a href="#fancai">наверх</a>)</p>

---

<div align="center">

**[Сайт](https://fancai.ru)** · **[Документация](docs/README.md)** · **[Сообщить об ошибке](https://github.com/sandk0/fancai/issues)**

Создано с любовью к читателям

</div>

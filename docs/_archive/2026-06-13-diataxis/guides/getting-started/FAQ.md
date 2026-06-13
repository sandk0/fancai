# Частозадаваемые вопросы (FAQ)

Распространенные вопросы и ответы о BookReader AI.

## Содержание

- [Общие вопросы](#общие-вопросы)
- [Начало работы](#начало-работы)
- [Разработка](#разработка)
- [Функциональность](#функциональность)
- [Multi-NLP система](#multi-nlp-система)
- [Производительность](#производительность)
- [Развертывание](#развертывание)
- [Устранение неполадок](#устранение-неполадок)
- [Участие в проекте](#участие-в-проекте)

---

## Общие вопросы

### Что такое BookReader AI?

BookReader AI - это веб-приложение для чтения художественной литературы с автоматической генерацией иллюстраций на основе описаний, извлеченных из книг. Оно использует передовые NLP технологии для извлечения описаний и AI-сервисы для создания визуализаций.

### Какие форматы книг поддерживаются?

В настоящее время поддерживаются форматы:
- **EPUB** (рекомендуется) - Полная поддержка с CFI позиционированием
- **FB2** - Полная поддержка
- **PDF** - Запланировано для Phase 2
- **MOBI** - Запланировано для Phase 2

### Какие языки поддерживаются?

NLP система оптимизирована для **русского языка** с использованием:
- SpaCy (ru_core_news_lg)
- Natasha (специалист по русской морфологии)
- Stanza (русский dependency parsing)

Поддержка английского языка запланирована для Phase 2.

### Является ли проект open source?

В настоящее время это частный проект. Детали лицензирования будут объявлены позже.

### Каков текущий статус проекта?

**Phase 1 (MVP)** завершен на 100% (по состоянию на октябрь 2025):
- Полная система управления книгами
- Продвинутый Multi-NLP парсер
- AI генерация изображений
- CFI система чтения с epub.js
- Production-ready развертывание
- Комплексный набор тестов

Для детального статуса см. [Текущий статус](docs/development/status/current-status.md).

---

## Начало работы

### Как установить BookReader AI?

**Быстрый старт:**
```bash
git clone <repository-url>
cd fancai-vibe-hackathon
cp .env.example .env
docker-compose up -d
```

Для детальных инструкций см. [Руководство по установке](docs/guides/getting-started/installation.md).

### Каковы системные требования?

**Разработка:**
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 6+
- Docker & Docker Compose
- Рекомендуется 4GB+ RAM

**Production:**
- 8GB+ RAM
- 4+ ядра CPU
- 50GB+ SSD хранилище
- Ubuntu 20.04+ или аналогичная

### Сколько времени занимает настройка?

- **С Docker:** 5-10 минут (автоматизировано)
- **Ручная настройка:** 30-60 минут (backend + frontend + база данных)

### Нужны ли API ключи для AI сервисов?

**Для разработки:**
- pollinations.ai - API ключ не нужен (бесплатный, сервис по умолчанию)
- OpenAI DALL-E - Опционально (требуется API ключ)
- Midjourney - Опционально (требуется подписка)

**Для production:**
- Рекомендуется настроить хотя бы один платный сервис для надежности

---

## Разработка

### Как запустить тесты?

```bash
# Backend тесты
cd backend && pytest -v --cov=app

# Frontend тесты
cd frontend && npm test

# E2E тесты
cd frontend && npm run test:e2e

# Все тесты
npm run test:all
```

См. [Руководство по тестированию](docs/guides/testing/testing-guide.md) для деталей.

### Как запустить сервер разработки?

```bash
# С Docker (рекомендуется)
docker-compose -f docker-compose.dev.yml up

# Без Docker
# Терминал 1: Backend
cd backend && uvicorn app.main:app --reload

# Терминал 2: Frontend
cd frontend && npm run dev

# Терминал 3: Celery worker
cd backend && celery -A app.core.celery worker --loglevel=info
```

### Какую IDE рекомендуется использовать?

**Backend (Python):**
- PyCharm Professional (рекомендуется)
- VS Code с расширением Python
- Vim/Neovim с LSP

**Frontend (TypeScript):**
- VS Code (рекомендуется)
- WebStorm
- Vim/Neovim с LSP

### Как отладить приложение?

См. [Руководство по устранению неполадок](TROUBLESHOOTING.md) для распространенных проблем.

**Отладка Backend:**
```python
# Добавить breakpoint
import pdb; pdb.set_trace()

# Или используйте debugger вашей IDE
```

**Отладка Frontend:**
- Используйте DevTools браузера (Chrome/Firefox)
- Расширение React DevTools
- Redux DevTools для инспекции состояния

---

## Функциональность

### Как работает Multi-NLP система?

Multi-NLP система использует **3 специализированных процессора**:
- **SpaCy** (ru_core_news_lg) - Entity recognition, вес 1.0
- **Natasha** - Специалист по русской морфологии, вес 1.2
- **Stanza** (ru) - Dependency parsing, вес 0.8

Работает в **5 режимах**:
1. **SINGLE** - Один процессор (быстро)
2. **PARALLEL** - Все процессоры параллельно (максимальное покрытие)
3. **SEQUENTIAL** - Последовательная обработка (контролируемо)
4. **ENSEMBLE** - Голосование с weighted consensus (максимальное качество) ⭐ Рекомендуется
5. **ADAPTIVE** - Автоматический выбор режима (интеллектуально)

Для деталей см. [Multi-NLP система](docs/reference/nlp/multi-nlp-system.md).

### Что такое CFI и зачем мы его используем?

**CFI (Canonical Fragment Identifier)** - это стандарт для точного позиционирования в EPUB книгах.

Преимущества:
- Pixel-perfect восстановление позиции чтения
- Работает на разных размерах экранов
- Соответствует стандарту (EPUB 3)
- Поддерживается epub.js из коробки

См. [Объяснение CFI системы](docs/explanations/concepts/cfi-system.md).

### Как работает генерация изображений?

1. **Загрузка книги** → Парсер извлекает главы
2. **NLP обработка** → Multi-NLP извлекает описания
3. **Prompt engineering** → Генерирует промпты на основе жанра/типа
4. **AI генерация** → pollinations.ai создает изображения
5. **Кэширование** → Дедупликация и хранение
6. **Отображение** → Умное выделение в читалке

Среднее время генерации: <30 секунд на изображение.

### Могу ли я использовать собственные AI сервисы?

Да! Система поддерживает:
- pollinations.ai (по умолчанию, бесплатный)
- OpenAI DALL-E (требуется API ключ)
- Midjourney (требуется подписка)
- Пользовательские сервисы (реализуйте интерфейс)

Настройка в `backend/app/core/config.py`.

---

## Multi-NLP система

### Какой NLP режим использовать?

**Рекомендации:**
- **ENSEMBLE** - Лучшее качество, рекомендуется для production (60% consensus)
- **ADAPTIVE** - Интеллектуальный автоматический выбор
- **PARALLEL** - Максимальное покрытие, но медленнее
- **SINGLE** - Быстрое тестирование/разработка

### Насколько точно извлечение описаний?

**Текущие метрики:**
- Релевантность: >70% (KPI достигнут ✅)
- Качество SpaCy: 0.78
- Качество Natasha: 0.82 (лучший)
- Качество Stanza: 0.75

Тестовый случай: 2,171 описание извлечено за 4 секунды из книги с 25 главами.

### Могу ли я настроить веса NLP процессоров?

Да! Используйте Admin API:

```bash
# Обновить вес SpaCy
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/spacy \
  -H "Content-Type: application/json" \
  -d '{"weight": 1.2, "threshold": 0.3}'

# Обновить вес Natasha
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/natasha \
  -H "Content-Type: application/json" \
  -d '{"weight": 1.0, "threshold": 0.25}'
```

См. [Multi-NLP Admin API](docs/reference/api/admin-nlp.md).

### Какие типы описаний извлекаются?

Три основных типа:
1. **Location** - Места, окружение, локации
2. **Character** - Внешность персонажей, одежда
3. **Atmosphere** - Настроение, атмосфера, погода

Каждый тип имеет специфические паттерны, оптимизированные для русской литературы.

---

## Производительность

### Насколько быстро парсятся книги?

**Бенчмарк (книга с 25 главами):**
- Загрузка книги: <2 секунд
- Парсинг EPUB: ~1 секунда
- NLP обработка: ~4 секунды (2,171 описание)
- Итого: ~7 секунд

В режиме ENSEMBLE на 3 процессорах.

### А как насчет производительности читалки?

**Метрики:**
- Время загрузки страницы: <2 секунд
- Time to Interactive: 1.2s (на 66% быстрее с оптимизациями)
- Размер бандла: 386KB gzipped (на 29% меньше)

### Как работает кэширование?

**Redis кэширование:**
- Процент попаданий в кэш: 85%
- Время ответа API: 200-500ms → <50ms (кэшировано)
- TTL: 1 час для метаданных книг, пользовательских сессий

**База данных:**
- JSONB + GIN индексы: В 100 раз быстрее запросы (<5ms)
- Одновременные пользователи: 500+ (в 10 раз больше)

См. [Отчет о производительности](docs/reports/performance/week17-database-performance.md).

### Может ли система обрабатывать много одновременных пользователей?

Да! После оптимизаций Недели 17:
- **50 → 500+ одновременных пользователей** (в 10 раз больше)
- Rate limiting защищает от злоупотреблений
- Redis кэширование снижает нагрузку на БД на 70%

---

## Развертывание

### Как развернуть в production?

```bash
# Инициализация окружения
./scripts/deploy.sh init

# Настройка SSL
./scripts/deploy.sh ssl

# Развертывание приложения
./scripts/deploy.sh deploy

# Проверка статуса
./scripts/deploy.sh status
```

См. [Руководство по Production развертыванию](docs/guides/deployment/production-deployment.md).

### А как насчет SSL сертификатов?

Автоматическая настройка SSL с Let's Encrypt:
```bash
./scripts/deploy.sh ssl
```

Сертификаты автоматически обновляются через cron job.

### Как мониторить приложение?

**Стек мониторинга (опционально):**
```bash
./scripts/setup-monitoring.sh start
```

Включает:
- **Prometheus** - Сбор метрик
- **Grafana** - Визуализация и дашборды
- **Loki** - Агрегация логов

Доступ к Grafana по адресу `http://your-domain:3000`.

### А как насчет резервного копирования?

**Автоматические бэкапы:**
```bash
# Ежедневные бэкапы (cron)
./scripts/backup.sh full

# Восстановление из бэкапа
./scripts/backup.sh restore backup_name.tar.gz
```

См. [Процедуры резервного копирования](docs/operations/backup/procedures.md).

---

## Устранение неполадок

### Docker контейнеры не запускаются

**Проверьте логи:**
```bash
docker-compose logs backend
docker-compose logs frontend
```

**Распространенные проблемы:**
- Конфликты портов (8000, 5173, 5432, 6379)
- Отсутствует .env файл
- Неправильные переменные окружения

См. [Руководство по устранению неполадок](TROUBLESHOOTING.md) для решений.

### NLP модели не найдены

**Установите необходимые модели:**
```bash
# SpaCy
python -m spacy download ru_core_news_lg

# Stanza
python -c "import stanza; stanza.download('ru')"

# Natasha (устанавливается через pip)
pip install natasha
```

### Миграции базы данных не работают

**Сбросить и повторить:**
```bash
# Проверить текущую версию
cd backend && alembic current

# Откатить при необходимости
alembic downgrade -1

# Применить обновление
alembic upgrade head

# Принудительная очистка (только для разработки!)
docker-compose down -v
docker-compose up -d
```

### Ошибки сборки Frontend

**Очистить и переустановить:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Изображения не генерируются

**Проверьте:**
1. Статус сервиса pollinations.ai
2. Celery worker запущен: `docker-compose logs celery-worker`
3. Соединение Redis: `docker-compose logs redis`

**Перезапустить Celery:**
```bash
docker-compose restart celery-worker
```

### Тесты падают

**Распространенные причины:**
1. Отсутствуют тестовые фикстуры
2. База данных не в тестовом режиме
3. Async тесты неправильно awaited
4. Не установлены переменные окружения

**Отладка:**
```bash
# Запустить конкретный тест с подробным выводом
pytest tests/test_file.py::test_function -v -s

# Проверить тестовое покрытие
pytest --cov=app --cov-report=html
```

---

## Участие в проекте

### Как я могу внести вклад?

1. Прочитайте [CONTRIBUTING.md](CONTRIBUTING.md)
2. Проверьте [открытые issues](https://github.com/your-org/fancai-vibe-hackathon/issues)
3. Сделайте fork репозитория
4. Создайте feature branch
5. Внесите изменения с тестами
6. Отправьте pull request

### Каковы стандарты кодирования?

**Backend (Python):**
- PEP 8 с форматированием Black
- Обязательны type hints (MyPy strict mode)
- Docstrings (Google style)
- Покрытие тестами >70%

**Frontend (TypeScript):**
- ESLint + Prettier
- Строгая проверка типов
- JSDoc комментарии
- React best practices

См. [Стандарты кодирования](CONTRIBUTING.md#coding-standards).

### Как писать документацию?

**Требуется для каждого изменения:**
1. Обновить README.md (если новая функция)
2. Обновить development-plan.md (отметить задачи)
3. Обновить development-calendar.md (даты)
4. Обновить changelog.md (детальное описание)
5. Обновить current-status.md (состояние проекта)
6. Добавить docstrings/комментарии в код

См. [Требования к документации](CONTRIBUTING.md#documentation-requirements).

### Сколько времени занимает ревью PR?

- Простые исправления: 1-2 дня
- Новые функции: 3-7 дней
- Breaking changes: 1-2 недели

Автоматические CI/CD проверки запускаются немедленно.

---

## Остались вопросы?

- **Документация:** Проверьте директорию [docs/](docs/)
- **Issues:** Поищите в [GitHub Issues](https://github.com/your-org/fancai-vibe-hackathon/issues)
- **Устранение неполадок:** См. [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Участие:** См. [CONTRIBUTING.md](CONTRIBUTING.md)
- **Контакт:** Откройте новый issue с вашим вопросом

---

**Последнее обновление:** 14 ноября 2025

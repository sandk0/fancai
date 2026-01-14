#!/bin/bash

# =============================================================================
# Скрипт установки Serena MCP для проекта fancai
# =============================================================================
# Использование: ./scripts/setup-serena.sh
# =============================================================================

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функции вывода
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Заголовок
echo ""
echo "=============================================="
echo "   Serena MCP Setup для проекта fancai"
echo "=============================================="
echo ""

# Определяем корень проекта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

info "Корень проекта: $PROJECT_ROOT"

# =============================================================================
# Шаг 1: Проверка зависимостей
# =============================================================================

info "Проверка зависимостей..."

# Проверка Python
if ! command -v python3 &> /dev/null; then
    error "Python3 не найден. Установите Python 3.11+: brew install python@3.11"
fi

PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
if [[ $(echo "$PYTHON_VERSION < 3.11" | bc -l) -eq 1 ]]; then
    warn "Рекомендуется Python 3.11+. Текущая версия: $PYTHON_VERSION"
fi
success "Python: $(python3 --version)"

# Проверка uv
if ! command -v uvx &> /dev/null; then
    warn "uv не найден. Устанавливаем..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source ~/.cargo/env 2>/dev/null || source ~/.bashrc 2>/dev/null || true
fi

if command -v uvx &> /dev/null; then
    success "uv: $(uv --version 2>&1 || echo 'установлен')"
else
    error "Не удалось установить uv. Установите вручную: curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

# Проверка Claude Code
if ! command -v claude &> /dev/null; then
    warn "Claude Code CLI не найден в PATH"
    warn "Убедитесь, что Claude Code установлен и настроен"
fi

# =============================================================================
# Шаг 2: Добавление Serena MCP в Claude Code
# =============================================================================

info "Добавление Serena MCP в Claude Code..."

# Удаляем старую конфигурацию (если есть)
claude mcp remove serena 2>/dev/null || true

# Добавляем новую конфигурацию
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena \
    serena start-mcp-server \
    --context claude-code \
    --project "$PROJECT_ROOT"

success "Serena MCP добавлен в Claude Code"

# =============================================================================
# Шаг 3: Создание конфигурации проекта
# =============================================================================

SERENA_DIR="$PROJECT_ROOT/.serena"
PROJECT_YML="$SERENA_DIR/project.yml"

info "Создание конфигурации проекта..."

mkdir -p "$SERENA_DIR/memories"

if [ ! -f "$PROJECT_YML" ]; then
    cat > "$PROJECT_YML" << 'EOF'
# Serena MCP Configuration for fancai
# https://oraios.github.io/serena/02-usage/050_configuration.html

# Основные языки проекта
language:
  - typescript
  - python

# Имя проекта
project_name: "fancai"

# Игнорировать файлы из .gitignore
ignore_all_files_in_gitignore: true

# Дополнительные игнорируемые пути
ignored_paths:
  - node_modules/
  - __pycache__/
  - .venv/
  - venv/
  - dist/
  - build/
  - coverage/
  - .pytest_cache/
  - htmlcov/
  - "*.pyc"
  - "*.pyo"
  - ".git/"
  - "*.log"
  - "*.pkl"

# Режим только для чтения
read_only: false

# Исключённые инструменты
excluded_tools: []

# Начальный промпт
initial_prompt: |
  Это проект fancai — веб-приложение для чтения книг с AI-генерацией изображений.
  Frontend: React 19 + TypeScript 5.7, epub.js, TanStack Query, Zustand
  Backend: FastAPI 0.125 + Python 3.11, PostgreSQL 15, Redis 7.4
  AI: Google Gemini 3.0 Flash (извлечение описаний), Google Imagen 4 (генерация изображений)
  Продакшен: https://fancai.ru
EOF
    success "Создан файл конфигурации: $PROJECT_YML"
else
    info "Файл конфигурации уже существует: $PROJECT_YML"
fi

# =============================================================================
# Шаг 4: Создание базовой памяти проекта
# =============================================================================

MEMORY_FILE="$SERENA_DIR/memories/project_overview.md"

if [ ! -f "$MEMORY_FILE" ]; then
    cat > "$MEMORY_FILE" << 'EOF'
# Обзор проекта fancai

## Назначение
Веб-приложение для чтения художественной литературы с автоматической
генерацией изображений по описаниям в тексте.

## Технологический стек

### Frontend (React 19 + TypeScript)
- **Директория:** `frontend/src/`
- **Компоненты:** 86 файлов в `components/`
  - Reader/ (15 файлов) - EPUB ридер
  - Settings/ (8 файлов) - Настройки
  - Library/ (6 файлов) - Библиотека
  - Admin/ (5 файлов) - Админка
  - UI/ (20+ файлов) - Shared компоненты
- **Хуки:** 56 файлов в `hooks/`
  - api/ (5 файлов) - TanStack Query
  - epub/ (22 файла) - EPUB функциональность
  - reader/ (9 файлов) - Логика ридера
- **Сервисы:** 9 файлов в `services/`
- **Stores:** 6 Zustand stores
- **Страницы:** 13 файлов

### Backend (FastAPI + Python 3.11)
- **Директория:** `backend/app/`
- **Сервисы:** 17+ файлов в `services/`
- **Роутеры:** `routers/` - API endpoints
- **Модели:** 9 SQLAlchemy моделей
- **Тесты:** 43+ тестов (35 unit + 8 integration)

### AI сервисы
- **Google Gemini 3.0 Flash** - Извлечение описаний из текста
- **Google Imagen 4** - Генерация изображений по описаниям

## Ключевые файлы

### Frontend
- `src/components/Reader/EpubReader.tsx` - Главный EPUB ридер
- `src/hooks/epub/useDescriptionHighlighting.ts` - Подсветка описаний
- `src/hooks/api/queryKeys.ts` - Ключи кэша TanStack Query
- `src/services/chapterCache.ts` - IndexedDB кэш глав
- `src/utils/retryWithBackoff.ts` - Экспоненциальный backoff

### Backend
- `app/services/book_parser.py` - Парсинг EPUB/FB2
- `app/services/gemini_extractor.py` - Извлечение через Gemini API
- `app/services/imagen_generator.py` - Генерация изображений
- `app/core/retry.py` - Retry декораторы (tenacity)
- `app/services/token_blacklist.py` - JWT revocation

## Команды разработки

```bash
# Frontend
cd frontend && npm run dev      # Разработка
cd frontend && npm test         # Тесты
cd frontend && npm run build    # Сборка

# Backend
cd backend && pytest -v         # Тесты
cd backend && alembic upgrade head  # Миграции

# Docker
docker-compose up -d            # Запуск всех сервисов
docker-compose logs -f backend  # Логи
```

## Продакшен
- **URL:** https://fancai.ru
- **Deploy:** `docker-compose.lite.yml`
EOF
    success "Создан файл памяти: $MEMORY_FILE"
else
    info "Файл памяти уже существует: $MEMORY_FILE"
fi

# =============================================================================
# Шаг 5: Индексация проекта
# =============================================================================

echo ""
read -p "Выполнить индексацию проекта? (занимает 1-5 минут) [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    info "Индексация проекта..."
    cd "$PROJECT_ROOT"
    uvx --from git+https://github.com/oraios/serena serena project index
    success "Индексация завершена"
else
    info "Индексация пропущена. Выполните позже:"
    echo "  cd $PROJECT_ROOT"
    echo "  uvx --from git+https://github.com/oraios/serena serena project index"
fi

# =============================================================================
# Завершение
# =============================================================================

echo ""
echo "=============================================="
echo "   Установка Serena MCP завершена!"
echo "=============================================="
echo ""
success "Serena MCP успешно настроен для проекта fancai"
echo ""
info "Следующие шаги:"
echo "  1. Перезапустите Claude Code"
echo "  2. Проверьте MCP инструменты: 'Покажи список MCP инструментов'"
echo "  3. При первом использовании выполните онбординг:"
echo "     'Выполни онбординг проекта с помощью Serena'"
echo ""
info "Конфигурация:"
echo "  - Проект: $PROJECT_YML"
echo "  - Память: $SERENA_DIR/memories/"
echo "  - Кэш:    $SERENA_DIR/cache/"
echo ""
info "Документация:"
echo "  - Руководство: docs/guides/development/serena-mcp-setup.md"
echo "  - GitHub: https://github.com/oraios/serena"
echo ""

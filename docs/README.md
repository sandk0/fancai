# Fancai Documentation

Документация веб-приложения для чтения книг с автоматической генерацией изображений по описаниям. Документация следует фреймворку [Diátaxis](https://diataxis.fr/).

**Продакшен:** https://fancai.ru

## Quick Navigation

### 📘 [Guides](guides/) - Learning & Problem-Solving
Step-by-step tutorials and how-to guides for common tasks.

- **[Getting Started](guides/getting-started/)** - Installation, quick start, first book
- **[Development](guides/development/)** - Environment setup, testing, debugging
- **[Deployment](guides/deployment/)** - Production deployment, Docker, SSL
- **[Agents](guides/agents/)** - Claude Code agents usage
- **[Testing](guides/testing/)** - Writing tests, E2E, QA playbook

### 📖 [Reference](reference/) - Technical Specifications
Detailed technical information and API documentation.

- **[API](reference/api/)** - REST API endpoints and authentication
- **[Database](reference/database/)** - Schema, migrations, diagrams
- **[Components](reference/components/)** - Backend, frontend, parser components
- **[CLI](reference/cli/)** - Command-line interface reference

> **Note:** NLP reference docs archived (December 2025). Description extraction now uses Gemini API.

### 🎓 [Explanations](explanations/) - Concepts & Architecture
Understanding-oriented documentation about system design and decisions.

- **[Architecture](explanations/architecture/)** - System architecture, infrastructure, LLM integration
- **[Concepts](explanations/concepts/)** - CFI system, EPUB integration, subscriptions
- **[Design Decisions](explanations/design-decisions/)** - Why certain technologies were chosen
- **[Resilience](explanations/resilience/)** - Retry strategies, offline sync, error handling

### 🔧 [Operations](operations/) - Deployment & Maintenance
Operations and maintenance documentation.

- **[Deployment](operations/deployment/)** - Production deployment procedures
- **[Docker](operations/docker/)** - Docker setup, upgrade, security
- **[Backup](operations/backup/)** - Backup and restore procedures
- **[Monitoring](operations/monitoring/)** - Setup monitoring and dashboards
- **[Maintenance](operations/maintenance/)** - Database, cache, logs management

### 👨‍💻 [Development](development/) - Development Process
Development planning, progress tracking, and status.

- **[Planning](development/planning/)** - Development plan and calendar
- **[Changelog](development/changelog/)** - Version history
- **[Status](development/status/)** - Current status and progress
- **[Testing](development/testing/)** - Testing strategy and coverage
- **[Performance](development/performance/)** - Optimization plans and analysis

### 🔨 [Refactoring](refactoring/) - Code Refactoring
Refactoring documentation and reports.

- **[Plans](refactoring/plans/)** - Master refactoring plans
- **[Reports](refactoring/reports/)** - Phase reports and summaries
- **[Database](refactoring/database/)** - Database refactoring analysis
- **[NLP](refactoring/nlp/)** - NLP system refactoring
- **[Code Quality](refactoring/code-quality/)** - Code quality improvements

### 🔄 [CI/CD](ci-cd/) - Continuous Integration/Deployment
CI/CD workflows and troubleshooting.

- **[Workflows](ci-cd/workflows/)** - CI/CD workflow documentation
- **[Action Plans](ci-cd/action-plans/)** - Implementation plans
- **[Error Reports](ci-cd/error-reports/)** - Error tracking and solutions

### 🔐 [Security](security/) - Security Documentation
Security policies, audits, and reports.

- **[Reports](security/reports/)** - Security audits and fixes

### 📊 [Reports](reports/) - Temporal Reports Archive
Historical reports from development sessions (archived by quarter).

- **[Archive](reports/archive/)** - Archived reports by quarter

### 🇷🇺 [Russian Documentation](ru/)
Russian translations of documentation (mirrors English structure).

---

## Documentation Philosophy

This documentation follows the **Diátaxis** framework, which organizes content into four categories:

1. **Tutorials** (Learning-oriented) - Take the user by the hand through a series of steps
2. **How-to Guides** (Problem-oriented) - Guide the user through solving a specific problem
3. **Reference** (Information-oriented) - Technical descriptions of the machinery
4. **Explanation** (Understanding-oriented) - Clarify and illuminate topics

## Contributing to Documentation

When adding or updating documentation:

1. Place documents in the appropriate Diátaxis category
2. Update relevant README files with links
3. Follow existing formatting and style
4. Update CLAUDE.md if adding new development processes
5. Create both English and Russian versions when applicable

## Need Help?

- Check [CLAUDE.md](../CLAUDE.md) for development guidelines
- See [README.md](../README.md) for project overview
- Review [Development Plan](development/planning/development-plan.md) for roadmap

---

**Обновлено:** 2026-01-15
**Версия документации:** 4.0 (Post-improvement phases P0-P4)

## Последние изменения (Январь 2026)

### Завершённые фазы улучшений
| Фаза | Фокус | Ключевые изменения |
|------|-------|-------------------|
| P0 | Hotfix | Критические баг-фиксы, стабильность |
| P1 | Security | JWT token blacklist, безопасный logout |
| P2 | Stability | Exponential backoff retry (backend + frontend) |
| P3 | Comprehensive | Offline sync queue, position conflict dialog, интеграционные тесты |
| P4 | Mobile UX | iOS navigation fixes, scroll/zoom lock, safe-area support |

### Новые компоненты (Январь 2026)
- `frontend/src/components/Reader/IOSTapZones.tsx` - iOS-специфичные зоны навигации
- `frontend/src/hooks/epub/useContentHooks.ts` - iOS iframe fixes
- `frontend/src/pages/BookReaderPage.tsx` - useReaderBodyLock hook
- Theme system (Light/Dark/Sepia) с синхронизацией EPUB

### iOS Mobile Fixes
- `touch-action: pan-x pan-y` — отключение pinch-zoom
- `overscroll-behavior: none` — отключение bounce-эффекта Safari
- Safari gesture event prevention (gesturestart/change/end)
- Safe-area support для устройств с notch

### Статистика Frontend (Январь 2026)
| Категория | Количество |
|-----------|------------|
| Components | 86 файлов |
| Hooks | 56 файлов |
| Services | 9 файлов |
| Stores | 6 файлов |
| Pages | 13 файлов |

> **Архитектура:** Multi-NLP система удалена в декабре 2025. Извлечение описаний теперь через Google Gemini API.

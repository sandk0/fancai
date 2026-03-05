---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-03-05T11:05:32Z"
progress:
  total_phases: 9
  completed_phases: 8
  total_plans: 23
  completed_plans: 21
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-02-27)

**Ключевая ценность:** Стабильное AI-приложение для чтения книг со спойлер-защищенной Entity Wiki и AI-иллюстрациями — работает надежно, без сбоев и визуальных глюков
**Текущий фокус:** Фаза 8 в процессе (1/3 плана выполнен). Bookmark/Highlight data layer готов.

## Текущая позиция

Фаза: 8 из 8 (Reader Features) — В процессе
План: 1 из 3 в фазе 8 (data layer закладок/выделений)
Статус: План 08-01 выполнен. Готово к плану 08-02 (визуальный UI).
Последняя активность: 2026-03-05 — Выполнен план 08-01 (Bookmark/Highlight data layer). SQLAlchemy модели, 7 REST endpoints, Zustand CFI store, TanStack Query хуки.

Прогресс: [█████████▒] 91%

## Метрики производительности

**Скорость:**

- Всего планов выполнено: 21
- Средняя продолжительность: ~15 мин
- Общее время выполнения: ~5.2 часа

**По фазам:**

| Фаза                          | Планы | Всего    | Среднее/План |
| ----------------------------- | ----- | -------- | ------------ |
| 01-production-safety          | 2/2   | ~60 мин  | ~30 мин      |
| 02-dead-code-cleanup          | 2/2   | ~39 мин  | ~20 мин      |
| 03-migration-services         | 4/4   | ~129 мин | ~32 мин      |
| 04-infrastructure-maintenance | 3/3   | ~20 мин  | ~10 мин      |
| 04.1-integration-rebrand      | 3/3   | ~15 мин  | ~5 мин       |
| 05-stabilization-ai-techdebt  | 2/2   | ~16 мин  | ~8 мин       |
| 06-entity-wiki                | 2/2   | ~15 мин  | ~8 мин       |
| 07-ux                         | 2/2   | ~11 мин  | ~6 мин       |
| 08-reader-features            | 1/3   | ~7 мин   | ~7 мин       |

_Обновляется после завершения каждого плана_

## Накопленный контекст

### Решения

Решения фиксируются в таблице ключевых решений PROJECT.md.
Недавние решения, влияющие на текущую работу:

- [Дорожная карта 2026-03-04]: Фазы 5-8 переписаны. AI-01 и AI-03 выполнены в фазе 3 (миграция OpenRouter). Фаза 5 переориентирована: circuit breaker + бэкап БД + очистка остаточного техдолга (из CONCERNS.md). UX-06 перенесён из фазы 6 в фазу 5 (проблема целостности данных, а не UI)
- [Дорожная карта 2026-03-04]: DEPLOY-04 (бэкап БД) назначен на фазу 5 вместо "отложено"
- [Дорожная карта 2026-03-04]: Фаза 7 теперь зависит от Phase 4.1 (не Phase 1), фазы 5-6 и 7-8 — параллелизуемые треки
- [Фаза 5 Plan 01]: Circuit breaker через call_async() с предварительной проверкой opened -- декоратор не работает с методами класса
- [Фаза 5 Plan 01]: cleanup_book_data() использует flush() без commit() -- транзакция управляется вызывающим кодом
- [Фаза 5 Plan 02]: prodrigestivill/postgres-backup-local:17 для автоматического бэкапа PostgreSQL
- [Фаза 5 Plan 02]: bind-mount volume /backups/postgres для доступа к бэкапам без Docker
- [Фаза 5 Plan 02]: Очищены ВСЕ "Google Imagen 4" references (не только запланированные в images.py)
- [Фаза 6 Plan 01]: Token overlap >= 0.5 (не > 0.5) — ловит частичные имена: "Гарри" -> "Гарри Поттер" (1/2=0.5)
- [Фаза 6 Plan 01]: LLM dedup threshold 0.75 (не 0.85) — больше автоматических merges при высокой уверенности
- [Фаза 6 Plan 01]: BATCH_SIZE=50, MAX_DEPTH=2 — баланс между качеством и количеством LLM-вызовов
- [Фаза 6 Plan 02]: hypothesis без пина версии — поддерживает обратную совместимость
- [Фаза 6 Plan 02]: 500 examples на property-тест — баланс покрытия и скорости (~6 сек на 11 тестов)
- [Фаза 6 Plan 02]: database=None в @settings — воспроизводимость без .hypothesis/ директории
- [Фаза 7 Plan 01]: mapApiError поддерживает 3 типа входных данных (Axios, Error, строки) для обратной совместимости
- [Фаза 7 Plan 01]: CircuitBreaker (503 + 'circuit') -> isRetryable=false, кнопка retry скрыта
- [Фаза 7 Plan 01]: ErrorBoundary использует i18n.t() напрямую (class component, нет хуков)
- [Фаза 7 Plan 01]: UX-04 (loading при смене глав) -- НЕ реализуется, решение пользователя
- [Фаза 7 Plan 02]: WebSocket onError разделён: parsing errors показываются в UI, timeout/connection переключают на polling
- [Фаза 7 Plan 02]: Retry парсинга через processBook (POST /api/books/{id}/process), не reprocess-descriptions
- [Фаза 7 Plan 02]: useChapterData проксирует error и refetch -> useChapterManagement -> EpubReader -> ExtractionIndicator
- [Фаза 7 Plan 02]: CircuitBreakerError (isRetryable=false) скрывает retry кнопку в обоих компонентах
- [Фаза 8 Plan 01]: UniqueConstraint(user_id, book_id, cfi) предотвращает дубликаты закладок
- [Фаза 8 Plan 01]: page поле стало опциональным в bookmarks для обратной совместимости с localStorage
- [Фаза 8 Plan 01]: Optimistic updates: Zustand в onMutate, rollback в onError, invalidate в onSettled
- [Фаза 8 Plan 01]: Batch sync использует process_bookmark_sync/process_highlight_sync вместо 501 заглушек

### Ожидающие задачи

Пока нет.

### Блокеры/Опасения

- [Тесты]: 2 pre-existing сломанных теста (test_langextract_processor.py, test_circuit_breaker.py) -- не блокируют, но требуют внимания

## Непрерывность сессий

Последняя сессия: 2026-03-05
Остановились на: Выполнен план 08-01-PLAN.md (Bookmark/Highlight data layer). Готово к плану 08-02.
Файл возобновления: .planning/phases/08-reader-features/08-02-PLAN.md

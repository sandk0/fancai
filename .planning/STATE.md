---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: iOS Reader Navigation Fixes
status: Phase 28.1 завершена (blob URL fix -- imageCache.release убран из closeModal)
last_updated: "2026-03-16T21:06:09.801Z"
last_activity: 2026-03-17 — Phase 28.1 Plan 01 завершена (blob URL lifecycle fix, 2 min)
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 11
  completed_plans: 11
  percent: 100
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-14)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 28.1 завершена (blob URL fix). Milestone v1.3 завершён.

## Текущая позиция

Phase: 28.1 (9 of 9) — fix: blob URL revoked при закрытии ImageModal ломает изображение в DescriptionDrawer
Plan: 01 of 01 (Plan 01 завершена, Phase 28.1 завершена)
Status: Phase 28.1 завершена (blob URL fix -- imageCache.release убран из closeModal)
Last activity: 2026-03-17 — Phase 28.1 Plan 01 завершена (blob URL lifecycle fix, 2 min)

Progress: [██████████] 100%

## Метрики производительности

**Общая статистика:**

| Milestone | Фазы | Планы | Время  | Среднее/план |
| --------- | ---- | ----- | ------ | ------------ |
| v1.0      | 9    | 23    | 9 дней | --           |
| v1.1      | 6    | 13    | 92 min | 7 min        |
| v1.2      | 8    | 21    | 4 дня  | --           |
| v1.3      | 5    | —     | —      | —            |

## Накопленный контекст

### Решения

Полная таблица решений: .planning/PROJECT.md

- Корневая причина: iOS Safari НЕ доставляет touch events в iframe contentDocument (100% source:parent)
- Стратегия фикса: полноэкранный iOS overlay с FSM для всех жестов (Phase 22)
- Overlay left:10px для Safari back gesture, touch-action:none
- FSM вынесена в shared utility gestureUtils.ts (Phase 23 Plan 01)
- Shared touchRef между overlay и iframe handler (platform-exclusive)
- Shared FSM через dependency injection (GestureFSMDeps interface)
- Overlay top динамический: 0 в immersive, safe-area+64px с header
- UAT на iPhone 15 Pro: все 8 проверок пройдены (Safari, Chrome, PWA) -- Phase 23 Plan 02
- Строго последовательный pipeline: каждая фаза зависит от предыдущей
- TQ useQuery refetchInterval заменяет ручной setInterval для Celery task polling (Phase 26 Plan 02)
- Visibility пауза через встроенный focusManager вместо useVisibilityManager (Phase 26 Plan 02)
- useImageForDescription TQ query как SSoT для изображений в DescriptionDrawer (Phase 26 Plan 01)
- mutation.reset() при смене описания для предотвращения stale data (Phase 26 Plan 01)
- imageKeys.byBook инвалидация в useGenerateImage для обновления images[] (Phase 26 Plan 01)
- ValueError для HTTP 400 (non-retryable), RateLimitError для HTTP 429 (retryable) в generate_image (Phase 27 Plan 01)
- RuntimeError для missing choices в OpenRouter ответе -- транзиентная ошибка (Phase 27 Plan 01)
- Structured logging extra: model, duration, response_preview, prompt_preview (Phase 27 Plan 01)
- RuntimeError добавлен в IMAGE_GENERATION_EXCEPTIONS для tenacity retry (Phase 27 Plan 02)
- _generate_with_retry как отдельный метод -- cache check и prompt engineering НЕ повторяются при retry (Phase 27 Plan 02)
- metadata хранится как JSON string в optional поле CachedImage -- schema version bump не нужен (Phase 28 Plan 01)
- getWithMetadata() -- отдельный метод для backward compatibility с get() (Phase 28 Plan 01)
- useDeleteImage принимает {imageId, descriptionId} -- нет внешних consumers, breaking change безопасен (Phase 28 Plan 01)
- useRegenerateImage() вызывается напрямую внутри ImageModal (direct hook) -- безопасно т.к. conditional render = mount/unmount (Phase 28 Plan 02)
- BookReader.tsx: useReaderImageModal заменён на inline state вместо удаления всего orphaned компонента (Phase 28 Plan 02)
- imageCache.release() убран из closeModal -- blob URL shared с TQ cache (staleTime 30 мин), revoke ломает изображение (Phase 28.1 Plan 01)

### Ожидающие задачи

Нет.

### Эволюция Roadmap

- Phase 26 добавлена: fix(images): исправить баги генерации и отображения изображений в читалке
- Phase 27 добавлена: Надёжность генерации изображений (OpenRouter FLUX.2 retry и error handling)
- Phase 28 добавлена: Аудит Frontend генерации изображений по описаниям (соответствие Backend, UX недочёты, error handling)
- Phase 28.1 inserted after Phase 28: fix: blob URL revoked при закрытии ImageModal ломает изображение в DescriptionDrawer (URGENT)

### Блокеры/Опасения

- Противоречие `touch-action: pan-x pan-y` vs `manipulation` на iOS -- разрешить в Phase 21
- Тестирование только на физическом iPhone 15 Pro (iOS 26.3.1)
- PWA standalone mode имеет недокументированные отличия от Safari tab

## Непрерывность сессий

Последняя сессия: 2026-03-17
Phase 28.1 Plan 01 завершена. Task 1 (796a8ac): убран imageCache.release() из closeModal, добавлен комментарий о lifecycle. Task 2 (0108bfe): тест инвертирован (not.toHaveBeenCalled), добавлен новый тест blob URL reuse. Все 20 тестов проходят, production build OK.
Resume file: .planning/phases/28.1-fix-blob-url-revoked-imagemodal-descriptiondrawer/28.1-01-SUMMARY.md

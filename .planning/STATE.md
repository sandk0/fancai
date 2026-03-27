---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Оптимизация обработки книг
status: Phase 35 Plan 02 завершена (status semantics + VPS timeout + time budget check)
last_updated: "2026-03-28T22:08:00Z"
last_activity: 2026-03-28
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 4
  completed_plans: 4
  percent: 50
---

# Состояние проекта

## Ссылка на проект

См.: .planning/PROJECT.md (обновлен 2026-03-14)

**Ключевая ценность:** AI-ридер с интерактивной Entity Wiki -- загрузка книги, чтение, AI-глоссарий без спойлеров, иллюстрации, заметки
**Текущий фокус:** Phase 35 Plan 02 завершена — status semantics + VPS timeout + time budget. Следующий: Plan 03 (schema constraints + reconciliation + GPU config).

## Текущая позиция

Phase: 35 (production-semantics)
Plan: 02 of 03 (Plan 02 завершена)
Status: Phase 35 Plan 02 завершена (status semantics + VPS timeout + time budget check)
Last activity: 2026-03-28

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
- DescriptionDrawer: прямой вызов imagesAPI.generateAsync вместо useGenerateImage -- polling pattern требует useState + useQuery (Phase 28.2 Plan 02)
- Удалён generateMutation.data из image preview -- SSoT через TQ invalidation после polling completion (Phase 28.2 Plan 02)
- 409 conflict обрабатывается через TQ cache invalidation без показа ошибки (Phase 28.2 Plan 02)
- openrouter_image_breaker как отдельный CircuitBreaker -- LLM failures НЕ блокируют image generation (Phase 28.2 Plan 01)
- pipeline_stage structured logging с timing на каждом этапе image pipeline для диагностики (Phase 28.2 Plan 01)

- NERService lazy singleton: get_ner_service() с threading.Lock, паттерн как get_gemini_extractor() (Phase 30 Plan 01)
- TextChunker: razdel.sentenize() + DeBERTa tokenizer, 384 max_tokens, 2 sentence overlap (Phase 30 Plan 01)
- LABEL_MAP: person->character, location->location, artifact->object, organization->object (Phase 30 Plan 01)
- SettingsManager API: get_setting (не get), инициализируется один раз перед циклом по главам (Phase 30 Plan 01)
- Feature flag routing: snapshot use_gliner перед циклом, asyncio.to_thread для синхронного PyTorch inference (Phase 30 Plan 01)

- _finalize_book_status() extracted helper: query failed chapters -> set status -> WebSocket -> push notification (Phase 35 Plan 02)
- check_time_budget() standalone function: time.monotonic() + CELERY_HARD_LIMIT - elapsed - SAFETY_MARGIN (Phase 35 Plan 02)
- VPS_TIMEOUT=960 как локальная константа (LLM_TIMEOUT=900 + 60s buffer), не импорт из modal (Phase 35 Plan 02)
- pubsub **kwargs: обратная совместимость + расширяемость WebSocket message format (Phase 35 Plan 02)

### Ожидающие задачи

Нет.

### Эволюция Roadmap

- Phase 26 добавлена: fix(images): исправить баги генерации и отображения изображений в читалке
- Phase 27 добавлена: Надёжность генерации изображений (OpenRouter FLUX.2 retry и error handling)
- Phase 28 добавлена: Аудит Frontend генерации изображений по описаниям (соответствие Backend, UX недочёты, error handling)
- Phase 28.1 inserted after Phase 28: fix: blob URL revoked при закрытии ImageModal ломает изображение в DescriptionDrawer (URGENT)
- Phase 28.2 inserted after Phase 28: fix: генерация изображений не доходит до OpenRouter (2/3 случаев) + ошибка хранилища на iOS (URGENT)

### Блокеры/Опасения

- Противоречие `touch-action: pan-x pan-y` vs `manipulation` на iOS -- разрешить в Phase 21
- Тестирование только на физическом iPhone 15 Pro (iOS 26.3.1)
- PWA standalone mode имеет недокументированные отличия от Safari tab

## Непрерывность сессий

Последняя сессия: 2026-03-28
Phase 35 Plan 02 завершена. Status semantics (4b901b3) + VPS timeout + time budget (cfd7f0c). 14 тестов проходят.
Resume file: .planning/phases/35-production-semantics/35-02-SUMMARY.md

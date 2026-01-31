# План рефакторинга и стабилизации Fancai Reader

**Дата:** 30 января 2026  
**Статус:** Утвержден (Вариант А: Adaptive PWA Strategy)  
**Приоритет:** High

---

## Стратегия: "Adaptive PWA Guard"
Мы отказываемся от агрессивного размонтирования компонентов (`Unmount`) в пользу мягкой блокировки интерфейса (`Overlay`). Логика защиты PWA будет работать **только** на мобильных устройствах и в PWA-режиме, полностью отключаясь на десктопных браузерах.

---

## Phase 1: Stabilization (Критические исправления)
*Цель: Остановить поток ошибок 400, починить работу на десктопе, убрать визуальные баги при переключении вкладок.*

### 1.1. Fix PWA Guard Scope (Desktop Fix)
**Проблема:** Guard срабатывает на десктопе, ломая UX.
**Решение:** Добавить проверку платформы.
- [ ] В `usePWAResumeGuard.ts` добавить функцию `shouldEnableGuard()`.
- [ ] Логика: `return isMobile || isTablet || isStandalonePWA`.
- [ ] Если `false` — хук ничего не делает (early return).

### 1.2. Implement Mobile Overlay (Mobile Fix)
**Проблема:** Unmount компонента сбрасывает стейт и вызывает тяжелую перезагрузку.
**Решение:** Заменить условный рендеринг на CSS-оверлей.
- [ ] В `BookReaderPage.tsx`: Убрать `if (isResuming) return <Loader />`.
- [ ] Вместо этого: Рендерить `<EpubReader />` всегда.
- [ ] Добавить слой `<div className="absolute inset-0 z-50 ...">` с лоадером, который показывается, когда `isResuming || !isReady`.
- [ ] Добавить `pointer-events-none` (или `all` на оверлее), чтобы блокировать клики во время восстановления.

### 1.3. Stop Infinite 400 Loop (Session Fix)
**Проблема:** `useReadingSession` бесконечно долбится в закрытую сессию. `offlineFirstRetry` в глобальном конфиге пропускает 400 ошибки, но локальный интервал продолжает работать.
**Решение:** Умная обработка ошибок.
- [ ] В `useReadingSession.ts` (updateMutation): Добавить локальный `onError`.
- [ ] Логика `onError`:
    1. Остановить `interval` (clearInterval).
    2. Сбросить локальный `sessionIdRef`.
    3. Инвалидировать Query Cache (`invalidateQueries(['activeSession'])`).
    4. Автоматически инициировать создание *новой* сессии (через `startSession`).

### 1.4. Fix Stale Cache (Data Fix)
**Проблема:** Глобальный `staleTime: 5 min` и локальный `1 min` заставляют клиент думать, что закрытая сессия жива.
**Решение:** Локальный оверрайд конфига.
- [ ] В `useReadingSession.ts` (useQuery):
    - Установить `staleTime: 0`.
    - Установить `gcTime: 1000 * 60` (1 минута).
    - Добавить `refetchOnWindowFocus: true`.

---

## Phase 2: Data Integrity (Целостность данных)
*Цель: Устранить "Split Brain" (рассинхрон между сессией и прогрессом), починить Beacon API и исправить гонку при восстановлении.*

### 2.1. Fix Beacon API (Backend)
**Проблема:** Браузер шлет `POST` (sendBeacon), сервер ждет `PUT`.
**Решение:** Добавить совместимость.
- [ ] В `backend/app/routers/reading_sessions.py`: Добавить эндпоинт `POST /reading-sessions/{id}/end`.
- [ ] Он должен вызывать ту же логику, что и `PUT`.

### 2.2. Fix Restoration Race (Restoration Bug)
**Проблема:** `useReaderPosition` восстанавливает позицию асинхронно, а `useProgressSync` может успеть отправить "0%" или промежуточную позицию во время загрузки, перезаписав прогресс. Механизм `skipNextRelocated` ненадежен при layout thrashing.
**Решение:** Явная блокировка сохранения.
- [ ] В `useReaderPosition.ts`: Экспортировать `isRestoringPosition`.
- [ ] В `EpubReader.tsx`: Прокинуть `isRestoringPosition` в `useProgressSync`.
- [ ] В `useProgressSync.ts`: Добавить проп `isRestoring`. Если `true` — полностью блокировать `saveImmediate` и сбрасывать таймеры.

### 2.3. Sync Integrity (Split Brain)
**Проблема:** `ReadingProgress` (CFI) и `ReadingSession` (Duration) обновляются независимо. Сбой одного не останавливает другой.
**Решение:**
- [ ] Проверить логику: При успешном `updateReadingProgress` (POST) вызывать `updateReadingSession` (PUT) или наоборот?
- [ ] *Решение Phase 1.3 (Stop 400 Loop)* частично решает это, предотвращая "зомби-сессии". Если сессия мертва, мы перестаем слать апдейты в нее.
- [ ] Добавить `onError` в `useProgressSync`, чтобы уведомлять юзера (Toast), если прогресс не сохраняется.

---

## Phase 3: Architecture Hardening (Долгосрочно)
*Цель: Упростить "Hook Spaghetti" и устранить Race Conditions.*

### 3.1. Centralized Visibility Manager
**Проблема:** 6 хуков слушают `visibilitychange` и конфликтуют (один релоадит, другой паузит).
**Решение:**
- [ ] Создать хук `useVisibilityManager`.
- [ ] Он один слушает событие DOM.
- [ ] Раздает состояние (`isVisible`, `timeSinceHidden`) всем подписчикам через Context или Zustand.
- [ ] Управляет приоритетами (например, запрещает `reload` пока не прошел `sync`).

### 3.2. Refactor Reader Lifecycle
**Проблема:** Сложная цепочка зависимостей.
**Решение:**
- [ ] Внедрить State Machine (через `useReducer` или XState) для состояний ридера: `INITIALIZING` -> `READY` -> `RESUMING` -> `ERROR`.
- [ ] Это уберет необходимость в `isReady`, `isResuming`, `isLoading` флагах, разбросанных по 10 файлам.

---

## Порядок выполнения
1. **Phase 1.1 + 1.2** (Desktop Fix + Mobile Overlay) — *Срочно (UX)*
2. **Phase 1.3 + 1.4** (Session Loop + Cache) — *Срочно (Stability)*
3. **Phase 2.1** (Beacon Fix) — *Важно (Data)*
4. **Phase 2.2** (Restoration Race) — *Важно (Bugfix)*
5. **Phase 3** — *По мере возможности*

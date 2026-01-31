# Вопрос: Стратегия PWA Detection для usePWAResumeGuard

**Дата:** 30 января 2026  
**Контекст:** Комплексный анализ Reader системы  
**Приоритет:** CRITICAL (блокирует исправление основного бага)

---

## Текущая ситуация

### Проблема

`usePWAResumeGuard` активен на **всех платформах** (десктоп, мобильный, PWA) и срабатывает при `idleTime > 1500ms`.

**На десктопе это вызывает каскад проблем:**
1. Переключение вкладок на 1.5+ секунды → Guard активируется
2. Guard unmount-ит EpubReader → Сессия закрывается
3. При remount читается stale cache → Бесконечные 400 ошибки

**Код:**
```typescript
// frontend/src/hooks/pwa/usePWAResumeGuard.ts:110-114
if (idleTime < MIN_IDLE_TIME_FOR_GUARD) {  // 1500ms
  return;  // Пропустить только если idle < 1.5s
}

// ❌ НЕТ проверки на:
// - isPWA (standalone mode)
// - isMobile/isTablet
// - Desktop browser
```

### Почему это проблема

На десктопе JS heap **никогда** не выгружается при переключении вкладок. Guard решает проблемы, специфичные для **mobile PWA:**

| Проблема | Mobile PWA | Desktop Browser |
|----------|------------|-----------------|
| JS heap unload | ✅ Происходит | ❌ Не происходит |
| Zustand rehydration delay | ✅ Нужна | ❌ Не нужна |
| epub.js corruption | ✅ Возможна | ❌ Не происходит |
| Auth state loss | ✅ Возможна | ❌ Не происходит |

---

## Варианты решения

### Вариант A: Device Detection (из existing plan)

**Код:**
```typescript
function shouldEnableGuard(): boolean {
  // 1. Проверка на standalone PWA mode
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
  
  // 2. Проверка на мобильное устройство
  const isMobile = /mobile|iphone|ipad|android/i.test(navigator.userAgent);
  
  return isPWA || isMobile;
}

// В handleVisibilityChange:
if (!shouldEnableGuard()) {
  return; // Skip guard на десктопе
}
```

**Плюсы:**
- ✅ Точный контроль — guard только на мобильных/PWA
- ✅ Решает проблему unmount на десктопе
- ✅ Соответствует рекомендациям production PWA apps

**Минусы:**
- ⚠️ Дополнительная сложность (device detection)
- ⚠️ Desktop PWA (Chrome, Edge) могут требовать guard
- ⚠️ UserAgent detection может быть ненадёжным

**Рекомендация librarian agent (best practices):**
> Use `visibilitychange` + device detection для PWA lifecycle management. Disable guard on desktop browsers где JS heap не выгружается.

---

### Вариант B: Увеличить MIN_IDLE_TIME

**Код:**
```typescript
const MIN_IDLE_TIME_FOR_GUARD = 5000; // 5 секунд вместо 1.5s
```

**Плюсы:**
- ✅ Простое решение (одна строка)
- ✅ Уменьшает ложные срабатывания на десктопе
- ✅ Не требует зависимостей

**Минусы:**
- ❌ Не решает проблему полностью (переключение на 5+ секунд всё ещё триггерит)
- ❌ Guard может не срабатывать на медленных мобильных девайсах при коротких suspends
- ❌ Arbitrary threshold без обоснования

---

### Вариант C: Использовать focusManager события вместо idleTime

**Код:**
```typescript
import { focusManager } from '@tanstack/react-query';

// Следить за фокусом через TanStack Query
focusManager.subscribe((isFocused) => {
  if (isFocused) {
    // App resumed
    handleResume();
  }
});
```

**Плюсы:**
- ✅ Event-driven approach (более надёжно)
- ✅ Интеграция с TanStack Query (уже используется)
- ✅ Автоматически учитывает focusOnWindowFocus config

**Минусы:**
- ⚠️ Требует рефакторинга логики guard
- ⚠️ Может не решить проблему полностью (focus events также срабатывают на десктопе)
- ⚠️ Сложнее тестировать

---

### Вариант D (НОВЫЙ): Hybrid Approach из production PWA

**Код (на основе best practices от librarian agent):**
```typescript
function shouldActivateGuard(): boolean {
  // Signal 1: Visibility duration (primary)
  const wasHiddenLongEnough = hiddenDuration > 30_000; // 30 seconds
  
  // Signal 2: Network status
  const isOnline = navigator.onLine !== false;
  
  // Signal 3: Standalone mode OR mobile
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  const isMobile = /mobile|iphone|ipad|android/i.test(navigator.userAgent);
  
  // Guard активен только если:
  // - Скрыты были достаточно долго (30s)
  // - И (PWA или мобильный)
  return wasHiddenLongEnough && (isPWA || isMobile);
}
```

**Плюсы:**
- ✅ Multiple signals (наиболее надёжно)
- ✅ 30s threshold исключает tab switching на десктопе
- ✅ Учитывает network status
- ✅ Соответствует production patterns (Firebase SDK, Complexity extension)

**Минусы:**
- ⚠️ Самый сложный вариант
- ⚠️ Требует больше тестирования

---

## Анализ на основе существующего кода

### useRenditionHealthGuard использует device detection

```typescript
// frontend/src/hooks/epub/useRenditionHealthGuard.ts:44-59
function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

const DEVICE_TYPE = detectDeviceType();
const MIN_BACKGROUND_TIME_FOR_RELOAD = 
  DEVICE_TYPE === 'mobile' || DEVICE_TYPE === 'tablet' ? 0 : 2000;
```

**Вывод:** Проект уже использует device detection в другом хуке. Консистентность!

### Production PWA Examples (librarian research)

Все проанализированные production PWA apps используют:
1. `visibilitychange` event (не `focus`)
2. Device detection ИЛИ idle time threshold (30s+)
3. Debouncing (1000ms) для visibility changes

**Никто не использует** `MIN_IDLE_TIME = 1500ms` без device check.

---

## Моя рекомендация

**Вариант A (Device Detection)** с улучшениями:

```typescript
function shouldEnableGuard(): boolean {
  // 1. Check standalone PWA mode (most reliable)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
  
  // 2. Check mobile/tablet using SAME function as useRenditionHealthGuard
  const deviceType = detectDeviceType(); // Reuse existing function
  const isMobileOrTablet = deviceType === 'mobile' || deviceType === 'tablet';
  
  // Guard активен если PWA ИЛИ мобильное устройство
  return isPWA || isMobileOrTablet;
}

const handleVisibilityChange = useCallback(async () => {
  if (document.visibilityState === 'hidden') {
    lastHiddenTimeRef.current = Date.now();
    return;
  }

  // ✅ Skip guard на десктопе
  if (!shouldEnableGuard()) {
    if (import.meta.env.DEV) {
      console.log('[PWAResumeGuard] Desktop browser detected, skipping guard');
    }
    return;
  }

  // ...rest of guard logic
}, [loadUserFromStorage]);
```

**Почему этот вариант:**
1. ✅ Решает проблему unmount на десктопе (root cause)
2. ✅ Консистентен с `useRenditionHealthGuard` (используется та же функция `detectDeviceType`)
3. ✅ Соответствует production best practices
4. ✅ Не требует внешних зависимостей
5. ✅ Desktop PWA корректно обрабатывается (standalone mode)
6. ✅ Простой rollback если что-то сломается (убрать 1 строку)

---

## Вопрос

**Какой вариант предпочтительнее для вашего проекта?**

- [ ] **A. Device Detection (РЕКОМЕНДУЕТСЯ)** — guard только на mobile/PWA
- [ ] **B. Увеличить MIN_IDLE_TIME до 5s** — простое решение
- [ ] **C. Использовать focusManager events** — event-driven подход
- [ ] **D. Hybrid Approach (30s + signals)** — максимально надёжно, но сложно
- [ ] **E. Другое решение** — опишите ваш вариант

**Дополнительные вопросы:**
1. Есть ли у вас Desktop PWA пользователи (Chrome/Edge installed apps)?
2. Какой % пользователей на mobile vs desktop? (влияет на приоритет)
3. Готовы ли вы к рефакторингу guard logic (варианты C, D) или предпочитаете minimal change (A, B)?

---

## Impact Analysis

| Вариант | Решает unmount на desktop | Решает mobile corruption | Сложность | Риск регрессии |
|---------|---------------------------|--------------------------|-----------|----------------|
| **A** | ✅ | ✅ | Low | Low |
| **B** | ⚠️ Частично | ⚠️ Может не сработать | Very Low | Very Low |
| **C** | ⚠️ Uncertain | ✅ | High | Medium |
| **D** | ✅ | ✅ | Very High | Medium |

---

*Пожалуйста, выберите вариант или предложите свой. Это критический вопрос, который блокирует исправление основного бага с session errors.*

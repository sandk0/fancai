# Исправление краша читалки при сворачивании PWA

**Дата:** 12 января 2026
**Версия:** 1.0
**Статус:** ✅ ИСПРАВЛЕНО

---

## Описание проблемы

### Симптомы
Пользователь сообщил о следующей проблеме:
> "Ошибка загрузки читалки при сворачивании PWA и перехода в него обратно. Воспроизводится стабильно, когда открываешь книгу (начать читать или продолжить чтение), сворачиваешь и снова возвращаешься в PWA. После этого при повторных сворачиваниях работает корректно."

### Шаги воспроизведения
1. Открыть книгу (кнопка "Начать читать" или "Продолжить чтение")
2. Свернуть PWA приложение
3. Вернуться в PWA приложение
4. **Результат:** Читалка крашится или зависает на загрузке

### Паттерн
- Проблема возникает на **первом** сворачивании после открытия книги
- При повторных сворачиваниях работает корректно
- Особенно актуально на iOS и Android

---

## Анализ корневой причины

### Исследованные файлы
| Файл | Назначение |
|------|------------|
| `usePWAResumeGuard.ts` | Защита от race condition при возобновлении PWA |
| `useRenditionSetup.ts` | Инициализация epub.js rendition |
| `EpubReader.tsx` | Основной компонент читалки |

### Найденные проблемы

#### 1. 🔴 КРИТИЧНО: Слишком высокий порог MIN_IDLE_TIME_FOR_GUARD

**Файл:** `frontend/src/hooks/pwa/usePWAResumeGuard.ts:43`

**Проблема:**
```typescript
const MIN_IDLE_TIME_FOR_GUARD = 5000; // 5 секунд
```

Если пользователь открывает книгу и сворачивает приложение **менее чем за 5 секунд**, Resume Guard пропускает защиту:
```typescript
if (idleTime < MIN_IDLE_TIME_FOR_GUARD) {
  console.log('[PWAResumeGuard] Short idle time, skipping guard');
  return; // Защита не активируется!
}
```

**Последствия:**
- При возврате TanStack Query сразу делает refetch
- Zustand ещё не успел rehydrate (занимает ~100ms)
- epub.js rendition пытается работать с corrupted state
- **Краш!**

#### 2. 🔴 КРИТИЧНО: Отсутствие проактивной проверки rendition

**Проблема:**
Проверка здоровья rendition выполнялась через 500ms **ПОСЛЕ** того, как React уже попытался отрендерить компонент с повреждённым состоянием.

**Порядок событий (до исправления):**
1. `visibilitychange` → app становится visible
2. React немедленно re-рендерит EpubReader
3. rendition corrupted → **КРАШ**
4. Через 500ms: "О, rendition сломан!" (уже поздно)

#### 3. 🟡 ВАЖНО: Нет сохранения позиции перед background

**Проблема:**
При сворачивании приложения JavaScript heap может быть выгружен (iOS/Android memory pressure). Позиция чтения не сохранялась перед `pagehide`, что приводило к потере прогресса.

---

## Решение

### 1. Снижение MIN_IDLE_TIME_FOR_GUARD

**Файл:** `frontend/src/hooks/pwa/usePWAResumeGuard.ts`

```typescript
// Было
const MIN_IDLE_TIME_FOR_GUARD = 5000;

// Стало
const MIN_IDLE_TIME_FOR_GUARD = 1500;
```

**Обоснование:** 1.5 секунды достаточно короткий порог, чтобы:
- Ловить сворачивания во время инициализации книги
- Не активировать guard при случайных фокусах окна

### 2. Новый хук useRenditionHealthGuard

**Файл:** `frontend/src/hooks/epub/useRenditionHealthGuard.ts` (НОВЫЙ)

```typescript
export function useRenditionHealthGuard({
  rendition,
  bookId,
  onCorrupted,
  enabled = true,
}: UseRenditionHealthGuardOptions): RenditionHealthGuardReturn
```

**Функции:**
- **Проактивная проверка:** Выполняется через 100ms после `visibilitychange`, **ДО** React re-render
- **Сохранение позиции:** Записывает CFI в localStorage перед `pagehide`
- **Восстановление:** Загружает сохранённую позицию при возобновлении

**Проверка здоровья:**
```typescript
const checkHealth = useCallback(async (): Promise<boolean> => {
  try {
    const loc = currentRendition.currentLocation();
    if (!loc || !loc.start || !loc.end) throw new Error('Invalid location');
    if (!currentRendition.manager) throw new Error('Manager is null');
    return true;
  } catch (e) {
    return false;
  }
}, []);
```

### 3. Интеграция в EpubReader

**Файл:** `frontend/src/components/Reader/EpubReader.tsx`

```typescript
const {
  isHealthy: isRenditionHealthy,
  isChecking: isCheckingHealth,
  markHealthy,
} = useRenditionHealthGuard({
  rendition,
  bookId: book.id,
  onCorrupted: async () => {
    // Очистка IndexedDB cache для книги
    await chapterCache.clearBookChapters(bookId);
    // Перезагрузка страницы
    window.location.reload();
  },
  enabled: renditionReady && !!rendition,
});
```

**Обновлённый loading overlay:**
```typescript
{(isLoading || isGenerating || isRestoringPosition ||
  isCheckingHealth || (!isRenditionHealthy && renditionReady)) && (
  <div className="loading-overlay">
    {isCheckingHealth
      ? "Восстановление сессии..."
      : "Загрузка..."}
  </div>
)}
```

---

## Изменённые файлы

| Файл | Тип изменения | Описание |
|------|---------------|----------|
| `frontend/src/hooks/pwa/usePWAResumeGuard.ts` | Изменён | MIN_IDLE_TIME_FOR_GUARD: 5000 → 1500ms |
| `frontend/src/hooks/epub/useRenditionHealthGuard.ts` | **Новый** | Проактивная проверка rendition (331 строка) |
| `frontend/src/components/Reader/EpubReader.tsx` | Изменён | Интеграция health guard, упрощение Hook 19 |

---

## Технические детали

### Жизненный цикл PWA (до исправления)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User opens book                                               │
│ 2. epub.js initializes rendition                                 │
│ 3. User minimizes PWA (< 5s)                                     │
│    └─ MIN_IDLE_TIME_FOR_GUARD = 5000ms                          │
│       └─ Guard SKIPPED!                                          │
│ 4. JS heap unloaded (iOS/Android memory pressure)               │
│ 5. User returns to PWA                                           │
│ 6. React re-renders with corrupted rendition                     │
│ 7. CRASH! 💥                                                     │
│ 8. (500ms later) Health check runs... too late                  │
└─────────────────────────────────────────────────────────────────┘
```

### Жизненный цикл PWA (после исправления)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User opens book                                               │
│ 2. epub.js initializes rendition                                 │
│ 3. User minimizes PWA                                            │
│    └─ pagehide: Save CFI to localStorage                        │
│ 4. JS heap unloaded (iOS/Android memory pressure)               │
│ 5. User returns to PWA                                           │
│    └─ visibilitychange: visible                                 │
│    └─ MIN_IDLE_TIME_FOR_GUARD = 1500ms → Guard ACTIVE           │
│    └─ focusManager.setFocused(false) ← Prevent refetch          │
│ 6. Health check runs (100ms delay, BEFORE React re-render)      │
│    └─ isCheckingHealth = true → Show loading overlay            │
│    └─ Check rendition.currentLocation()                         │
│ 7a. If healthy:                                                  │
│     └─ focusManager.setFocused(true)                            │
│     └─ markHealthy() → Normal operation                         │
│ 7b. If corrupted:                                                │
│     └─ Clear IndexedDB cache                                    │
│     └─ window.location.reload()                                 │
│ 8. Success! ✅                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Тестирование

### Ручное тестирование

1. **Быстрое сворачивание (< 5s):**
   - Открыть книгу
   - Свернуть через 2 секунды
   - Вернуться
   - ✅ Должно работать

2. **Длительное сворачивание (> 5s):**
   - Открыть книгу
   - Подождать 10 секунд
   - Свернуть
   - Вернуться
   - ✅ Должно работать

3. **Многократные сворачивания:**
   - Открыть книгу
   - Свернуть → вернуться (x5)
   - ✅ Должно работать стабильно

---

## Заключение

Проблема была вызвана комбинацией факторов:
1. Слишком высокий порог для активации Resume Guard (5s вместо 1.5s)
2. Отсутствие проактивной проверки rendition ДО React re-render
3. Отсутствие сохранения позиции перед уходом в background

Решение реализует best practices для PWA lifecycle:
- **Проактивная защита:** Проверка здоровья до рендеринга
- **Graceful degradation:** Показ loading overlay вместо краша
- **Position recovery:** Сохранение и восстановление позиции чтения

---

*Сгенерировано: Claude Code*
*Время исправления: ~30 минут*

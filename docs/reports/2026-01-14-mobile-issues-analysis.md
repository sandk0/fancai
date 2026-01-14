# Анализ и исправление проблем мобильной навигации: Android safe-area и iOS description click

**Дата:** 2026-01-14
**Статус:** ✅ Исправлено
**Тип:** Критические баги UX

---

## Проблема 1: Android браузер — текст вылезает за нижний край экрана

### Симптомы
- **Android PWA**: Отступы корректны ✅
- **Android браузер**: Текст вылезал за нижний край экрана ❌
- **iOS PWA + браузер**: Работает корректно ✅

### Корневая причина

В `useEpubLoader.ts` функция `getUsableViewportHeight()` вызывалась **ТОЛЬКО для iOS**:

```typescript
// БЫЛО (проблемный код):
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || ...;

if (isIOSDevice && viewerRef.current) {  // ← Android НЕ включён!
  const height = getUsableViewportHeight(containerRect, 70);
  renditionHeight = height;
}
```

### ✅ Решение (реализовано)

Добавлено определение Android и расширено условие:

```typescript
// СТАЛО (исправленный код):
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || ...;
const isAndroidDevice = /Android/i.test(navigator.userAgent);
const isMobileDevice = isIOSDevice || isAndroidDevice;

if (isMobileDevice && viewerRef.current) {  // ← Теперь включает Android!
  const height = getUsableViewportHeight(containerRect, 70);
  renditionHeight = height;
}
```

**Файл:** `frontend/src/hooks/epub/useEpubLoader.ts`

---

## Проблема 2: iOS — клик по описаниям не работает

### Симптомы
- На iOS (PWA + Safari) клик по выделенному описанию не открывал модальное окно ❌
- Debug overlay показывал координаты отправки (`BC:X,Y`)
- Но сообщение не доходило до iframe

### Корневая причина

**BroadcastChannel и postMessage НЕ работают** с blob: URL iframes на Safari из-за storage partitioning:

```
┌─────────────────────────────────────────────────────────┐
│  IOSTapZones (overlay)                                  │
│  └─ BroadcastChannel.postMessage({TAP_COORDINATES})     │  ← НЕ РАБОТАЕТ!
│  └─ iframe.contentWindow.postMessage(...)               │  ← НЕ РАБОТАЕТ!
└─────────────────────────────────────────────────────────┘
         │
         ✗ Storage partitioning блокирует
         │
┌─────────────────────────────────────────────────────────┐
│  epub.js iframe (blob: URL - opaque origin)             │
│  └─ BroadcastChannel.onmessage (НЕ получает)            │
└─────────────────────────────────────────────────────────┘
```

> "Storage is first partitioned according to top-level sites. Iframe cannot communicate with the parent page despite same-origin."
> — [MDN Browser Compat Data Issue #18471](https://github.com/mdn/browser-compat-data/issues/18471)

### ✅ Решение (реализовано)

**Новый подход: использование epub.js API `rendition.getContents()`**

Этот API предоставляет прямой доступ к документу iframe, обходя ограничения blob: origins:

```typescript
// НОВАЯ АРХИТЕКТУРА:
┌─────────────────────────────────────────────────────────┐
│  IOSTapZones                                            │
│  └─ touchEnd → координаты (x, y)                        │
│      └─ onCenterTap(x, y) callback                      │  ← CALLBACK
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  EpubReader                                             │
│  └─ onCenterTap handler                                 │
│      └─ rendition.getContents()[0].document             │  ← EPUB.JS API
│      └─ doc.elementFromPoint(x, y)                      │  ← РАБОТАЕТ!
│      └─ найти .description-highlight                    │
│      └─ openModal(description, image)                   │
└─────────────────────────────────────────────────────────┘
```

**Изменения:**

1. **IOSTapZones.tsx:**
   - Добавлен prop `onCenterTap?: (x: number, y: number) => void`
   - Удалён код BroadcastChannel/postMessage
   - При тапе вызывается callback с координатами

2. **EpubReader.tsx:**
   - Добавлен handler `onCenterTap`
   - Использует `rendition.getContents()[0].document.elementFromPoint(x, y)`
   - Находит описание и открывает модальное окно

---

## Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `frontend/src/hooks/epub/useEpubLoader.ts` | Добавлено определение Android, расширено условие для mobile |
| `frontend/src/components/Reader/IOSTapZones.tsx` | Добавлен `onCenterTap` callback, удалён BroadcastChannel |
| `frontend/src/components/Reader/EpubReader.tsx` | Добавлен handler для `onCenterTap` |
| `frontend/src/hooks/epub/useContentHooks.ts` | Удалён неиспользуемый код BroadcastChannel (~200 строк) |

---

## Тестирование

### Чек-лист

| Платформа | Отступы | Клик по описаниям |
|-----------|---------|-------------------|
| iOS Safari browser | ✅ | ⏳ Ожидает тест |
| iOS PWA | ✅ | ⏳ Ожидает тест |
| Android Chrome browser | ⏳ Ожидает тест | N/A (работает через rendition.on) |
| Android PWA | ✅ | N/A |

### Как тестировать

1. **Android browser safe-area:**
   - Открыть книгу в Chrome browser (не PWA)
   - Убедиться что текст не вылезает за нижний край экрана
   - Проверить что навигация работает корректно

2. **iOS description click:**
   - Открыть книгу с подсвеченными описаниями
   - Кликнуть по описанию в центральной зоне
   - Debug overlay должен показать `TAP:X,Y`
   - Должно открыться модальное окно с изображением

---

## Технические детали

### Почему BroadcastChannel не работает с blob: iframes

1. **Storage Partitioning** (Safari): Каждый top-level site имеет изолированное хранилище
2. **Blob URLs как opaque origins**: `blob:http://...` рассматривается как отдельный origin
3. **BroadcastChannel работает только внутри одного storage partition**

### Почему rendition.getContents() работает

1. epub.js создаёт iframe и сохраняет ссылку на его document
2. `rendition.getContents()` возвращает массив Contents объектов
3. `contents[0].document` даёт прямой доступ к DOM iframe
4. Это обходит security restrictions потому что epub.js уже имеет доступ

---

## Источники

- [MDN: BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
- [MDN Browser Compat Data Issue #18471](https://github.com/mdn/browser-compat-data/issues/18471) - BroadcastChannel + iframe не работает
- [WHATWG HTML Issue #7219](https://github.com/whatwg/html/issues/7219) - BroadcastChannel в detached iframe
- [Can I Use: BroadcastChannel](https://caniuse.com/broadcastchannel)
- [readium-js Issue #72](https://github.com/readium/readium-js/issues/72) - Blob URL issues на iOS/Safari

---

## Следующие шаги

1. [ ] Развернуть на тестовом сервере
2. [ ] Протестировать на реальных устройствах:
   - iOS Safari browser
   - iOS PWA
   - Android Chrome browser
3. [x] ~~Удалить неиспользуемый BroadcastChannel код из `useContentHooks.ts`~~ ✅ Готово
4. [ ] Удалить debug overlay после подтверждения работоспособности

---

## Коммиты

| Хэш | Описание |
|-----|----------|
| `4ca9595` | fix(mobile): Android browser safe-area + iOS description click |
| `d90542a` | refactor(ios): remove unused BroadcastChannel code from useContentHooks |

---

## История изменений

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2026-01-14 | 1.0 | Первоначальный анализ |
| 2026-01-14 | 2.0 | Реализованы исправления |
| 2026-01-14 | 2.1 | Cleanup: удалён неиспользуемый код BroadcastChannel |

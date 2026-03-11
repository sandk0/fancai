# Phase 19: Описания и Entity Popup - Research

**Researched:** 2026-03-11
**Domain:** Мобильный UX (bottom sheets, tap interception, CSS injection в epub iframe)
**Confidence:** HIGH

## Summary

Фаза 19 решает две задачи: (1) улучшение UX описаний и сущностей через переход на Vaul bottom sheets с единообразным поведением, и (2) исправление бага ENT-02 с перехватом тапов навигацией у краёв экрана.

Кодовая база хорошо подготовлена для этих изменений. Vaul (v1.1.2) уже используется в 4 компонентах, `MobilePanel` предоставляет готовый wrapper с snap points. `getInteractiveType()` в gesture controller уже правильно идентифицирует `description` и `entity` ПЕРЕД zone detection. Основная работа -- расширение `DescriptionDrawer` (генерация изображений), замена `EntityPopup` на bottom sheet, приглушение CSS opacity описаний, и добавление toggle в настройках.

Ключевой архитектурный паттерн: описания обрабатываются через `onCenterTap` + `elementFromPoint` (handleCenterTap в EpubReader), а сущности -- через прямой click handler в `useEntityNameHighlighting` (привязан к `rendition.on('click')`). Для entity bottom sheet нужно изменить интерфейс -- вместо `position: {x, y}` передавать только entity и показывать bottom sheet.

**Primary recommendation:** Разделить на 2 плана: (1) DescriptionDrawer + EntityBottomSheet + i18n, (2) ENT-02 fix + CSS приглушение + toggle в настройках.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Кнопка генерации изображения показывается ВСЕГДА: "Сгенерировать" если нет изображения, "Посмотреть" если есть
- Один тап на подсвеченное описание = сразу открывает DescriptionDrawer (bottom sheet), без промежуточного popup
- Генерация НЕ запускается автоматически при клике -- пользователь явно нажимает кнопку "Сгенерировать" внутри drawer
- При генерации: спиннер/прогресс прямо в drawer, drawer остаётся открытым
- После генерации: превью изображения появляется в drawer, клик на превью открывает полноэкранный ImageModal
- Snap points: [0.4, 0.8] -- унификация с другими панелями (MobilePanel), убрать max-h-[60vh]
- Закрытие при навигации: drawer закрывается при свайпе/тапе перелистывания (Phase 17 panel dismiss)
- Типы описаний перевести на русский через i18n (ru.json)
- Содержимое drawer: тип-badge + полный текст описания + кнопка изображения
- EntityPopup переделать из floating карточки (240x140px) в Vaul bottom sheet
- Entity bottom sheet: аватар/placeholder + имя + тип (i18n) + краткое описание (100 символов) + кнопка "Подробнее"
- Snap points entity: [0.3, 0.6] -- компактный по умолчанию, можно растянуть
- Кнопка "Подробнее" ВСЕГДА закрывает bottom sheet и открывает полный EntityDrawer
- Стили описаний и сущностей остаются РАЗНЫМИ: описания -- цветной фон, сущности -- пунктирное подчёркивание
- Описания: приглушить фон -- opacity 5-8% вместо текущих 15-20%
- Active state (:active) на мобильных для описаний и сущностей
- Toggle descriptionHighlightingEnabled в reader store + toggle в ReaderSettingsPanel
- Починить баг ENT-02 обязательно -- столько итераций, сколько нужно
- iOS-специфичные баги -- в scope фазы, исправлять при обнаружении
- UAT на Pixel 9 (Android PWA / Web Mobile) + iOS Safari

### Claude's Discretion
- Технический путь открытия описания (прямой click handler vs onCenterTap + elementFromPoint)
- Точные значения opacity для приглушённых описаний
- Дизайн спиннера/прогресса генерации в drawer
- Snap point default для DescriptionDrawer (0.4 или 0.8)

### Deferred Ideas (OUT OF SCOPE)
- Onboarding-подсказка при первом появлении описаний/сущностей -- будущий milestone
- Генерация аватаров для сущностей -- новая фича, отдельная фаза
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENT-01 | Popup описания показывает кнопку генерации изображения и полное содержимое | DescriptionDrawer расширяется: snap points вместо max-h, кнопка генерации всегда видна, интеграция с useGenerateImage мутацией |
| ENT-02 | Тапы на выделенные описания и сущности у краёв экрана не перехватываются навигацией | getInteractiveType() уже проверяет классы ДО zone detection -- нужно отладить конкретный баг |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vaul | 1.1.2 | Bottom sheet (Drawer) | Уже используется в 4 компонентах проекта |
| react-i18next | latest | Интернационализация типов | Уже настроен с ru/en переводами |
| zustand | 5.x | Reader store (settings) | Persisted state с миграциями |
| @tanstack/react-query | 5.x | Мутация генерации изображений | useGenerateImage уже готов |
| lucide-react | latest | Иконки (User, MapPin, Package, Loader2) | Используется по всему проекту |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| motion/react | latest | Анимации (AnimatePresence) | Для EntityPopup transition -- НЕ нужен для bottom sheet (Vaul имеет свои) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vaul bottom sheet для entity | Floating popup (текущий) | Bottom sheet унифицирует UX, нет проблем с viewport clamping |
| MobilePanel wrapper | Прямой Drawer.Root | MobilePanel добавляет header/close кнопку, но entity sheet компактнее -- лучше прямой Drawer.Root |

## Architecture Patterns

### Текущий Data Flow для описаний
```
User tap → gesture controller (getInteractiveType → 'description' → return early)
         → epub.js rendition.on('click') → useDescriptionHighlighting click handler
         → onDescriptionClick callback → EpubReader → setDrawerDescription + setIsDrawerOpen
         → DescriptionDrawer (Vaul bottom sheet)
```

### Текущий Data Flow для сущностей
```
User tap → gesture controller (getInteractiveType → 'entity' → return early, NO onCenterTap)
         → epub.js rendition.on('click') → useEntityNameHighlighting click handler
         → onEntityClick callback → EpubReader → setPopupEntity + setPopupPosition
         → EntityPopup (floating карточка с AnimatePresence)
```

### Целевой Data Flow для сущностей (изменение)
```
User tap → gesture controller (getInteractiveType → 'entity' → return early)
         → epub.js rendition.on('click') → useEntityNameHighlighting click handler
         → onEntityClick callback → EpubReader → setPopupEntity (без position!)
         → EntityBottomSheet (Vaul bottom sheet, snap [0.3, 0.6])
```

### Pattern: DescriptionDrawer с генерацией
```typescript
// Расширенный DescriptionDrawer с кнопкой генерации
interface DescriptionDrawerProps {
  description: Description | null;
  image?: GeneratedImage;
  isOpen: boolean;
  onClose: () => void;
  onOpenImage: (description: Description, image?: GeneratedImage) => void;
  bookId: string; // нужен для useGenerateImage
}

// Внутри компонента:
// - useGenerateImage() мутация для генерации
// - isLoading state для спиннера
// - Кнопка: "Сгенерировать" (нет изображения) / "Посмотреть" (есть)
// - После генерации: image preview с onOpenImage
```

### Pattern: EntityBottomSheet (замена EntityPopup)
```typescript
// Новый компонент вместо EntityPopup
interface EntityBottomSheetProps {
  entity: EntityDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenDrawer: (entityId: string) => void;
}

// Vaul Drawer.Root с snapPoints={[0.3, 0.6]}
// Содержимое: avatar + name + type (i18n) + truncated description + "Подробнее"
```

### Anti-Patterns to Avoid
- **НЕ передавать position в EntityBottomSheet:** Bottom sheet не позиционируется относительно клика -- Vaul всегда снизу
- **НЕ использовать MobilePanel для entity:** MobilePanel имеет header с title/close -- entity sheet компактнее, нужен свой layout
- **НЕ автоматически генерировать при открытии drawer:** Пользователь явно нажимает кнопку
- **НЕ менять CSS class names в iframe:** `description-highlight` и `entity-mention` используются в `getInteractiveType()` -- менять нельзя

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bottom sheet | Custom modal + drag | Vaul Drawer.Root с snapPoints | Уже работает в проекте, обрабатывает drag/dismiss/backdrop |
| Image generation mutation | Прямой fetch | useGenerateImage из useImageMutations.ts | Обрабатывает retry, кэширование, query invalidation |
| Image generation API | Новый API вызов | imagesAPI.generateImageForDescription() | Уже существует с retry preset |
| Gesture passthrough | Свой gesture handler | getInteractiveType() в useGestureController | Уже идентифицирует description/entity/annotation/link |
| i18n | Hardcoded строки | t() из react-i18next + ru/en translation.json | Паттерн используется во всём проекте |

## Common Pitfalls

### Pitfall 1: iOS overlay перехватывает тапы в center zone
**What goes wrong:** На iOS центральная зона покрыта `#gesture-controller-ios-overlay` (z-index: 5, left/right: 15%). Тапы на описания/сущности в центре могут быть перехвачены overlay.
**Why it happens:** Overlay слушает touchstart/touchend напрямую, без проверки interactive elements в iframe.
**How to avoid:** iOS overlay handleOverlayTouchEnd уже вызывает `onCenterTapRef.current(viewportX, viewportY)` + `onToggleUIRef.current()`. Описания обрабатываются через handleCenterTap → elementFromPoint. Для entity taps в center zone -- overlay не проверяет entity-mention. Нужно добавить entity detection в overlay handler или полагаться на event bubbling.
**Warning signs:** Тапы на сущности в центре экрана на iOS не открывают popup.

### Pitfall 2: Entity click handler привязан к rendition.on('click'), но gesture controller может "съедать" события
**What goes wrong:** На touch-устройствах gesture controller обрабатывает touchend и return-ит для interactive elements, но это не гарантирует что epub.js click event сработает.
**Why it happens:** Gesture controller привязан к iframe через `contents.document.addEventListener('touchend')`. epub.js click handler привязан через `rendition.on('click')` -- это другой механизм. Если touchend handler не вызывает stopPropagation, click должен нормально всплыть.
**How to avoid:** Проверить что gesture controller НЕ вызывает preventDefault/stopPropagation для interactive types. Текущий код: просто `return` -- это безопасно.
**Warning signs:** entity click работает на desktop, но не на мобильных.

### Pitfall 3: Vaul snap points и h-[95dvh]
**What goes wrong:** Если drawer content height меньше snap point, Vaul может вести себя неожиданно.
**Why it happens:** Vaul Drawer.Content должен иметь достаточную height для работы snap points.
**How to avoid:** Использовать `h-full` или `h-[95dvh]` для Content (как в MobilePanel). Entity sheet [0.3, 0.6] -- Content всё равно должен быть 95dvh, snap points управляют видимой высотой.
**Warning signs:** Drawer не snap-ится к нужной точке.

### Pitfall 4: useDescriptionManagement.ts -- dead code / конфликт с DescriptionDrawer flow
**What goes wrong:** `useDescriptionManagement` hook содержит `handleDescriptionClick` который автоматически генерирует изображение. Этот hook может быть dead code или конфликтовать с новым flow.
**Why it happens:** Исторически описания открывались через этот hook. Сейчас flow: useDescriptionHighlighting → onDescriptionClick → DescriptionDrawer.
**How to avoid:** Проверить, используется ли useDescriptionManagement в EpubReader. Если нет -- можно не трогать. Если да -- нужно заменить на новый flow без авто-генерации.
**Warning signs:** `handleCenterTap` в EpubReader вызывает `handleDescriptionClick(id)` -- нужно проверить что это за handler.

### Pitfall 5: handleCenterTap → handleDescriptionClick цепочка
**What goes wrong:** В EpubReader строка 271: `handleDescriptionClick(id)` -- но handleDescriptionClick определён на строке 240-257 и вызывает `setDrawerDescription + setDrawerImage + setIsDrawerOpen`. Это правильный flow. НО `useDescriptionManagement` тоже экспортирует `handleDescriptionClick` с авто-генерацией.
**Why it happens:** Два разных `handleDescriptionClick` в разных scope.
**How to avoid:** Убедиться что EpubReader использует inline handler (строки 240-257), а не hook из useDescriptionManagement.
**Warning signs:** При тапе на описание сразу запускается генерация без открытия drawer.

### Pitfall 6: descriptionHighlightingEnabled vs descriptionDensity='off'
**What goes wrong:** В store уже есть `descriptionDensity: 'all' | 'key' | 'off'` -- значение 'off' отключает описания. Новый `descriptionHighlightingEnabled` toggle может конфликтовать.
**Why it happens:** Два механизма для одной функции.
**How to avoid:** CONTEXT.md говорит "toggle описаний в настройках" -- это может быть реализовано через существующий descriptionDensity='off'. Нужно уточнить: отдельный boolean toggle или использовать density=off. Рекомендация: использовать существующий `descriptionDensity` с 'off' значением, а НЕ создавать новый `descriptionHighlightingEnabled`.
**Warning signs:** Два отдельных выключателя описаний в настройках.

## Code Examples

### Расширенный DescriptionDrawer с генерацией
```typescript
// Source: существующий DescriptionDrawer.tsx + useGenerateImage мутация
import { Drawer } from 'vaul';
import { useGenerateImage } from '@/hooks/api/useImages/useImageMutations';
import { Loader2 } from 'lucide-react';

// Snap points [0.4, 0.8], убрать max-h-[60vh]
<Drawer.Root
  open={isOpen}
  onOpenChange={(open) => !open && onClose()}
  snapPoints={[0.4, 0.8]}
  activeSnapPoint={activeSnap}
  setActiveSnapPoint={setActiveSnap}
>
  <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-elevated)] rounded-t-xl z-50 h-[95dvh]">
    {/* handle bar */}
    {/* type badge (i18n) */}
    {/* description text */}
    {/* image button: ALWAYS shown */}
    {image?.status === 'completed' ? (
      <button onClick={() => onOpenImage(description, image)}>
        {t('reader.description_drawer.view_image')}
      </button>
    ) : generateMutation.isPending ? (
      <button disabled>
        <Loader2 className="animate-spin" />
        {t('reader.description_drawer.generating')}
      </button>
    ) : (
      <button onClick={() => generateMutation.mutate({ descriptionId: description.id, bookId })}>
        {t('reader.description_drawer.generate')}
      </button>
    )}
    {/* image preview after generation */}
    {generateMutation.data && (
      <img src={generateMutation.data.image_url} onClick={() => onOpenImage(...)} />
    )}
  </Drawer.Content>
</Drawer.Root>
```

### EntityBottomSheet (замена EntityPopup)
```typescript
// Source: MobilePanel.tsx pattern + EntityPopup.tsx содержимое
import { Drawer } from 'vaul';
import { User, MapPin, Package } from 'lucide-react';

<Drawer.Root
  open={!!entity}
  onOpenChange={(open) => !open && onClose()}
  snapPoints={[0.3, 0.6]}
  activeSnapPoint={activeSnap}
  setActiveSnapPoint={setActiveSnap}
>
  <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-background rounded-t-xl z-50 h-[95dvh]">
    <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 my-3" />
    <Drawer.Title className="sr-only">{entity?.name}</Drawer.Title>
    <div className="flex gap-3 px-5 pb-4">
      {/* Avatar / placeholder icon */}
      {/* Name + type (i18n) */}
      {/* Truncated description (100 chars) */}
    </div>
    <div className="border-t px-5 py-3">
      <button onClick={handleOpenDrawer}>
        {t('reader.entity_popup.details')}
      </button>
    </div>
  </Drawer.Content>
</Drawer.Root>
```

### Приглушённые CSS стили описаний
```typescript
// Source: useDescriptionHighlighting.ts TYPE_COLORS → приглушить bg opacity
// Текущие значения: 0.2 (20%) и 0.15 (15%)
// Целевые значения: 0.06 (6%) -- компромисс 5-8%

const TYPE_COLORS: Record<string, { bg: string; border: string; active: string }> = {
  location: {
    bg: 'rgba(96,165,250,0.06)',      // было 0.2
    border: 'rgba(96,165,250,0.4)',    // можно оставить или убрать border
    active: 'rgba(96,165,250,0.15)',   // active state при тапе
  },
  // ... аналогично для character, atmosphere, object, action
};

// Active state через CSS :active pseudo-class
// В injected styles добавить:
s.textContent += `
  .description-highlight:active { background: ${c.active} !important; }
  .entity-mention:active { background: rgba(167,139,250,0.2) !important; }
`;
```

### Panel dismiss при навигации
```typescript
// Source: gesture controller (Phase 17 pattern)
// DescriptionDrawer и EntityBottomSheet должны закрываться при:
// 1. isPanelOpen check → gesture controller dismisses все panels
// 2. Свайп → onPanelDismiss callback

// В EpubReader handlePanelDismiss уже закрывает:
const handlePanelDismiss = useCallback(() => {
  setIsTocOpen(false);
  setIsSettingsOpen(false);
  setIsEntityDrawerOpen(false);
  // Нужно ДОБАВИТЬ:
  setIsDrawerOpen(false);      // DescriptionDrawer
  setPopupEntity(null);         // EntityBottomSheet
}, []);

// isPanelOpen тоже нужно расширить:
const isPanelOpen = isTocOpen || isSettingsOpen || isEntityDrawerOpen
  || isSearchOpen || isDrawerOpen || !!popupEntity;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EntityPopup floating card | EntityBottomSheet (Vaul) | Phase 19 | Унификация UX всех popup-ов |
| Описания с opacity 15-20% | Описания с opacity 5-8% | Phase 19 | Менее навязчивое выделение |
| Авто-генерация при клике | Явная генерация по кнопке | Phase 19 | Пользователь контролирует |
| max-h-[60vh] на DescriptionDrawer | Vaul snap points [0.4, 0.8] | Phase 19 | Консистентность с другими панелями |

## Open Questions

1. **descriptionHighlightingEnabled vs descriptionDensity='off'**
   - What we know: В store уже есть `descriptionDensity` с значением `'off'` которое отключает описания. CONTEXT.md просит "toggle описаний в настройках аналогично nameHighlightingEnabled".
   - What's unclear: Нужен ли отдельный boolean toggle или достаточно существующего density с off?
   - Recommendation: Использовать существующий `descriptionDensity` toggle (All/Key/Off) -- он уже есть в UI и делает ту же работу. НЕ создавать новый boolean, чтобы не дублировать функциональность. В CONTEXT.md сказано "аналогично nameHighlightingEnabled" -- это можно реализовать как простой Switch который переключает между 'all' и 'off'.

2. **iOS overlay и entity taps в center zone**
   - What we know: iOS overlay (#gesture-controller-ios-overlay) покрывает center 70% экрана (left/right: 15%). Overlay вызывает onCenterTap + onToggleUI. handleCenterTap проверяет только `.description-highlight`, не `.entity-mention`.
   - What's unclear: Работают ли entity taps в center zone на iOS? Overlay перехватывает touch events и не прокидывает их в iframe.
   - Recommendation: В handleCenterTap добавить проверку `.entity-mention` аналогично `.description-highlight`. Или: при переходе EntityPopup → EntityBottomSheet, entity клики в center zone на iOS могут потребовать специальной обработки через overlay.

3. **handleDescriptionClick в EpubReader -- какой именно?**
   - What we know: В EpubReader есть два потенциальных handler: (a) inline callback на строках 240-257, (b) import из useDescriptionManagement.
   - Нужно проверить: Grep показал что handleDescriptionClick используется в handleCenterTap (строка 271). На строках 240-257 определён inline handler `handleDescriptionClick` через useCallback, который вызывает useDescriptionManagement.handleDescriptionClick.
   - Recommendation: При рефакторинге заменить useDescriptionManagement.handleDescriptionClick на прямое открытие drawer без авто-генерации.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + @testing-library/react |
| Config file | frontend/vitest.config.ts |
| Quick run command | `cd frontend && npx vitest run src/components/Reader/__tests__/EntityPopup.test.tsx --reporter=verbose` |
| Full suite command | `cd frontend && npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENT-01 | DescriptionDrawer показывает кнопку генерации и полное содержимое | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/DescriptionDrawer.test.tsx -x` | -- Wave 0 |
| ENT-01 | EntityBottomSheet рендерит entity данные, кнопку "Подробнее" | unit | `cd frontend && npx vitest run src/components/Reader/__tests__/EntityBottomSheet.test.tsx -x` | -- Wave 0 |
| ENT-02 | Тапы на описания/сущности у краёв обрабатываются корректно | manual-only | Ручной UAT на Pixel 9 + iOS Safari | N/A |

### Sampling Rate
- **Per task commit:** `cd frontend && npx vitest run src/components/Reader/__tests__/ --reporter=verbose`
- **Per wave merge:** `cd frontend && npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + UAT на Pixel 9

### Wave 0 Gaps
- [ ] `frontend/src/components/Reader/__tests__/DescriptionDrawer.test.tsx` -- covers ENT-01 (drawer content, generate button, view button)
- [ ] `frontend/src/components/Reader/__tests__/EntityBottomSheet.test.tsx` -- covers ENT-01 (entity rendering, "Подробнее" button, truncation)
- [ ] Обновить `frontend/src/components/Reader/__tests__/EntityPopup.test.tsx` -- переименовать/адаптировать для EntityBottomSheet

## Sources

### Primary (HIGH confidence)
- Кодовая база проекта -- прямое чтение всех затрагиваемых файлов
- `DescriptionDrawer.tsx` (71 строка) -- текущая реализация
- `EntityPopup.tsx` (163 строки) -- заменяемый компонент
- `useDescriptionHighlighting.ts` (495 строк) -- CSS injection и click handling
- `useEntityNameHighlighting.ts` (196 строк) -- entity injection и click handling
- `useGestureController.ts` (960+ строк) -- gesture FSM, getInteractiveType, iOS overlay
- `EpubReader.tsx` -- integration point для всех компонентов
- `reader.ts` (Zustand store) -- persisted settings
- `MobilePanel.tsx` -- Vaul Drawer wrapper pattern
- `useImageMutations.ts` -- useGenerateImage мутация
- Vaul v1.1.2 -- package.json в node_modules

### Secondary (MEDIUM confidence)
- `ru/translation.json` -- i18n ключи (entity_popup.details, entities.types.*)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- всё уже используется в проекте, никаких новых зависимостей
- Architecture: HIGH -- data flow полностью прослежен по коду, integration points идентифицированы
- Pitfalls: HIGH -- gesture controller логика проверена построчно, iOS overlay flow понят

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (стабильный стек, внутренняя архитектура)
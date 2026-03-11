# Phase 19: Описания и Entity Popup - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Тапы на описания и сущности корректно открывают popup-ы в любой зоне экрана, не конфликтуя с навигацией. Включает: обновление DescriptionDrawer (кнопка генерации, snap points, спиннер), переход EntityPopup из floating popup в bottom sheet, приглушение стилей описаний, добавление active state, toggle описаний в настройках, исправление ENT-02 (тапы у краёв).

</domain>

<decisions>
## Implementation Decisions

### DescriptionDrawer (ENT-01)
- Кнопка генерации изображения показывается ВСЕГДА: "Сгенерировать" если нет изображения, "Посмотреть" если есть
- Один тап на подсвеченное описание = сразу открывает DescriptionDrawer (bottom sheet), без промежуточного popup
- Генерация НЕ запускается автоматически при клике — пользователь явно нажимает кнопку "Сгенерировать" внутри drawer
- При генерации: спиннер/прогресс прямо в drawer (кнопка меняется на состояние загрузки), drawer остаётся открытым
- После генерации: превью изображения появляется в drawer, клик на превью открывает полноэкранный ImageModal
- Snap points: [0.4, 0.8] — унификация с другими панелями (MobilePanel), убрать max-h-[60vh]
- Закрытие при навигации: drawer закрывается при свайпе/тапе перелистывания (консистентно с Phase 17 panel dismiss)
- Типы описаний (Location, Character, Atmosphere, Object, Action) перевести на русский через i18n (ru.json)
- Содержимое drawer: тип-badge + полный текст описания + кнопка изображения (без номера главы / контекста)

### Entity Popup → Bottom Sheet
- EntityPopup переделать из floating карточки (240x140px) в Vaul bottom sheet
- Содержимое компактное: аватар/placeholder + имя + тип (i18n) + краткое описание (100 символов) + кнопка "Подробнее"
- Snap points: [0.3, 0.6] — компактный по умолчанию, можно растянуть
- Кнопка "Подробнее" ВСЕГДА закрывает bottom sheet и открывает полный EntityDrawer (как сейчас)
- Закрытие при навигации: как DescriptionDrawer
- Placeholder иконки по типу (User/MapPin/Package) — оставить как есть
- Проверить/добавить русские переводы типов сущностей в ru.json

### Визуальная кликабельность
- Стили описаний и сущностей остаются РАЗНЫМИ: описания — цветной фон, сущности — пунктирное подчёркивание
- Описания: приглушить фон — та же цветовая палитра по типу, но более прозрачная (opacity 5-8% вместо текущих 15-20%)
- Описания с/без изображения — одинаковый стиль (наличие изображения видно внутри drawer)
- Active state (:active) на мобильных: кратковременное усиление фона при тапе (для описаний и сущностей)
- Toggle в настройках: добавить descriptionHighlightingEnabled в reader store + toggle в ReaderSettingsPanel (аналогично nameHighlightingEnabled для сущностей)

### Тап-перехват (ENT-02)
- getInteractiveType() в gesture controller уже проверяет CSS-классы ДО zone detection — описания/сущности в edge zones должны приоритетно обрабатываться
- Починить баг ENT-02 обязательно — столько итераций, сколько нужно
- iOS-специфичные баги (iOS overlay, center-tap path) — в scope фазы, исправлять при обнаружении

### Тестирование
- UAT на Pixel 9 (Android PWA / Web Mobile) + iOS Safari
- Unit-тесты для обновлённых компонентов (EntityBottomSheet, DescriptionDrawer)
- Ручной UAT: тапы на описания/сущности в центре, у левого/правого края, проверка drawer/sheet

### Claude's Discretion
- Технический путь открытия описания (прямой click handler vs onCenterTap + elementFromPoint) — главное надёжность
- Точные значения opacity для приглушённых описаний
- Дизайн спиннера/прогресса генерации в drawer
- Snap point default для DescriptionDrawer (0.4 или 0.8)

</decisions>

<specifics>
## Specific Ideas

- Entity bottom sheet = унификация UX: оба типа интерактивных элементов (описания и сущности) открываются как bottom sheet
- Приглушение описаний — та же палитра, но 5-8% opacity: "Тот же background но прозрачнее"
- Генерация по кнопке, не автоматически — "Пользователь явно решает"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DescriptionDrawer.tsx` (71 строка): Vaul Drawer, тип-badge, текст, кнопка — нужно расширить (snap points, генерация, превью)
- `EntityPopup.tsx` (163 строки): floating popup, viewport clamping — ЗАМЕНИТЬ на Vaul bottom sheet
- `useDescriptionManagement.ts` (190 строк): handleDescriptionClick с авто-генерацией — нужно ИЗМЕНИТЬ (разделить открытие drawer и генерацию)
- `useDescriptionHighlighting.ts`: 8 fallback стратегий поиска, CSS стили с цветами по типу — нужно приглушить opacity
- `useEntityNameHighlighting.ts`: injected styles `.entity-mention { border-bottom: 1px dotted rgba(167,139,250,0.6) }` + click handler
- `useGestureController.ts` (1016 строк): `getInteractiveType()` распознаёт description/entity/annotation/link ПЕРЕД zone detection
- `MobilePanel.tsx` (70 строк): Vaul Drawer wrapper с snapPoints — переиспользовать для entity bottom sheet
- `ReaderSettingsPanel`: уже имеет toggle для nameHighlightingEnabled (сущности) — добавить аналогичный для описаний

### Established Patterns
- Vaul bottom sheet для всех панелей (Phase 17: snap points [0.5, 0.95])
- Panel dismiss при тапе в iframe (Phase 17: unified early return)
- CSS injection в epub iframe через rendition.themes.default() (useContentHooks) и прямой DOM injection (useDescriptionHighlighting, useEntityNameHighlighting)
- i18n через react-i18next: `t('key')` с fallback на английский

### Integration Points
- `EpubReader.tsx:363`: useDescriptionHighlighting → onDescriptionClick → setDrawerDescription → DescriptionDrawer
- `EpubReader.tsx:540`: useEntityNameHighlighting → onEntityClick → setPopupEntity → EntityPopup (заменить на EntityBottomSheet)
- `EpubReader.tsx:726`: EntityPopup рендерится — заменить на EntityBottomSheet
- `EpubReader.tsx:762`: DescriptionDrawer рендерится — расширить
- `useGestureController.ts:528-533`: interactive type check → ПЕРЕД zone detection → passthrough для описаний/сущностей
- `ReaderModals.tsx`: не включает DescriptionDrawer и EntityPopup — они рендерятся напрямую в EpubReader

</code_context>

<deferred>
## Deferred Ideas

- Onboarding-подсказка при первом появлении описаний/сущностей ("Нажмите на цветной текст...") — будущий milestone
- Генерация аватаров для сущностей — новая фича, отдельная фаза

</deferred>

---

*Phase: 19-description-entity-popup*
*Context gathered: 2026-03-11*

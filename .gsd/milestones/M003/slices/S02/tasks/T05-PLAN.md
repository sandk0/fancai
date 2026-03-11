# T05: 17-shapka-i-paneli 05

**Slice:** S02 — **Milestone:** M003

## Description

Исправить закрытие панелей по клику вне них — bridge iframe events, фикс MobilePanel, backdrop для SearchPanel.

Purpose: Все панели (TocSidebar, Settings, EntityDrawer, SearchPanel) не закрываются при клике внутри epub iframe, потому что epub.js рендерит книгу в iframe со своим document. Dismiss-механизмы (Vaul, Radix) слушают host document и не видят iframe events. Дополнительно MobilePanel имеет замороженный activeSnapPoint, а SearchPanel вообще не имеет outside-click.

Output: Universal iframe bridge для dismiss панелей, исправленный MobilePanel, backdrop для SearchPanel.

## Must-Haves

- [ ] "Тап внутри epub iframe при открытой панели закрывает панель"
- [ ] "MobilePanel (mobile TocSidebar, mobile Settings) корректно закрывается по свайпу вниз и outside-click"
- [ ] "SearchPanel закрывается по клику вне неё (backdrop или iframe tap)"
- [ ] "Desktop TocSidebar закрывается по клику внутри epub iframe"

## Files

- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/UI/MobilePanel.tsx`
- `frontend/src/components/Reader/SearchPanel.tsx`

# S02: Shapka I Paneli

**Goal:** Адаптивная шапка ридера с overflow menu и перенос кнопки Инфо в TocSidebar.
**Demo:** Адаптивная шапка ридера с overflow menu и перенос кнопки Инфо в TocSidebar.

## Must-Haves


## Tasks

- [x] **T01: 17-shapka-i-paneli 01** `est:7min`
  - Адаптивная шапка ридера с overflow menu и перенос кнопки Инфо в TocSidebar.

Purpose: На экране 320px (iPhone SE) шапка переполняется -- 6 кнопок не помещаются. Нужен overflow menu для второстепенных кнопок с постепенным появлением по breakpoints. Кнопка Инфо удаляется из шапки и становится табом в TocSidebar.
Output: Адаптивный ReaderHeader.tsx с DropdownMenu, обновлённый TocSidebar с 3 табами, очищенная цепочка BookInfo props.
- [x] **T02: 17-shapka-i-paneli 02** `est:5min`
  - Исправление snap points панелей, фикс автофокуса клавиатуры и адаптация SearchPanel.

Purpose: Панели оглавления/настроек/заметок обрезают контент из-за `max-h-[90vh]` и snap point 0.9. Клавиатура выскакивает при открытии оглавления на мобильных. SearchPanel на 320px может не помещаться.
Output: MobilePanel с правильными snap points, TocSidebar без автофокуса на мобильных, SearchPanel адаптивный на 320px.
- [x] **T03: 17-shapka-i-paneli 03** `est:10min`
  - Создать ReaderFooter с прогресс-линией и удалить прогресс из ReaderHeader.

Purpose: Пользователь хочет видеть прогресс внизу читалки, а не в шапке — это освободит место в шапке для кнопок и уберёт визуальный шум. Прогресс-линия на всю ширину с процентом, счетчиком страниц и страницами до конца главы.

Output: Новый компонент ReaderFooter.tsx, обновлённый ReaderHeader без прогресса, расширенный useCFITracking с данными страниц внутри главы.
- [x] **T04: 17-shapka-i-paneli 04** `est:2min`
  - Исправить перехват кликов iOS overlay и вынести Entity Wiki / Settings из overflow menu.

Purpose: (1) BLOCKER — iOS overlay перехватывает тапы по шапке и вызывает toggleUI, скрывая шапку при любом клике. (2) Entity Wiki — ключевая AI-функциональность, должна иметь отдельную кнопку, не быть спрятана в overflow. После плана 17-03 прогресс убран из шапки — место освободилось.

Output: Фикс iOS overlay, реорганизованная шапка с видимыми кнопками Entity Wiki и Settings.
- [x] **T05: 17-shapka-i-paneli 05** `est:8min`
  - Исправить закрытие панелей по клику вне них — bridge iframe events, фикс MobilePanel, backdrop для SearchPanel.

Purpose: Все панели (TocSidebar, Settings, EntityDrawer, SearchPanel) не закрываются при клике внутри epub iframe, потому что epub.js рендерит книгу в iframe со своим document. Dismiss-механизмы (Vaul, Radix) слушают host document и не видят iframe events. Дополнительно MobilePanel имеет замороженный activeSnapPoint, а SearchPanel вообще не имеет outside-click.

Output: Universal iframe bridge для dismiss панелей, исправленный MobilePanel, backdrop для SearchPanel.

## Files Likely Touched

- `frontend/src/components/Reader/ReaderHeader.tsx`
- `frontend/src/components/Reader/TocSidebar.tsx`
- `frontend/src/components/Reader/BookInfo.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`
- `frontend/src/components/Reader/Core/ReaderModals.tsx`
- `frontend/src/components/UI/MobilePanel.tsx`
- `frontend/src/components/Reader/TocSidebar.tsx`
- `frontend/src/components/Reader/SearchPanel.tsx`
- `frontend/src/hooks/epub/useCFITracking.ts`
- `frontend/src/components/Reader/ReaderFooter.tsx`
- `frontend/src/components/Reader/ReaderHeader.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/ReaderHeader.tsx`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/UI/MobilePanel.tsx`
- `frontend/src/components/Reader/SearchPanel.tsx`

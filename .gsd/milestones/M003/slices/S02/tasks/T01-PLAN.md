# T01: 17-shapka-i-paneli 01

**Slice:** S02 — **Milestone:** M003

## Description

Адаптивная шапка ридера с overflow menu и перенос кнопки Инфо в TocSidebar.

Purpose: На экране 320px (iPhone SE) шапка переполняется -- 6 кнопок не помещаются. Нужен overflow menu для второстепенных кнопок с постепенным появлением по breakpoints. Кнопка Инфо удаляется из шапки и становится табом в TocSidebar.
Output: Адаптивный ReaderHeader.tsx с DropdownMenu, обновлённый TocSidebar с 3 табами, очищенная цепочка BookInfo props.

## Must-Haves

- [ ] "На экране 320px шапка показывает только 3 элемента: кнопка Назад, процент по центру, overflow menu (MoreVertical)"
- [ ] "На 375px+ кнопка Оглавление появляется из overflow в шапке"
- [ ] "На sm (640px)+ Сущности и Поиск появляются из overflow"
- [ ] "На md (768px)+ все кнопки видны, overflow скрыт, название книги по центру"
- [ ] "Overflow menu содержит только скрытые на текущем breakpoint кнопки (без дублирования)"
- [ ] "320px: процент без полосы; 375px+: процент + полоса; sm+: процент + полоса + страница/всего"
- [ ] "Кнопка Инфо удалена из шапки, вместо неё таб Info в TocSidebar"

## Files

- `frontend/src/components/Reader/ReaderHeader.tsx`
- `frontend/src/components/Reader/TocSidebar.tsx`
- `frontend/src/components/Reader/BookInfo.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`
- `frontend/src/components/Reader/Core/ReaderModals.tsx`

# T02: 17-shapka-i-paneli 02

**Slice:** S02 — **Milestone:** M003

## Description

Исправление snap points панелей, фикс автофокуса клавиатуры и адаптация SearchPanel.

Purpose: Панели оглавления/настроек/заметок обрезают контент из-за `max-h-[90vh]` и snap point 0.9. Клавиатура выскакивает при открытии оглавления на мобильных. SearchPanel на 320px может не помещаться.
Output: MobilePanel с правильными snap points, TocSidebar без автофокуса на мобильных, SearchPanel адаптивный на 320px.

## Must-Haves

- [ ] "Все панели (оглавление, настройки, заметки) используют snap points [0.5, 0.95]"
- [ ] "Оглавление открывается на snap 0.95 по умолчанию (полная высота)"
- [ ] "Контент панелей не обрезается снизу (max-h-[90vh] заменён)"
- [ ] "При открытии оглавления на мобильном клавиатура НЕ появляется"
- [ ] "На десктопе автофокус поля поиска в оглавлении работает как раньше"
- [ ] "SearchPanel на 320px: поле поиска и крестик полностью видны, ничего не обрезается"

## Files

- `frontend/src/components/UI/MobilePanel.tsx`
- `frontend/src/components/Reader/TocSidebar.tsx`
- `frontend/src/components/Reader/SearchPanel.tsx`

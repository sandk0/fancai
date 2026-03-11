# T03: 17-shapka-i-paneli 03

**Slice:** S02 — **Milestone:** M003

## Description

Создать ReaderFooter с прогресс-линией и удалить прогресс из ReaderHeader.

Purpose: Пользователь хочет видеть прогресс внизу читалки, а не в шапке — это освободит место в шапке для кнопок и уберёт визуальный шум. Прогресс-линия на всю ширину с процентом, счетчиком страниц и страницами до конца главы.

Output: Новый компонент ReaderFooter.tsx, обновлённый ReaderHeader без прогресса, расширенный useCFITracking с данными страниц внутри главы.

## Must-Haves

- [ ] "Прогресс-линия с процентом отображается внизу экрана, не в шапке"
- [ ] "Прогресс-линия на ~95% ширины, процент ~5% справа"
- [ ] "Под прогресс-линией: слева счетчик страниц (15 из 800), справа — страниц до конца главы"
- [ ] "ReaderFooter показывается/скрывается вместе с шапкой (isHeaderVisible)"
- [ ] "Шапка ридера больше не содержит прогресс-линию и процент"

## Files

- `frontend/src/hooks/epub/useCFITracking.ts`
- `frontend/src/components/Reader/ReaderFooter.tsx`
- `frontend/src/components/Reader/ReaderHeader.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`
- `frontend/src/components/Reader/EpubReader.tsx`

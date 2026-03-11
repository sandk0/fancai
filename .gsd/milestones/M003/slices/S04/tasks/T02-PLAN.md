# T02: 19-description-entity-popup 02

**Slice:** S04 — **Milestone:** M003

## Description

Приглушить CSS стили описаний, добавить active state для тапов, toggle описаний в настройках, и исправить баг ENT-02 (тапы на описания/сущности у краёв экрана перехватываются навигацией).

Purpose: ENT-02 -- тапы на описания и сущности у краёв экрана не перехватываются навигацией. ENT-01 -- визуальная полировка и toggle.
Output: Приглушённые стили, active states, settings toggle, исправленный gesture controller.

## Must-Haves

- [ ] "Описания подсвечены приглушённым фоном (opacity 5-8% вместо 15-20%)"
- [ ] "Тап на описание/сущность у левого/правого края экрана НЕ перехватывается навигацией"
- [ ] "Active state (:active) кратковременно усиливает фон при тапе на описания и сущности"
- [ ] "Toggle описаний в настройках переключает видимость подсветки"
- [ ] "Entity тапы в center zone на iOS обрабатываются через overlay handler"

## Files

- `frontend/src/hooks/epub/useDescriptionHighlighting.ts`
- `frontend/src/hooks/epub/useEntityNameHighlighting.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/stores/reader.ts`
- `frontend/src/components/Reader/ReaderControls.tsx`
- `frontend/src/components/Reader/Core/ReaderUI.tsx`

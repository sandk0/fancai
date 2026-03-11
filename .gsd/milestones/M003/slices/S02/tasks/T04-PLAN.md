# T04: 17-shapka-i-paneli 04

**Slice:** S02 — **Milestone:** M003

## Description

Исправить перехват кликов iOS overlay и вынести Entity Wiki / Settings из overflow menu.

Purpose: (1) BLOCKER — iOS overlay перехватывает тапы по шапке и вызывает toggleUI, скрывая шапку при любом клике. (2) Entity Wiki — ключевая AI-функциональность, должна иметь отдельную кнопку, не быть спрятана в overflow. После плана 17-03 прогресс убран из шапки — место освободилось.

Output: Фикс iOS overlay, реорганизованная шапка с видимыми кнопками Entity Wiki и Settings.

## Must-Haves

- [ ] "Клик по кнопкам шапки не скрывает шапку (iOS overlay не перехватывает тапы по header area)"
- [ ] "Entity Wiki имеет отдельную видимую кнопку в шапке на всех размерах экрана"
- [ ] "Настройки имеют отдельную видимую кнопку в шапке (не только в overflow)"
- [ ] "Overflow menu содержит только TOC (ниже xs) — все остальные кнопки всегда видны"

## Files

- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/ReaderHeader.tsx`

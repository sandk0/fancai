# T02: 19.1-uat-edge-taps 02

**Slice:** S05 — **Milestone:** M003

## Description

Исправление BUG-4: race condition в annotation rendering — заметки отображаются с задержкой, показывая ПРЕДЫДУЩУЮ заметку вместо текущей.

Purpose: Пользователь создаёт заметку и сразу видит визуальную подсветку текста, без необходимости создавать ещё одну заметку для "проявления" предыдущей.
Output: Исправленный useAnnotationRendering.ts без stale closure проблемы + тест.

## Must-Haves

- [ ] "Созданная заметка СРАЗУ отображается визуально (подсветка текста), без необходимости создавать вторую заметку"
- [ ] "При создании заметки B заметка A не перерисовывается с задержкой — обе видны мгновенно"

## Files

- `frontend/src/hooks/epub/useAnnotationRendering.ts`
- `frontend/src/hooks/epub/__tests__/useAnnotationRendering.test.ts`

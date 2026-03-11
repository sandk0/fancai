# T02: 16-navigation-swipes 02

**Slice:** S01 — **Milestone:** M003

## Description

Создать тесты для всех исправлений Phase 16 и получить подтверждение пользователя на реальном устройстве.

Purpose: Тесты фиксируют корректное поведение pipeline и предотвращают регрессии. Human verification подтверждает что баги действительно исправлены.
Output: Тестовые файлы + подтверждение пользователя.

## Must-Haves

- [ ] "Тесты покрывают двухфазный pipeline (animate -> instant scroll -> reset)"
- [ ] "Тесты проверяют что chapterTransitionThreshold достижим"
- [ ] "Тесты проверяют under-damped spring config (damping < critical)"
- [ ] "Тесты проверяют instant scroll для тапов"
- [ ] "Пользователь подтвердил работу навигации на реальном устройстве"

## Files

- `frontend/src/hooks/epub/__tests__/useGestureController.test.ts`
- `frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts`
- `frontend/src/hooks/epub/__tests__/useEpubNavigation.test.ts`

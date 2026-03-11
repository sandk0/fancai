# S01: Navigation Swipes

**Goal:** Исправить четыре регрессии v1.1 в gesture pipeline ридера: двойное перелистывание свайпом, дёрганая анимация, нерабочий переход между главами, артефакты тапов.
**Demo:** Стабильный gesture pipeline с плавными свайпами, мгновенными тапами и работающими переходами между главами.

## Must-Haves


## Tasks

- [x] **T01: 16-navigation-swipes 01** `est:11min`
  - Исправить четыре регрессии v1.1 в gesture pipeline ридера: двойное перелистывание свайпом, дёрганая анимация, нерабочий переход между главами, артефакты тапов.

Purpose: Это фундамент для всех фаз v1.2 -- без стабильной навигации невозможно работать над шапкой, выделением текста и описаниями.
Output: Стабильный gesture pipeline с плавными свайпами, мгновенными тапами и работающими переходами между главами.
- [x] **T02: 16-navigation-swipes 02** `est:~60min (spread across verification iterations)`
  - Создать тесты для всех исправлений Phase 16 и получить подтверждение пользователя на реальном устройстве.

Purpose: Тесты фиксируют корректное поведение pipeline и предотвращают регрессии. Human verification подтверждает что баги действительно исправлены.
Output: Тестовые файлы + подтверждение пользователя.

## Files Likely Touched

- `frontend/src/hooks/epub/useFollowFingerSwipe.ts`
- `frontend/src/hooks/epub/useEpubNavigation.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/EpubReader.tsx`
- `frontend/src/hooks/epub/__tests__/useGestureController.test.ts`
- `frontend/src/hooks/epub/__tests__/useFollowFingerSwipe.test.ts`
- `frontend/src/hooks/epub/__tests__/useEpubNavigation.test.ts`

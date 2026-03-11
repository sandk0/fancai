# T01: 16-navigation-swipes 01

**Slice:** S01 — **Milestone:** M003

## Description

Исправить четыре регрессии v1.1 в gesture pipeline ридера: двойное перелистывание свайпом, дёрганая анимация, нерабочий переход между главами, артефакты тапов.

Purpose: Это фундамент для всех фаз v1.2 -- без стабильной навигации невозможно работать над шапкой, выделением текста и описаниями.
Output: Стабильный gesture pipeline с плавными свайпами, мгновенными тапами и работающими переходами между главами.

## Must-Haves

- [ ] "Свайп перелистывает ровно одну страницу без двойного сдвига"
- [ ] "Анимация свайпа плавная (60fps) с micro-bounce на завершении (Apple Books feel)"
- [ ] "Тап по краю страницы перелистывает мгновенно с быстрой spring-анимацией"
- [ ] "Свайп на границе главы с достаточным смещением переходит к следующей/предыдущей главе"
- [ ] "Rubber-band на краях книги даёт обратную связь 'дальше нельзя'"

## Files

- `frontend/src/hooks/epub/useFollowFingerSwipe.ts`
- `frontend/src/hooks/epub/useEpubNavigation.ts`
- `frontend/src/hooks/epub/useGestureController.ts`
- `frontend/src/components/Reader/EpubReader.tsx`

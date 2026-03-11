# M002: Reader Mobile / PWA

**Vision:** Мобильный ридер с follow-finger свайпами, spring physics, FSM gesture controller, iOS viewport fix, PWA с offline-чтением и graduated resume. Shipped 2026-03-09 за 1 день.

## Success Criteria


## Slices

- [x] **S01: Стабилизация навигации** `risk:medium` `depends:[]`
  > After this: unit tests prove Стабилизация навигации works
- [x] **S02: Follow Finger свайпы** `risk:medium` `depends:[S01]`
  > After this: unit tests prove Follow-finger свайпы works
- [x] **S03: Единый gesture handler и мобильный UI** `risk:medium` `depends:[S02]`
  > After this: unit tests prove Единый gesture handler и мобильный UI works
- [x] **S04: Viewport и iOS** `risk:medium` `depends:[S03]`
  > After this: unit tests prove Viewport и iOS works
- [x] **S05: PWA и offline** `risk:medium` `depends:[S04]`
  > After this: unit tests prove PWA и offline works
- [x] **S06: Фикс описаний** `risk:medium` `depends:[S05]`
  > After this: unit tests prove Фикс описаний works

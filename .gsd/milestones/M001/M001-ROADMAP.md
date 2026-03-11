# M001: Готовность к продакшену

**Vision:** Довести приложение до продакшен-уровня: безопасность, мониторинг, миграция AI на OpenRouter, очистка мёртвого кода, качество Entity Wiki, функции ридера (закладки, выделения, поиск). Shipped 2026-03-09 за 9 дней.

## Success Criteria


## Slices

- [x] **S01: Безопасность продакшена** `risk:medium` `depends:[]`
  > After this: unit tests prove Безопасность продакшена works
- [x] **S02: Очистка мертвого кода** `risk:medium` `depends:[S01]`
  > After this: unit tests prove Очистка мертвого кода works
- [x] **S03: Миграция сервисов** `risk:medium` `depends:[S02]`
  > After this: unit tests prove Миграция сервисов works
- [x] **S04: Обслуживание инфраструктуры** `risk:medium` `depends:[S03]`
  > After this: unit tests prove Обслуживание инфраструктуры works
- [x] **S05: Фиксы интеграции и ребрендинг** `risk:medium` `depends:[S04]`
  > After this: unit tests prove Фиксы интеграции и ребрендинг works
- [x] **S06: Стабилизация AI и техдолг** `risk:medium` `depends:[S05]`
  > After this: unit tests prove Стабилизация AI и техдолг works
- [x] **S07: Качество Entity Wiki** `risk:medium` `depends:[S06]`
  > After this: unit tests prove Качество Entity Wiki works
- [x] **S08: Обработка ошибок и UX** `risk:medium` `depends:[S07]`
  > After this: unit tests prove Обработка ошибок и UX works
- [x] **S09: Функции ридера** `risk:medium` `depends:[S08]`
  > After this: unit tests prove Функции ридера works

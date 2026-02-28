## GSD: русский язык

Все файлы, генерируемые GSD-агентами и workflow, ДОЛЖНЫ быть на русском языке:

- Заголовки разделов (## Обзор, ## Фазы, ## Прогресс, ## Критерии успеха)
- Описания фаз, планов, задач
- Критерии успеха (must_haves.truths)
- Описания артефактов (must_haves.artifacts.provides)
- Описания связей (must_haves.key_links.via)
- Objective, action, verify, done секции в PLAN-файлах
- STATE.md — статусы, решения, блокеры
- ROADMAP.md — обзор, детали фаз, таблица прогресса
- SUMMARY.md — итоги выполнения
- RESEARCH.md — исследования
- CONTEXT.md — контекст фаз
- VERIFICATION.md — отчёты верификации

**Не переводить:**
- YAML frontmatter ключи (phase, plan, type, wave, depends_on, files_modified, autonomous, requirements)
- Пути к файлам
- Идентификаторы требований (SEC-01, WIKI-02)
- Имена технологий и библиотек
- Код в блоках ```
- XML-теги шаблонов (<task>, <objective>, <verify>)
- Коммит-сообщения (остаются на английском по конвенции)

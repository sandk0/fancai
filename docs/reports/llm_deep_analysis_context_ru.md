# Подробный контекст-промпт для анализа AI архитектуры Fancai

**Инструкция:** Скопируйте весь текст ниже (от "START OF CONTEXT" до "END OF CONTEXT") и отправьте его в Perplexity Pro или ChatGPT o1. Это даст нейросети полное представление о коде без доступа к файлам.

---

### [START OF CONTEXT]

**ОТЧЕТ: ГЛУБОКИЙ ТЕХНИЧЕСКИЙ АНАЛИЗ AI/LLM ФУНКЦИОНАЛЬНОСТИ ПРОЕКТА FANCAI (Backend)**

**Дата аудита:** 25 Января 2026
**Цель:** Миграция с Google Vertex AI (Imagen/Gemini) на Replicate (FLUX.2) и оптимизация архитектуры.

Проект представляет собой "AI-читалку" книг (EPUB/FB2), которая визуализирует персонажей и локации. Ниже приведен детальный разбор всех файлов, использующих AI.

---

#### 1. `backend/app/services/imagen_generator.py` (Core Generation)
**Роль:** Основной сервис генерации изображений.
**Модель:** Google Imagen 4 (`imagen-4.0-generate-001`).
**Ключевые компоненты:**
1.  **`PromptTranslator`**:
    *   **Что делает:** Переводит русские описания из книги на английский для Imagen.
    *   **LLM:** Gemini 3 Flash Preview.
    *   **Код:** Метод `translate(russian_text)`. Использует системный промпт: *"Focus ONLY on visual elements... preserve mood"*.
    *   **Кэширование:** Использует Redis (`translation:{hash}`) с TTL 7 дней.
2.  **`ImagenPromptEngineer`**:
    *   **Что делает:** Собирает финальный промпт из шаблонов.
    *   **Логика:** Использует жесткие шаблоны по типам (`DescriptionType`).
        *   *Location:* "Detailed book illustration of [English Desc], atmospheric lighting..."
        *   *Character:* "Character portrait illustration of..."
    *   **Жанры:** Hardcoded словарь `GENRE_STYLES` (Fantasy, Detective, Noir...), добавляемый как суффикс.
3.  **`GoogleImagenGenerator`**:
    *   **SDK:** `google-genai`.
    *   **Вызов:** `_client.models.generate_images`.
    *   **Особенности:** Синхронный вызов, обернутый в `asyncio.to_thread`.
    *   **Safety:** Использует фильтр `block_low_and_above`.
    *   **Вывод:** Возвращает Base64, который декодируется и сохраняется локально в `/app/storage`.

---

#### 2. `backend/app/services/gemini_extractor.py` (Extraction)
**Роль:** Извлечение сущностей (NER) и описаний из текста книг.
**Модель:** Google Gemini 3 Flash Preview.
**Архитектура:**
1.  **`RecursiveTextChunker`**: Разбивает текст на чанки (~100k chars) с перекрытием (overlap 15%).
2.  **`GeminiDirectExtractor`**:
    *   **Параллельность:** Использует `asyncio.Semaphore(3)` для параллельной обработки чанков.
    *   **Промпт:** `EXTRACTION_PROMPT` ("Ты - литературный редактор... Выдели ТОЛЬКО ГЛАВНЫХ персонажей... Оцени ВАЖНОСТЬ 1-10").
    *   **Формат:** Structured Output через Pydantic-схемы (`GeminiResponseSchema`).
    *   **Данные:** Возвращает списки `descriptions` (описания), `entities` (сущности) и `relationships` (связи).
    *   **Deduplication:** Использует нечеткое сравнение (`SequenceMatcher > 0.85`) для объединения сущностей (например, "Гэндальф" и "Гэндальф Серый").

---

#### 3. `backend/app/services/consistency_manager.py` (Graph & Logic)
**Роль:** Поддержание логической целостности мира книги. Оптимизация и создание "Мастер-референсов".
**AI Использование:**
1.  **Reduce Phase (`optimize_book_entities`)**:
    *   **Что делает:** Map-Reduce паттерн. Берет ВСЕ найденные в книге сущности и отправляет их одним списком в LLM.
    *   **LLM:** Gemini (через `gemini_extractor`).
    *   **Промпт:** *"IDENTIFY DUPLICATES... FILTER GARBAGE (Importance < 7)"*.
    *   **Результат:** JSON-план слияния (merge) и удаления (delete) сущностей в БД.
2.  **Master Reference Generation (`generate_master_references`)**:
    *   **Что делает:** Генерирует "эталонные" портреты для главных героев (Importance > 7).
    *   **LLM:** Imagen 4 (через `image_generator`).
    *   **Промпт:** *"Masterpiece portrait, character concept art..."*.
    *   **Логика:** Если у персонажа нет `master_portrait_url`, он создается и сохраняется в сущности.

---

#### 4. `backend/app/core/tasks.py` (Orchestration)
**Роль:** Управление асинхронными задачами Celery.
**Ключевой метод:** `_process_book_async`.
**Workflow:**
1.  **Parallel Parsing:** Запускает `gemini_extractor` для всех глав параллельно (TaskGroup + Semaphore 10).
2.  **Consistency (Reduce):** Вызывает `consistency_manager.optimize_book_entities` (Gemini Dedupe).
3.  **Graph Analysis:** Вызывает PageRank (алгоритмически).
4.  **Master Generation:** Вызывает `consistency_manager.generate_master_references` (Imagen).
5.  **Notification:** Отправляет WebSocket/Push уведомление пользователю.

---

#### 5. `backend/app/services/llm_description_enricher.py` (Enrichment)
**Роль:** (Вспомогательный) Обогащение коротких описаний атрибутами.
**Статус:** Используется редко/опционально.
**LLM:** Gemini / LangExtract.
**Функция:** Извлекает структурированные атрибуты (цвет глаз, рост) из текста описания.

---

#### 6. `backend/app/core/config.py` (Environment)
**Конфигурация:**
*   `GOOGLE_API_KEY`: Единый ключ для Gemini и Imagen.
*   `IMAGEN_MODEL`: `imagen-4.0-generate-001`.
*   `GEMINI_MODEL`: `gemini-3-flash-preview`.
*   `CELERY_CONCURRENCY`: 1 (оптимизация под малую память).

---

### [END OF CONTEXT]

**Задача для AI:**
Используя приведенный выше контекст, составь пошаговый план миграции с Google Imagen на Replicate FLUX.2, учитывая следующие критические моменты:
1.  Необходимо заменить `GoogleImagenGenerator` на клиент Replicate.
2.  Нужно адаптировать `ImagenPromptEngineer`: FLUX лучше понимает естественный язык, чем "теги" Imagen. Стоит ли убрать шаблоны?
3.  Как сохранить функциональность `Master Reference`, если FLUX работает асинхронно (через вебхуки/polling), в то время как текущий код `consistency_manager` ожидает синхронного ответа?
4.  Какие изменения потребуются в `config.py`?

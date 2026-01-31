# Объединённый технический анализ fancai

**Дата:** 31 января 2026  
**Версия:** 1.0  
**Статус:** Консолидированный анализ готов к реализации

---

## Резюме

Настоящий документ объединяет результаты 7 технических отчётов за 30-31 января 2026 года. Выявлены **2 критические системы**, требующие немедленного исправления:

| Система | Критических проблем | Влияние на пользователей |
|---------|---------------------|--------------------------|
| **LLM-пайплайн обработки книг** | 4 | Мало описаний, скудные сущности, спойлеры |
| **Читалка (Reading Sessions)** | 5 | Бесконечные ошибки 400, потеря статистики чтения |

**Ключевой вывод:** Обе системы технически исправны, но содержат конфликтующие механизмы и ограничения, внедрённые в период 20-31 января.

---

## Часть 1: LLM-пайплайн обработки книг

### 1.1 Выявленные проблемы

| # | Проблема | Критичность | Корневая причина | Файл |
|---|----------|-------------|------------------|------|
| L1 | Мало описаний (3-5 вместо 10-20) | **CRITICAL** | Промпт: "Top-15", "Importance<7=ИГНОРИРОВАТЬ" | `gemini_extractor.py:386-390` |
| L2 | Скудный visual_summary (50-100 chars) | **CRITICAL** | `min_description_chars=50` — слишком низкий порог | `gemini_extractor.py:199` |
| L3 | Статичный visual_summary | **HIGH** | "Wiper" логика: replace вместо append | `consistency_manager.py:166-167` |
| L4 | Мало сущностей | **CRITICAL** | Reduce phase удаляет importance<3 | `consistency_manager.py:369` |
| L5 | Спойлеры алиасов | **HIGH** | Алиасы глобальны, нет reveal_chapter | `consistency_manager.py:196-197` |
| L6 | Пустые карточки связей | **HIGH** | context не сохраняется при merge | `consistency_manager.py:103-108` |
| L7 | Нет few-shot примеров в промптах | **MEDIUM** | Потеря 15-20% F1 по исследованиям 2025-2026 | `gemini_extractor.py:349-411` |

### 1.2 Принятые решения (при конфликте рекомендаций)

| Конфликт | Варианты | Решение | Обоснование |
|----------|----------|---------|-------------|
| Visual Summary update | (A) Append с главой, (B) Merge+Dedupe+Summarize | **B** | Более интеллектуальный подход, избегает дублирования |
| Промпты | V2, V3, "Omnibus" | **V2** | Few-shot примеры + Quality Gates + совместимость со схемой |
| Importance фильтрация | (A) Убрать из промпта, (B) Soft filter в коде | **A+B** | Извлекаем всё, фильтруем на уровне API/UI |
| Entity resolution | SequenceMatcher vs Token Overlap | **Multi-strategy** | Цепочка: Exact → Alias → Token → Fuzzy |

### 1.3 Архитектура решения

```
ТЕКУЩИЙ ПАЙПЛАЙН (проблемный):
─────────────────────────────────────────────────────────────
[Gemini] → "Top-15 only" → Мало сущностей
    ↓
[ConsistencyManager] → "if longer, replace" → Статичный summary
    ↓
[Reduce Phase] → "Importance<3 = DELETE" → Ещё меньше сущностей
    ↓
[API] → Алиасы без reveal_chapter → Спойлеры
─────────────────────────────────────────────────────────────

ИСПРАВЛЕННЫЙ ПАЙПЛАЙН:
─────────────────────────────────────────────────────────────
[Gemini V2] → "Extract EVERYTHING" + Few-shot → Полный контент
    ↓
[ConsistencyManager V2] → Merge+Dedupe+Summarize → Эволюция
    ↓
[Reduce Phase V2] → "ONLY merge duplicates" → Сохранение контента
    ↓
[API V2] → reveal_chapter фильтрация → Без спойлеров
─────────────────────────────────────────────────────────────
```

### 1.4 Улучшенные промпты

#### TSA_EXTRACTION_PROMPT_V2

```python
TSA_EXTRACTION_PROMPT_V2 = """Ты - опытный литературный редактор, специализирующийся на подготовке книг к иллюстрированию.

## ЗАДАЧА
Разметь визуальные описания в тексте XML-тегами. Формат:
<desc type="TYPE" occurrence="N">точный текст из оригинала</desc>

## ТИПЫ (TYPE)
- location: места, интерьеры, пейзажи
- character: внешность персонажей
- atmosphere: освещение, погода, настроение
- object: важные артефакты

## КРИТЕРИИ КАЧЕСТВЕННОГО ОПИСАНИЯ
✓ Минимум 50 символов (идеально 100-300)
✓ Создаёт визуальный образ в воображении
✓ Содержит конкретные детали (цвета, формы, текстуры)
✓ Подходит для иллюстрации художником

## НЕГАТИВНЫЕ ПРИМЕРЫ (НЕ РАЗМЕЧАТЬ!)
✗ "Он был высоким" — слишком коротко, нет деталей
✗ "Она улыбнулась" — действие, не описание
✗ "Комната была большой" — нет визуальных деталей

## ПОЗИТИВНЫЕ ПРИМЕРЫ

### Пример 1 (короткий, atmosphere):
Вход: "Солнце садилось. Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера."
Выход: "Солнце садилось. <desc type=\"atmosphere\" occurrence=\"1\">Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера.</desc>"

### Пример 2 (средний, character):
Вход: "В дверях стоял незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой."
Выход: "В дверях стоял <desc type=\"character\" occurrence=\"1\">незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой.</desc>"

### Пример 3 (длинный, location):
Вход: "Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна."
Выход: "<desc type=\"location\" occurrence=\"1\">Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна.</desc>"

## ПРАВИЛА
1. Текст внутри тегов = ТОЧНАЯ копия из оригинала
2. Сохраняй пробелы и пунктуацию
3. occurrence = порядковый номер при повторении (по умолчанию 1)
4. НЕ изменяй текст вне тегов

## ДОПОЛНИТЕЛЬНО ВЫДЕЛИ
1. ВСЕХ персонажей с visual_summary и aliases
   - importance 7-10: главные герои
   - importance 4-6: второстепенные
   - importance 1-3: эпизодические (ИЗВЛЕКАЙ, не игнорируй!)
2. ВСЕ локации с visual_summary
3. СВЯЗИ между сущностями (source, target, type, context)

## QUALITY GATES
- visual_summary < 80 символов → Дополни деталями из контекста
- Нет описания внешности → "Внешность не описана в данном фрагменте"

Текст для анализа:
{text}
"""
```

#### REDUCE_PROMPT_V2

```python
REDUCE_PROMPT_V2 = """You are a Data Consistency Expert for a book entity database.

## INPUT DATA
{entity_list_text}

## TASK
1. **MERGE DUPLICATES**: Identify entities that refer to the same person/place:
   - "Harry", "Harry Potter", "Mr. Potter" → SAME entity
   - Consider aliases, partial names, nicknames
   
2. **DO NOT DELETE based on importance!** Keep ALL entities.
   - Deletion criteria: ONLY if entity is clearly garbage (typo, parsing error)
   - Example of garbage: "said", "ааааа", "Chapter 1"

3. **PRESERVE reveal_chapter for aliases:**
   - If "Избранный" alias appears only in chapter 10, mark it: 
     {{ "alias": "Избранный", "reveal_chapter": 10 }}

## OUTPUT JSON
{{
    "merge_operations": [
        {{ 
            "keep_id": "uuid-of-most-detailed", 
            "merge_ids": ["uuid", "uuid"],
            "merged_aliases": [
                {{ "name": "Potter", "reveal_chapter": null }},
                {{ "name": "The Chosen One", "reveal_chapter": 10 }}
            ]
        }}
    ],
    "delete_operations": [ "uuid-only-if-garbage" ]
}}

## CRITICAL RULES
- When merging, keep the entity with the LONGEST visual_summary
- NEVER delete entities just because they have low importance
- ALWAYS preserve chapter information for spoiler protection
"""
```

#### TRANSLATION_PROMPT_V2 (Imagen)

```python
TRANSLATION_PROMPT_V2 = """You are an expert translator specializing in visual descriptions for AI image generation (Imagen 4).

## TASK
Translate this Russian visual description to English, optimizing for high-quality image generation.

## RULES
1. Focus ONLY on visual elements:
   - Physical appearance (face, hair, body, clothing)
   - Environment details (architecture, lighting, weather)
   - Colors, textures, materials

2. USE art and photography terminology:
   - Lighting: "golden hour", "dramatic chiaroscuro", "soft diffused"
   - Composition: "portrait orientation", "establishing shot", "close-up"
   - For portraits: "detailed facial features", "expressive eyes", "85mm lens"

3. STRUCTURE your output:
   - Start with subject (who/what)
   - Add descriptive details (how it looks)
   - End with atmosphere/mood

4. LENGTH: 100-200 words (optimal for Imagen 4)

## EXAMPLE
Input: "Старик сидел у окна. Глубокие морщины прорезали его лицо, белая борода спускалась до груди."
Output: "Elderly man portrait, deep wrinkles etched across weathered face, long flowing white beard reaching chest level. Seated by window, soft natural sidelight illuminating features. Wise contemplative expression, kind eyes with crow's feet. Detailed facial features, expressive eyes. Professional portrait illustration, masterful composition."

## Russian text:
{text}

## English translation (visual elements only):
"""
```

### 1.5 Оптимизация затрат

| Стратегия | Экономия | Реализация |
|-----------|----------|------------|
| Gemini Context Caching | 70-80% | Статичный контент (промпт + few-shot) в начале запроса |
| Model Tiering | 50% | Flash-Lite для translation, Flash для extraction |
| Implicit Caching | Автоматически | Gemini 3 автоматически кэширует повторяющийся префикс |

### 1.6 Метрики успеха (LLM)

| Метрика | Текущее | Цель | SQL-запрос |
|---------|---------|------|------------|
| Описаний/глава | 3-5 | 10-20 | `SELECT AVG(descriptions_count) FROM chapters` |
| visual_summary length | 50-100 chars | 150-300 chars | `SELECT AVG(LENGTH(visual_summary)) FROM entity` |
| Сущностей/книга | 10-20 | 40-60 | `SELECT COUNT(*) FROM entity WHERE book_id=X` |
| Cache hit rate | ~60% | 85%+ | Redis MONITOR |

---

## Часть 2: Читалка (Reading Sessions)

### 2.1 Выявленные проблемы

| # | Проблема | Критичность | Корневая причина | Файл |
|---|----------|-------------|------------------|------|
| R1 | Бесконечные ошибки 400 | **CRITICAL** | usePWAResumeGuard unmount-ит EpubReader | `BookReaderPage.tsx:136-145` |
| R2 | PWA guard на десктопе | **CRITICAL** | Нет проверки на PWA/mobile | `usePWAResumeGuard.ts` |
| R3 | Stale cache при remount | **CRITICAL** | staleTime=60s для activeSession | `useReadingSession.ts:77` |
| R4 | Silent failures | **HIGH** | onError только логирует, interval продолжает | `useReadingSession.ts:109-112` |
| R5 | Beacon API не работает | **MEDIUM** | POST вместо PUT, backend только PUT | `useReadingSession.ts:405-420` |
| R6 | Race condition guards | **MEDIUM** | useRenditionHealthGuard reload vs usePWAResumeGuard | Multiple files |

### 2.2 Принятые решения (при конфликте рекомендаций)

| Конфликт | Варианты | Решение | Обоснование |
|----------|----------|---------|-------------|
| PWA Strategy | (A) Адаптивный, (B) Hard-off, (C) Рефакторинг | **A+Overlay** | Overlay не unmount-ит reader + проверка на mobile |
| Reading Sessions recovery | (A) Новая сессия при 400, (B) Retry | **A** | Старая сессия закрыта — retry бесполезен |
| Visibility handlers | Централизация vs Координация | **Координация** | Меньше изменений, проверка isResuming |

### 2.3 Архитектура решения

```
ТЕКУЩАЯ ПРОБЛЕМА:
─────────────────────────────────────────────────────────────
Tab switch (1.5s) → usePWAResumeGuard → isResuming=true
    ↓
BookReaderPage → if(isResuming) return <Spinner/> → EpubReader UNMOUNT
    ↓
useReadingSession cleanup → PUT /end → Session CLOSED
    ↓
300ms later → isResuming=false → EpubReader REMOUNT
    ↓
useQuery staleTime=60s → Returns OLD session from cache
    ↓
setInterval → PUT /update → 400 "Cannot update inactive session"
    ↓
onError → console.error() only → Interval CONTINUES → INFINITE LOOP
─────────────────────────────────────────────────────────────

ИСПРАВЛЕННАЯ АРХИТЕКТУРА:
─────────────────────────────────────────────────────────────
Tab switch → usePWAResumeGuard → Check: isPWA || isMobile?
    ↓                                    ↓
[Desktop: SKIP]                   [Mobile: isResuming=true]
                                         ↓
BookReaderPage → OVERLAY (not unmount) → EpubReader STAYS IN DOM
    ↓
useReadingSession → Session CONTINUES (no cleanup)
    ↓
300ms later → Overlay removed → Normal operation
    ↓
[If 400 error] → Stop interval → Reset state → Create new session
─────────────────────────────────────────────────────────────
```

### 2.4 Код исправлений

#### Fix R1+R2: Overlay + Desktop check

```tsx
// BookReaderPage.tsx
function shouldEnableGuard(): boolean {
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
  const isMobile = /mobile|iphone|ipad|android/i.test(navigator.userAgent);
  return isPWA || isMobile;
}

return (
  <div className="fixed inset-0 overflow-hidden bg-background reader-container">
    {/* Overlay INSTEAD of conditional render - EpubReader stays in DOM */}
    {(isResuming || !isReady) && shouldEnableGuard() && (
      <div 
        className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        style={{ pointerEvents: 'all' }}
      >
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full mb-4" />
          <p className="text-muted-foreground">Восстановление сессии...</p>
        </div>
      </div>
    )}
    
    {/* EpubReader ALWAYS in DOM */}
    <EpubReader book={bookData} />
  </div>
);
```

#### Fix R3+R4: Error handling + staleTime

```tsx
// useReadingSession.ts
const { data: activeSession } = useQuery({
  queryKey: [QUERY_KEY_ACTIVE_SESSION],
  queryFn: readingSessionsAPI.getActiveSession,
  staleTime: 0,        // Always refetch on mount
  gcTime: 5000,        // Quick garbage collection
  refetchOnMount: 'always',
});

const updateMutation = useMutation({
  // ...
  onError: (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail || '';
    const isInactiveError = status === 400 && 
      (detail.includes('inactive') || detail.includes('already ended'));
    
    if (isInactiveError) {
      // 1. Stop interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      // 2. Reset state
      sessionIdRef.current = null;
      hasStartedRef.current = false;
      setSession(null);
      
      // 3. Invalidate cache
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY_ACTIVE_SESSION] });
      
      // 4. Will trigger new session creation via Effect 1
    }
  },
});
```

#### Fix R5: Backend POST endpoint

```python
# reading_sessions.py
@router.post(
    "/reading-sessions/{session_id}/end",
    response_model=ReadingSessionResponse,
    summary="Завершить сессию (Beacon API)",
)
async def end_reading_session_beacon(
    session_id: UUID,
    request: EndSessionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_database_session),
    current_user: User = Depends(get_current_active_user),
) -> ReadingSessionResponse:
    """POST wrapper для Beacon API совместимости."""
    return await end_reading_session(
        session_id, request, background_tasks, db, current_user
    )
```

### 2.5 Метрики успеха (Reader)

| Метрика | Текущее | Цель | Как измерить |
|---------|---------|------|--------------|
| 400 ошибок/час | 50+ | 0 | Backend logs |
| Session recovery rate | 0% | 95%+ | Frontend metrics |
| Tab switch без ошибок | Нет | Да | Manual QA |
| Beacon API success | 0% | 100% | Backend logs |

---

## Часть 3: Сводная таблица изменений

### Backend

| Файл | Изменение | Приоритет |
|------|-----------|-----------|
| `gemini_extractor.py:386-390` | Убрать "Top-15" и "Importance<7=ИГНОРИРОВАТЬ" | **P0** |
| `gemini_extractor.py:199` | `min_description_chars = 150` | **P0** |
| `gemini_extractor.py:349-411` | Заменить промпты на V2 с few-shot | **P0** |
| `consistency_manager.py:166-167` | Wiper → Merge+Dedupe+Summarize | **P0** |
| `consistency_manager.py:369` | Убрать "Importance<3=DELETE" из REDUCE_PROMPT | **P0** |
| `consistency_manager.py:103-108` | Обновлять context при merge relationships | **P1** |
| `consistency_manager.py:196-197` | reveal_chapter для алиасов | **P1** |
| `reading_sessions.py` | Добавить POST endpoint для Beacon API | **P1** |
| `entities.py` | API: фильтрация алиасов по current_chapter | **P1** |
| `models/entity.py` | Новое поле aliases_with_reveal | **P1** |

### Frontend

| Файл | Изменение | Приоритет |
|------|-----------|-----------|
| `BookReaderPage.tsx:136-145` | Overlay вместо conditional render | **P0** |
| `usePWAResumeGuard.ts` | Проверка isPWA \|\| isMobile | **P0** |
| `useReadingSession.ts:77` | `staleTime: 0` для activeSession | **P0** |
| `useReadingSession.ts:109-112` | Полноценная обработка ошибки 400 | **P0** |
| `useRenditionHealthGuard.ts` | Проверять isResuming перед reload | **P1** |
| `EntityCard.tsx` | Отображать first_mention_chapter | **P2** |
| `RelationshipCard.tsx:144` | Маппинг edge.description из metadata | **P2** |

---

## Часть 4: Риски и эскалация

### Риски при внедрении

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Regression в extraction | Средняя | Высокое | A/B тест на 10% книг |
| Rate limit Gemini | Низкая | Среднее | Динамический семафор |
| Сломанные существующие книги | Низкая | Высокое | Миграция с backup |
| iOS-специфичные баги | Средняя | Среднее | QA на реальных устройствах |

### Триггеры эскалации

| Ситуация | Триггер | Действие |
|----------|---------|----------|
| Entity resolution fails | >20% unmatched | Embedding-based similarity |
| Quality degradation | F1 < 70% | Multi-stage pipeline |
| Cost explosion | >$1/book | Aggressive tiering + batch |
| Mobile bugs | >5% crash rate | Полный аудит PWA guards |

---

## Приложения

### A: Таксономия связей

| Категория | Backend Types | Frontend Label | Цвет |
|-----------|---------------|----------------|------|
| Родство | PARENT, CHILD, SIBLING, SPOUSE | Семья | Purple |
| Романтика | LOVER, CRUSH, EX_PARTNER | Романтика | Pink |
| Конфликт | ENEMY, RIVAL, KILLER | Вражда | Red |
| Альянс | FRIEND, ALLY, COMPANION | Союз | Green |
| Иерархия | MASTER, SERVANT, MENTOR | Власть | Blue |
| Сюжет | BETRAYED, SAVED, CAPTURED | Действие | Orange |

### B: Visibility Handlers (для координации)

| Hook | Delay | Action | Координация |
|------|-------|--------|-------------|
| usePWAResumeGuard | 300ms | Overlay | Master |
| useReadingSession | 300ms | Pause interval | Check isResuming |
| useProgressSync | 300ms | Pause save | Check isResuming |
| useRenditionHealthGuard | 0-2000ms | Reload | **Check isResuming!** |

### C: Ключевые файлы

```
backend/
├── app/services/gemini_extractor.py      # Промпты, конфигурация
├── app/services/consistency_manager.py   # Entity resolution, Wiper
├── app/routers/reading_sessions.py       # POST endpoint
├── app/routers/entities.py               # API фильтрация
└── app/models/entity.py                  # aliases_with_reveal

frontend/
├── src/pages/BookReaderPage.tsx          # Overlay
├── src/hooks/pwa/usePWAResumeGuard.ts    # Desktop check
├── src/hooks/useReadingSession.ts        # Error handling
└── src/hooks/epub/useRenditionHealthGuard.ts  # Координация
```

---

*Документ создан на основе анализа 7 технических отчётов за 30-31 января 2026*

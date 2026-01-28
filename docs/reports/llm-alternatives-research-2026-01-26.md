# Исследование альтернатив Gemini 3 Flash для парсинга описаний

**Дата:** 26 января 2026  
**Автор:** Claude (Sisyphus)  
**Версия:** 2.0 (дополнено сравнением Gemini 3 Pro)

---

## Executive Summary

### Главная находка

**В текущей реализации НЕТ перевода русского текста на английский!** Промпт в `gemini_extractor.py` (строки 321-346) полностью на русском языке. Предположение о двойном переводе было ошибочным.

### Реальные корневые причины проблем

| Проблема | Реальная причина | Файл:строка |
|----------|------------------|-------------|
| Пропуск описаний | Фильтрация по min_confidence=0.6 и min_chars=100 | gemini_extractor.py:182-183 |
| Неточные позиции | Позиция = offset чанка, а НЕ реальная позиция в тексте | gemini_extractor.py:612-613 |
| Низкое качество | LLM плохо определяет character offsets (исследования показывают <24% F1) | Архитектурная проблема |

### Рекомендация

**Оставить Gemini 3 Flash**, но исправить архитектуру извлечения позиций:
1. Перейти на **Tagged Span Annotation (TSA)** вместо числовых offsets
2. Снизить min_confidence до 0.4 для увеличения recall
3. Добавить post-processing для вычисления реальных позиций

**Альтернатива для более высокого качества:** Claude Sonnet 4.5 (x6 дороже, но лучше качество для сложного литературного текста).

---

## Часть 1: Анализ текущей реализации

### 1.1 Структура кода

```
gemini_extractor.py (788 строк)
├── GeminiConfig (строки 167-188) - конфигурация
├── RecursiveTextChunker (строки 190-310) - чанкинг текста
├── GeminiDirectExtractor (строки 313-788) - основной класс
│   ├── EXTRACTION_PROMPT (строки 321-346) - РУССКИЙ промпт!
│   ├── analyze_chapter() - анализ главы
│   ├── _call_gemini_with_retry() - вызов API с retry
│   └── _convert_descriptions() - конвертация результатов
```

### 1.2 Промпт (РУССКИЙ, строки 321-346)

```python
EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. 
Твоя задача - подготовить детальные справки для художников...

ТИПЫ СУЩНОСТЕЙ:
- character: Люди, существа. Описывай: лицо, волосы, одежда, возраст...
- location: Места действия. Описывай: освещение, архитектура...
- object: ТОЛЬКО Сюжетно Важные Артефакты...

Текст для анализа:
{text}
"""
```

**Вывод:** Перевод НЕ происходит. Gemini получает русский текст напрямую.

### 1.3 Проблема с позициями (КРИТИЧНО)

```python
# gemini_extractor.py:606-614
desc_obj = ExtractedDescription(
    content=content,
    description_type=desc_type,
    confidence=item.confidence,
    entities=[{"name": name} for name in item.entities],
    attributes={},
    position=offset,  # <-- ПРИБЛИЗИТЕЛЬНАЯ позиция (комментарий в коде!)
    source_span=(offset, offset + len(content))  # <-- НЕ реальная позиция!
)
```

**Проблема:** `offset` — это позиция начала **чанка**, а не позиция описания в исходном тексте.

### 1.4 Фильтрация описаний

```python
# gemini_extractor.py:182-183
min_description_chars: int = 100    # Минимум 100 символов
min_confidence: float = 0.6         # Минимум 60% уверенность
```

**Гипотеза:** Gemini может возвращать описания с confidence 0.5-0.6, которые отсекаются фильтром.

---

## Часть 2: Web Research — Benchmarks и Pricing

### 2.1 Мультиязычные бенчмарки (MMMLU, декабрь 2025)

| Модель | MMMLU Score | Русский* |
|--------|-------------|----------|
| **Gemini 3 Pro** | 91.8 | Отлично |
| **Claude Opus 4.5** | 90.8 | Отлично |
| **Claude Sonnet 4.5** | 89.1 | Хорошо |
| **Gemini 2.5 Pro** | 89.2 | Хорошо |
| **GPT-4o** | 81.4 | Хорошо |
| Qwen2.5-72B | 78.7 (ruMMLU) | Хорошо |

*Русский оценивается на основе ruMMLU и MERA benchmarks.

**Источники:** [Vellum LLM Leaderboard](https://www.vellum.ai/llm-leaderboard), [MMLU-ProX](https://mmluprox.github.io/)

### 2.2 Pricing (январь 2026)

| Модель | Input/1M | Output/1M | Context | Стоимость книги* |
|--------|----------|-----------|---------|------------------|
| **Gemini 2.5 Flash Lite** | $0.08 | $0.30 | 1M | ~$0.02 |
| **Gemini 2.5 Flash** | $0.30 | $2.50 | 1M | ~$0.10 |
| **Gemini 3 Flash** | $0.50 | $3.00 | 1M | ~$0.15 |
| GPT-4o Mini | $0.15 | $0.60 | 128K | ~$0.05 |
| **GPT-4o** | $2.50 | $10.00 | 128K | ~$0.80 |
| **Claude Sonnet 4.5** | $3.00 | $15.00 | 200K | ~$1.00 |
| **Claude Opus 4.5** | $5.00 | $25.00 | 200K | ~$2.00 |
| Gemini 3 Pro | $4.00 | $18.00 | 1M | ~$1.50 |

*Примерная стоимость обработки книги 100K слов (~150K токенов input + ~50K output).

**Источники:** [CloudIDR LLM Pricing](https://www.cloudidr.com/llm-pricing), [DocsBot Calculator](https://docsbot.ai/tools/gpt-openai-api-pricing-calculator)

### 2.3 Text Extraction Performance

| Модель | OCR (OmniDocBench) | Data Extraction | Примечание |
|--------|-------------------|-----------------|------------|
| **Gemini 3 Flash** | 0.121 (лучше) | Лидер | Быстрее, точнее для structured data |
| Claude Sonnet 4.5 | 0.145 | Хорошо | Лучше для qualitative analysis |

**Источник:** [Google DeepMind — Gemini Flash](https://deepmind.google/models/gemini/flash/)

### 2.4 Исследования по точности позиций (2025-2026)

**Ключевой вывод из исследований:**

> "Прямой запрос числовых character offsets у LLM даёт **низкую производительность** (<24% F1 для open LLMs). LLM не имеют прямого механизма для точного подсчёта символов."
> — [Strategies for Span Labeling with LLMs, arXiv 2601.16946](https://arxiv.org/html/2601.16946v1)

**Best Practices для позиций:**

1. **Tagged Span Annotation (TSA)** — вставлять теги `@@description##TYPE` в текст
2. **Требовать идентичный output** — текст на выходе = текст на входе + теги
3. **Post-processing** — вычислять offsets по позициям тегов

**Библиотека LangExtract (Google)** использует "Precise Source Grounding" с exact character offsets.

---

## Часть 3: Сравнительный анализ альтернатив

### 3.1 Gemini 3 Flash (текущий)

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 8/10 | Хороший, но не лучший |
| Structured Output | 9/10 | Нативная поддержка Pydantic |
| Latency | 10/10 | ~1-2s на chunk |
| Context Window | 10/10 | 1M токенов |
| Cost Efficiency | 9/10 | $0.50/$3.00 per 1M |
| **Итого** | **8.5/10** | Оптимальный баланс |

**Плюсы:**
- Огромный контекст (1M токенов) — можно обрабатывать главы целиком
- Быстрый
- Дешёвый
- Нативный `response_schema` с Pydantic

**Минусы:**
- Не лучший для русской литературы
- Проблемы с exact character offsets (общая проблема всех LLM)

### 3.2 Claude Sonnet 4.5

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 9/10 | Отличное понимание нюансов |
| Structured Output | 9/10 | Через Instructor или native |
| Latency | 7/10 | ~3-5s на chunk |
| Context Window | 8/10 | 200K токенов |
| Cost Efficiency | 5/10 | $3.00/$15.00 per 1M (x6 дороже) |
| **Итого** | **7.5/10** | Премиум качество |

**Плюсы:**
- Лучшее понимание литературного текста
- Превосходный qualitative analysis
- Меньше hallucinations

**Минусы:**
- В 6 раз дороже Gemini 3 Flash
- Медленнее
- Меньший контекст

**Когда использовать:** Для премиум-пользователей или финальной проверки качества.

### 3.3 GPT-4o

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 7/10 | Хорошее, но хуже Claude |
| Structured Output | 10/10 | Лучшая поддержка JSON mode |
| Latency | 8/10 | ~2-3s на chunk |
| Context Window | 7/10 | 128K токенов |
| Cost Efficiency | 6/10 | $2.50/$10.00 per 1M |
| **Итого** | **7.5/10** | Хороший баланс |

**Плюсы:**
- Лучший structured output
- Стабильный API
- Хорошая документация

**Минусы:**
- Меньший контекст (128K vs 1M)
- Дороже Gemini
- Русский хуже чем у Claude

### 3.4 Qwen 2.5 72B (Self-hosted)

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 8/10 | 78.7 на ruMMLU |
| Structured Output | 7/10 | Требует fine-tuning |
| Latency | 6/10 | Зависит от инфраструктуры |
| Context Window | 7/10 | 32K-128K |
| Cost Efficiency | 10/10 | Только инфраструктура |
| **Итого** | **7/10** | Для self-hosted |

**Плюсы:**
- Нет платы за API (только GPU)
- Полный контроль
- Поддержка 29+ языков

**Минусы:**
- Требует GPU (A100 или выше)
- DevOps overhead
- Нет native structured output

**Когда использовать:** При большом объёме (>100K книг/месяц) или требованиях к privacy.

### 3.5 DeepSeek V3

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 7/10 | Оптимизирован для китайского |
| Structured Output | 7/10 | Поддержка JSON |
| Latency | 8/10 | Быстрый |
| Context Window | 8/10 | 128K токенов |
| Cost Efficiency | 9/10 | Дешевле GPT-4o |
| **Итого** | **7.5/10** | Альтернатива GPT-4o |

**Плюсы:**
- Дешевле GPT-4o
- Хорошее качество
- MoE архитектура (эффективность)

**Минусы:**
- Оптимизирован для китайского, не русского
- Меньше документации
- Менее стабильный API

### 3.6 GLiNER (Specialized NER)

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | 4/10 | 33.3 F1 (слабо) |
| Structured Output | 10/10 | Native NER output |
| Latency | 10/10 | Локальный inference |
| Cost Efficiency | 10/10 | Open source |
| **Итого** | **6/10** | Только для entity extraction |

**Вывод:** GLiNER не подходит для русского языка (F1=33.3 vs ChatGPT F1=59.7).

---

## Часть 3.7: Gemini 3 Pro — Детальный анализ (НОВОЕ)

### Общая информация

**Gemini 3 Pro** — флагманская модель Google, оптимизированная для сложных рассуждений и агентных workflow. Занимает **первое место по MMMLU (91.8%)** — лучший результат среди всех моделей по мультиязычности.

### Pricing (январь 2026)

| Контекст | Input/1M | Output/1M | Сравнение с Flash |
|----------|----------|-----------|-------------------|
| ≤200K токенов | $2.00 | $12.00 | **4x дороже** |
| >200K токенов | $4.00 | $18.00 | **4x дороже** |

**Стоимость обработки книги (100K слов):**
- Gemini 3 Flash: ~$0.15
- Gemini 3 Pro: ~$0.60 (**4x дороже**)

**Источники:** [Google AI Pricing](https://ai.google.dev/gemini-api/docs/pricing), [MetaCTO Guide](https://www.metacto.com/blogs/the-true-cost-of-google-gemini-a-guide-to-api-pricing-and-integration)

### Benchmarks: Pro vs Flash (декабрь 2025)

| Бенчмарк | Flash | Pro | Победитель | Значение |
|----------|-------|-----|------------|----------|
| **MMMLU (мультиязычность)** | ~88% | **91.8%** | **Pro** | TOP среди всех моделей |
| **Global PIQA (100 языков)** | ~90% | **93.4%** | **Pro** | Культурное понимание |
| **GPQA Diamond (PhD reasoning)** | 90.4% | **91.9%** | **Pro** | +1.5% |
| **Humanity's Last Exam** | 33.7% | **37.5%** | **Pro** | +3.8% |
| MMMU Pro (multimodal) | **81.2%** | 81.0% | **Flash** | +0.2% |
| **SWE-bench (coding)** | **78.0%** | 76.2% | **Flash** | +1.8% |
| Toolathlon | **49.4%** | ~45% | **Flash** | Агентные задачи |

**Источники:** [CNET](https://www.cnet.com/tech/services-and-software/google-gemini-3-flash-release/), [9to5Google](https://9to5google.com/2025/12/17/gemini-3-flash-launch/), [Vellum Benchmarks](https://www.vellum.ai/blog/google-gemini-3-benchmarks)

### Ключевые различия

| Параметр | Flash | Pro | Комментарий |
|----------|-------|-----|-------------|
| **Контекст** | 1M токенов | **2M токенов** | Pro для очень длинных документов |
| **Скорость** | **3x быстрее** | Baseline | Flash значительно быстрее |
| **Стоимость** | **75% дешевле** | Baseline | Flash экономичнее |
| **Мультиязычность** | Хорошо | **TOP (91.8%)** | Pro лидер MMMLU |
| **Coding** | **78%** | 76.2% | Flash лучше для кода |
| **Reasoning** | 90.4% | **91.9%** | Pro для сложных рассуждений |

### Неожиданные находки

1. **Flash ОБХОДИТ Pro в coding** (78% vs 76.2% на SWE-bench)
2. **Flash в 3 раза быстрее** при сопоставимом качестве
3. **Pro имеет проблемы с памятью** — [сообщения о критических memory issues](https://vertu.com/lifestyle/gemini-3-flash-outperforms-pro-in-coding-while-pro-suffers-critical-memory-issues/)
4. **Pro ЛИДЕР по мультиязычности** — 91.8% MMMLU (лучше Claude Opus 4.5!)

### Оценка для задачи парсинга описаний

| Критерий | Оценка | Комментарий |
|----------|--------|-------------|
| Качество русского | **10/10** | TOP MMMLU (91.8%), лучший для мультиязычности |
| Structured Output | 9/10 | Нативная поддержка Pydantic |
| Latency | 6/10 | ~3-5s на chunk (3x медленнее Flash) |
| Context Window | **10/10** | 2M токенов — можно обрабатывать целые книги |
| Cost Efficiency | 5/10 | $2.00/$12.00 per 1M (4x дороже Flash) |
| **Итого** | **8.0/10** | Премиум качество для мультиязычности |

### Когда использовать Gemini 3 Pro

**Рекомендуется для:**

1. **Мультиязычный контент высшего качества** — Pro имеет лучший MMMLU score
2. **Очень длинные документы** (>200K токенов) — 2M контекст позволяет обработать целую книгу за один вызов
3. **Сложные литературные тексты** — лучшее понимание нюансов через Global PIQA
4. **ULTIMATE подписка** — когда качество важнее стоимости

**НЕ рекомендуется для:**

1. **Массовая обработка** — 4x дороже Flash
2. **Coding-тяжёлые задачи** — Flash лучше на SWE-bench
3. **Требования к latency** — Flash в 3x быстрее

### Сравнение с Claude Sonnet 4.5

| Параметр | Gemini 3 Pro | Claude Sonnet 4.5 | Победитель |
|----------|--------------|-------------------|------------|
| MMMLU | **91.8%** | 89.1% | **Pro** |
| Стоимость (input) | $2.00 | $3.00 | **Pro** |
| Стоимость (output) | $12.00 | $15.00 | **Pro** |
| Контекст | **2M** | 200K | **Pro** |
| Latency | ~3-5s | ~3-5s | Паритет |
| Качество русского | Отлично | Отлично | Паритет |

**Вывод:** Gemini 3 Pro **лучше Claude Sonnet 4.5** для мультиязычных задач:
- Дешевле (на 33% по input, на 20% по output)
- Больший контекст (2M vs 200K — в 10 раз!)
- Лучший MMMLU score (91.8% vs 89.1%)

---

## Часть 4: Рекомендация

### 4.1 Оптимальное решение: Исправить текущую реализацию

**Gemini 3 Flash остаётся лучшим выбором** по соотношению цена/качество/скорость.

**Необходимые изменения:**

#### 1. Исправить расчёт позиций (Tagged Span Annotation)

```python
# Новый промпт с тегами
EXTRACTION_PROMPT = """
...
ВАЖНО: Для каждого описания оберни его в исходном тексте тегами:
@@DESCRIPTION_START##TYPE@@описание текста@@DESCRIPTION_END##

Пример:
Исходный текст: "Комната была тёмной и сырой."
Результат: "@@DESCRIPTION_START##LOCATION@@Комната была тёмной и сырой.@@DESCRIPTION_END##"

Верни модифицированный текст С ТЕГАМИ, а также JSON с метаданными.
"""

# Post-processing для вычисления offsets
def extract_positions(tagged_text: str, original_text: str) -> List[Tuple[int, int]]:
    """Вычислить реальные позиции по тегам."""
    import re
    pattern = r'@@DESCRIPTION_START##(\w+)@@(.+?)@@DESCRIPTION_END##'
    
    positions = []
    for match in re.finditer(pattern, tagged_text):
        desc_text = match.group(2)
        # Найти в оригинальном тексте
        start = original_text.find(desc_text)
        if start != -1:
            positions.append((start, start + len(desc_text)))
    
    return positions
```

#### 2. Снизить threshold для увеличения recall

```python
# gemini_extractor.py:182-183
min_description_chars: int = 50   # Было 100
min_confidence: float = 0.4       # Было 0.6
```

#### 3. Добавить валидацию описаний

```python
def validate_description_in_text(description: str, source_text: str) -> bool:
    """Проверить, что описание действительно есть в тексте."""
    # Нормализация
    desc_normalized = ' '.join(description.lower().split())
    text_normalized = ' '.join(source_text.lower().split())
    
    # Fuzzy matching
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, desc_normalized, text_normalized).ratio()
    
    return ratio > 0.3 or desc_normalized in text_normalized
```

### 4.2 Альтернатива для ULTIMATE: Gemini 3 Pro (ОБНОВЛЕНО)

**Рекомендация изменена:** Вместо Claude Sonnet 4.5 рекомендуется **Gemini 3 Pro** для ULTIMATE тарифа:

| Параметр | Gemini 3 Pro | Claude Sonnet 4.5 |
|----------|--------------|-------------------|
| MMMLU (мультиязычность) | **91.8% (TOP)** | 89.1% |
| Стоимость книги | **~$0.60** | ~$1.00 |
| Контекст | **2M токенов** | 200K токенов |
| Latency | ~3-5s | ~3-5s |

**Преимущества Gemini 3 Pro:**
- **Лучший MMMLU score** (91.8%) — TOP среди всех моделей
- **На 40% дешевле** Claude Sonnet 4.5
- **В 10 раз больший контекст** (2M vs 200K) — можно обработать целую книгу за один вызов
- **Единая экосистема** — не нужно интегрировать второго провайдера

```python
class GeminiProExtractor:
    """Премиум экстрактор на Gemini 3 Pro для ULTIMATE."""
    
    def __init__(self):
        from google import genai
        from google.genai import types
        
        self.client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        self.model = "gemini-3-pro-preview"
        self.types = types
    
    async def extract(self, text: str) -> List[ExtractedDescription]:
        """Извлечение с использованием 2M контекста."""
        config = self.types.GenerateContentConfig(
            temperature=0.3,
            top_p=0.95,
            response_mime_type="application/json",
            response_schema=GeminiResponseSchema,
        )
        
        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=EXTRACTION_PROMPT.format(text=text),
            config=config,
        )
        
        return response.parsed
```

**Cost comparison для книги (100K слов):**

| Модель | Стоимость | Для кого | MMMLU |
|--------|-----------|----------|-------|
| Gemini 3 Flash | ~$0.15 | FREE, PREMIUM | ~88% |
| **Gemini 3 Pro** | **~$0.60** | **ULTIMATE** | **91.8%** |
| Claude Sonnet 4.5 | ~$1.00 | (не рекомендуется) | 89.1% |

### 4.3 Стратегия по тарифам fancai.ru

| Тариф | Модель | Стоимость/книга | Качество | Обоснование |
|-------|--------|-----------------|----------|-------------|
| **FREE** | Gemini 3 Flash | ~$0.15 | Хорошее | Оптимальный баланс |
| **PREMIUM** | Gemini 3 Flash | ~$0.15 | Хорошее | Больше квота, та же модель |
| **ULTIMATE** | **Gemini 3 Pro** | ~$0.60 | **Лучшее** | TOP мультиязычность, 2M контекст |

**Дополнительные возможности ULTIMATE с Gemini 3 Pro:**

1. **Обработка целой книги за один вызов** — 2M контекст позволяет загрузить книгу целиком
2. **Лучшее понимание литературного контекста** — Global PIQA 93.4% (культурная осведомлённость)
3. **Более точное извлечение связей между персонажами** — лучший reasoning
4. **Меньше пропущенных описаний** — top multilingual score улучшает recall для русского

### 4.3 План миграции

**Если всё же решите мигрировать на Claude Sonnet 4.5:**

1. **Неделя 1:** Добавить `claude_extractor.py` как альтернативный экстрактор
2. **Неделя 2:** A/B тест на 100 книгах — сравнить recall/precision
3. **Неделя 3:** Feature flag для выбора модели по тарифу пользователя
4. **Неделя 4:** Мониторинг стоимости, оптимизация промпта

**Rollback strategy:** Feature flag выключает Claude, возвращает Gemini.

---

## Часть 5: Proof of Concept — тестовый промпт

### 5.1 Улучшенный промпт для Gemini 3 Flash

```python
IMPROVED_EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. 
Анализируй текст книги и извлекай визуальные описания.

ЗАДАЧА:
1. Найди ВСЕ фрагменты текста, которые описывают:
   - LOCATION: места, интерьеры, пейзажи, погоду
   - CHARACTER: внешность персонажей, одежду, выражения лиц
   - ATMOSPHERE: настроение сцены, освещение, звуки
   - OBJECT: важные предметы с детальным описанием

2. Для каждого описания:
   - Оберни его в тексте тегами: @@START##TYPE@@текст@@END##
   - TYPE = LOCATION | CHARACTER | ATMOSPHERE | OBJECT

3. КРИТЕРИИ ВКЛЮЧЕНИЯ:
   - Минимум 30 символов описания
   - Должно создавать визуальный образ
   - Подходит для иллюстрации

4. НЕ ВКЛЮЧАЙ:
   - Диалоги без описаний
   - Абстрактные рассуждения
   - Действия без визуальных деталей

ПРИМЕР:
Входной текст: "Иван вошёл в комнату. Она была тёмной и пыльной, с покосившимися книжными полками."

Выходной текст: "Иван вошёл в комнату. @@START##LOCATION@@Она была тёмной и пыльной, с покосившимися книжными полками.@@END##"

ТЕКСТ ДЛЯ АНАЛИЗА:
{text}

ВЕРНИ:
1. Модифицированный текст с тегами
2. JSON с метаданными каждого описания
"""
```

### 5.2 Метрики для оценки

```python
def evaluate_extraction(
    extracted: List[ExtractedDescription],
    ground_truth: List[Dict],
    source_text: str
) -> Dict[str, float]:
    """Оценить качество извлечения."""
    
    # 1. Recall: % найденных описаний из ground truth
    found = 0
    for gt in ground_truth:
        for ext in extracted:
            if ext.content in gt["content"] or gt["content"] in ext.content:
                found += 1
                break
    recall = found / len(ground_truth) if ground_truth else 0
    
    # 2. Precision: % релевантных среди найденных
    valid = sum(1 for ext in extracted if ext.content in source_text)
    precision = valid / len(extracted) if extracted else 0
    
    # 3. Position accuracy: средняя ошибка позиции в символах
    position_errors = []
    for ext in extracted:
        real_pos = source_text.find(ext.content)
        if real_pos != -1:
            error = abs(ext.source_span[0] - real_pos)
            position_errors.append(error)
    avg_position_error = sum(position_errors) / len(position_errors) if position_errors else float('inf')
    
    return {
        "recall": recall,
        "precision": precision,
        "f1": 2 * recall * precision / (recall + precision) if (recall + precision) > 0 else 0,
        "avg_position_error_chars": avg_position_error
    }
```

---

## Часть 6: Итоговая таблица сравнения (ОБНОВЛЕНО)

| Модель | Русский | Structured | Latency | Context | Cost | **Итого** | Рекомендация |
|--------|---------|------------|---------|---------|------|-----------|--------------|
| **Gemini 3 Flash** | 8 | 9 | 10 | 10 | 9 | **8.5** | FREE, PREMIUM |
| **Gemini 3 Pro** | **10** | 9 | 6 | **10** | 5 | **8.0** | **ULTIMATE** |
| Claude Sonnet 4.5 | 9 | 9 | 7 | 8 | 5 | 7.5 | — |
| GPT-4o | 7 | 10 | 8 | 7 | 6 | 7.5 | — |
| DeepSeek V3 | 7 | 7 | 8 | 8 | 9 | 7.5 | — |
| Qwen 2.5 72B | 8 | 7 | 6 | 7 | 10 | 7.0 | Self-hosted |
| GLiNER | 4 | 10 | 10 | N/A | 10 | 6.0 | — |

### Визуализация: Flash vs Pro для fancai.ru

```
                    Gemini 3 Flash          Gemini 3 Pro
                    ──────────────          ────────────
Мультиязычность:    ████████░░ 88%         ██████████ 91.8% (TOP!)
Скорость:           ██████████ 3x          ███░░░░░░░ baseline
Стоимость:          ██████████ $0.15       ██░░░░░░░░ $0.60
Контекст:           █████████░ 1M          ██████████ 2M
Coding:             █████████░ 78%         ████████░░ 76%
Reasoning:          █████████░ 90.4%       ██████████ 91.9%

Рекомендация:       FREE + PREMIUM         ULTIMATE
```

---

## Заключение

### Главные выводы

1. **Проблема НЕ в Gemini 3 Flash** — модель работает с русским напрямую, без перевода
2. **Проблема в архитектуре** — позиции вычисляются неправильно (offset чанка вместо реальной позиции)
3. **Проблема в фильтрации** — слишком высокий min_confidence (0.6) отсекает валидные описания
4. **Gemini 3 Pro — лучший для мультиязычности** — TOP MMMLU (91.8%), лучше Claude Sonnet 4.5

### Рекомендуемые действия

| Приоритет | Действие | Ожидаемый эффект |
|-----------|----------|------------------|
| **P0** | Исправить расчёт позиций (TSA) | +50% точность позиций |
| **P0** | Снизить min_confidence до 0.4 | +30% recall описаний |
| **P1** | Добавить валидацию описаний | -20% ложных срабатываний |
| **P1** | **Gemini 3 Pro для ULTIMATE** | Лучшее качество русского (MMMLU 91.8%) |

### Стратегия по тарифам (ФИНАЛЬНАЯ)

| Тариф | Модель | Стоимость/книга | Почему |
|-------|--------|-----------------|--------|
| FREE | Gemini 3 Flash | ~$0.15 | Баланс цена/качество |
| PREMIUM | Gemini 3 Flash | ~$0.15 | Больше квота |
| **ULTIMATE** | **Gemini 3 Pro** | ~$0.60 | TOP мультиязычность, 2M контекст |

### Почему Gemini 3 Pro вместо Claude Sonnet 4.5

| Критерий | Gemini 3 Pro | Claude Sonnet 4.5 |
|----------|--------------|-------------------|
| MMMLU (мультиязычность) | **91.8% (TOP)** | 89.1% |
| Стоимость книги | **$0.60** | $1.00 (+67%) |
| Контекст | **2M** | 200K (в 10 раз меньше) |
| Интеграция | Единая экосистема | Второй провайдер |

### Не рекомендуется

- **Claude Sonnet 4.5** — дороже Gemini 3 Pro при меньшем MMMLU score
- **Self-hosted Qwen** — overhead DevOps не окупится при текущем объёме
- **GLiNER** — слабая поддержка русского (F1=33.3)
- **Полная миграция на Pro** — 4x дороже Flash, для большинства пользователей избыточно

---

## Приложения

### A. Источники

1. [Vellum LLM Leaderboard (December 2025)](https://www.vellum.ai/llm-leaderboard)
2. [CloudIDR LLM Pricing (January 2026)](https://www.cloudidr.com/llm-pricing)
3. [Google DeepMind — Gemini Flash](https://deepmind.google/models/gemini/flash/)
4. [Strategies for Span Labeling with LLMs](https://arxiv.org/html/2601.16946v1)
5. [MMLU-ProX Multilingual Benchmark](https://mmluprox.github.io/)
6. [MERA Russian Benchmark](https://mera.a-ai.ru/en)
7. [Qwen 2.5 Documentation](https://qwen2.org/qwen2-5/)

**Gemini 3 Pro (новые источники):**

8. [Google AI Pricing (January 2026)](https://ai.google.dev/gemini-api/docs/pricing)
9. [Gemini 3 Flash vs Pro Comparison (AIFreeAPI)](https://www.aifreeapi.com/en/posts/gemini-3-flash-vs-pro-capabilities)
10. [Gemini 3 Flash Launch (9to5Google)](https://9to5google.com/2025/12/17/gemini-3-flash-launch/)
11. [CNET: Gemini 3 Flash vs Pro Benchmarks](https://www.cnet.com/tech/services-and-software/google-gemini-3-flash-release/)
12. [Vellum: Gemini 3 Benchmarks](https://www.vellum.ai/blog/google-gemini-3-benchmarks)
13. [Lifehacker: Gemini 3 Flash vs Pro](https://lifehacker.com/tech/gemini-3-flash-is-officially-googles-default-ai-model)
14. [Vertu: Pro Memory Issues Report](https://vertu.com/lifestyle/gemini-3-flash-outperforms-pro-in-coding-while-pro-suffers-critical-memory-issues/)

### B. Файлы для изменения

```
backend/app/services/gemini_extractor.py
  - Строка 182: min_description_chars: 100 → 50
  - Строка 183: min_confidence: 0.6 → 0.4
  - Строки 321-346: Обновить промпт (TSA)
  - Строки 580-617: Добавить post-processing позиций

backend/app/tasks/book_tasks.py
  - Строки 357-410: Использовать новые позиции из TSA
```

### C. Оценка трудозатрат (ОБНОВЛЕНО)

| Задача | Сложность | Время | Приоритет |
|--------|-----------|-------|-----------|
| Исправить позиции (TSA) | M | 4-6 часов | P0 |
| Снизить thresholds | S | 30 минут | P0 |
| Добавить валидацию | S | 1-2 часа | P1 |
| **Добавить Gemini 3 Pro для ULTIMATE** | S | 2-3 часа | P1 |
| Feature flag для выбора модели | S | 1-2 часа | P1 |
| Тестирование | M | 4-6 часов | P1 |
| **Итого** | | **~2.5 дня** |

### D. Имплементация Gemini 3 Pro

**Минимальные изменения для поддержки Pro:**

```python
# gemini_extractor.py

class GeminiConfig:
    # Добавить поддержку Pro
    model_id: str = "gemini-3-flash-preview"  # default
    pro_model_id: str = "gemini-3-pro-preview"  # для ULTIMATE
    
    # Настройки для Pro (большой контекст)
    pro_max_chunk_chars: int = 500000  # 500K chars, используем 2M контекст

def get_gemini_extractor(use_pro: bool = False) -> GeminiDirectExtractor:
    """Получить экстрактор с выбором модели."""
    config = GeminiConfig()
    if use_pro:
        config.model_id = config.pro_model_id
        config.max_chunk_chars = config.pro_max_chunk_chars
    return GeminiDirectExtractor(config)
```

**В book_tasks.py:**

```python
# Определение модели по подписке пользователя
async def _process_book_async(book_id: UUID) -> Dict[str, Any]:
    ...
    # Получить подписку пользователя
    user_subscription = book.user.subscription_tier  # FREE, PREMIUM, ULTIMATE
    
    # Выбрать модель
    use_pro = user_subscription == "ULTIMATE"
    gemini_extractor = get_gemini_extractor(use_pro=use_pro)
    ...
```

---

**Следующие шаги:**
1. **P0:** Исправить расчёт позиций через Tagged Span Annotation
2. **P0:** Снизить min_confidence до 0.4
3. **P1:** Добавить Gemini 3 Pro для ULTIMATE
4. **P1:** Feature flag для A/B тестирования

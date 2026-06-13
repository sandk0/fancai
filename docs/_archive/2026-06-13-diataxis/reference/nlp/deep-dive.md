# NLP Technical Deep-Dive: Advanced Algorithmic Analysis

**Дата:** 2025-11-14 (обновлено)
**Автор:** Claude Code
**Версия:** 1.1 - Technical Analysis (актуализировано)
**Цель:** Глубокий анализ текущей реализации и разработка advanced алгоритмов

---

## 📋 Оглавление

1. [Архитектура Системы](#архитектура-системы)
2. [Критический Анализ Текущей Реализации](#критический-анализ)
3. [Алгоритмический Анализ](#алгоритмический-анализ)
4. [Математические Модели](#математические-модели)
5. [Advanced NLP Техники](#advanced-nlp-техники)
6. [Граф-Алгоритмы для Описаний](#граф-алгоритмы)
7. [Machine Learning Подходы](#machine-learning)
8. [Implementation Roadmap](#implementation-roadmap)

---

## 🏗️ ЧАСТЬ 1: Архитектура Системы

### 1.1 Обзор Компонентов

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOOKREADER AI NLP SYSTEM                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: FILE PARSING (book_parser.py - 835 lines)            │
│  ════════════════════════════════════════════════════════════   │
│  • BookParser (main coordinator)                                │
│  • EPUBParser (EPUB files)                                      │
│  • FB2Parser (FB2 files)                                        │
│  • ChapterNumberExtractor (chapter detection)                   │
│                                                                  │
│  Input:  EPUB/FB2 file                                          │
│  Output: ParsedBook { metadata, chapters[] }                    │
│          BookChapter { number, title, content, html_content }   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: NLP PROCESSING (multiple files)                      │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  2.1 BASIC NLP (nlp_processor.py - 572 lines)          │   │
│  │  ───────────────────────────────────────────────────    │   │
│  │  • BaseNLPProcessor                                     │   │
│  │  • SpacyProcessor (ru_core_news_lg)                     │   │
│  │  • NatashaProcessor (Russian NER)                       │   │
│  │  • NLPProcessor (coordinator)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  2.2 ENHANCED PROCESSORS (3 files, ~1752 lines total)  │   │
│  │  ───────────────────────────────────────────────────    │   │
│  │  • EnhancedSpacyProcessor (691 lines)                   │   │
│  │  • EnhancedNatashaProcessor (515 lines)                 │   │
│  │  • EnhancedStanzaProcessor (546 lines)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  2.3 MULTI-NLP MANAGER (304 lines)                     │   │
│  │  ───────────────────────────────────────────────────    │   │
│  │  • ProcessorRegistry                                    │   │
│  │  • ConfigLoader                                         │   │
│  │  • EnsembleVoter                                        │   │
│  │  • ProcessingMode: SINGLE/PARALLEL/ENSEMBLE/ADAPTIVE    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Input:  Chapter.content (text)                                 │
│  Output: List[Description] with confidence scores               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: DATABASE STORAGE (models)                             │
│  ════════════════════════════════════════════════════════════   │
│  • Book model                                                    │
│  • Chapter model (117 lines)                                    │
│  • Description model (181 lines)                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
1. USER UPLOADS FILE
   │
   ▼
2. BookParser.parse_book()
   ├─► EPUBParser.parse() OR FB2Parser.parse()
   │   ├─► _extract_metadata()
   │   └─► _extract_chapters()
   │       ├─► _extract_chapters_from_toc() [preferred]
   │       └─► _extract_chapters_from_spine() [fallback]
   │
   ▼
3. ParsedBook { metadata, chapters[] } → Database
   │
   ▼
4. FOR EACH Chapter:
   │
   ├─► NLPProcessor.extract_descriptions()
   │   │
   │   ├─► BASIC MODE (nlp_processor.py)
   │   │   ├─► SpacyProcessor.extract_descriptions()
   │   │   │   ├─► _analyze_sentence_spacy()
   │   │   │   │   ├─► NER extraction
   │   │   │   │   └─► Pattern matching
   │   │   │   └─► _filter_and_prioritize()
   │   │   │
   │   │   └─► NatashaProcessor.extract_descriptions()
   │   │       ├─► _analyze_sentence_natasha()
   │   │       └─► _filter_and_prioritize()
   │   │
   │   └─► ENHANCED MODE (multi_nlp_manager.py)
   │       ├─► ProcessorRegistry.get_processor()
   │       │   ├─► EnhancedSpacyProcessor
   │       │   ├─► EnhancedNatashaProcessor
   │       │   └─► EnhancedStanzaProcessor
   │       │
   │       ├─► ProcessingMode selection
   │       │   ├─► SINGLE: One processor
   │       │   ├─► PARALLEL: All processors concurrently
   │       │   ├─► SEQUENTIAL: One after another
   │       │   ├─► ENSEMBLE: Voting algorithm
   │       │   └─► ADAPTIVE: Auto-select based on text
   │       │
   │       └─► EnsembleVoter.vote() [if ENSEMBLE mode]
   │           ├─► Weighted consensus
   │           ├─► Deduplication
   │           └─► Context enrichment
   │
   ▼
5. List[Description] → Database (descriptions table)
```

### 1.3 Critical Observations

#### ✅ Сильные стороны текущей архитектуры:

1. **Modular Design:**
   - Четкое разделение на layers (parsing → NLP → storage)
   - Pluggable processors (SpaCy, Natasha, Stanza)
   - Easy to extend с новыми processors

2. **Robust File Parsing:**
   - Надежный EPUB parser с TOC support
   - FB2 parser с XML handling
   - Graceful degradation (TOC → spine fallback)

3. **Multi-NLP Ensemble:**
   - 3 процессора с разными strengths
   - Voting mechanism для consensus
   - Configurable weights

#### ❌ Критические проблемы:

1. **SENTENCE-LEVEL PROCESSING** (фатально!)
   ```python
   # enhanced_nlp_system.py:350
   for sent in doc.sents:
       description = sent.text.strip()
       # ← ПРОБЛЕМА: описание может быть 5-20 предложений!
   ```

2. **NO PARAGRAPH AWARENESS**
   - Парсеры разбивают на sentences, не paragraphs
   - Нет понятия "законченного описания"
   - Result: фрагменты вместо полных описаний

3. **SHALLOW PATTERN MATCHING**
   ```python
   # nlp_processor.py:216-220
   location_patterns = [
       r"(?:в|на|около)\s+([^,.!?]{10,100})",  # Слишком простой!
   ]
   ```

4. **NO CONTEXT TRACKING**
   - Каждая глава обрабатывается независимо
   - Нет связи между описаниями персонажей/локаций
   - Повторные описания не группируются

5. **NAIVE CONFIDENCE SCORING**
   ```python
   # nlp_processor.py:177-182
   if ent.label_ in ["LOC", "GPE", "FAC"]:
       confidence = 0.8  # Hardcoded!
   elif ent.label_ in ["PERSON"]:
       confidence = 0.7
   ```
   - Не учитывает контекст
   - Не учитывает визуальную насыщенность
   - Не учитывает законченность

---

## 🔬 ЧАСТЬ 2: Критический Анализ Текущей Реализации

### 2.1 Sentence-Level Processing Problem

#### Текущая реализация (ПЛОХО):

**File: `nlp_processor.py:126-159`**
```python
def extract_descriptions(self, text: str, chapter_id: str = None) -> List[Dict[str, Any]]:
    """Извлекает описания используя spaCy."""

    # Очистка текста
    cleaned_text = self._clean_text(text)

    # ПРОБЛЕМА #1: Разбивка на ПРЕДЛОЖЕНИЯ
    doc = self.nlp(cleaned_text)
    sentences = [
        sent.text.strip()
        for sent in doc.sents
        if len(sent.text.strip()) >= self.min_sentence_length
    ]

    descriptions = []

    # ПРОБЛЕМА #2: Анализ КАЖДОГО предложения ОТДЕЛЬНО
    for i, sentence in enumerate(sentences):
        sentence_descriptions = self._analyze_sentence_spacy(
            sentence, i, cleaned_text
        )
        descriptions.extend(sentence_descriptions)

    return descriptions
```

#### Почему это фатально?

**Пример из "Ведьмак":**
```
ОРИГИНАЛЬНЫЙ ТЕКСТ (должно быть ОДНО описание, 347 chars):

"Замок возвышался на скале, его стены из темного камня уходили в небо.
Четыре башни с остроконечными крышами стояли по углам. Главные ворота
были открыты, над ними развевался флаг с гербом. Внутренний двор был
вымощен серым булыжником."

ТЕКУЩАЯ СИСТЕМА извлекает:

1. "Замок возвышался на скале" (31 chars) ← fragment
2. "его стены из темного камня" (26 chars) ← fragment
3. "Четыре башни с остроконечными крышами" (40 chars) ← fragment
4. "Главные ворота были открыты" (30 chars) ← fragment
5. "Внутренний двор был вымощен" (29 chars) ← fragment

РЕЗУЛЬТАТ: 5 бесполезных фрагментов вместо 1 полного описания!
```

### 2.2 Pattern Matching Analysis

#### Текущие паттерны (ПРИМИТИВНЫЕ):

**File: `nlp_processor.py:209-241`**
```python
location_patterns = [
    r"(?:в|на|около|возле|рядом с|перед|за|над|под)\s+([^,.!?]{10,100})",
    r"([^,.!?]{5,50})\s+(?:стоял|стояла|стояло|находился|находилась|находилось)",
    r"(?:дом|здание|замок|храм|дворец|башня|мост|лес|поле|горы?|река|море|озеро)\s+([^,.!?]{10,100})",
]

character_patterns = [
    r"(?:он|она|оно|они)\s+(?:был|была|было|были)\s+([^,.!?]{10,100})",
    r"(?:мужчина|женщина|девушка|парень|старик|старуха)\s+([^,.!?]{10,100})",
]

atmosphere_patterns = [
    r"(?:было|стало)\s+(?:темно|светло|холодно|жарко|тихо|шумно|туманно|ясно)\s*([^,.!?]{0,50})",
    r"(?:наступил|наступила|наступило)\s+(?:вечер|утро|ночь|день|рассвет|закат)\s*([^,.!?]{0,50})",
]
```

#### Проблемы паттернов:

1. **Слишком узкие:**
   - Ловят только простые конструкции
   - Пропускают сложные литературные описания
   - Не работают с причастными оборотами

2. **Не масштабируются:**
   - Hardcoded keywords
   - Нет обучения на данных
   - Нельзя адаптировать под жанр

3. **Игнорируют синтаксис:**
   - Не учитывают dependency parsing
   - Не используют морфологию
   - Не анализируют POS sequences

### 2.3 Confidence Scoring Analysis

#### Текущий алгоритм (НАИВНЫЙ):

**File: `enhanced_nlp_system.py:400-442`**
```python
def _calculate_general_descriptive_score(self, sent) -> float:
    """
    Рассчитывает общую описательность предложения.
    """
    # Подсчёт прилагательных и существительных
    adj_count = sum(1 for token in sent if token.pos_ == "ADJ")
    noun_count = sum(1 for token in sent if token.pos_ == "NOUN")

    if adj_count > 0 and noun_count > 0:
        # ПРОБЛЕМА: Слишком простая формула
        adj_ratio = adj_count / (noun_count + adj_count)
        score = 0.5 + adj_ratio * 0.3  # ← Все получают 0.5-0.8!

        # Бонусы за ключевые слова
        if any(kw in sent.text.lower() for kw in ["красивый", "величественный"]):
            score += 0.1

        # Штрафы
        if any(kw in sent.text.lower() for kw in ["сказал", "подумал"]):
            score -= 0.2

        return max(0.0, min(1.0, score))

    return 0.3  # Default для всего остального
```

#### Критические недостатки:

1. **Нет discrimination:**
   - Почти всё получает 0.5-0.8
   - Заголовки глав: 0.9 (!)
   - Реальные описания: 0.3-0.4
   - **Система работает НАОБОРОТ!**

2. **Не учитывает:**
   - Визуальную лексику (цвета, размеры, формы)
   - Сенсорные слова (запахи, звуки, текстуры)
   - Пространственные предлоги (над, под, между)
   - Синтаксическую сложность
   - Семантическую связность

3. **Hardcoded thresholds:**
   - Нет адаптации под жанр
   - Нет обучения на feedback
   - Нет calibration

### 2.4 Enhanced Processors Analysis

#### EnhancedSpacyProcessor (692 lines)

**Strengths:**
- Multiple extraction strategies:
  - `_extract_entity_descriptions()` - NER-based
  - `_extract_pattern_descriptions()` - Pattern-based
  - `_extract_contextual_descriptions()` - Context-based
  - `_extract_fallback_descriptions()` - ADJ+NOUN fallback

**Weaknesses:**
```python
# enhanced_nlp_system.py:350-370
def _extract_entity_descriptions(self, doc):
    descriptions = []
    for sent in doc.sents:  # ← SENTENCE-LEVEL!
        # Extract entities from SINGLE sentence
        for ent in sent.ents:
            # Create description from entity
            description = {
                "content": sent.text,  # ← Только одно предложение!
                "type": self._guess_type(ent),
                "confidence_score": 0.5,
            }
            descriptions.append(description)
    return descriptions
```

**Проблема:** Все стратегии работают на sentence-level!

#### EnhancedNatashaProcessor (516 lines)

**Strengths:**
- Russian-specific patterns
- Yargy-parser integration
- Morphological analysis

**Weaknesses:**
```python
# natasha_processor.py:60-72
"person_patterns": [
    r"\b(?:юноша|девушка|старик|женщина|мужчина|ребёнок|дитя)\b",
],
"location_patterns": [
    r"\b(?:дворец|замок|крепость|терем|хижина|изба)\b",
],
```

- Слишком узкие паттерны
- Не покрывают литературные описания
- Не группируют multi-sentence descriptions

#### EnhancedStanzaProcessor (541 lines)

**Strengths:**
- Deep dependency parsing
- Universal Dependencies
- Participial constructions handling

**Weaknesses:**
```python
# stanza_processor.py:150-180
def _extract_dependency_descriptions(self, doc):
    # Анализирует dependency relations
    for sent in doc.sentences:  # ← SENTENCE-LEVEL AGAIN!
        for word in sent.words:
            if word.deprel in ["amod", "nmod"]:
                # Extract based on dependency
```

- Также sentence-level
- Не использует полную силу dependency parsing для multi-sentence grouping

### 2.5 Multi-NLP Manager Analysis

#### Ensemble Voting Algorithm

**File: `multi_nlp_manager.py:150-220`**
```python
class EnsembleVoter:
    def vote(self, results: List[ProcessingResult]) -> ProcessingResult:
        """
        Ensemble voting с weighted consensus.
        """
        # Weights для процессоров
        weights = {
            "spacy": 1.0,
            "natasha": 1.2,  # Выше для русского
            "stanza": 0.8,
        }

        # Group similar descriptions
        groups = self._group_similar_descriptions(all_descriptions)

        # Weighted voting
        voted_descriptions = []
        for group in groups:
            # Calculate consensus score
            total_weight = sum(weights[d.source] for d in group)
            consensus_score = total_weight / len(results)

            if consensus_score >= 0.6:  # Threshold
                # Take best description from group
                best = max(group, key=lambda d: d.confidence)
                voted_descriptions.append(best)

        return voted_descriptions
```

**Strengths:**
- Weighted consensus
- Deduplication
- Multiple processors combine strengths

**Weaknesses:**
- `_group_similar_descriptions()` - как группировать?
- Similarity metric - какой использовать?
- Threshold 0.6 - откуда взялся?
- Не учитывает длину/полноту описаний

---

## 🧮 ЧАСТЬ 3: Алгоритмический Анализ

### 3.1 Необходимые Алгоритмы

Для решения задачи извлечения длинных описаний (500-3500 chars) нужны:

#### A. **Paragraph Segmentation Algorithm**
- **Вход:** Chapter.content (plain text)
- **Выход:** List[Paragraph] с классификацией
- **Сложность:** O(n) где n = length(text)

#### B. **Description Boundary Detection Algorithm**
- **Вход:** List[Paragraph]
- **Выход:** List[CompleteDescription] (multi-paragraph)
- **Сложность:** O(n * m) где m = max paragraphs in description

#### C. **Multi-Feature Confidence Scoring Algorithm**
- **Вход:** CompleteDescription + NLP analysis
- **Выход:** Confidence score [0.0, 1.0]
- **Сложность:** O(k) где k = number of features

#### D. **Cross-Chapter Context Tracking Algorithm**
- **Вход:** List[Description] across chapters
- **Выход:** Entity registry + context enrichment
- **Сложность:** O(n log n) с indexing

#### E. **Type Classification Algorithm**
- **Вход:** CompleteDescription + visual/semantic features
- **Выход:** DescriptionType + confidence
- **Сложность:** O(k) где k = number of classifiers

### 3.2 Algorithm A: Paragraph Segmentation

#### Псевдокод:

```python
ALGORITHM: ParagraphSegmentation
INPUT: text (string), config (ParagraphSegmentationConfig)
OUTPUT: paragraphs (List[Paragraph])

FUNCTION segment_into_paragraphs(text, config):
    lines = text.split('\n')
    paragraphs = []
    current_paragraph_lines = []

    FOR EACH line IN lines:
        stripped_line = line.strip()

        # Rule 1: Empty line = paragraph boundary
        IF stripped_line == "":
            IF current_paragraph_lines NOT EMPTY:
                paragraph = join(current_paragraph_lines, ' ')
                paragraphs.append(create_paragraph(paragraph))
                current_paragraph_lines = []
            CONTINUE

        # Rule 2: Dialog marker = separate paragraph
        IF is_dialog_start(stripped_line):
            IF current_paragraph_lines NOT EMPTY:
                paragraph = join(current_paragraph_lines, ' ')
                paragraphs.append(create_paragraph(paragraph))
                current_paragraph_lines = []

            paragraphs.append(create_paragraph(stripped_line, type=DIALOG))
            CONTINUE

        # Rule 3: Chapter header = separate paragraph
        IF is_chapter_header(stripped_line):
            IF current_paragraph_lines NOT EMPTY:
                paragraph = join(current_paragraph_lines, ' ')
                paragraphs.append(create_paragraph(paragraph))
                current_paragraph_lines = []

            paragraphs.append(create_paragraph(stripped_line, type=META))
            CONTINUE

        # Rule 4: Accumulate regular lines
        current_paragraph_lines.append(stripped_line)

    # Flush remaining
    IF current_paragraph_lines NOT EMPTY:
        paragraph = join(current_paragraph_lines, ' ')
        paragraphs.append(create_paragraph(paragraph))

    # Classify each paragraph
    FOR EACH paragraph IN paragraphs:
        paragraph.type = classify_paragraph(paragraph.text)
        paragraph.descriptiveness_score = score_descriptiveness(paragraph.text)

    RETURN paragraphs

FUNCTION classify_paragraph(text):
    """
    Классифицирует параграф: DESCRIPTION, NARRATIVE, DIALOG, META
    """
    # Fast classification based on patterns
    IF starts_with_dialog_marker(text):
        RETURN DIALOG

    IF is_chapter_header(text):
        RETURN META

    IF is_epigraph(text):
        RETURN META

    # Compute scores
    desc_score = score_descriptiveness(text)
    narr_score = score_narrativeness(text)

    IF desc_score > narr_score + 0.2:
        RETURN DESCRIPTION
    ELSE IF narr_score > desc_score + 0.2:
        RETURN NARRATIVE
    ELSE:
        RETURN MIXED

FUNCTION score_descriptiveness(text):
    """
    Оценка описательности параграфа.
    """
    doc = nlp(text)

    # Feature 1: ADJ/NOUN ratio
    adj_count = count_pos(doc, "ADJ")
    noun_count = count_pos(doc, "NOUN")
    adj_ratio = adj_count / (noun_count + 1) если noun_count > 0 else 0
    score = min(0.3, adj_ratio * 0.6)

    # Feature 2: Visual vocabulary density
    visual_words = count_visual_words(text)
    score += min(0.25, visual_words / word_count(text) * 5)

    # Feature 3: Descriptive verbs
    descriptive_verbs = ["был", "казался", "выглядел", "напоминал"]
    verb_count = sum(1 for v in descriptive_verbs if v in text.lower())
    score += min(0.2, verb_count * 0.05)

    # Feature 4: Spatial prepositions
    spatial_preps = ["над", "под", "вокруг", "между", "рядом"]
    prep_count = sum(1 for p in spatial_preps if f" {p} " in text.lower())
    score += min(0.15, prep_count * 0.03)

    # Feature 5: Penalty for action verbs
    action_verbs = ["пошел", "побежал", "схватил", "закричал"]
    action_count = sum(1 for v in action_verbs if v in text.lower())
    score -= min(0.2, action_count * 0.05)

    RETURN clamp(score, 0.0, 1.0)

FUNCTION score_narrativeness(text):
    """
    Оценка нарративности (повествовательности).
    """
    score = 0.0

    # Feature 1: Action verbs
    action_verbs = ["сказал", "пошел", "взял", "посмотрел", "подумал"]
    action_count = sum(1 for v in action_verbs if v in text.lower())
    score += min(0.4, action_count * 0.08)

    # Feature 2: Temporal markers
    temporal_markers = ["затем", "потом", "вдруг", "внезапно", "спустя"]
    temporal_count = sum(1 for m in temporal_markers if m in text.lower())
    score += min(0.3, temporal_count * 0.1)

    # Feature 3: Verb/Adjective ratio (narratives have more verbs)
    doc = nlp(text)
    verb_count = count_pos(doc, "VERB")
    adj_count = count_pos(doc, "ADJ")
    verb_adj_ratio = verb_count / (adj_count + 1) если adj_count > 0 else 0
    IF verb_adj_ratio > 2.0:
        score += 0.3

    RETURN clamp(score, 0.0, 1.0)
```

**Complexity Analysis:**
- Время: O(n) где n = length(text)
  - Split by lines: O(n)
  - Classify each paragraph: O(p) где p = number of paragraphs
  - NLP processing per paragraph: O(p * avg_paragraph_length)
  - **Total: O(n)** (linear в длине текста)

- Память: O(p) где p = number of paragraphs
  - Store paragraphs: O(p)
  - NLP doc objects: O(p)

### 3.3 Algorithm B: Description Boundary Detection

Это **ключевой алгоритм** для группировки параграфов в длинные описания.

#### Mathematical Foundation

Задача: **Найти оптимальную сегментацию** последовательности параграфов.

**Дано:**
- Последовательность параграфов: P = [p₁, p₂, ..., pₙ]
- Каждый параграф pᵢ имеет:
  - `descriptiveness_score(pᵢ)` ∈ [0, 1]
  - `type(pᵢ)` ∈ {DESCRIPTION, NARRATIVE, DIALOG, META}
  - `length(pᵢ)` - количество символов

**Найти:**
- Сегментацию S = {D₁, D₂, ..., Dₖ} где каждый Dᵢ = [pⱼ, pⱼ₊₁, ..., pⱼ₊ₘ]
- Dᵢ - это **CompleteDescription** (group of consecutive paragraphs)

**Constraints:**
1. ∀Dᵢ: 500 ≤ length(Dᵢ) ≤ 4000 chars
2. ∀Dᵢ: avg(descriptiveness_score(pⱼ ∈ Dᵢ)) ≥ 0.5
3. ∀Dᵢ: type(p₁) ∈ {DESCRIPTION, MIXED} (начинается с описательного параграфа)

**Objective:**
Максимизировать: Σ quality_score(Dᵢ) где quality_score учитывает:
- Длину (prefer longer descriptions)
- Coherence (связность параграфов)
- Visual richness (наличие визуальной лексики)

#### Algorithm: Dynamic Programming Approach

```python
ALGORITHM: DescriptionBoundaryDetection
INPUT: paragraphs (List[Paragraph])
OUTPUT: descriptions (List[CompleteDescription])

FUNCTION detect_boundaries(paragraphs):
    n = length(paragraphs)
    descriptions = []
    i = 0

    WHILE i < n:
        paragraph = paragraphs[i]

        # Skip non-descriptive paragraphs
        IF paragraph.type IN [DIALOG, META]:
            i += 1
            CONTINUE

        IF paragraph.descriptiveness_score < 0.4:
            i += 1
            CONTINUE

        # Try to build a description starting from i
        description = extract_complete_description(paragraphs, i)

        IF description IS NOT NULL:
            descriptions.append(description)
            i = description.end_index + 1
        ELSE:
            i += 1

    RETURN descriptions

FUNCTION extract_complete_description(paragraphs, start_idx):
    """
    Извлекает максимальное описание начиная с start_idx.

    Использует GREEDY ALGORITHM с lookahead.
    """
    current_desc_paras = [paragraphs[start_idx]]
    current_length = length(paragraphs[start_idx].text)

    # Lookahead window
    for i in range(start_idx + 1, min(start_idx + 20, len(paragraphs))):
        para = paragraphs[i]

        # Stopping conditions
        IF should_stop(para, current_desc_paras):
            BREAK

        # Length constraint
        IF current_length + length(para.text) > 4000:
            BREAK

        # Continuation signals
        IF should_continue(para, current_desc_paras):
            current_desc_paras.append(para)
            current_length += length(para.text)
        ELSE:
            # Try lookahead (maybe next paragraph continues)
            IF i + 1 < len(paragraphs):
                next_para = paragraphs[i + 1]
                IF has_strong_continuation_signal(next_para, current_desc_paras):
                    # Include both current and next
                    current_desc_paras.append(para)
                    current_desc_paras.append(next_para)
                    current_length += length(para.text) + length(next_para.text)
                    i += 1
                ELSE:
                    BREAK
            ELSE:
                BREAK

    # Validate minimum length
    IF current_length < 500:
        RETURN NULL

    # Create CompleteDescription
    description = CompleteDescription(
        paragraphs=current_desc_paras,
        text=join(p.text for p in current_desc_paras, '\n\n'),
        start_index=start_idx,
        end_index=start_idx + len(current_desc_paras) - 1,
        length=current_length
    )

    # Calculate quality score
    description.quality_score = calculate_quality_score(description)

    RETURN description

FUNCTION should_stop(para, current_description):
    """
    Определяет жесткие stop signals.
    """
    # Stop Signal 1: Dialog
    IF para.type == DIALOG:
        RETURN TRUE

    # Stop Signal 2: Meta text (chapter header, etc.)
    IF para.type == META:
        RETURN TRUE

    # Stop Signal 3: Strong narrative shift
    IF starts_with(para.text, ["Затем", "Потом", "Вдруг", "Однако", "Но"]):
        RETURN TRUE

    # Stop Signal 4: Action verbs indicating scene change
    action_verbs = ["пошел", "повернулся", "бросился", "закричал"]
    IF any(verb in para.text[:100] for verb in action_verbs):
        RETURN TRUE

    RETURN FALSE

FUNCTION should_continue(para, current_description):
    """
    Определяет continuation signals.
    """
    last_para = current_description[-1]

    # Continue Signal 1: Still descriptive
    IF para.descriptiveness_score >= 0.5:
        RETURN TRUE

    # Continue Signal 2: Entity continuity
    entities_prev = extract_entities(last_para.text)
    entities_curr = extract_entities(para.text)
    IF overlap(entities_prev, entities_curr) > 0:
        RETURN TRUE

    # Continue Signal 3: Spatial continuity
    spatial_words = ["над", "под", "рядом", "возле", "внутри", "снаружи"]
    IF any(word in para.text[:100] for word in spatial_words):
        RETURN TRUE

    # Continue Signal 4: Semantic similarity
    IF cosine_similarity(embed(last_para.text), embed(para.text)) > 0.7:
        RETURN TRUE

    RETURN FALSE

FUNCTION calculate_quality_score(description):
    """
    Multi-factor quality scoring.

    Factors:
    1. Length (30%) - prefer longer descriptions
    2. Coherence (25%) - semantic связность
    3. Visual richness (25%) - visual vocabulary density
    4. Descriptiveness (20%) - avg descriptiveness_score
    """
    # Factor 1: Length score (prefer 1000-2500 chars)
    length = description.length
    IF 1000 <= length <= 2500:
        length_score = 1.0
    ELSE IF 500 <= length < 1000:
        length_score = 0.6 + (length - 500) / 500 * 0.4
    ELSE IF 2500 < length <= 3500:
        length_score = 0.9 - (length - 2500) / 1000 * 0.2
    ELSE:
        length_score = 0.5

    # Factor 2: Coherence score
    coherence = calculate_semantic_coherence(description.paragraphs)

    # Factor 3: Visual richness
    visual_richness = calculate_visual_richness(description.text)

    # Factor 4: Average descriptiveness
    avg_desc = mean(p.descriptiveness_score for p in description.paragraphs)

    # Weighted sum
    quality = (
        length_score * 0.30 +
        coherence * 0.25 +
        visual_richness * 0.25 +
        avg_desc * 0.20
    )

    RETURN quality

FUNCTION calculate_semantic_coherence(paragraphs):
    """
    Измеряет semantic coherence между параграфами.

    Использует sentence embeddings и cosine similarity.
    """
    IF len(paragraphs) == 1:
        RETURN 1.0

    embeddings = [embed_text(p.text) for p in paragraphs]

    # Pairwise cosine similarity
    similarities = []
    FOR i in range(len(embeddings) - 1):
        sim = cosine_similarity(embeddings[i], embeddings[i+1])
        similarities.append(sim)

    # Average similarity
    coherence = mean(similarities)

    RETURN coherence

FUNCTION calculate_visual_richness(text):
    """
    Измеряет визуальную насыщенность текста.
    """
    words = text.lower().split()
    total_words = len(words)

    # Category 1: Colors (15%)
    colors = ["белый", "черный", "серый", "красный", "синий", "зеленый",
              "желтый", "золотой", "серебряный", "темный", "светлый"]
    color_count = sum(1 for w in words if w in colors)
    color_score = min(0.15, color_count / total_words * 10)

    # Category 2: Sizes (15%)
    sizes = ["большой", "маленький", "огромный", "крошечный", "высокий",
             "низкий", "широкий", "узкий", "длинный", "короткий"]
    size_count = sum(1 for w in words if w in sizes)
    size_score = min(0.15, size_count / total_words * 10)

    # Category 3: Shapes (10%)
    shapes = ["круглый", "квадратный", "треугольный", "острый", "тупой",
              "прямой", "кривой", "изогнутый"]
    shape_count = sum(1 for w in words if w in shapes)
    shape_score = min(0.10, shape_count / total_words * 10)

    # Category 4: Textures (15%)
    textures = ["гладкий", "шершавый", "мягкий", "твердый", "холодный",
                "теплый", "влажный", "сухой"]
    texture_count = sum(1 for w in words if w in textures)
    texture_score = min(0.15, texture_count / total_words * 10)

    # Category 5: Lighting (20%)
    lighting = ["свет", "тень", "сумрак", "яркий", "тусклый", "освещенный",
                "темный", "солнце", "луна", "звезды", "огонь"]
    lighting_count = sum(1 for w in words if w in lighting)
    lighting_score = min(0.20, lighting_count / total_words * 10)

    # Category 6: Materials (15%)
    materials = ["камень", "дерево", "металл", "ткань", "кожа", "стекло",
                 "золото", "серебро", "железо", "сталь"]
    material_count = sum(1 for w in words if w in materials)
    material_score = min(0.15, material_count / total_words * 10)

    # Category 7: Architecture (10%)
    architecture = ["башня", "стена", "крыша", "окно", "дверь", "ворота",
                    "арка", "колонна", "купол"]
    arch_count = sum(1 for w in words if w in architecture)
    arch_score = min(0.10, arch_count / total_words * 10)

    visual_richness = (
        color_score + size_score + shape_score + texture_score +
        lighting_score + material_score + arch_score
    )

    RETURN visual_richness
```

**Complexity Analysis:**
- **Time:** O(n * w) где:
  - n = number of paragraphs
  - w = lookahead window size (константа, обычно 20)
  - Для каждого paragraph: O(w) lookahead
  - **Total: O(n)** (linear)

- **Space:** O(d) где d = number of detected descriptions
  - Store descriptions: O(d)
  - Temporary paragraph groups: O(w) (константа)

**Optimization:**
- Early stopping при достижении length limit
- Lookahead ограничен константой (20 paragraphs)
- Semantic similarity вычисляется только при необходимости (lazy)

---

## 🔢 ЧАСТЬ 4: Математические Модели

### 4.1 Confidence Scoring Model

**Текущая проблема:** Naive linear model с hardcoded weights.

**Решение:** Multi-factor ensemble model с learned weights.

#### Mathematical Formulation

**Дано:**
- Description D с text t
- NLP analysis features F = {f₁, f₂, ..., fₖ}

**Найти:**
- Confidence score C(D) ∈ [0, 1]

**Модель:**

```
C(D) = Σᵢ wᵢ * fᵢ(D)

где:
- wᵢ - вес фактора i (learned or configured)
- fᵢ(D) - normalized factor score ∈ [0, 1]
```

#### Factor Definitions

**F1: Linguistic Quality (weight: 0.30)**
```
f_linguistic(D) = (
    adj_noun_balance(D) * 0.4 +
    syntactic_complexity(D) * 0.3 +
    pos_variety(D) * 0.3
)

adj_noun_balance(D):
    ratio = count(ADJ) / count(NOUN)
    IF 0.3 <= ratio <= 0.7:
        RETURN 1.0
    ELSE IF 0.1 <= ratio < 0.3 OR 0.7 < ratio <= 1.0:
        RETURN 0.6
    ELSE:
        RETURN 0.3

syntactic_complexity(D):
    avg_depth = mean(dependency_depth(sent) for sent in D.sentences)
    # Literary descriptions: depth 2-4
    IF 2 <= avg_depth <= 4:
        RETURN 1.0
    ELSE IF 1 <= avg_depth < 2:
        RETURN 0.6
    ELSE:
        RETURN 0.8 - (avg_depth - 4) * 0.1

pos_variety(D):
    unique_pos = len(set(token.pos for token in D))
    # Good descriptions have 6+ POS tags
    RETURN min(1.0, unique_pos / 8.0)
```

**F2: Visual Richness (weight: 0.25)**
```
f_visual(D) = (
    color_density(D) * 0.20 +
    size_scale_density(D) * 0.18 +
    texture_density(D) * 0.15 +
    lighting_density(D) * 0.22 +
    shape_density(D) * 0.12 +
    material_density(D) * 0.13
)

# Generic density function
density(D, vocabulary):
    word_count = count_words(D.text, vocabulary)
    total_words = len(D.text.split())
    # Normalize: 1% coverage = 0.2 score
    RETURN min(1.0, (word_count / total_words) * 20)
```

**F3: Structural Completeness (weight: 0.20)**
```
f_structure(D) = (
    starts_complete(D) * 0.3 +
    ends_complete(D) * 0.3 +
    multi_sentence(D) * 0.4
)

starts_complete(D):
    IF D.text[0].isupper():
        RETURN 1.0
    ELSE:
        RETURN 0.0  # Incomplete start = disqualify

ends_complete(D):
    last_char = D.text.rstrip()[-1]
    IF last_char IN ['.', '!', '?']:
        RETURN 1.0
    ELSE IF last_char IN [',', ';']:
        RETURN 0.3
    ELSE:
        RETURN 0.1

multi_sentence(D):
    sentence_count = count_sentences(D.text)
    IF sentence_count >= 3:
        RETURN 1.0
    ELSE IF sentence_count == 2:
        RETURN 0.7
    ELSE:
        RETURN 0.4
```

**F4: Type Specificity (weight: 0.15)**
```
f_type(D) = type_specific_score(D.text, D.type)

type_specific_score(text, type):
    IF type == LOCATION:
        RETURN location_specificity(text)
    ELSE IF type == CHARACTER:
        RETURN character_specificity(text)
    ELSE IF type == ATMOSPHERE:
        RETURN atmosphere_specificity(text)
    ELSE:
        RETURN 0.5

location_specificity(text):
    # Location indicators
    location_nouns = ["город", "деревня", "замок", "дворец", ...]
    spatial_preps = ["над", "под", "вокруг", "между", ...]
    architecture = ["башня", "стена", "крыша", "окно", ...]

    score = 0.0
    score += min(0.4, count_words(text, location_nouns) / word_count * 10)
    score += min(0.3, count_words(text, spatial_preps) / word_count * 15)
    score += min(0.3, count_words(text, architecture) / word_count * 10)

    RETURN score

character_specificity(text):
    # Character indicators
    appearance = ["лицо", "глаза", "волосы", "руки", ...]
    clothing = ["одежда", "плащ", "доспехи", "шлем", ...]
    characteristics = ["высокий", "низкий", "худой", "полный", ...]

    score = 0.0
    score += min(0.4, count_words(text, appearance) / word_count * 10)
    score += min(0.3, count_words(text, clothing) / word_count * 10)
    score += min(0.3, count_words(text, characteristics) / word_count * 10)

    RETURN score

atmosphere_specificity(text):
    # Atmosphere indicators
    weather = ["ветер", "дождь", "снег", "туман", ...]
    lighting = ["свет", "тень", "сумрак", "рассвет", ...]
    mood = ["мрачный", "светлый", "тихий", "тревожный", ...]

    score = 0.0
    score += min(0.35, count_words(text, weather) / word_count * 10)
    score += min(0.35, count_words(text, lighting) / word_count * 10)
    score += min(0.30, count_words(text, mood) / word_count * 10)

    RETURN score
```

**F5: Length Appropriateness (weight: 0.10)**
```
f_length(D) = length_score(len(D.text))

length_score(length):
    # Optimal для image generation: 1000-2500 chars
    IF 1000 <= length <= 2500:
        RETURN 1.0
    ELSE IF 500 <= length < 1000:
        # Linear interpolation
        RETURN 0.6 + (length - 500) / 500 * 0.4
    ELSE IF 2500 < length <= 3500:
        # Linear decline
        RETURN 0.9 - (length - 2500) / 1000 * 0.2
    ELSE IF length < 500:
        # Too short - penalty
        RETURN max(0.0, length / 500 * 0.6)
    ELSE:  # length > 3500
        # Too long - moderate penalty
        RETURN 0.7 - min(0.3, (length - 3500) / 1000 * 0.1)
```

#### Final Confidence Formula

```python
def calculate_confidence(description: CompleteDescription) -> float:
    """
    Multi-factor confidence scoring with learned weights.
    """
    # Extract features
    F1 = calculate_linguistic_quality(description)
    F2 = calculate_visual_richness(description)
    F3 = calculate_structural_completeness(description)
    F4 = calculate_type_specificity(description)
    F5 = calculate_length_appropriateness(description)

    # Weights (can be learned from feedback)
    W = {
        "linguistic": 0.30,
        "visual": 0.25,
        "structure": 0.20,
        "type": 0.15,
        "length": 0.10,
    }

    # Weighted sum
    confidence = (
        W["linguistic"] * F1 +
        W["visual"] * F2 +
        W["structure"] * F3 +
        W["type"] * F4 +
        W["length"] * F5
    )

    return clamp(confidence, 0.0, 1.0)
```

### 4.2 Type Classification Model

**Текущая проблема:** Binary patterns, hardcoded keywords.

**Решение:** Multi-class classification с feature-based scoring.

#### Model: Hierarchical Scoring Classifier

```
Type Scores:
    S_location = score_location(D)
    S_character = score_character(D)
    S_atmosphere = score_atmosphere(D)
    S_object = score_object(D)

Classification Rule:
    type(D) = argmax(S_location, S_character, S_atmosphere, S_object)

    WITH constraint: max_score >= threshold (e.g., 0.4)
    IF max_score < threshold: REJECT or classify as OBJECT (fallback)
```

#### Location Score Function

```python
def score_location(description):
    """
    Scores how likely description is a LOCATION.

    Features:
    1. Location nouns (30%)
    2. Spatial prepositions (25%)
    3. Architecture/geography vocabulary (20%)
    4. Absence of character-specific words (15%)
    5. Static verbs (был, находился, стоял) (10%)
    """
    text = description.text.lower()
    words = text.split()
    total_words = len(words)

    # Feature 1: Location nouns (30%)
    location_nouns = {
        "город", "деревня", "село", "столица",
        "замок", "дворец", "крепость", "башня",
        "лес", "поле", "луг", "долина",
        "гора", "холм", "утес", "скала",
        "река", "озеро", "море", "океан",
        "улица", "площадь", "переулок",
        "дом", "здание", "сооружение",
        # ... expand to 100+ words
    }
    location_count = sum(1 for w in words if w in location_nouns)
    f1 = min(1.0, location_count / (total_words * 0.05))  # 5% coverage = 1.0

    # Feature 2: Spatial prepositions (25%)
    spatial_preps = {
        "над", "под", "вокруг", "между", "рядом", "возле",
        "около", "перед", "за", "внутри", "снаружи",
        "выше", "ниже", "дальше", "ближе",
        # ... expand
    }
    spatial_count = sum(1 for i, w in enumerate(words)
                       if w in spatial_preps and i + 1 < len(words))
    f2 = min(1.0, spatial_count / (total_words * 0.03))  # 3% = 1.0

    # Feature 3: Architecture/geography (20%)
    architecture = {
        "стена", "крыша", "окно", "дверь", "ворота",
        "арка", "колонна", "купол", "шпиль",
        "фасад", "балкон", "терраса",
        # ... expand
    }
    geography = {
        "горизонт", "вершина", "склон", "берег",
        "залив", "мыс", "остров", "полуостров",
        # ... expand
    }
    arch_geo_vocab = architecture | geography
    arch_geo_count = sum(1 for w in words if w in arch_geo_vocab)
    f3 = min(1.0, arch_geo_count / (total_words * 0.04))  # 4% = 1.0

    # Feature 4: Absence of character words (15%)
    character_words = {
        "лицо", "глаза", "волосы", "руки", "ноги",
        "голова", "тело", "фигура", "рост",
        "мужчина", "женщина", "человек", "он", "она",
        # ... expand
    }
    character_count = sum(1 for w in words if w in character_words)
    f4 = 1.0 - min(1.0, character_count / (total_words * 0.05))

    # Feature 5: Static verbs (10%)
    static_verbs = {
        "находился", "располагался", "стоял", "возвышался",
        "простирался", "тянулся", "раскинулся",
        # ... expand
    }
    static_count = sum(1 for w in words if w in static_verbs)
    f5 = min(1.0, static_count / 5.0)  # 5 verbs = 1.0

    # Weighted score
    score = (
        f1 * 0.30 +
        f2 * 0.25 +
        f3 * 0.20 +
        f4 * 0.15 +
        f5 * 0.10
    )

    return score
```

Аналогично реализуются `score_character()`, `score_atmosphere()`, `score_object()`.

---

## 🚀 ЧАСТЬ 5: Advanced NLP Техники

### 5.1 Discourse Segmentation

**Проблема:** Текущая система не понимает discourse structure.

**Решение:** Rhetorical Structure Theory (RST) для литературных текстов.

#### Rhetorical Relations в Описаниях

**Relations:**
1. **ELABORATION**: Paragraph p2 elaborates on p1
   - Example: p1="Замок стоял на холме." p2="Его стены были из серого камня."

2. **CONTINUATION**: Paragraph p2 continues description from p1
   - Example: p1="Внешние стены..." p2="Внутренний двор..."

3. **SPECIFICATION**: Paragraph p2 specifies details from p1
   - Example: p1="Башни по углам." p2="Северная башня была самой высокой."

4. **CONTRAST**: Paragraph p2 contrasts with p1 (scene change!)
   - Example: p1="Снаружи..." p2="Но внутри всё было иначе."

**Algorithm:**
```python
def detect_discourse_relation(para1, para2):
    """
    Определяет rhetorical relation между параграфами.
    """
    # Lexical cues
    if starts_with(para2.text, ["Кроме того", "Также", "К тому же"]):
        return ELABORATION

    if starts_with(para2.text, ["Внутри", "Снаружи", "Рядом"]):
        return CONTINUATION

    if starts_with(para2.text, ["Особенно", "В частности", "Например"]):
        return SPECIFICATION

    if starts_with(para2.text, ["Но", "Однако", "Напротив", "Тем не менее"]):
        return CONTRAST  # ← STOP SIGNAL!

    # Semantic similarity
    sim = cosine_similarity(embed(para1.text), embed(para2.text))
    if sim > 0.75:
        return CONTINUATION
    elif sim > 0.60:
        return ELABORATION
    else:
        return NONE  # No clear relation
```

### 5.2 Entity Coreference Resolution

**Проблема:** Система не отслеживает упоминания одного и того же entity.

**Решение:** Coreference chains для entity tracking.

#### Algorithm: Cross-Document Coreference

```python
class EntityRegistry:
    """
    Отслеживает entities across chapters.
    """
    def __init__(self):
        self.entities = {}  # entity_id -> EntityInfo
        self.mentions = []  # List[Mention]

    def register_mention(self, mention, chapter_id):
        """
        Регистрирует упоминание entity.
        """
        # Try to resolve to existing entity
        entity_id = self._resolve_coreference(mention)

        if entity_id:
            # Update existing entity
            self.entities[entity_id].mentions.append(mention)
            self.entities[entity_id].last_seen_chapter = chapter_id
        else:
            # Create new entity
            entity_id = generate_id()
            self.entities[entity_id] = EntityInfo(
                canonical_name=mention.text,
                type=mention.type,
                first_seen_chapter=chapter_id,
                mentions=[mention],
            )

        return entity_id

    def _resolve_coreference(self, mention):
        """
        Определяет, ссылается ли mention на известный entity.

        Uses:
        - String similarity (Levenshtein distance)
        - Semantic similarity (embeddings)
        - Type consistency
        """
        candidates = []

        for entity_id, entity in self.entities.items():
            # Type must match
            if entity.type != mention.type:
                continue

            # String similarity
            canonical_name = entity.canonical_name.lower()
            mention_text = mention.text.lower()

            # Exact match
            if canonical_name == mention_text:
                return entity_id

            # Partial match (one contains the other)
            if canonical_name in mention_text or mention_text in canonical_name:
                candidates.append((entity_id, 0.9))
                continue

            # Levenshtein distance
            lev_dist = levenshtein_distance(canonical_name, mention_text)
            max_len = max(len(canonical_name), len(mention_text))
            similarity = 1.0 - (lev_dist / max_len)

            if similarity > 0.75:
                candidates.append((entity_id, similarity))

            # Semantic similarity
            sem_sim = cosine_similarity(
                embed(entity.canonical_description),
                embed(mention.context)
            )
            if sem_sim > 0.80:
                candidates.append((entity_id, sem_sim * 0.9))

        # Return best candidate
        if candidates:
            candidates.sort(key=lambda x: x[1], reverse=True)
            best_entity_id, best_score = candidates[0]
            if best_score > 0.80:
                return best_entity_id

        return None  # New entity
```

### 5.3 Semantic Role Labeling (SRL)

**Проблема:** Не понимаем semantic roles в предложениях.

**Решение:** SRL для извлечения WHO, WHAT, WHERE, WHEN, HOW.

#### Example:

**Sentence:** "Высокая башня с остроконечной крышей возвышалась над городом."

**SRL Analysis:**
```
Predicate: возвышалась (was towering)
ARG0 (Agent/Theme): Высокая башня с остроконечной крышей
ARG1 (Location): над городом
Modifiers:
  - высокая (attribute)
  - с остроконечной крышей (attribute)
```

**Use Case:**
- Extract main entity: "башня"
- Extract attributes: "высокая", "остроконечная крыша"
- Extract spatial relation: "над городом"

**Implementation:**
```python
def extract_semantic_roles(sentence):
    """
    Использует Stanza для SRL.
    """
    doc = stanza_nlp(sentence)

    roles = []
    for sent in doc.sentences:
        for word in sent.words:
            if word.upos == "VERB":
                # Find arguments
                arg0 = find_subject(word, sent)
                arg1 = find_object(word, sent)

                role = SemanticRole(
                    predicate=word.text,
                    arg0=arg0,
                    arg1=arg1,
                )
                roles.append(role)

    return roles
```

### 5.4 Dependency Parsing для Compound Descriptions

**Проблема:** Не используем dependency structure для группировки.

**Решение:** Subtree extraction из dependency parse.

#### Example:

**Sentence:** "Массивная крепость из темного гранита возвышалась на вершине холма."

**Dependency Parse:**
```
возвышалась (ROOT)
  ├─ крепость (nsubj)
  │  ├─ Массивная (amod)
  │  └─ гранита (nmod)
  │     ├─ из (case)
  │     └─ темного (amod)
  └─ вершине (obl)
     ├─ на (case)
     └─ холма (nmod)
```

**Subtree Extraction:**
```
Main entity: крепость
  Attributes: Массивная, из темного гранита
  Location: на вершине холма
```

**Algorithm:**
```python
def extract_description_from_dependency(sent):
    """
    Извлекает описание используя dependency parse.
    """
    # Find main predicate (ROOT)
    root = None
    for word in sent.words:
        if word.deprel == "root":
            root = word
            break

    if not root:
        return None

    # Find subject
    subject = None
    for word in sent.words:
        if word.head == root.id and word.deprel in ["nsubj", "nsubj:pass"]:
            subject = word
            break

    if not subject:
        return None

    # Extract subject subtree (all modifiers)
    subject_subtree = extract_subtree(subject, sent)

    # Extract location/oblique arguments
    locations = []
    for word in sent.words:
        if word.head == root.id and word.deprel in ["obl", "obl:tmod", "obl:lmod"]:
            loc_subtree = extract_subtree(word, sent)
            locations.append(loc_subtree)

    description = {
        "main_entity": subject_subtree,
        "predicate": root.text,
        "locations": locations,
    }

    return description

def extract_subtree(word, sent):
    """
    Извлекает поддерево для слова (все его dependents).
    """
    subtree = [word]

    def collect_dependents(w):
        for other in sent.words:
            if other.head == w.id:
                subtree.append(other)
                collect_dependents(other)

    collect_dependents(word)

    # Sort by position
    subtree.sort(key=lambda x: x.id)

    # Join text
    text = " ".join(w.text for w in subtree)

    return text
```

---

## 📊 ЧАСТЬ 6: Граф-Алгоритмы для Описаний

### 6.1 Description Graph

**Идея:** Представить все описания как граф, где:
- Nodes = Descriptions
- Edges = Relations (SAME_ENTITY, SAME_LOCATION, TEMPORAL_SEQUENCE, etc.)

#### Graph Construction

```python
class DescriptionGraph:
    """
    Граф описаний для анализа relationships.
    """
    def __init__(self):
        self.nodes = {}  # description_id -> Description
        self.edges = []  # List[Edge(source, target, type, weight)]

    def add_description(self, description):
        """Добавляет description как node."""
        self.nodes[description.id] = description

    def add_edge(self, source_id, target_id, edge_type, weight):
        """Добавляет edge между descriptions."""
        edge = Edge(source_id, target_id, edge_type, weight)
        self.edges.append(edge)

    def build_edges(self):
        """
        Строит edges между descriptions на основе различных relations.
        """
        descriptions = list(self.nodes.values())

        # O(n²) pairwise comparison
        for i, desc1 in enumerate(descriptions):
            for desc2 in descriptions[i+1:]:
                # Check various relations

                # Relation 1: SAME_ENTITY
                if self._shares_entity(desc1, desc2):
                    weight = self._entity_overlap_score(desc1, desc2)
                    self.add_edge(desc1.id, desc2.id, "SAME_ENTITY", weight)

                # Relation 2: SAME_LOCATION
                if self._same_location(desc1, desc2):
                    weight = self._location_similarity(desc1, desc2)
                    self.add_edge(desc1.id, desc2.id, "SAME_LOCATION", weight)

                # Relation 3: TEMPORAL_SEQUENCE
                if desc2.chapter_id > desc1.chapter_id:
                    if self._temporal_continuation(desc1, desc2):
                        weight = 0.8
                        self.add_edge(desc1.id, desc2.id, "TEMPORAL", weight)

    def find_connected_components(self):
        """
        Находит connected components (clusters of related descriptions).

        Uses: Union-Find algorithm
        """
        parent = {node_id: node_id for node_id in self.nodes}

        def find(x):
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]

        def union(x, y):
            root_x = find(x)
            root_y = find(y)
            if root_x != root_y:
                parent[root_y] = root_x

        # Union based on edges
        for edge in self.edges:
            if edge.weight > 0.7:  # Strong connection
                union(edge.source, edge.target)

        # Group by root
        components = {}
        for node_id in self.nodes:
            root = find(node_id)
            if root not in components:
                components[root] = []
            components[root].append(node_id)

        return list(components.values())

    def rank_descriptions_pagerank(self):
        """
        Ранжирует descriptions используя PageRank algorithm.

        Идея: Важные descriptions - те, на которые ссылаются другие важные descriptions.
        """
        n = len(self.nodes)
        node_ids = list(self.nodes.keys())
        node_index = {node_id: i for i, node_id in enumerate(node_ids)}

        # Build adjacency matrix
        A = [[0.0] * n for _ in range(n)]
        for edge in self.edges:
            i = node_index[edge.source]
            j = node_index[edge.target]
            A[i][j] = edge.weight
            A[j][i] = edge.weight  # Undirected

        # Normalize (stochastic matrix)
        for i in range(n):
            row_sum = sum(A[i])
            if row_sum > 0:
                A[i] = [val / row_sum for val in A[i]]

        # PageRank iteration
        d = 0.85  # Damping factor
        ranks = [1.0 / n] * n

        for _ in range(30):  # 30 iterations
            new_ranks = []
            for i in range(n):
                rank_sum = sum(A[j][i] * ranks[j] for j in range(n))
                new_rank = (1 - d) / n + d * rank_sum
                new_ranks.append(new_rank)
            ranks = new_ranks

        # Map back to descriptions
        for i, node_id in enumerate(node_ids):
            self.nodes[node_id].pagerank_score = ranks[i]

        # Sort by PageRank
        sorted_descriptions = sorted(
            self.nodes.values(),
            key=lambda d: d.pagerank_score,
            reverse=True
        )

        return sorted_descriptions
```

**Use Cases:**
1. **Deduplication:** Find descriptions in same component → merge
2. **Context enrichment:** Use graph neighbors для добавления context
3. **Importance ranking:** PageRank для приоритизации
4. **Consistency checking:** Detect conflicting descriptions в same component

---

## 🤖 ЧАСТЬ 7: Machine Learning Подходы

### 7.1 Supervised Learning для Classification

**Problem:** Hardcoded rules не масштабируются.

**Solution:** Train classifier на labeled data.

#### Dataset Construction

```
FEATURES:
- BOW (Bag of Words) features
- TF-IDF features
- POS tag sequences
- Dependency patterns
- Embedding features (BERT/GPT)

LABELS:
- IS_DESCRIPTION: {0, 1}
- DESCRIPTION_TYPE: {LOCATION, CHARACTER, ATMOSPHERE, OBJECT, NONE}
- QUALITY_SCORE: [0.0, 1.0]
```

#### Model Architecture

**Option 1: Random Forest**
```python
from sklearn.ensemble import RandomForestClassifier

# Features
X = extract_features(descriptions)  # (n_samples, n_features)

# Labels
y_type = [d.type for d in descriptions]
y_quality = [d.quality_score for d in descriptions]

# Train
clf_type = RandomForestClassifier(n_estimators=100)
clf_type.fit(X, y_type)

clf_quality = RandomForestRegressor(n_estimators=100)
clf_quality.fit(X, y_quality)
```

**Option 2: Neural Network (BERT-based)**
```python
from transformers import BertForSequenceClassification

model = BertForSequenceClassification.from_pretrained(
    "DeepPavlov/rubert-base-cased",
    num_labels=4  # 4 types
)

# Fine-tune на labeled data
trainer = Trainer(
    model=model,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
)
trainer.train()
```

### 7.2 Unsupervised Learning для Clustering

**Problem:** Группировка похожих описаний без labels.

**Solution:** Clustering algorithms (K-Means, DBSCAN, HDBSCAN).

#### Algorithm: HDBSCAN для Description Clustering

```python
from sklearn.cluster import HDBSCAN
from sentence_transformers import SentenceTransformer

# Embed descriptions
embedder = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
embeddings = embedder.encode([d.text for d in descriptions])

# Cluster
clusterer = HDBSCAN(min_cluster_size=5, metric='euclidean')
labels = clusterer.fit_predict(embeddings)

# Group by cluster
clusters = {}
for i, label in enumerate(labels):
    if label == -1:  # Noise
        continue
    if label not in clusters:
        clusters[label] = []
    clusters[label].append(descriptions[i])

# Analyze clusters
for cluster_id, cluster_descriptions in clusters.items():
    print(f"Cluster {cluster_id}: {len(cluster_descriptions)} descriptions")
    # Можем выбрать representative description
    # Можем merge duplicates
    # Можем найти common theme
```

### 7.3 Reinforcement Learning для Optimization

**Problem:** Оптимизация thresholds и weights.

**Solution:** RL agent для подбора оптимальных параметров.

#### RL Formulation

**State:**
- Current settings: {confidence_threshold, min_length, max_length, weights, ...}
- Current metrics: {precision, recall, F1, avg_quality, ...}

**Action:**
- Adjust одна настройка: увеличить/уменьшить threshold, изменить weight, etc.

**Reward:**
- Improvement в target metric (e.g., F1 score для quality descriptions)

**Algorithm: Q-Learning / Policy Gradient**
```python
class DescriptionExtractorRL:
    def __init__(self):
        self.state = initial_settings()
        self.q_table = {}  # State-Action values

    def get_action(self, state):
        """Epsilon-greedy policy."""
        if random.random() < epsilon:
            return random_action()
        else:
            return argmax_action(self.q_table[state])

    def update(self, state, action, reward, next_state):
        """Q-learning update."""
        current_q = self.q_table.get((state, action), 0.0)
        max_next_q = max(
            self.q_table.get((next_state, a), 0.0)
            for a in possible_actions
        )

        new_q = current_q + alpha * (reward + gamma * max_next_q - current_q)
        self.q_table[(state, action)] = new_q

    def train(self, episodes=1000):
        """Train RL agent."""
        for episode in range(episodes):
            state = reset()

            for step in range(max_steps):
                action = self.get_action(state)
                next_state, reward = execute_action(action)
                self.update(state, action, reward, next_state)
                state = next_state

                if is_terminal(state):
                    break
```

---

## 🎯 ЧАСТЬ 8: Implementation Roadmap

### Phase 1: Core Algorithms (3-4 недели)

#### Week 1-2: Paragraph Segmentation & Boundary Detection
- [ ] Implement `ParagraphSegmenter`
- [ ] Implement `DescriptionBoundaryDetector`
- [ ] Test на sample chapters
- [ ] Tune thresholds

**Files to create:**
- `backend/app/services/nlp/paragraph_segmenter.py` (~500 lines)
- `backend/app/services/nlp/boundary_detector.py` (~600 lines)

#### Week 3-4: Multi-Factor Confidence Scoring
- [ ] Implement всех 5 факторов scoring
- [ ] Integrate в description extraction pipeline
- [ ] Calibrate weights на sample data
- [ ] A/B test: old scoring vs new scoring

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (+300 lines)
- Create `backend/app/services/nlp/confidence_scorer.py` (~400 lines)

### Phase 2: Advanced NLP Integration (3-4 недели)

#### Week 5-6: Discourse Analysis & SRL
- [ ] Implement discourse relation detection
- [ ] Implement SRL extraction
- [ ] Integrate в boundary detector

**Files to create:**
- `backend/app/services/nlp/discourse_analyzer.py` (~350 lines)
- `backend/app/services/nlp/semantic_role_labeler.py` (~300 lines)

#### Week 7-8: Entity Tracking & Context Manager
- [ ] Implement `EntityRegistry`
- [ ] Implement `DescriptionContextManager`
- [ ] Integrate cross-chapter tracking

**Files to create:**
- `backend/app/services/nlp/entity_registry.py` (~450 lines)
- `backend/app/services/nlp/context_manager.py` (~400 lines)

### Phase 3: Graph Algorithms & ML (3-4 недели)

#### Week 9-10: Description Graph
- [ ] Implement `DescriptionGraph`
- [ ] Implement PageRank ranking
- [ ] Implement clustering algorithms

**Files to create:**
- `backend/app/services/nlp/description_graph.py` (~500 lines)

#### Week 11-12: ML Models
- [ ] Collect labeled dataset
- [ ] Train Random Forest classifier
- [ ] Train BERT-based classifier
- [ ] Evaluate and integrate best model

**Files to create:**
- `backend/app/services/ml/` (new directory)
  - `feature_extractor.py` (~300 lines)
  - `classifier.py` (~400 lines)
  - `training.py` (~200 lines)

### Phase 4: Testing & Optimization (2 недели)

#### Week 13-14: Full Integration & Testing
- [ ] Re-parse test book "Ведьмак"
- [ ] Compare old vs new system
- [ ] Performance optimization
- [ ] Documentation

---

## 📊 Заключение

### Критические Выводы

1. **Текущая архитектура fundamentally broken для длинных описаний:**
   - Sentence-level processing
   - No paragraph awareness
   - Naive confidence scoring
   - No context tracking

2. **Требуются сложные алгоритмы:**
   - Dynamic Programming для boundary detection
   - Multi-factor scoring model
   - Graph algorithms для relationships
   - ML classifiers для type classification

3. **Нет готовых решений:**
   - Уникальная задача
   - Комбинация NLP + литературный анализ + image generation requirements
   - Нужна полная custom implementation

4. **Complexity является необходимостью:**
   - Простые regex patterns НЕ РАБОТАЮТ
   - Hardcoded rules не масштабируются
   - Нужны advanced NLP техники (SRL, discourse analysis, dependency parsing)
   - Нужны ML models для обучения на данных

### Next Steps

**Immediate (Critical):**
1. Implement paragraph segmentation
2. Implement boundary detection
3. Implement multi-factor confidence scoring

**Short-term (High Priority):**
4. Entity tracking & context manager
5. Advanced NLP integration (SRL, discourse)

**Medium-term (Important):**
6. Graph algorithms
7. ML classifiers

**Long-term (Optimization):**
8. RL для auto-tuning
9. BERT fine-tuning
10. Continuous learning from feedback

---

**Version:** 1.0 - Comprehensive Technical Analysis
**Last Updated:** 2025-11-05
**Status:** Ready for Implementation
**Estimated LOC:** ~10,000 new lines of advanced algorithmic code
**Estimated Time:** 10-12 недель для полной реализации

---

**КОНЕЦ ТЕХНИЧЕСКОГО АНАЛИЗА**

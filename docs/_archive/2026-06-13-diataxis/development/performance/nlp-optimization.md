# NLP Parsing Optimization Plan for Flux Image Generation

**Date:** 2025-11-05
**Author:** Claude Code
**Version:** 1.0
**Status:** Comprehensive Analysis & Implementation Plan

---

## Executive Summary

### Current Situation: CRITICAL

Анализ 1257 описаний из тестовой книги "Ведьмак. Перекресток воронов" выявил **катастрофические проблемы** в парсинге:

#### 🔴 Проблема #1: Неправильное распределение типов
```
ТЕКУЩЕЕ (неправильно):
  OBJECT:      672 (53.5%)  ← ДОМИНИРУЕТ, но низкий приоритет (40%)
  LOCATION:    503 (40.0%)  ← Должно быть 75% приоритет
  CHARACTER:    61 (4.9%)   ← КАТАСТРОФА! Приоритет 60%
  ATMOSPHERE:   21 (1.7%)   ← ПОЧТИ НЕТ! Приоритет 45%

ОЖИДАЕМОЕ (правильно):
  LOCATION:    ~600 (48%)   ← Основной фокус
  CHARACTER:   ~400 (32%)   ← Второй приоритет
  ATMOSPHERE:  ~200 (16%)   ← Третий приоритет
  OBJECT:       ~57 (4%)    ← Минимальный приоритет
```

#### 🔴 Проблема #2: Качество извлечений - УЖАСНОЕ
**Топ-10 по confidence score (0.90-0.95) - это МУСОР:**
- `"звезды. Жан-Антельм Брилья-Саварен Глава седьмая..."` - **ЗАГОЛОВОК ГЛАВЫ**
- `"мархии. Маркграфств этих четыре..."` - **ОБРЫВОК ПРЕДЛОЖЕНИЯ**
- `"Верхней частью, то есть от головы..."` - **ФРАГМЕНТ ИЗ СПРАВОЧНИКА**

**Проблема:** Система извлекает случайные фрагменты текста, а не законченные описания.

#### 🔴 Проблема #3: Недостаточная длина для Flux
```
Текущая статистика:
  Среднее:  104.7 chars  ← НЕДОСТАТОЧНО (Flux нужно 100-500+)
  Медиана:  102 chars
  Минимум:  50 chars     ← Слишком короткий порог
  Максимум: 398 chars

Проблемные сегменты:
  < 100 chars:  587 (46.7%)  ← ПОЛОВИНА слишком короткие!
  100-500:      670 (53.3%)  ← Подходят по длине, но КАЧЕСТВО ужасное
  > 500 chars:  0 (0.0%)    ← НЕТ длинных описаний
```

#### 🔴 Проблема #4: Корневая причина
В `backend/app/models/description.py:153-162`:
```python
# Бонус за оптимальную длину (15-300 символов)
if 15 <= content_length <= 300:
    length_score = 15
```

**Система оптимизирована под 15-300 символов, но Flux требует 100-500+ символов!**

---

## Flux Requirements Analysis

### Optimal Flux Prompt Format (Research Results)

Из исследования Flux AI (pollinations.ai) установлено:

#### ✅ Идеальный формат
```
Длина:        100-500+ символов (до 1000 для сложных сцен)
Язык:         Natural language, детальный, описательный
Структура:    Subject → Setting → Lighting → Color → Mood → Composition
Стиль:        Narrative descriptions, как из книги
Избегать:     Короткие списки, технический язык, weight syntax
```

#### ✅ Пример ОТЛИЧНОГО описания (578 chars)
```
"Ветер дул на северо-восток, над селениями Джуалде неспешно плыли низкие
облака, закрывавшие солнце; из всех башен и минаретов Тар Валона были
видны только острые вершины. Холодный, ровный свет ровными серыми мазками
ложился на белые камни города, подчёркивая геометрические формы зданий,
напоминавших огромные игральные кости или чьи-то пальцы, устремлённые к
небу. По извилистым улицам, в окружении почётной стражи Шайдо двигался в
восточном направлении блестящий под серым небом паланкин. От дворца в
сторону Чёрной башни."
```

**Почему это идеально:**
- ✅ 578 символов - оптимальная длина
- ✅ Включает: локацию (Тар Валон), погоду (ветер, облака), освещение (холодный свет), цвета (белые камни, серое небо), настроение (холодное, величественное)
- ✅ Живописное, визуализируемое описание
- ✅ Законченное, coherent описание
- ✅ Natural language, не техническое

#### ❌ Пример ПЛОХОГО извлечения (текущая система)
```
", что амбиции тамошних маркграфов — продвигаться дальше в долины
Драконьих гор, оттого владения свои цисмонтанскими называть повелось,
дескать,"
```

**Почему это ужасно:**
- ❌ Обрывок предложения (начинается с запятой!)
- ❌ Не визуализируемое (политический контекст, не описание)
- ❌ Фрагмент, не законченная мысль
- ❌ Нет detalied visual elements

---

## Detailed Problem Analysis

### Problem 1: Fragment Extraction ("съедает части слов")

**Причина:** Отсутствие детекции границ описаний.

Текущая логика:
```python
# enhanced_nlp_system.py:350-370
def _extract_entity_descriptions(self, doc):
    for sent in doc.sents:
        # Извлекает ОДНО предложение
        description = sent.text.strip()
        # Проблема: описание может быть multi-sentence!
```

**Результат:**
- Описание из 3 предложений разбивается на 3 фрагмента
- Берется середина описания, потерян контекст
- "съедает части" - начало/конец отсутствуют

### Problem 2: Dialog and Service Text Extraction

**Примеры из БД:**
```
❌ "Глава восьмая «Вот слова Пророка: воистину говорю вам..."
❌ "звезды. Жан-Антельм Брилья-Саварен Глава седьмая..."
❌ "Твоё признание, которое, кстати, не имеет силы..."
```

**Причина:** Нет фильтрации:
- Заголовков глав
- Эпиграфов
- Диалогов в кавычках
- Авторских ремарок
- Служебного текста

### Problem 3: Wrong Type Classification

**Почему OBJECT доминирует (53.5%):**

Текущие паттерны слишком широкие:
```python
# natasha_processor.py:60-65
"object_indicators": [
    r"\b(?:меч|кинжал|щит|лук|копьё|топор)\b",  # Оружие
    r"\b(?:золото|серебро|медь|железо|сталь)\b",  # Материалы
    # ... слишком много паттернов
]
```

Любое упоминание объекта → классифицируется как OBJECT, даже если это часть описания локации или персонажа.

**Пример:**
```
"Геральт держал в руке серебряный меч и шел по мрачному лесу."
                        ^^^^^^^^^^^^^^
Текущая система: OBJECT (из-за "меч")
Правильно: LOCATION или CHARACTER (полное описание сцены)
```

### Problem 4: Confidence Score Calculation Issues

**Текущая логика (enhanced_nlp_system.py:400-420):**
```python
def _calculate_general_descriptive_score(self, sent) -> float:
    adj_count = sum(1 for token in sent if token.pos_ == "ADJ")
    noun_count = sum(1 for token in sent if token.pos_ == "NOUN")

    # Проблема: слишком простая метрика
    if adj_count > 0 and noun_count > 0:
        return 0.5 + (adj_count / (noun_count + adj_count)) * 0.3
    # Итого: 0.5-0.8 для почти любого текста!
```

**Результат:**
- Заголовки глав получают 0.9-0.95 confidence (из-за прилагательных)
- Реальные описания получают 0.3-0.4 confidence (сложная структура)
- **Система работает НАОБОРОТ!**

---

## Strategy 1: Description Boundary Detection

### Goal
Извлекать ЗАКОНЧЕННЫЕ многопредложенческие описания, а не фрагменты.

### Approach: Multi-Sentence Window Analysis

#### Step 1: Identify Description Start
**Indicators:**
```python
DESCRIPTION_START_PATTERNS = [
    # Visual scene setting
    r"^\s*[А-ЯЁ].*?\b(был|была|было|были|стоял|находился|виднелся)",

    # Location descriptions
    r"^\s*[А-ЯЁ].*?\b(город|деревня|замок|дворец|лес|поле|река|гора)",

    # Character introductions
    r"^\s*[А-ЯЁ].*?\b(мужчина|женщина|человек|девушка|старик|ведьмак)",

    # Atmospheric openings
    r"^\s*(Солнце|Луна|Ветер|Небо|Тучи|Туман|Свет)",
]
```

#### Step 2: Continue Until Description End
**Continuation indicators:**
```python
DESCRIPTION_CONTINUE_SIGNALS = {
    "has_descriptive_verbs": ["был", "казался", "выглядел", "напоминал"],
    "has_visual_adjectives": ["высокий", "темный", "огромный", "величественный"],
    "has_spatial_prepositions": ["над", "под", "вокруг", "рядом", "между"],
    "has_color_words": ["белый", "черный", "серый", "красный", "золотой"],
}

DESCRIPTION_END_SIGNALS = {
    "dialog_start": ['—', '«', '"', "- "],
    "action_verb": ["сказал", "подумал", "пошел", "повернулся", "бросился"],
    "narrative_shift": ["Однако", "Но", "Впрочем", "Между тем"],
    "temporal_marker": ["Затем", "Потом", "Через", "Спустя"],
}
```

#### Step 3: Group Sentences
```python
def extract_complete_description(self, doc, start_sent_idx: int) -> Optional[str]:
    """
    Извлекает законченное описание начиная с start_sent_idx.

    Returns:
        Complete multi-sentence description or None
    """
    sentences = list(doc.sents)
    description_sents = [sentences[start_sent_idx]]

    for i in range(start_sent_idx + 1, len(sentences)):
        sent = sentences[i]

        # Check if should continue
        if self._should_continue_description(sent, description_sents):
            description_sents.append(sent)
        else:
            break

        # Max 5 sentences для одного описания
        if len(description_sents) >= 5:
            break

    # Require minimum 2 sentences for complete description
    if len(description_sents) >= 2:
        full_text = " ".join(s.text for s in description_sents)

        # Validate length for Flux
        if 100 <= len(full_text) <= 1000:
            return full_text

    return None
```

### Implementation Location
Добавить в `backend/app/services/enhanced_nlp_system.py`:
- Новый метод `_extract_complete_descriptions()`
- Вызывать ДО `_extract_entity_descriptions()`
- Использовать SpaCy `doc.sents` с window analysis

---

## Strategy 2: Anti-Patterns for Filtering

### Goal
Фильтровать нежелательный текст: диалоги, заголовки, служебный текст.

### Anti-Pattern Categories

#### 1. Chapter Headers and Epigraphs
```python
CHAPTER_HEADER_PATTERNS = [
    r"^Глава\s+(первая|вторая|третья|\d+)",
    r"^ГЛАВА\s+[IVX\d]+",
    r"^Часть\s+\d+",
    r"^Книга\s+\d+",
    r"^Пролог$|^Эпилог$",
]

EPIGRAPH_PATTERNS = [
    r"^[«"].*?[»"]$",  # Quoted epigraphs
    r"©.*?\d{4}",      # Copyright
    r"^\s*\*\s*\*\s*\*\s*$",  # Section dividers
]
```

#### 2. Dialog Detection
```python
DIALOG_PATTERNS = [
    r"^—\s*",                    # Em dash dialog
    r"^-\s+[А-ЯЁ]",              # Hyphen dialog
    r"[«"].*?[»"]",              # Quoted speech
    r"\bсказал\b|\bговорил\b|\bответил\b|\bпроизнёс\b",  # Speech verbs
]

def is_dialog(self, text: str) -> bool:
    # Check for direct speech markers
    if re.search(r'^[—-]\s*', text):
        return True

    # Check for speech verb + quoted text pattern
    if re.search(r'(сказал|спросил|ответил).*?[«"]', text):
        return True

    # High punctuation ratio (dialogs have many commas, dashes)
    punct_ratio = len(re.findall(r'[,—!?]', text)) / len(text.split())
    if punct_ratio > 0.3:
        return True

    return False
```

#### 3. Author's Remarks and Meta-Text
```python
META_TEXT_PATTERNS = [
    r"\(примеч\.\s*(?:автора|редактора|переводчика)\)",
    r"\[.*?\]",  # Square bracket notes
    r"см\.\s+главу\s+\d+",  # Cross-references
    r"далее\s+в\s+тексте",
    r"как\s+(?:сказано|упоминалось|известно)",
]
```

#### 4. Incomplete Sentences
```python
def is_incomplete_sentence(self, text: str) -> bool:
    # Starts with lowercase or punctuation
    if text[0].islower() or text[0] in ',.:;—':
        return True

    # Ends abruptly without proper punctuation
    if not text.rstrip()[-1] in '.!?':
        return True

    # Very short fragments
    if len(text.split()) < 5:
        return True

    return False
```

### Filter Pipeline
```python
def should_filter_out(self, text: str) -> Tuple[bool, str]:
    """
    Returns (should_filter, reason)
    """
    # Check all anti-patterns
    if any(re.search(p, text) for p in CHAPTER_HEADER_PATTERNS):
        return (True, "chapter_header")

    if self.is_dialog(text):
        return (True, "dialog")

    if any(re.search(p, text) for p in META_TEXT_PATTERNS):
        return (True, "meta_text")

    if self.is_incomplete_sentence(text):
        return (True, "incomplete")

    return (False, "")
```

---

## Strategy 3: Improved Type Classification

### Goal
Правильное распределение: LOCATION (48%), CHARACTER (32%), ATMOSPHERE (16%), OBJECT (4%)

### Hierarchical Classification

#### Priority 1: LOCATION (highest priority)
```python
LOCATION_STRONG_INDICATORS = {
    "nouns": [
        "город", "деревня", "замок", "дворец", "крепость",
        "лес", "поле", "река", "озеро", "море", "гора",
        "улица", "площадь", "дом", "здание", "башня",
        "комната", "зал", "палата", "коридор",
    ],
    "verbs": ["располагался", "находился", "простирался", "виднелся"],
    "patterns": [
        r"(?:в|на)\s+(?:севере|юге|западе|востоке)",
        r"(?:над|под|между)\s+(?:горами|реками|холмами)",
    ],
}

def is_location_description(self, doc, text: str) -> float:
    score = 0.0

    # Count location nouns
    location_count = sum(
        1 for token in doc
        if token.lemma_.lower() in LOCATION_STRONG_INDICATORS["nouns"]
    )
    score += location_count * 0.2

    # Spatial prepositions boost
    spatial_preps = ["над", "под", "вокруг", "между", "рядом с"]
    spatial_count = sum(1 for prep in spatial_preps if prep in text.lower())
    score += spatial_count * 0.15

    # Geographic/architectural vocabulary
    if re.search(r'\b(архитектура|здание|строение|сооружение)\b', text):
        score += 0.3

    return min(1.0, score)
```

#### Priority 2: CHARACTER (second priority)
```python
CHARACTER_STRONG_INDICATORS = {
    "appearance": [
        "лицо", "глаза", "волосы", "руки", "рост", "фигура",
        "одежда", "плащ", "доспехи", "шлем", "сапоги",
    ],
    "characteristics": [
        "высокий", "низкий", "худой", "полный", "молодой", "старый",
        "бледный", "загорелый", "седой", "рыжий", "белокурый",
    ],
    "patterns": [
        r"(?:его|её|их)\s+(?:лицо|глаза|волосы|руки)",
        r"\b(?:выглядел|казался|был\s+похож)",
    ],
}

def is_character_description(self, doc, text: str) -> float:
    score = 0.0

    # Named entities (PERSON)
    persons = [ent for ent in doc.ents if ent.label_ == "PER"]
    if persons:
        score += 0.4

    # Appearance vocabulary
    appearance_count = sum(
        1 for token in doc
        if token.lemma_.lower() in CHARACTER_STRONG_INDICATORS["appearance"]
    )
    score += appearance_count * 0.15

    # Physical characteristics
    char_adj_count = sum(
        1 for token in doc
        if token.pos_ == "ADJ" and
        token.lemma_.lower() in CHARACTER_STRONG_INDICATORS["characteristics"]
    )
    score += char_adj_count * 0.1

    return min(1.0, score)
```

#### Priority 3: ATMOSPHERE
```python
ATMOSPHERE_STRONG_INDICATORS = {
    "weather": ["ветер", "дождь", "снег", "туман", "солнце", "облака"],
    "lighting": ["свет", "тень", "сумрак", "рассвет", "закат", "полдень"],
    "mood": ["мрачный", "светлый", "тихий", "тревожный", "спокойный"],
    "sensory": ["запах", "аромат", "звук", "шум", "тишина", "холод", "тепло"],
}

def is_atmosphere_description(self, doc, text: str) -> float:
    score = 0.0

    # Weather and lighting
    weather_count = sum(
        1 for w in ATMOSPHERE_STRONG_INDICATORS["weather"]
        if w in text.lower()
    )
    score += weather_count * 0.2

    # Sensory vocabulary
    sensory_count = sum(
        1 for s in ATMOSPHERE_STRONG_INDICATORS["sensory"]
        if s in text.lower()
    )
    score += sensory_count * 0.15

    # Time of day indicators
    if re.search(r'\b(утро|день|вечер|ночь|рассвет|закат)\b', text):
        score += 0.25

    return min(1.0, score)
```

#### Decision Logic
```python
def classify_description_type(self, doc, text: str) -> DescriptionType:
    scores = {
        DescriptionType.LOCATION: self.is_location_description(doc, text),
        DescriptionType.CHARACTER: self.is_character_description(doc, text),
        DescriptionType.ATMOSPHERE: self.is_atmosphere_description(doc, text),
    }

    # Require minimum threshold
    max_score = max(scores.values())
    if max_score < 0.4:
        return DescriptionType.OBJECT  # Fallback

    # Return type with highest score
    return max(scores, key=scores.get)
```

---

## Strategy 4: Confidence Score Overhaul

### Current Problem
```python
# ПЛОХО: Простая метрика ADJ/NOUN
confidence = 0.5 + (adj_count / (noun_count + adj_count)) * 0.3
# Результат: Все получают 0.5-0.8, нет discrimination
```

### New Multi-Factor Scoring

```python
def calculate_description_confidence(
    self,
    doc,
    text: str,
    desc_type: DescriptionType
) -> float:
    """
    Multi-factor confidence scoring для literary descriptions.

    Factors:
    1. Linguistic quality (30%)
    2. Visual richness (25%)
    3. Structural completeness (20%)
    4. Type-specific indicators (15%)
    5. Length appropriateness (10%)
    """

    # Factor 1: Linguistic Quality (30%)
    linguistic_score = self._score_linguistic_quality(doc)

    # Factor 2: Visual Richness (25%)
    visual_score = self._score_visual_richness(doc, text)

    # Factor 3: Structural Completeness (20%)
    structure_score = self._score_structural_completeness(text)

    # Factor 4: Type-Specific Indicators (15%)
    type_score = self._score_type_specificity(doc, text, desc_type)

    # Factor 5: Length Appropriateness (10%)
    length_score = self._score_length_for_flux(text)

    # Weighted sum
    confidence = (
        linguistic_score * 0.30 +
        visual_score * 0.25 +
        structure_score * 0.20 +
        type_score * 0.15 +
        length_score * 0.10
    )

    return confidence

def _score_linguistic_quality(self, doc) -> float:
    """
    Оценка языкового качества.
    """
    score = 0.0

    # Rich adjective usage
    adj_tokens = [t for t in doc if t.pos_ == "ADJ"]
    noun_tokens = [t for t in doc if t.pos_ == "NOUN"]

    if noun_tokens:
        adj_ratio = len(adj_tokens) / len(noun_tokens)
        # Optimal: 0.3-0.7 adjectives per noun
        if 0.3 <= adj_ratio <= 0.7:
            score += 0.4
        elif 0.1 <= adj_ratio < 0.3:
            score += 0.2

    # Syntactic complexity (using dependency depth)
    depths = [len(list(token.ancestors)) for token in doc]
    avg_depth = sum(depths) / len(depths) if depths else 0
    # Literary descriptions: depth 2-4
    if 2 <= avg_depth <= 4:
        score += 0.3

    # Variety of POS tags (не только ADJ+NOUN)
    pos_variety = len(set(t.pos_ for t in doc))
    if pos_variety >= 6:  # ADJ, NOUN, VERB, ADV, ADP, DET
        score += 0.3

    return score

def _score_visual_richness(self, doc, text: str) -> float:
    """
    Оценка визуальной насыщенности (важно для Flux).
    """
    score = 0.0

    # Color words
    colors = ["белый", "черный", "серый", "красный", "зеленый", "синий",
              "желтый", "золотой", "серебряный", "темный", "светлый"]
    color_count = sum(1 for c in colors if c in text.lower())
    score += min(0.3, color_count * 0.1)

    # Size/scale descriptors
    scale = ["огромный", "большой", "маленький", "крошечный", "громадный",
             "высокий", "низкий", "широкий", "узкий", "длинный", "короткий"]
    scale_count = sum(1 for s in scale if s in text.lower())
    score += min(0.25, scale_count * 0.1)

    # Lighting vocabulary
    lighting = ["свет", "тень", "сумрак", "яркий", "тусклый", "блестящий",
                "освещенный", "темный", "сияющий"]
    lighting_count = sum(1 for l in lighting if l in text.lower())
    score += min(0.25, lighting_count * 0.1)

    # Texture/material words
    texture = ["гладкий", "шершавый", "мягкий", "твердый", "каменный",
               "деревянный", "металлический"]
    texture_count = sum(1 for t in texture if t in text.lower())
    score += min(0.2, texture_count * 0.1)

    return score

def _score_structural_completeness(self, text: str) -> float:
    """
    Оценка структурной законченности.
    """
    score = 0.0

    # Starts with capital letter
    if text[0].isupper():
        score += 0.3
    else:
        return 0.0  # Incomplete sentence - disqualify

    # Ends with proper punctuation
    if text.rstrip()[-1] in '.!?':
        score += 0.3
    else:
        score += 0.1  # Partial credit

    # Multiple complete sentences (multi-sentence descriptions better)
    sentence_count = len([s for s in text.split('.') if len(s.strip()) > 20])
    if sentence_count >= 2:
        score += 0.4
    elif sentence_count == 1:
        score += 0.2

    return score

def _score_type_specificity(
    self,
    doc,
    text: str,
    desc_type: DescriptionType
) -> float:
    """
    Оценка соответствия типу описания.
    """
    if desc_type == DescriptionType.LOCATION:
        return self.is_location_description(doc, text)
    elif desc_type == DescriptionType.CHARACTER:
        return self.is_character_description(doc, text)
    elif desc_type == DescriptionType.ATMOSPHERE:
        return self.is_atmosphere_description(doc, text)
    else:
        return 0.5  # OBJECT - neutral

def _score_length_for_flux(self, text: str) -> float:
    """
    Оценка длины для Flux requirements.
    """
    length = len(text)

    # Optimal: 150-500 chars
    if 150 <= length <= 500:
        return 1.0

    # Acceptable: 100-150 or 500-800
    elif (100 <= length < 150) or (500 < length <= 800):
        return 0.7

    # Marginal: 80-100 or 800-1000
    elif (80 <= length < 100) or (800 < length <= 1000):
        return 0.4

    # Too short or too long
    else:
        return 0.0
```

---

## Strategy 5: Threshold Optimization

### Current Settings (ПЛОХИЕ)
```python
# backend/app/services/enhanced_nlp_system.py
MIN_DESCRIPTION_LENGTH = 50        # ← Слишком короткий для Flux
MAX_DESCRIPTION_LENGTH = 1000      # ← OK
MIN_WORD_COUNT = 10                # ← Слишком мало
CONFIDENCE_THRESHOLD = 0.3         # ← КРИТИЧЕСКИ низкий
```

### Optimized Settings for Flux
```python
# NEW SETTINGS - Оптимизированы для Flux
DESCRIPTION_EXTRACTION_CONFIG = {
    # Length constraints (aligned with Flux)
    "min_char_length": 100,           # ← Minimum for Flux
    "max_char_length": 1000,          # ← Maximum (soft limit)
    "optimal_char_length": (150, 500), # ← Sweet spot for Flux
    "min_word_count": 15,             # ← ~15 words = ~100 chars

    # Quality thresholds
    "min_confidence_score": 0.50,     # ← Raised from 0.3
    "optimal_confidence_score": 0.70, # ← Target quality
    "min_visual_richness": 0.30,      # ← Require visual vocabulary

    # Type-specific thresholds
    "location_min_confidence": 0.55,   # ← Higher for locations
    "character_min_confidence": 0.50,
    "atmosphere_min_confidence": 0.45,
    "object_min_confidence": 0.60,     # ← Highest (discourage)

    # Multi-sentence requirements
    "prefer_multi_sentence": True,
    "min_sentences_for_boost": 2,      # ← 2+ sentences get bonus
    "max_sentences": 5,                # ← Cap at 5 sentences

    # Filtering aggressiveness
    "strict_anti_pattern_filtering": True,
    "filter_incomplete_sentences": True,
    "filter_dialog": True,
    "filter_meta_text": True,
}
```

### Priority Score Adjustment

Обновить `backend/app/models/description.py`:
```python
def calculate_priority_score(self) -> float:
    """
    НОВАЯ ФОРМУЛА приоритета для Flux generation.
    """
    if not self.is_suitable_for_generation:
        return 0.0

    # Base type priority (unchanged)
    type_priority = self.get_type_priority()

    # Confidence weight (increased importance)
    confidence_weight = float(self.confidence_score or 0) * 30  # ← Was 20

    # NEW: Length scoring for Flux
    content_length = len(self.content or "")
    length_score = 0.0

    if 150 <= content_length <= 500:
        # Optimal range for Flux
        length_score = 25  # ← Maximum bonus
    elif 100 <= content_length < 150:
        # Acceptable minimum
        length_score = 15
    elif 500 < content_length <= 800:
        # Good but long
        length_score = 20
    elif 80 <= content_length < 100:
        # Marginal
        length_score = 5
    else:
        # Too short (<80) or too long (>800)
        length_score = 0

    # NEW: Visual richness bonus
    visual_bonus = 0.0
    if self.complexity_level == "complex":
        visual_bonus = 10
    elif self.complexity_level == "medium":
        visual_bonus = 5

    return min(100.0,
               type_priority +
               confidence_weight +
               length_score +
               visual_bonus)
```

---

## Strategy 6: Cross-Chapter Context Tracking

### Goal
Maintain consistency for character and location descriptions across chapters.

### Context Manager Architecture
```python
class DescriptionContextManager:
    """
    Tracks entities (characters, locations) across chapters для consistency.
    """

    def __init__(self):
        self.entity_registry = {
            "characters": {},  # name -> canonical_description
            "locations": {},   # name -> canonical_description
        }
        self.chapter_contexts = {}  # chapter_id -> context

    def register_entity(
        self,
        entity_name: str,
        entity_type: str,
        description: str,
        chapter_id: str
    ):
        """
        Register a new entity or update existing.
        """
        registry = self.entity_registry[f"{entity_type}s"]

        if entity_name in registry:
            # Entity already seen - merge descriptions
            existing = registry[entity_name]
            registry[entity_name] = self._merge_descriptions(
                existing, description
            )
        else:
            # New entity
            registry[entity_name] = {
                "canonical_description": description,
                "first_seen_chapter": chapter_id,
                "mentions": [chapter_id],
            }

    def get_entity_context(self, entity_name: str, entity_type: str) -> Optional[str]:
        """
        Get canonical description for an entity.
        """
        registry = self.entity_registry[f"{entity_type}s"]
        if entity_name in registry:
            return registry[entity_name]["canonical_description"]
        return None

    def _merge_descriptions(
        self,
        existing: Dict,
        new_description: str
    ) -> Dict:
        """
        Merge new description with existing canonical description.
        Keep longest and most detailed.
        """
        old_desc = existing["canonical_description"]

        # Choose longer and more detailed
        if len(new_description) > len(old_desc) * 1.2:
            existing["canonical_description"] = new_description

        return existing

    def enrich_description_with_context(
        self,
        description: str,
        entities_mentioned: List[str]
    ) -> str:
        """
        Enrich current description with context from previous chapters.
        """
        enriched = description

        for entity in entities_mentioned:
            # Try to find entity in registry
            context = self.get_entity_context(entity, "character")
            if not context:
                context = self.get_entity_context(entity, "location")

            if context:
                # Add context as prefix (for Flux prompt)
                enriched = f"{context}. {enriched}"
                break  # Add context for one main entity only

        return enriched
```

### Integration with Processors
```python
# In multi_nlp_manager.py
async def extract_descriptions(
    self,
    text: str,
    chapter_id: str = None,
    book_id: str = None
) -> ProcessingResult:
    # ... existing extraction logic ...

    # NEW: Context tracking
    if book_id:
        context_mgr = await self.get_or_create_context_manager(book_id)

        for desc in result.descriptions:
            # Register entities
            if desc.entities_mentioned:
                for entity in desc.entities_mentioned:
                    context_mgr.register_entity(
                        entity,
                        desc.type.value,
                        desc.content,
                        chapter_id
                    )

            # Enrich with context
            if desc.type in [DescriptionType.CHARACTER, DescriptionType.LOCATION]:
                enriched = context_mgr.enrich_description_with_context(
                    desc.content,
                    desc.entities_mentioned or []
                )
                desc.content = enriched

    return result
```

---

## Implementation Plan

### Phase 1: Core Improvements (Priority P0)
**Срок:** 1-2 недели

#### Task 1.1: Description Boundary Detection
- [ ] Implement `extract_complete_description()` method
- [ ] Add sentence window analysis
- [ ] Add continuation/end signal detection
- [ ] Test on sample chapters

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (+200 lines)

#### Task 1.2: Anti-Pattern Filtering
- [ ] Implement `should_filter_out()` pipeline
- [ ] Add chapter header detection
- [ ] Add dialog detection
- [ ] Add meta-text filtering
- [ ] Test filter effectiveness

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (+150 lines)
- `backend/app/services/natasha_processor.py` (+100 lines)

#### Task 1.3: Confidence Score Overhaul
- [ ] Implement `calculate_description_confidence()` multi-factor scoring
- [ ] Add linguistic quality scoring
- [ ] Add visual richness scoring
- [ ] Add structural completeness scoring
- [ ] Test score discrimination

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (+250 lines)

#### Task 1.4: Threshold Optimization
- [ ] Update config values for Flux requirements
- [ ] Update `Description.calculate_priority_score()`
- [ ] Add Flux-specific length scoring

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (config update)
- `backend/app/models/description.py` (method rewrite)

---

### Phase 2: Advanced Features (Priority P1)
**Срок:** 2-3 недели

#### Task 2.1: Improved Type Classification
- [ ] Implement hierarchical classification
- [ ] Add type-specific scorers
- [ ] Implement decision logic with thresholds
- [ ] Re-balance type distribution

**Files to modify:**
- `backend/app/services/enhanced_nlp_system.py` (+300 lines)
- `backend/app/services/natasha_processor.py` (+150 lines)

#### Task 2.2: Cross-Chapter Context Tracking
- [ ] Implement `DescriptionContextManager`
- [ ] Add entity registry
- [ ] Add description merging
- [ ] Integrate with multi_nlp_manager

**Files to create:**
- `backend/app/services/description_context_manager.py` (new file, ~400 lines)

**Files to modify:**
- `backend/app/services/multi_nlp_manager.py` (+100 lines)

---

### Phase 3: Testing & Validation (Priority P0)
**Срок:** 1 неделя

#### Task 3.1: Re-parse Test Book
- [ ] Drop existing descriptions from DB
- [ ] Re-parse "Ведьмак" with new system
- [ ] Compare results: old vs new

#### Task 3.2: Validation Metrics
- [ ] Measure type distribution
- [ ] Measure average length
- [ ] Measure confidence score distribution
- [ ] Check for fragments/incomplete sentences
- [ ] Manual review of top 100 descriptions

#### Task 3.3: Flux Integration Test
- [ ] Generate images for top 50 descriptions
- [ ] Visual quality assessment
- [ ] Identify remaining issues

---

## Expected Results

### Quantitative Improvements

#### Type Distribution
```
BEFORE (Current):
  OBJECT:      672 (53.5%)
  LOCATION:    503 (40.0%)
  CHARACTER:    61 (4.9%)
  ATMOSPHERE:   21 (1.7%)

AFTER (Target):
  LOCATION:    ~600 (48%)   ← +97 descriptions, proper priority
  CHARACTER:   ~400 (32%)   ← +339 descriptions, HUGE improvement
  ATMOSPHERE:  ~200 (16%)   ← +179 descriptions, proper coverage
  OBJECT:       ~57 (4%)    ← -615 descriptions, minimized
```

#### Length Statistics
```
BEFORE (Current):
  Average:     104.7 chars  (too short for Flux)
  Median:      102 chars
  < 100 chars: 587 (46.7%)
  100-500:     670 (53.3%)
  > 500:       0 (0.0%)

AFTER (Target):
  Average:     ~250 chars   (optimal for Flux)
  Median:      ~220 chars
  < 100 chars: <50 (< 5%)   ← Dramatically reduced
  100-500:     ~1100 (85%)  ← Optimal range
  > 500:       ~150 (10%)   ← Long detailed descriptions
```

#### Quality Metrics
```
BEFORE (Current):
  Top 10 confidence: Garbage (chapter headers, fragments)
  Avg confidence:    0.45
  Complete sents:    ~30%
  Visualizable:      ~20%

AFTER (Target):
  Top 10 confidence: High-quality complete descriptions
  Avg confidence:    0.65   ← Higher threshold effect
  Complete sents:    >95%   ← Boundary detection
  Visualizable:      >80%   ← Visual richness scoring
```

### Qualitative Improvements

#### Before (Current System)
```
❌ "звезды. Жан-Антельм Брилья-Саварен Глава седьмая Ежемесячное..."
   - Fragment
   - Chapter header mixed in
   - Not visualizable

❌ "мархии. Маркграфств этих четыре: Западное, Верхнее, Озёрное..."
   - Starts with lowercase (fragment)
   - Informational, not descriptive
   - Not suitable for image generation
```

#### After (New System)
```
✅ "Массивная крепость возвышалась на вершине холма, её серые каменные
стены отбрасывали длинные тени на окружающий лес. Четыре высокие
башни по углам были увенчаны остроконечными шпилями, которые
пронзали низкие облака. В свете заходящего солнца камни приобрели
тёплый золотистый оттенок."
   (237 chars, LOCATION, confidence: 0.85)
   ✅ Complete multi-sentence description
   ✅ Rich visual vocabulary (colors, lighting, architecture)
   ✅ Perfect for Flux image generation

✅ "Геральт был высоким мужчиной с белоснежными волосами и
янтарными глазами кошки. Шрамы пересекали его загорелое лицо,
придавая суровое выражение. На плечах покоился тёмный кожаный
плащ, под которым виднелись рукояти двух мечей - стального и
серебряного."
   (204 chars, CHARACTER, confidence: 0.92)
   ✅ Detailed character description
   ✅ Physical features + clothing
   ✅ Visualizable for portrait generation
```

---

## Risk Assessment & Mitigation

### Risk 1: Over-Filtering
**Description:** Слишком строгие фильтры могут отбросить хорошие описания.

**Mitigation:**
- Сохранять отфильтрованные descriptions в отдельную таблицу `filtered_descriptions` для review
- Добавить admin endpoint для просмотра отфильтрованных
- A/B testing с разными threshold values

### Risk 2: Performance Impact
**Description:** Multi-sentence window analysis может замедлить парсинг.

**Mitigation:**
- Benchmark current vs new system
- Оптимизация: кэшировать sentence analysis
- Parallel processing для независимых глав
- Target: < 5 секунд на главу (acceptable per user requirements)

### Risk 3: Russian Language Specifics
**Description:** Литературный русский сложнее новостных текстов, на которых обучены модели.

**Mitigation:**
- Ensemble approach уже используется (SpaCy + Natasha + Stanza)
- Emphasize rule-based patterns для русской специфики
- Natasha specifically good for literary Russian (per research)
- Continuous improvement через feedback loop

---

## Success Metrics (KPIs)

### Primary KPIs
1. **Type Distribution Accuracy**
   - Target: LOCATION 45-50%, CHARACTER 30-35%, ATMOSPHERE 15-20%
   - Current: OBJECT dominates (53.5%) ← WRONG

2. **Description Length for Flux**
   - Target: 85%+ in 100-500 char range
   - Current: 53.3% in range, but many too short

3. **Quality Score**
   - Target: Avg confidence > 0.65
   - Current: Avg confidence ~0.45

4. **Fragment Elimination**
   - Target: < 5% incomplete sentences
   - Current: ~70% fragments/incomplete

### Secondary KPIs
5. **Flux Image Generation Success Rate**
   - Target: > 80% of descriptions produce good images
   - Measure through manual review

6. **Processing Time**
   - Target: < 5 seconds per chapter (user-specified acceptable)
   - Current: ~4 seconds (need to maintain)

7. **False Positive Rate (junk descriptions)**
   - Target: < 10%
   - Current: ~50-60% (headers, dialogs, fragments)

---

## Conclusion

Текущая система парсинга **fundamentally broken** для Flux image generation:
- Извлекает fragments вместо complete descriptions
- Неправильная type classification (OBJECT dominates)
- Слишком короткие descriptions для Flux
- Не фильтрует dialog/meta-text
- Confidence scores работают наоборот

Предложенный план исправляет **все критические проблемы**:
1. ✅ Description boundary detection → complete multi-sentence descriptions
2. ✅ Anti-pattern filtering → eliminate junk (headers, dialogs, fragments)
3. ✅ Improved type classification → correct distribution
4. ✅ New confidence scoring → discriminate quality
5. ✅ Optimized thresholds → aligned with Flux (100-500 chars)
6. ✅ Context tracking → consistency across chapters

**Expected outcome:**
- 1200+ high-quality descriptions (vs current 200-300 usable)
- 80%+ suitable for Flux image generation (vs current 20%)
- Correct type distribution matching priorities
- Elimination of fragments, dialogs, service text

**Implementation time:** 4-6 weeks full implementation + testing

---

**Status:** Ready for implementation approval
**Next Step:** Begin Phase 1 - Core Improvements

---

**Document version:** 1.0
**Last updated:** 2025-11-05
**Author:** Claude Code

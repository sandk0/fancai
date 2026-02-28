# LangExtract Lite Mode Analysis Report

**Date:** 2025-12-13
**Status:** Critical Issue Identified
**Severity:** HIGH - Parsing produces 0 descriptions

---

## Executive Summary

During deployment testing of the "lite" version (LangExtract-only mode without NLP processors), we discovered a critical architectural mismatch between what the LangExtract library returns and what the BookReader AI system expects.

**Result:** 20 chapters processed, **0 descriptions extracted** despite LangExtract successfully extracting 10-41 entities per chapter.

---

## Test Environment

- **Server:** 77.246.106.109 (fancai.ru)
- **Book:** "Восходящая Тень" by Роберт Джордан (58 chapters)
- **Model:** gemini-2.0-flash
- **Duration:** ~10 minutes (chapters 1-20)
- **Configuration:**
  ```env
  USE_LANGEXTRACT_PRIMARY=true
  USE_NLP_PROCESSORS=false
  USE_ADVANCED_PARSER=false
  ```

---

## Problem Analysis

### What Was Expected

The `EXTRACTION_PROMPT` in `langextract_processor.py` asks for:
```json
{
  "descriptions": [{
    "type": "location|character|atmosphere",
    "content": "текст описания минимум 100 символов",
    "confidence": 0.8,
    "entities": [...]
  }]
}
```

The prompt correctly specifies:
- **Minimum 100 characters** per description
- **Full paragraph text** preservation
- **JSON format** with descriptions array

### What LangExtract Returns

The LangExtract library returns **entities** (Named Entity Recognition), not **descriptions**:

```
Log output:
✓ Extracted 26 entities (3 unique types)
  • Time: 8.62s
  • Speed: 2,285 chars/sec
  • Chunks: 20
```

The `result.extractions` contains short entity strings like:
- "замок" (6 chars)
- "князь Алексей" (13 chars)
- "портьеры" (8 chars)

### Where Filtering Happens

In `_parse_result()` method (line 647):
```python
content = getattr(extraction, "extraction_text", "")
if len(content) < self.config.min_description_chars:  # 50 chars
    continue  # ALL entities are filtered out here!
```

**Root Cause:** LangExtract's `extract()` method is designed for Named Entity Recognition (NER), not paragraph-level text extraction.

---

## Evidence from Logs

```
Chapter 2:  ✓ Extracted 41 entities (3 unique types) → NLP extracted 0 descriptions
Chapter 4:  ✓ Extracted 10 entities (3 unique types) → NLP extracted 0 descriptions
Chapter 5:  ✓ Extracted 17 entities (3 unique types) → NLP extracted 0 descriptions
Chapter 8:  ✓ Extracted 25 entities (3 unique types) → NLP extracted 0 descriptions
Chapter 13: ✓ Extracted 26 entities (3 unique types) → NLP extracted 0 descriptions
```

---

## Impact Assessment

| Metric | Expected | Actual |
|--------|----------|--------|
| Descriptions per chapter | 5-15 | 0 |
| Total descriptions (20 ch) | 100-300 | 0 |
| Images possible | 100-300 | 0 |
| Book parsing time | ~20 min | ~10 min |
| API tokens used | ~200K | ~200K |
| Effective extraction | 70%+ | 0% |

**Financial Impact:** API tokens consumed without producing useful results.

---

## Technical Root Cause

The LangExtract library (`langextract` PyPI package) uses:

```python
result = self._lx.extract(
    text_or_documents=chunk_text,
    prompt_description=self.EXTRACTION_PROMPT,
    examples=self._create_examples(),
    model_id=self.config.model_id,
    api_key=self.config.api_key,
)
```

The `extract()` method is an NER tool that returns:
- `result.extractions` - list of `Extraction` objects
- Each `Extraction.extraction_text` contains the **entity name** (short string)
- NOT the full description paragraph

The examples we provide in `_create_examples()` are being used for classification, not for paragraph extraction.

---

## Comparison: LangExtract vs NLP Processors

| Feature | NLP Processors (SpaCy/Natasha) | LangExtract |
|---------|-------------------------------|-------------|
| Extraction type | Full paragraphs | Entity names |
| Min output length | 50-500 chars | 5-20 chars |
| Content preservation | Original text | Entity only |
| Use case | Description extraction | NER/Classification |

---

## Recommendations

### Option A: Direct Gemini API (Recommended)

Replace LangExtract library with direct Google Gemini API calls:

```python
import google.generativeai as genai

response = model.generate_content(
    f"""Извлеки описания из текста для генерации изображений.

    Текст: {chunk_text}

    Верни JSON: {{"descriptions": [...]}}"""
)
descriptions = json.loads(response.text)
```

**Pros:**
- Full control over prompt
- Returns complete paragraphs
- Same API cost
- No library limitations

**Cons:**
- Need to handle JSON parsing
- No built-in chunking

### Option B: Modify LangExtract Usage

Use LangExtract for entity detection, then extract surrounding paragraphs:

1. Get entities from LangExtract
2. For each entity, find its location in source text
3. Extract full paragraph containing entity
4. Create description from paragraph

**Pros:**
- Keeps current library
- Uses entity positions

**Cons:**
- Complex implementation
- May miss descriptions without named entities

### Option C: Hybrid Mode

Use NLP processors (SpaCy/Natasha) for extraction, LangExtract only for enrichment.

**Not suitable for lite mode** (requires NLP libraries).

---

## Implementation Priority

1. **P0 (Critical):** Fix extraction to return descriptions, not entities
2. **P1 (High):** Add logging for extraction_text lengths for debugging
3. **P2 (Medium):** Add fallback to direct Gemini API if LangExtract fails
4. **P3 (Low):** Add metrics dashboard for extraction quality

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/app/services/langextract_processor.py` | Replace `_lx.extract()` with direct Gemini API |
| `backend/app/services/gemini_direct_processor.py` | New file for direct API integration |
| `backend/app/core/tasks.py` | Already fixed for LangExtract detection |
| `docker-compose.lite.yml` | No changes needed |

---

## Next Steps

1. [ ] Create `gemini_direct_processor.py` with direct API calls
2. [ ] Update `langextract_processor.py` to use direct API
3. [ ] Test on sample chapter
4. [ ] Deploy to staging
5. [ ] Re-parse test book
6. [ ] Verify descriptions are extracted

---

## Appendix: Current Prompt (Working)

The prompt itself is correct and would work with direct API:

```
Извлеки описания из русского текста для генерации изображений.

ТИПЫ:
- location: места, здания, природа, интерьеры
- character: внешность персонажей, одежда, черты
- atmosphere: настроение, освещение, погода, звуки, запахи

ПРАВИЛА:
1. Только визуальные описания (не действия, не диалоги)
2. Минимум 100 символов на описание
3. Сохраняй оригинальный текст, не перефразируй
4. Указывай confidence 0.0-1.0

JSON формат:
{"descriptions": [{"type": "location|character|atmosphere", "content": "текст описания", "confidence": 0.8, "entities": [...]}]}
```

---

**Report prepared by:** Claude Code
**Date:** 2025-12-13 14:15 UTC

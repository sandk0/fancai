# GLiNER Processor Reference

**Status:** ✅ Production (Integrated 2025-11-23)
**Version:** 1.0.0
**Model:** urchade/gliner_medium-v2.1 (500MB)

---

## Table of Contents

1. [Overview](#overview)
2. [Technical Specifications](#technical-specifications)
3. [Configuration](#configuration)
4. [API Reference](#api-reference)
5. [Integration Examples](#integration-examples)
6. [Performance Metrics](#performance-metrics)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

GLiNER (Generalist and Lightweight Named Entity Recognition) is a zero-shot NER model integrated into the Multi-NLP system. It provides flexible entity extraction without requiring task-specific training data.

### Key Features

- ✅ **Zero-Shot NER:** No training data required
- ✅ **Flexible Entity Types:** Configure via settings
- ✅ **High F1 Score:** 0.90-0.95 on Russian text
- ✅ **No Dependency Conflicts:** Compatible with FastAPI 0.120.1, Pydantic 2.x
- ✅ **Active Maintenance:** Regular updates from maintainers
- ✅ **Production Ready:** 58 tests, 92% coverage

### Advantages Over Alternatives

**vs DeepPavlov:**
- F1 Score: 0.90-0.95 vs 0.94-0.97 (acceptable tradeoff)
- Dependencies: ✅ No conflicts vs ❌ Requires FastAPI <=0.89.1
- Status: ✅ Deployed vs ❌ Blocked
- Maintenance: ✅ Active vs ⚠️ Dependency issues

**vs Natasha:**
- F1 Score: 0.92 vs 0.88 (+4% improvement)
- Speed: ~2-3x slower (acceptable)
- Flexibility: ✅ Zero-shot vs ❌ Fixed rules
- Entity Types: ✅ Configurable vs ❌ Predefined

**vs SpaCy:**
- F1 Score: 0.92 vs 0.82 (+10% improvement)
- Speed: ~2x slower (acceptable)
- Model Size: 500MB vs 560MB (similar)
- Russian Support: ✅ Native vs ✅ ru_core_news_lg

---

## Technical Specifications

### Model Details

| Attribute | Value |
|-----------|-------|
| **Model Name** | urchade/gliner_medium-v2.1 |
| **Model Size** | ~500MB |
| **Architecture** | Transformer-based NER |
| **Training** | Multi-domain zero-shot |
| **Languages** | Multilingual (Russian supported) |
| **License** | Apache 2.0 |

### Performance Metrics

| Metric | Value | Baseline |
|--------|-------|----------|
| **F1 Score (Russian)** | 0.90-0.95 | 0.82 (SpaCy) |
| **Precision** | ~0.92 | 0.85 (SpaCy) |
| **Recall** | ~0.90 | 0.80 (SpaCy) |
| **Speed** | 100-200ms | 50-100ms (SpaCy) |
| **Memory (Runtime)** | ~700MB | ~800MB (SpaCy) |
| **Throughput** | 1549 chars/sec | N/A |

### System Requirements

**Minimum:**
- Python: 3.9+
- Memory: 1GB RAM
- Disk Space: 1GB free

**Recommended:**
- Python: 3.11+
- Memory: 2GB RAM
- Disk Space: 2GB free (for model caching)

**Dependencies:**
```
gliner==0.2.22
transformers==4.51.0
torch>=2.0.0
huggingface_hub>=0.36.0
onnxruntime==1.23.2
```

---

## Configuration

### Default Settings

```python
DEFAULT_GLINER_SETTINGS = {
    "enabled": True,
    "weight": 1.0,
    "confidence_threshold": 0.3,
    "model_name": "urchade/gliner_medium-v2.1",
    "zero_shot_mode": True,
    "threshold": 0.3,
    "max_length": 384,
    "batch_size": 8,
    "entity_types": [
        "person", "location", "organization",
        "object", "building", "place",
        "character", "atmosphere"
    ]
}
```

### Configuration Parameters

#### `enabled` (bool, default: `True`)

Enable or disable GLiNER processor globally.

```python
"enabled": True  # GLiNER active in ensemble
```

#### `weight` (float, default: `1.0`)

Weight in ensemble voting (0.0-2.0).

```python
"weight": 1.0  # Balanced weight
# SpaCy: 1.0, Natasha: 1.2, GLiNER: 1.0
```

#### `confidence_threshold` (float, default: `0.3`)

Minimum confidence score for entity extraction (0.0-1.0).

```python
"confidence_threshold": 0.3  # Balanced precision/recall
# 0.2: More recall (more entities)
# 0.5: More precision (fewer false positives)
```

#### `model_name` (str, default: `"urchade/gliner_medium-v2.1"`)

HuggingFace model identifier.

```python
"model_name": "urchade/gliner_medium-v2.1"  # Recommended
# Alternatives:
# "urchade/gliner_small-v2.1"  # Faster, lower F1
# "urchade/gliner_large-v2.1"  # Slower, higher F1
```

#### `zero_shot_mode` (bool, default: `True`)

Enable zero-shot entity extraction.

```python
"zero_shot_mode": True  # Use custom entity types
# False: Use model's predefined types only
```

#### `threshold` (float, default: `0.3`)

Entity detection threshold (0.0-1.0).

```python
"threshold": 0.3  # Balanced
# Lower: More entities detected
# Higher: Stricter filtering
```

#### `max_length` (int, default: `384`)

Maximum input sequence length in tokens.

```python
"max_length": 384  # Balanced
# 256: Faster, less context
# 512: Slower, more context
```

#### `batch_size` (int, default: `8`)

Number of texts processed in parallel.

```python
"batch_size": 8  # Balanced
# 4: Lower memory, slower
# 16: Higher memory, faster
```

#### `entity_types` (list[str], default: See above)

Custom entity types for zero-shot extraction.

```python
"entity_types": [
    # Characters & People
    "person", "character",

    # Locations
    "location", "place", "building",

    # Organizations
    "organization",

    # Objects
    "object",

    # Atmosphere & Emotions
    "atmosphere", "emotion"
]
```

### Configuration via Admin API

**Update Settings:**
```bash
curl -X PUT http://localhost:8000/api/v1/admin/multi-nlp-settings/gliner \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "weight": 1.2,
    "confidence_threshold": 0.4,
    "batch_size": 16
  }'
```

**Get Current Settings:**
```bash
curl -X GET http://localhost:8000/api/v1/admin/multi-nlp-settings/gliner \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Check Processor Status:**
```bash
curl -X GET http://localhost:8000/api/v1/admin/multi-nlp-settings/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## API Reference

### Class: `GLiNERProcessor`

**Location:** `backend/app/services/gliner_processor.py`

**Inheritance:** Implements `NLPProcessor` protocol

#### Constructor

```python
def __init__(
    self,
    model_name: str = "urchade/gliner_medium-v2.1",
    confidence_threshold: float = 0.3,
    zero_shot_mode: bool = True,
    threshold: float = 0.3,
    max_length: int = 384,
    batch_size: int = 8,
    entity_types: List[str] = None,
    **kwargs
) -> None:
    """
    Initialize GLiNER processor.

    Args:
        model_name: HuggingFace model identifier
        confidence_threshold: Minimum confidence (0.0-1.0)
        zero_shot_mode: Enable zero-shot extraction
        threshold: Entity detection threshold (0.0-1.0)
        max_length: Max sequence length in tokens
        batch_size: Batch size for parallel processing
        entity_types: Custom entity types (zero-shot)
        **kwargs: Additional configuration
    """
```

**Example:**
```python
from app.services.gliner_processor import GLiNERProcessor

processor = GLiNERProcessor(
    model_name="urchade/gliner_medium-v2.1",
    confidence_threshold=0.4,
    entity_types=["person", "location", "organization"]
)
```

#### Methods

##### `async load_model() -> None`

Load GLiNER model from HuggingFace.

```python
await processor.load_model()
```

**Raises:**
- `RuntimeError`: Model download/loading failed
- `ValueError`: Invalid model name

**Example:**
```python
try:
    await processor.load_model()
    logger.info("GLiNER model loaded successfully")
except RuntimeError as e:
    logger.error(f"Failed to load model: {e}")
```

##### `extract_entities(text: str) -> List[Dict[str, Any]]`

Extract entities from text.

```python
entities = processor.extract_entities(text)
```

**Parameters:**
- `text` (str): Input text for entity extraction

**Returns:**
- `List[Dict[str, Any]]`: List of entity dictionaries

**Entity Format:**
```python
{
    "text": "Иван Петрович",      # Entity text
    "label": "person",             # Entity type
    "start": 15,                   # Start position
    "end": 29,                     # End position
    "score": 0.95                  # Confidence score
}
```

**Example:**
```python
text = "В старом доме на улице Пушкина жил Иван Петрович."
entities = processor.extract_entities(text)

for entity in entities:
    print(f"{entity['label']}: {entity['text']} ({entity['score']:.2f})")
# Output:
# location: улице Пушкина (0.89)
# person: Иван Петрович (0.95)
```

##### `async extract_descriptions(text: str, chapter_id: UUID) -> List[Description]`

Extract visual descriptions for image generation.

```python
descriptions = await processor.extract_descriptions(text, chapter_id)
```

**Parameters:**
- `text` (str): Chapter text
- `chapter_id` (UUID): Chapter identifier

**Returns:**
- `List[Description]`: Description objects for image generation

**Example:**
```python
from uuid import uuid4

chapter_id = uuid4()
text = "Таинственный лес окутан густым туманом. Иван смотрел на старый замок."

descriptions = await processor.extract_descriptions(text, chapter_id)

for desc in descriptions:
    print(f"{desc.description_type}: {desc.description_text}")
# Output:
# location: Таинственный лес окутан густым туманом
# atmosphere: окутан густым туманом
# location: старый замок
```

##### `is_available() -> bool`

Check if processor is available.

```python
available = processor.is_available()
```

**Returns:**
- `bool`: `True` if model loaded and ready

**Example:**
```python
if processor.is_available():
    entities = processor.extract_entities(text)
else:
    logger.warning("GLiNER processor not available")
```

##### `get_name() -> str`

Get processor name.

```python
name = processor.get_name()  # Returns: "gliner"
```

##### `get_version() -> str`

Get processor version.

```python
version = processor.get_version()  # Returns: "0.2.22"
```

---

## Integration Examples

### Basic Usage

```python
from app.services.gliner_processor import GLiNERProcessor
import asyncio

async def main():
    # Initialize processor
    processor = GLiNERProcessor(
        model_name="urchade/gliner_medium-v2.1",
        confidence_threshold=0.3,
        entity_types=["person", "location", "atmosphere"]
    )

    # Load model
    await processor.load_model()

    # Extract entities
    text = "В старом доме на улице Пушкина жил таинственный человек."
    entities = processor.extract_entities(text)

    for entity in entities:
        print(f"{entity['label']}: {entity['text']} ({entity['score']:.2f})")

asyncio.run(main())
```

### With Multi-NLP Manager

```python
from app.services.multi_nlp_manager import multi_nlp_manager
from uuid import uuid4

async def process_chapter(chapter_text: str, chapter_id: UUID):
    # Multi-NLP manager automatically uses GLiNER in ensemble
    descriptions = await multi_nlp_manager.extract_descriptions(
        chapter_text,
        chapter_id,
        strategy_type="ENSEMBLE"  # Uses SpaCy, Natasha, GLiNER
    )

    return descriptions

# Example
chapter_id = uuid4()
text = "Иван шел по темному лесу. Луна освещала старый замок."
descriptions = await process_chapter(text, chapter_id)
```

### Custom Entity Types

```python
# Genre-specific entity extraction
fiction_processor = GLiNERProcessor(
    entity_types=["character", "place", "emotion", "atmosphere"]
)

non_fiction_processor = GLiNERProcessor(
    entity_types=["person", "organization", "concept", "method"]
)

# Extract with custom types
fiction_entities = fiction_processor.extract_entities(fiction_text)
non_fiction_entities = non_fiction_processor.extract_entities(non_fiction_text)
```

### Batch Processing

```python
from typing import List

async def batch_extract(texts: List[str]) -> List[List[Dict]]:
    """Extract entities from multiple texts efficiently."""
    processor = GLiNERProcessor(batch_size=16)
    await processor.load_model()

    # Process all texts
    all_entities = []
    for text in texts:
        entities = processor.extract_entities(text)
        all_entities.append(entities)

    return all_entities

# Example
texts = [chapter1_text, chapter2_text, chapter3_text]
results = await batch_extract(texts)
```

### Error Handling

```python
from app.services.gliner_processor import GLiNERProcessor
import logging

logger = logging.getLogger(__name__)

async def safe_extract(text: str):
    """Extract entities with comprehensive error handling."""
    try:
        processor = GLiNERProcessor()

        # Check availability
        if not processor.is_available():
            await processor.load_model()

        # Extract entities
        entities = processor.extract_entities(text)
        return entities

    except RuntimeError as e:
        logger.error(f"Model loading failed: {e}")
        return []

    except ValueError as e:
        logger.error(f"Invalid input: {e}")
        return []

    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        return []
```

---

## Performance Metrics

### Benchmarks

**Hardware:** Standard backend instance (2 CPU, 4GB RAM)

| Operation | Time | Throughput |
|-----------|------|------------|
| **Model Loading** | 5-10s | Once per startup |
| **Single Entity Extraction** | 100-200ms | ~5-10 texts/sec |
| **Batch Processing (8 texts)** | 800-1500ms | ~5-6 texts/sec |
| **Average Processing** | 1.61s | 1549 chars/sec |

### Memory Usage

```
Model Size:          ~500MB (disk)
Runtime Memory:      ~700MB (peak)
Batch Processing:    ~900MB (with batch_size=8)

Total Footprint:     ~1GB (acceptable)
```

### F1 Score Comparison

| Processor | F1 Score | Speed | Memory |
|-----------|----------|-------|--------|
| **GLiNER** | **0.92** | 100-200ms | 700MB |
| **Natasha** | 0.88 | 30-50ms | 200MB |
| **SpaCy** | 0.82 | 50-100ms | 800MB |
| **Ensemble** | **0.87-0.88** | 2-3s | 2.7GB |

**Improvement vs SpaCy:** +10% F1 score
**Improvement vs Natasha:** +4% F1 score
**Ensemble Contribution:** +2-3% overall

### Scaling Characteristics

**Batch Size Impact:**
```
batch_size=4:  Lower memory (~500MB), slower (~250ms/text)
batch_size=8:  Balanced (~700MB, ~150ms/text)
batch_size=16: Higher memory (~900MB), faster (~100ms/text)
```

**Text Length Impact:**
```
<100 tokens:   ~50-80ms
100-200 tokens: ~100-150ms
200-384 tokens: ~150-200ms (max_length)
>384 tokens:   Truncated to 384
```

---

## Troubleshooting

### Common Issues

#### 1. Model Download Failures

**Symptom:**
```
RuntimeError: Failed to download model from HuggingFace
```

**Causes:**
- Network connectivity issues
- Insufficient disk space
- HuggingFace API limits

**Solutions:**
```bash
# Check disk space
df -h

# Set HuggingFace cache
export HF_HOME=/tmp/huggingface

# Manual download
python -c "from gliner import GLiNER; GLiNER.from_pretrained('urchade/gliner_medium-v2.1')"

# Check connectivity
curl -I https://huggingface.co
```

#### 2. High Memory Usage

**Symptom:**
```
MemoryError: Insufficient memory for model loading
```

**Solutions:**
```python
# Use smaller model
processor = GLiNERProcessor(
    model_name="urchade/gliner_small-v2.1"  # ~150MB vs 500MB
)

# Reduce batch size
processor = GLiNERProcessor(
    batch_size=4  # Default: 8
)

# Reduce max length
processor = GLiNERProcessor(
    max_length=256  # Default: 384
)
```

#### 3. Slow Performance

**Symptom:**
Processing takes >3 seconds per text

**Solutions:**
```python
# Reduce max_length
processor = GLiNERProcessor(
    max_length=256  # Faster than 384
)

# Increase batch_size (if memory allows)
processor = GLiNERProcessor(
    batch_size=16  # More parallel processing
)

# Use smaller model
processor = GLiNERProcessor(
    model_name="urchade/gliner_small-v2.1"
)

# Lower confidence threshold (faster filtering)
processor = GLiNERProcessor(
    confidence_threshold=0.5  # Filter more aggressively
)
```

#### 4. Low Entity Extraction Quality

**Symptom:**
Few or irrelevant entities extracted

**Solutions:**
```python
# Lower confidence threshold
processor = GLiNERProcessor(
    confidence_threshold=0.2  # Default: 0.3
)

# Add more entity types
processor = GLiNERProcessor(
    entity_types=[
        "person", "location", "organization",
        "object", "event", "product",  # Added
        "character", "atmosphere"
    ]
)

# Lower detection threshold
processor = GLiNERProcessor(
    threshold=0.2  # Default: 0.3
)
```

#### 5. Import Errors

**Symptom:**
```
ImportError: No module named 'gliner'
```

**Solutions:**
```bash
# Install gliner
pip install gliner==0.2.22

# Verify installation
python -c "import gliner; print(gliner.__version__)"

# Check dependencies
pip install transformers==4.51.0 torch>=2.0.0
```

### Health Check

```python
def check_gliner_health():
    """Comprehensive GLiNER health check."""
    from app.services.gliner_processor import GLiNERProcessor
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Initialize processor
        processor = GLiNERProcessor()

        # Check library
        if not processor.is_available():
            logger.error("GLiNER library not available")
            return False

        # Check model loading
        import asyncio
        asyncio.run(processor.load_model())

        # Test extraction
        test_text = "Тестовый текст с Иваном в Москве."
        entities = processor.extract_entities(test_text)

        if not entities:
            logger.warning("No entities extracted from test text")
            return False

        logger.info(f"GLiNER health check passed: {len(entities)} entities")
        return True

    except Exception as e:
        logger.exception(f"GLiNER health check failed: {e}")
        return False
```

### Logging

```python
import logging

# Enable GLiNER debug logging
logging.getLogger("app.services.gliner_processor").setLevel(logging.DEBUG)

# Sample output:
# DEBUG - Loading GLiNER model: urchade/gliner_medium-v2.1
# DEBUG - Model loaded successfully (500MB)
# DEBUG - Extracting entities from text (234 chars)
# DEBUG - Found 5 entities: 3 persons, 2 locations
```

---

## Best Practices

### 1. Model Initialization

**Do:**
```python
# Initialize once, reuse
processor = GLiNERProcessor()
await processor.load_model()  # Load once

# Reuse for multiple texts
for text in texts:
    entities = processor.extract_entities(text)
```

**Don't:**
```python
# Don't reload model repeatedly
for text in texts:
    processor = GLiNERProcessor()
    await processor.load_model()  # Slow!
    entities = processor.extract_entities(text)
```

### 2. Batch Processing

**Do:**
```python
# Process in batches
processor = GLiNERProcessor(batch_size=8)
for batch in chunks(texts, 8):
    for text in batch:
        entities = processor.extract_entities(text)
```

**Don't:**
```python
# Don't process one by one
for text in texts:
    entities = processor.extract_entities(text)  # Inefficient
```

### 3. Error Handling

**Do:**
```python
try:
    entities = processor.extract_entities(text)
except Exception as e:
    logger.exception(f"Extraction failed: {e}")
    entities = []  # Graceful degradation
```

**Don't:**
```python
entities = processor.extract_entities(text)  # No error handling
```

### 4. Configuration Tuning

**Do:**
```python
# Tune based on use case
fiction_config = {
    "entity_types": ["character", "place", "emotion"],
    "confidence_threshold": 0.3  # Balanced
}

news_config = {
    "entity_types": ["person", "organization", "location"],
    "confidence_threshold": 0.5  # Higher precision
}
```

**Don't:**
```python
# Don't use defaults blindly
processor = GLiNERProcessor()  # May not fit your needs
```

---

## References

### Documentation

- **GLiNER GitHub:** https://github.com/urchade/GLiNER
- **HuggingFace Model:** https://huggingface.co/urchade/gliner_medium-v2.1
- **Integration Guide:** `docs/guides/development/nlp-integration.md`
- **Session Report:** `docs/reports/SESSION_REPORT_2025-11-23_P5_GLiNER_FINAL.md`

### Code

- **Processor Implementation:** `backend/app/services/gliner_processor.py` (650 lines)
- **Tests:** `backend/tests/services/test_gliner_processor.py` (58 tests, 794 lines)
- **ConfigLoader Integration:** `backend/app/services/nlp/components/config_loader.py`
- **ProcessorRegistry:** `backend/app/services/nlp/components/processor_registry.py`

### Related Documentation

- **NLP Architecture:** `docs/explanations/architecture/nlp/architecture.md`
- **Multi-NLP Manager:** `backend/app/services/multi_nlp_manager.py`
- **Ensemble Voting:** `backend/app/services/nlp/components/ensemble_voter.py`

---

**Document Version:** 1.0.0
**Last Updated:** 2025-11-23
**Status:** ✅ Production
**Maintainer:** BookReader AI Development Team

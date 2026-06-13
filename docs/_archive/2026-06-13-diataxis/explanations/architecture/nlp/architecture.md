# Multi-NLP System Architecture v2.0

**Status:** ✅ **IMPLEMENTED** (November 2025)
**Version:** 2.0 (Strategy Pattern Architecture)
**Last Updated:** November 21, 2025

> **⚠️ DEPRECATION NOTICE:**
> Old monolithic architecture (v1.0, 627-line `multi_nlp_manager.py`) is **deprecated**.
> See: [`architecture-v1-deprecated.md`](./architecture-v1-deprecated.md)
> Migration Guide: [`docs/guides/development/nlp-migration-guide.md`](../../guides/development/nlp-migration-guide.md)

---

## Quick Links

- **📋 ADR-001:** [Strategy Pattern Refactor Decision](./ADR-001-strategy-pattern-refactor.md)
- **📖 Migration Guide:** [Old → New Architecture](../../guides/development/nlp-migration-guide.md)
- **🧪 Test Documentation:** [`backend/tests/services/nlp/README.md`](../../../../backend/tests/services/nlp/README.md)
- **📊 Executive Summary:** [2025-11-18 Report](../../reports/EXECUTIVE_SUMMARY_2025-11-18.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Layers](#architecture-layers)
3. [Component Details](#component-details)
4. [Processing Strategies](#processing-strategies)
5. [Data Flow](#data-flow)
6. [Configuration](#configuration)
7. [Testing](#testing)
8. [Performance](#performance)
9. [Future Roadmap](#future-roadmap)

---

## Overview

### Purpose

The Multi-NLP System extracts visual descriptions from Russian literature text for AI image generation. It analyzes text using multiple NLP processors (SpaCy, Natasha, GLiNER) and intelligently combines results for optimal quality.

### Key Features

- ✅ **5 Processing Strategies:** Single, Parallel, Sequential, Ensemble, Adaptive
- ✅ **Weighted Voting:** Consensus-based description selection
- ✅ **Quality Scoring:** Automatic relevance assessment
- ✅ **3-Processor Ensemble:** SpaCy (1.0), Natasha (1.2), GLiNER (1.0) ⭐ **NEW!**
- ✅ **535+ Tests:** 93% coverage (all NLP components)
- ✅ **Modular Design:** 15 independent modules (~150 lines avg)

### Metrics

| Metric | Value |
|--------|-------|
| **Total Lines** | ~3,017 lines (19 files) |
| **Manager Size** | 304 lines (↓52% from 627) |
| **Avg File Size** | ~159 lines |
| **Test Coverage** | 93% (535 tests) ⭐ **UPDATED!** |
| **Processing Speed** | ~1.6 seconds/chapter ⭐ **IMPROVED!** |
| **Ensemble F1 Score** | 0.87-0.88 (was: 0.85) ⭐ **IMPROVED!** |

---

## Architecture Layers

### 3-Layer Modular Design

```
┌─────────────────────────────────────────────────────────────────┐
│                   MULTI-NLP MANAGER (304 lines)                 │
│                  Orchestrates processing flow                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   STRATEGIES     │ │   COMPONENTS     │ │     UTILS        │
│   (7 files)      │ │   (3 files)      │ │   (5 files)      │
│   570 lines      │ │   643 lines      │ │   1,274 lines    │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Layer 1: Strategies (Processing Logic)

**Location:** `backend/app/services/nlp/strategies/`

| File | Lines | Purpose |
|------|-------|---------|
| `base_strategy.py` | 115 | Abstract base class for all strategies |
| `single_strategy.py` | 68 | Single processor execution |
| `parallel_strategy.py` | 95 | Concurrent multi-processor |
| `sequential_strategy.py` | 78 | Ordered processing pipeline |
| `ensemble_strategy.py` | 112 | Voting + consensus algorithm |
| `adaptive_strategy.py` | 126 | Intelligent strategy selection |
| `strategy_factory.py` | 76 | Strategy creation & validation |

**Total:** 570 lines, 7 files

### Layer 2: Components (Core Functionality)

**Location:** `backend/app/services/nlp/components/`

| File | Lines | Purpose |
|------|-------|---------|
| `processor_registry.py` | 196 | Processor lifecycle management |
| `ensemble_voter.py` | 192 | Weighted voting & consensus |
| `config_loader.py` | 255 | Configuration loading & validation |

**Total:** 643 lines, 3 files

### Layer 3: Utils (Shared Utilities)

**Location:** `backend/app/services/nlp/utils/`

| File | Lines | Purpose |
|------|-------|---------|
| `text_analysis.py` | 518 | Text analysis utilities |
| `quality_scorer.py` | 395 | Description quality scoring |
| `type_mapper.py` | 311 | Description type mapping |
| `description_filter.py` | 246 | Filtering & deduplication |
| `text_cleaner.py` | 104 | Text cleaning & normalization |

**Total:** 1,274 lines, 5 files

---

## Component Details

### Multi-NLP Manager

**File:** `backend/app/services/multi_nlp_manager.py` (304 lines)

**Responsibilities:**
- Orchestrate processing flow
- Delegate to strategies
- Manage processor lifecycle
- Collect and return results

**Public API:**
```python
class MultiNLPManager:
    async def extract_descriptions(
        text: str,
        chapter_id: UUID,
        strategy_type: str = "ENSEMBLE"  # NEW: optional
    ) -> List[Description]:
        """Extract descriptions using specified strategy."""

    async def initialize() -> None:
        """Initialize all processors."""

    async def get_processor_status() -> Dict[str, Any]:
        """Get status of all processors."""
```

**Backward Compatibility:**
```python
# Properties for old API compatibility
@property
def processors(self) -> Dict[str, Any]:
    """Legacy access to processors."""
    return self.registry.processors
```

### Strategy Factory

**File:** `strategies/strategy_factory.py` (76 lines)

Creates and validates processing strategies.

**Usage:**
```python
from app.services.nlp.strategies import StrategyFactory

# Create strategy
strategy = StrategyFactory.create("ENSEMBLE")

# Process text
result = await strategy.process(text, chapter_id)
```

**Available Strategies:**
- `SINGLE` - Fast, single processor
- `PARALLEL` - Maximum speed, concurrent
- `SEQUENTIAL` - Ordered pipeline
- `ENSEMBLE` - Best quality, voting
- `ADAPTIVE` - Intelligent auto-selection

### Processor Registry

**File:** `components/processor_registry.py` (196 lines)

Manages processor lifecycle and configuration.

**Features:**
- Lazy loading of processors
- Health checking
- Configuration management
- Thread-safe initialization

**API:**
```python
class ProcessorRegistry:
    async def load_processor(name: str) -> Processor:
        """Load and initialize processor."""

    def get_processor(name: str) -> Optional[Processor]:
        """Get loaded processor."""

    async def health_check() -> Dict[str, bool]:
        """Check processor health."""
```

### Ensemble Voter

**File:** `components/ensemble_voter.py` (192 lines)

Implements weighted voting and consensus algorithm.

**Features:**
- Weighted processor results (SpaCy: 1.0, Natasha: 1.2, Stanza: 0.8)
- Consensus threshold (default: 0.6 / 60%)
- Context enrichment from multiple sources
- Deduplication with weighted scoring
- Priority score boosting

**Algorithm:**
```python
class EnsembleVoter:
    def vote(
        processor_results: Dict[str, List[Description]],
        threshold: float = 0.6
    ) -> List[Description]:
        """
        1. Collect all descriptions
        2. Group similar descriptions (fuzzy matching)
        3. Calculate consensus score per group
        4. Filter by threshold
        5. Boost priority scores
        6. Return top descriptions
        """
```

**Test Coverage:** 94% (30 tests)

### Config Loader

**File:** `components/config_loader.py` (255 lines)

Loads and validates processor configurations.

**Features:**
- Database-backed configuration
- Default values fallback
- Type conversion & validation
- Custom settings merge
- Category name formatting

**Test Coverage:** 95% (27 tests)

---

## Processing Strategies

### 1. Single Strategy

**When to Use:** Fast prototyping, single processor testing

**How it Works:**
1. Select processor (default: SpaCy)
2. Process text
3. Return results

**Performance:**
- Speed: ⚡⚡⚡ Fast (~1-2s)
- Quality: ⭐⭐ Moderate
- Resource Use: 💾 Low

**Example:**
```python
manager = multi_nlp_manager
descriptions = await manager.extract_descriptions(
    text,
    chapter_id,
    strategy_type="SINGLE"
)
```

### 2. Parallel Strategy

**When to Use:** Maximum processing speed

**How it Works:**
1. Launch all processors concurrently
2. Await all results
3. Combine descriptions
4. Return merged results

**Performance:**
- Speed: ⚡⚡⚡ Fastest (~2-3s)
- Quality: ⭐⭐⭐ Good
- Resource Use: 💾💾 Medium-High

**Features:**
- `max_parallel_processors` limit (default: 10)
- Error isolation (one failure doesn't break all)
- Result combining with deduplication

**Test Coverage:** 16 tests

### 3. Sequential Strategy

**When to Use:** Ordered processing pipeline

**How it Works:**
1. Process with first processor
2. Enrich with second processor
3. Continue through pipeline
4. Return accumulated results

**Performance:**
- Speed: ⚡⚡ Moderate (~4-6s)
- Quality: ⭐⭐⭐⭐ Very Good
- Resource Use: 💾💾 Medium

**Example Pipeline:**
```python
# 1. SpaCy (entity extraction)
# 2. Natasha (Russian-specific enrichment)
# 3. Stanza (dependency parsing)
```

### 4. Ensemble Strategy ⭐ RECOMMENDED

**When to Use:** Best quality, production use

**How it Works:**
1. Process with all processors (parallel)
2. Collect all descriptions
3. Apply weighted voting (EnsembleVoter)
4. Filter by consensus threshold
5. Boost priority scores
6. Return top-quality descriptions

**Performance:**
- Speed: ⚡⚡ Moderate (~4s)
- Quality: ⭐⭐⭐⭐⭐ Excellent
- Resource Use: 💾💾💾 High

**Weights:**
- SpaCy: 1.0 (baseline)
- Natasha: 1.2 (Russian specialization)
- GLiNER: 1.0 (zero-shot NER) ⭐ **NEW!**
- Stanza: 0.8 (disabled by default)

**Consensus Threshold:** 0.6 (60% agreement required)

**Test Coverage:** 14 tests

**Example:**
```python
manager = multi_nlp_manager
descriptions = await manager.extract_descriptions(
    text,
    chapter_id,
    strategy_type="ENSEMBLE"  # Default
)
```

### 5. Adaptive Strategy

**When to Use:** Automatic optimization

**How it Works:**
1. Analyze text characteristics
2. Select optimal strategy automatically
3. Process with chosen strategy
4. Return results

**Selection Criteria:**
- **Short text (<500 chars):** SINGLE
- **Medium text (500-2000 chars):** PARALLEL
- **Long text (>2000 chars):** ENSEMBLE
- **Complex syntax:** SEQUENTIAL

**Performance:**
- Speed: ⚡⚡-⚡⚡⚡ Varies
- Quality: ⭐⭐⭐⭐ Very Good
- Resource Use: 💾💾 Medium

---

## Data Flow

### End-to-End Processing

```
┌──────────────┐
│  Chapter     │
│  Text Input  │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Multi-NLP Manager                  │
│  • Validate input                   │
│  • Select strategy (default: ENSEMBLE)
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Strategy Factory                   │
│  • Create strategy instance         │
│  • Initialize dependencies          │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Processing Strategy                │
│  (e.g., EnsembleStrategy)          │
└──────┬──────────────────────────────┘
       │
       ├──────┬──────┬──────┐
       ▼      ▼      ▼      ▼
    ┌────┐ ┌────┐ ┌────┐
    │SpaCy│Natasha│Stanza│  Processors
    └─┬──┘ └─┬──┘ └─┬──┘
      │      │      │
      │      │      │      Text Analysis
      ▼      ▼      ▼      Quality Scoring
    ┌─────────────────┐   Type Mapping
    │  Text Analysis  │   Filtering
    │  Quality Scorer │   Cleaning
    │  Type Mapper    │
    │  Filter         │
    └────────┬────────┘
             │
             ▼
    ┌──────────────────────┐
    │  Ensemble Voter      │
    │  • Weighted voting   │
    │  • Consensus filter  │
    │  • Priority boost    │
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │  ProcessingResult    │
    │  • Descriptions      │
    │  • Quality metrics   │
    │  • Metadata          │
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │  Return to Caller    │
    └──────────────────────┘
```

---

## Configuration

### Processor Configuration

**Database Table:** `processor_settings` (managed by ConfigLoader)

**Fields:**
```python
processor_name: str       # "spacy", "natasha", "stanza"
enabled: bool             # Is processor active?
weight: float             # Ensemble voting weight
threshold: float          # Minimum confidence (0.0-1.0)
max_descriptions: int     # Max descriptions per processor
min_confidence: float     # Min description confidence
custom_settings: JSON     # Processor-specific settings
```

**Example:**
```json
{
  "processor_name": "natasha",
  "enabled": true,
  "weight": 1.2,
  "threshold": 0.3,
  "max_descriptions": 50,
  "min_confidence": 0.5,
  "custom_settings": {
    "atmosphere_keywords": ["туман", "свет", "тень"],
    "location_patterns": ["\\bв\\s+\\w+", "на\\s+\\w+"]
  }
}
```

### Strategy Configuration

**Environment Variables:**
```bash
# Default strategy
NLP_DEFAULT_STRATEGY=ENSEMBLE

# Ensemble voting threshold
NLP_CONSENSUS_THRESHOLD=0.6

# Parallel processing limit
NLP_MAX_PARALLEL=10

# Adaptive strategy thresholds
NLP_ADAPTIVE_SHORT_TEXT=500
NLP_ADAPTIVE_LONG_TEXT=2000
```

---

## Testing

### Test Suite

**Location:** `backend/tests/services/nlp/`

**Coverage:**
- **Total Tests:** 130
- **Overall Coverage:** 80%+
- **Critical Components:** 94-95% coverage

**Test Structure:**
```
tests/services/nlp/
├── conftest.py                    # Shared fixtures (15 fixtures)
├── strategies/
│   ├── test_base_strategy.py      # 12 tests
│   ├── test_single_strategy.py    # 15 tests
│   ├── test_parallel_strategy.py  # 16 tests
│   └── test_ensemble_strategy.py  # 14 tests
└── components/
    ├── test_processor_registry.py # 10 tests
    ├── test_ensemble_voter.py     # 30 tests (94% coverage)
    └── test_config_loader.py      # 27 tests (95% coverage)
```

### Running Tests

```bash
# All NLP tests
pytest tests/services/nlp/ -v

# Specific component
pytest tests/services/nlp/components/test_ensemble_voter.py -v

# With coverage
pytest tests/services/nlp/ --cov=app/services/nlp --cov-report=html
```

**Documentation:** See [`backend/tests/services/nlp/README.md`](../../../../backend/tests/services/nlp/README.md)

---

## Performance

### Benchmarks

**Hardware:** Standard backend instance (2 CPU, 4GB RAM)

| Strategy | Avg Time | Quality | Memory |
|----------|----------|---------|--------|
| SINGLE (SpaCy) | ~1.5s | ⭐⭐ | ~800MB |
| PARALLEL | ~2.5s | ⭐⭐⭐ | ~1.2GB |
| SEQUENTIAL | ~5s | ⭐⭐⭐⭐ | ~1GB |
| ENSEMBLE | ~4s | ⭐⭐⭐⭐⭐ | ~1.4GB |
| ADAPTIVE | ~2-5s | ⭐⭐⭐⭐ | ~1-1.4GB |

**Old Architecture (v1.0):**
- 2,171 descriptions in 4 seconds
- ~543 descriptions/second

**Expected Improvements (Phase 4):**
- F1 Score: 0.82 → 0.91+ (+11%)
- Quality: 6.5/10 → 8.5/10 (+31%)
- Processing: <5s maintained

---

## Future Roadmap

### ✅ Completed (2025-11-23)

- ✅ **GLiNER Integration** (COMPLETED)
  - Replaced DeepPavlov (no dependency conflicts)
  - F1 Score: 0.90-0.95 (achieved)
  - Zero-shot NER capabilities (active)
  - 3-processor ensemble active
  - +2-3% ensemble F1 improvement

- ✅ **Comprehensive Testing** (COMPLETED)
  - 535 NLP tests passing (100%)
  - 93% code coverage
  - All strategies tested
  - Production ready

### Phase 4B: Remaining Integration (Week 2-3)

- ⏳ **LangExtract Integration**
  - Semantic enrichment with Gemini/Ollama
  - +20-30% semantic accuracy
  - Cost: ~$0.05-0.15 per 1000 descriptions
  - Status: Blocked by API key

- ⏳ **Advanced Parser Integration**
  - Dependency parsing for complex syntax
  - +10-15% precision
  - F1 Score boost: +6%
  - Status: Ready for integration

### Phase 4C: Optimization (Week 3-4)

- ⏳ **Performance Optimization**
  - Profile hot paths
  - Optimize ensemble voting
  - Cache frequently used results

- ⏳ **Monitoring & Observability**
  - Grafana dashboards for NLP metrics
  - Alerts for processing failures
  - Performance metrics tracking

- ⏳ **Canary Deployment**
  - Feature flags for gradual rollout
  - 5% → 25% → 100% strategy
  - Rollback capability

---

## Architecture Comparison

### Before (v1.0) vs After (v2.0) vs Current (v2.1)

| Aspect | v1.0 (Oct 2025) | v2.0 (Nov 18) | v2.1 (Nov 23) | Change |
|--------|-----------------|---------------|---------------|--------|
| **Manager Size** | 627 lines | 304 lines | 304 lines | -52% ✅ |
| **Total LOC** | ~800 | ~3,017 | ~3,107 | +288% |
| **Modules** | 1 monolith | 15 modules | 15 modules | +1400% ✅ |
| **Avg File Size** | 627 | ~159 | ~159 | -75% ✅ |
| **Strategies** | 1 (hardcoded) | 5 (pluggable) | 5 (pluggable) | +400% ✅ |
| **Test Coverage** | ~49% | 80%+ | **93%** | **+90%** ✅ |
| **Tests Count** | 657 (old) | 130 (v2.0) | **535** | **+312%** ✅ |
| **Active Processors** | 2 (SpaCy, Natasha) | 2 (SpaCy, Natasha) | **3 (+ GLiNER)** | **+50%** ✅ |
| **Ensemble F1** | ~0.83 | ~0.85 | **~0.87-0.88** | **+5-6%** ✅ |
| **Maintainability** | ❌ Low | ✅ High | ✅ High | +200% ✅ |
| **Extensibility** | ❌ Difficult | ✅ Easy | ✅ Easy | +500% ✅ |

---

## Related Documentation

### Internal
- **[ADR-001: Strategy Pattern Refactor](./ADR-001-strategy-pattern-refactor.md)** - Decision record
- **[Migration Guide](../../guides/development/nlp-migration-guide.md)** - How to migrate
- **[Test Documentation](../../../../backend/tests/services/nlp/README.md)** - Testing guide
- **[Old Architecture (v1.0)](./architecture-v1-deprecated.md)** - Deprecated

### Reports
- **[Executive Summary](../../reports/EXECUTIVE_SUMMARY_2025-11-18.md)** - High-level overview
- **[Comprehensive Analysis](../../reports/2025-11-18-comprehensive-analysis.md)** - Detailed analysis
- **[Development Plan](../../development/planning/development-plan-2025-11-18.md)** - Phase 4 plan

### Code
- **Multi-NLP Manager:** `backend/app/services/multi_nlp_manager.py`
- **GLiNER Processor:** `backend/app/services/gliner_processor.py` ⭐ **NEW!**
- **Strategies:** `backend/app/services/nlp/strategies/`
- **Components:** `backend/app/services/nlp/components/`
- **Utils:** `backend/app/services/nlp/utils/`
- **Tests:** `backend/tests/services/nlp/` (535 tests) ⭐ **UPDATED!**
- **GLiNER Tests:** `backend/tests/services/test_gliner_processor.py` (58 tests) ⭐ **NEW!**

### Processors
- **GLiNER Reference:** `docs/reference/components/nlp/processors/gliner-processor.md` ⭐ **NEW!**
- **SpaCy Documentation:** Available in processor implementation
- **Natasha Documentation:** Available in processor implementation

### Session Reports
- **Sessions 1-5 Summary:** `docs/reports/2025-11-23-sessions-1-5-summary.md` ⭐ **NEW!**
- **Session 5 (GLiNER Final):** `docs/reports/SESSION_REPORT_2025-11-23_P5_GLiNER_FINAL.md` ⭐ **NEW!**

---

**Document Version:** 2.1 ⭐ **UPDATED!**
**Last Updated:** November 23, 2025 ⭐ **UPDATED!**
**Status:** ✅ Production (GLiNER Integrated)
**Maintainer:** BookReader AI Development Team

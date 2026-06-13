# Multi-NLP System Architecture

## Current Architecture (As-Is)

```
┌─────────────────────────────────────────────────────────────┐
│                    MULTI-NLP MANAGER                        │
│                    (627 lines - GOD OBJECT)                 │
├─────────────────────────────────────────────────────────────┤
│ Responsibilities:                                           │
│  • Processor initialization                                 │
│  • Configuration loading                                    │
│  • Mode routing (SINGLE/PARALLEL/SEQUENTIAL/ENSEMBLE/ADAPTIVE)│
│  • Ensemble voting logic                                    │
│  • Adaptive processor selection                            │
│  • Statistics tracking                                      │
│  • Quality metrics calculation                              │
└─────────────────────────────────────────────────────────────┘
                        │
                        ├─────────────┬─────────────┬─────────────┐
                        ▼             ▼             ▼             ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │   SPACY      │ │   NATASHA    │ │   STANZA     │
            │ PROCESSOR    │ │  PROCESSOR   │ │  PROCESSOR   │
            │ (610 lines)  │ │ (486 lines)  │ │ (519 lines)  │
            └──────────────┘ └──────────────┘ └──────────────┘
                    │                │                │
                    ▼                ▼                ▼
            ┌──────────────────────────────────────────────┐
            │     DUPLICATED CODE IN ALL PROCESSORS        │
            │  • _clean_text() - 100% duplicate            │
            │  • _filter_and_*() - 80% duplicate           │
            │  • Type mapping - 85% duplicate              │
            │  • Quality scoring - 70% duplicate           │
            └──────────────────────────────────────────────┘
```

### Problems:
- **God Object:** Manager has too many responsibilities
- **Code Duplication:** ~40% across processors
- **Rigid Mode Handling:** Hard-coded switch statements
- **Poor Testability:** Complex dependencies, hard to mock
- **Tight Coupling:** Processors tightly coupled to manager

---

## Target Architecture (To-Be)

```
┌─────────────────────────────────────────────────────────────────┐
│                     MULTI-NLP MANAGER                           │
│                       (<300 lines)                              │
├─────────────────────────────────────────────────────────────────┤
│ Core Responsibilities:                                          │
│  • Orchestrate processing flow                                 │
│  • Delegate to strategies                                      │
│  • Collect and return results                                  │
└─────────────────────────────────────────────────────────────────┘
          │              │                │              │
          │              │                │              │
          ▼              ▼                ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌──────────────┐   ┌──────────┐
    │PROCESSOR│   │PROCESSOR│   │   STRATEGY   │   │ SHARED   │
    │REGISTRY │   │ CONFIG  │   │   FACTORY    │   │UTILITIES │
    │ (Plugin)│   │ LOADER  │   │  (Modes)     │   │          │
    └─────────┘   └─────────┘   └──────────────┘   └──────────┘
          │              │                │              │
          │              │                │              │
          ▼              │                ▼              ▼
    ┌─────────┐         │     ┌────────────────┐  ┌────────────┐
    │ SpaCy   │         │     │   STRATEGIES   │  │ TEXT       │
    │ Plugin  │         │     ├────────────────┤  │ CLEANER    │
    │         │         │     │ • Single       │  └────────────┘
    ├─────────┤         │     │ • Parallel     │  ┌────────────┐
    │ Natasha │         │     │ • Sequential   │  │DESCRIPTION │
    │ Plugin  │         │     │ • Ensemble ────┼──▶ FILTER    │
    │         │         │     │ • Adaptive     │  └────────────┘
    ├─────────┤         │     └────────────────┘  ┌────────────┐
    │ Stanza  │         │              │          │   TYPE     │
    │ Plugin  │         │              ▼          │  MAPPER    │
    │         │         │     ┌────────────────┐  └────────────┘
    └─────────┘         │     │   ENSEMBLE     │  ┌────────────┐
          │             │     │    VOTER       │  │  QUALITY   │
          │             │     │ • Weighted     │  │  SCORER    │
          │             │     │ • Consensus    │  └────────────┘
          │             │     │ • Threshold    │  ┌────────────┐
          │             │     └────────────────┘  │DEDUPLICATOR│
          │             │                         └────────────┘
          ▼             ▼
    ┌─────────────────────────────────────────┐
    │      PROCESSORS (Plugins)               │
    │  ┌────────────┐ ┌────────────┐ ┌────────────┐
    │  │   SpaCy    │ │  Natasha   │ │  Stanza    │
    │  │ Processor  │ │ Processor  │ │ Processor  │
    │  │(~400 lines)│ │(~350 lines)│ │(~400 lines)│
    │  └────────────┘ └────────────┘ └────────────┘
    │     Use shared utilities, no duplication
    └─────────────────────────────────────────┘
```

### Benefits:
- **Single Responsibility:** Each component has one clear purpose
- **No Duplication:** Shared utilities used by all processors
- **Open/Closed:** Easy to add new processors (plugins) and modes (strategies)
- **Testable:** Each component can be tested in isolation
- **Loose Coupling:** Processors independent of manager

---

## Processing Flow Diagrams

### Single Mode Flow

```
User Request
    │
    ▼
┌────────────────┐
│ Multi-NLP      │
│ Manager        │
└────────────────┘
    │
    ▼
┌────────────────┐
│ Single         │
│ Strategy       │
└────────────────┘
    │
    ▼
┌────────────────┐      ┌────────────┐
│ Text Cleaner   │─────▶│ Clean Text │
└────────────────┘      └────────────┘
    │
    ▼
┌────────────────┐      ┌────────────┐
│ SpaCy          │─────▶│Descriptions│
│ Processor      │      └────────────┘
└────────────────┘
    │
    ▼
┌────────────────┐      ┌────────────┐
│ Description    │─────▶│ Filtered   │
│ Filter         │      │Descriptions│
└────────────────┘      └────────────┘
    │
    ▼
Return to User
```

### Parallel Mode Flow

```
User Request
    │
    ▼
┌────────────────┐
│ Multi-NLP      │
│ Manager        │
└────────────────┘
    │
    ▼
┌────────────────┐
│ Parallel       │
│ Strategy       │
└────────────────┘
    │
    ▼
┌────────────────┐      ┌────────────┐
│ Text Cleaner   │─────▶│ Clean Text │
└────────────────┘      └────────────┘
    │
    ├─────────────┬─────────────┬─────────────┐
    ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ SpaCy   │  │ Natasha │  │ Stanza  │
│Processor│  │Processor│  │Processor│
└─────────┘  └─────────┘  └─────────┘
    │             │             │
    └─────────────┴─────────────┘
                  │
                  ▼
         ┌────────────────┐      ┌────────────┐
         │ Deduplicator   │─────▶│  Unique    │
         │                │      │Descriptions│
         └────────────────┘      └────────────┘
                  │
                  ▼
         ┌────────────────┐      ┌────────────┐
         │ Description    │─────▶│  Filtered  │
         │ Filter         │      │Descriptions│
         └────────────────┘      └────────────┘
                  │
                  ▼
         Return to User
```

### Ensemble Mode Flow

```
User Request
    │
    ▼
┌────────────────┐
│ Multi-NLP      │
│ Manager        │
└────────────────┘
    │
    ▼
┌────────────────┐
│ Ensemble       │
│ Strategy       │
└────────────────┘
    │
    ▼
┌────────────────┐      ┌────────────┐
│ Text Cleaner   │─────▶│ Clean Text │
└────────────────┘      └────────────┘
    │
    ├─────────────┬─────────────┬─────────────┐
    ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ SpaCy   │  │ Natasha │  │ Stanza  │
│  w=1.0  │  │  w=1.2  │  │  w=0.8  │
└─────────┘  └─────────┘  └─────────┘
    │             │             │
    └─────────────┴─────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ Ensemble Voter │
         │ • Group similar│
         │ • Apply weights│
         │ • Consensus >0.6│
         └────────────────┘
                  │
                  ▼
         ┌────────────────┐      ┌────────────┐
         │ Description    │─────▶│  Best      │
         │ Filter         │      │Descriptions│
         └────────────────┘      └────────────┘
                  │
                  ▼
         Return to User
```

### Adaptive Mode Flow

```
User Request (text)
    │
    ▼
┌────────────────┐
│ Multi-NLP      │
│ Manager        │
└────────────────┘
    │
    ▼
┌────────────────┐
│ Adaptive       │
│ Strategy       │
└────────────────┘
    │
    ▼
┌────────────────────────────────┐
│ Text Analysis                  │
│ • Check length (>1000 words)   │
│ • Check names (regex patterns) │
│ • Check locations (keywords)   │
│ • Estimate complexity (0.0-1.0)│
└────────────────────────────────┘
    │
    ├──────────────────┬──────────────────┐
    │                  │                  │
    ▼                  ▼                  ▼
Complex Text     Medium Text       Simple Text
(complexity>0.8)  (2 processors)   (1 processor)
    │                  │                  │
    ▼                  ▼                  ▼
┌─────────┐      ┌─────────┐      ┌─────────┐
│ENSEMBLE │      │PARALLEL │      │ SINGLE  │
│ MODE    │      │  MODE   │      │  MODE   │
└─────────┘      └─────────┘      └─────────┘
    │                  │                  │
    └──────────────────┴──────────────────┘
                       │
                       ▼
              Return to User
```

---

## Plugin Architecture

```
┌──────────────────────────────────────────┐
│     PROCESSOR PLUGIN REGISTRY            │
├──────────────────────────────────────────┤
│ register(plugin)                         │
│ get_plugin(name) → ProcessorPlugin       │
│ list_plugins() → List[str]               │
└──────────────────────────────────────────┘
                  │
                  ├────────────┬────────────┬────────────┐
                  ▼            ▼            ▼            ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ SpaCy Plugin │ │Natasha Plugin│ │ Stanza Plugin│
         ├──────────────┤ ├──────────────┤ ├──────────────┤
         │ name: "spacy"│ │name:"natasha"│ │ name:"stanza"│
         │ version: 1.0 │ │ version: 1.0 │ │ version: 1.0 │
         ├──────────────┤ ├──────────────┤ ├──────────────┤
         │create_       │ │create_       │ │create_       │
         │processor()   │ │processor()   │ │processor()   │
         └──────────────┘ └──────────────┘ └──────────────┘
                  │            │            │
                  ▼            ▼            ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │   SpaCy      │ │   Natasha    │ │   Stanza     │
         │  Processor   │ │  Processor   │ │  Processor   │
         └──────────────┘ └──────────────┘ └──────────────┘

Benefits:
• Easy to add new processors without modifying core code
• Third-party processors supported
• Version management per processor
• Clean separation of concerns
```

---

## Strategy Pattern for Modes

```
┌──────────────────────────────────────────┐
│         STRATEGY FACTORY                 │
├──────────────────────────────────────────┤
│ register(mode, strategy)                 │
│ get(mode) → ProcessingStrategy           │
└──────────────────────────────────────────┘
                  │
                  ├────────┬────────┬────────┬────────┐
                  ▼        ▼        ▼        ▼        ▼
          ┌─────────┐┌─────────┐┌──────────┐┌─────────┐┌─────────┐
          │ Single  ││Parallel ││Sequential││Ensemble ││Adaptive │
          │Strategy ││Strategy ││ Strategy ││Strategy ││Strategy │
          └─────────┘└─────────┘└──────────┘└─────────┘└─────────┘
               │          │          │          │          │
               └──────────┴──────────┴──────────┴──────────┘
                                     │
                   All implement ProcessingStrategy interface:
                   • process(text, processors) → ProcessingResult
                   • estimate_processing_time(text_length) → float

Benefits:
• Open/Closed Principle: Add new modes without changing manager
• Each strategy isolated and testable
• Easy to A/B test different strategies
• Clear separation of mode logic
```

---

## Shared Utilities Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  SHARED UTILITIES                        │
└──────────────────────────────────────────────────────────┘
    │
    ├─────────────┬─────────────┬─────────────┬─────────────┐
    ▼             ▼             ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│  TEXT   │  │DESC.    │  │  TYPE   │  │QUALITY  │  │DEDUPLI- │
│ CLEANER │  │ FILTER  │  │ MAPPER  │  │ SCORER  │  │ CATOR   │
└─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘
    │             │             │             │             │
    ▼             ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│            Used by ALL processors                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│  │  SpaCy   │    │ Natasha  │    │  Stanza  │             │
│  │Processor │    │Processor │    │Processor │             │
│  └──────────┘    └──────────┘    └──────────┘             │
└─────────────────────────────────────────────────────────────┘

Benefits:
• No code duplication (from 40% to <10%)
• Consistent behavior across all processors
• Single source of truth
• Easier to maintain and test
• ~400 lines of code reduction
```

---

## Data Flow: Book Processing

```
┌──────────────────────────────────────────────────────────┐
│                   USER UPLOADS BOOK                      │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │   BOOK PARSER      │
              │ • Extract chapters │
              │ • Extract metadata │
              └────────────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │   CHAPTERS         │
              │ Chapter 1: "..."   │
              │ Chapter 2: "..."   │
              │ ...                │
              └────────────────────┘
                          │
                          ▼
              ┌────────────────────────────┐
              │   MULTI-NLP MANAGER        │
              │ Mode: ENSEMBLE             │
              │ Processors: SpaCy, Natasha │
              └────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
    ┌──────────────┐            ┌──────────────┐
    │ Chapter 1    │            │ Chapter 2    │
    │ Processing   │            │ Processing   │
    └──────────────┘            └──────────────┘
            │                           │
            ▼                           ▼
    ┌──────────────┐            ┌──────────────┐
    │Descriptions  │            │Descriptions  │
    │• 127 desc.   │            │• 105 desc.   │
    │• 4.2s        │            │• 3.8s        │
    └──────────────┘            └──────────────┘
            │                           │
            └─────────────┬─────────────┘
                          ▼
              ┌────────────────────┐
              │ PRIORITY QUEUE     │
              │ (Image Generation) │
              └────────────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │   GENERATED        │
              │   IMAGES           │
              │ • pollinations.ai  │
              └────────────────────┘
                          │
                          ▼
              ┌────────────────────┐
              │   READER UI        │
              │ • Text + Images    │
              │ • Modal on click   │
              └────────────────────┘
```

---

## Performance Optimization Points

```
┌────────────────────────────────────────────────────────┐
│           OPTIMIZATION OPPORTUNITIES                   │
└────────────────────────────────────────────────────────┘

1. PARALLEL MODEL LOADING (-50% init time)
   ┌─────────────────────────────────────┐
   │ Current: Sequential (6-10 seconds)  │
   │ SpaCy  ████ 3s                      │
   │ Natasha ██ 2s                       │
   │ Stanza  █████ 5s                    │
   │ Total: 10s                          │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Optimized: Parallel (3-5 seconds)   │
   │ SpaCy  ████                         │
   │ Natasha ██                          │
   │ Stanza  █████                       │
   │ Total: 5s (max of three)            │
   └─────────────────────────────────────┘

2. SHARED TEXT PREPROCESSING (-10% processing)
   ┌─────────────────────────────────────┐
   │ Current: 3x text cleaning           │
   │ Clean → SpaCy                       │
   │ Clean → Natasha                     │
   │ Clean → Stanza                      │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Optimized: 1x text cleaning         │
   │ Clean → All processors              │
   └─────────────────────────────────────┘

3. OPTIMIZED DEDUPLICATION (-5% processing)
   ┌─────────────────────────────────────┐
   │ Current: O(n²) comparison           │
   │ Compare each desc with all others   │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Optimized: O(n) set-based           │
   │ Hash-based deduplication            │
   └─────────────────────────────────────┘

4. RESULT CACHING (Variable improvement)
   ┌─────────────────────────────────────┐
   │ Cache key: text_hash + mode         │
   │ Hit: Return cached (instant)        │
   │ Miss: Process and cache             │
   │ LRU eviction (max 100 entries)      │
   └─────────────────────────────────────┘

5. BATCH PROCESSING (+20% throughput)
   ┌─────────────────────────────────────┐
   │ Current: 1 chapter at a time        │
   │ Ch1 → Process → Ch2 → Process       │
   └─────────────────────────────────────┘

   ┌─────────────────────────────────────┐
   │ Optimized: Batch of 5 chapters      │
   │ [Ch1,Ch2,Ch3,Ch4,Ch5] → Parallel    │
   │ Better CPU/GPU utilization          │
   └─────────────────────────────────────┘
```

---

## File Structure Comparison

### Before (Current)
```
backend/app/services/
├── multi_nlp_manager.py        (627 lines) ⚠️ God Object
├── nlp_processor.py            (567 lines) ⚠️ DEPRECATED
├── enhanced_nlp_system.py      (610 lines) ⚠️ SpaCy + Base
├── natasha_processor.py        (486 lines)
└── stanza_processor.py         (519 lines)
Total: 2,809 lines

Problems:
• 40% code duplication
• Manager too complex (627 lines)
• Legacy code (nlp_processor.py)
• Poor separation of concerns
```

### After (Target)
```
backend/app/services/nlp/
├── __init__.py
├── manager.py                  (<300 lines) ✅ Simplified
├── processor_registry.py       (100 lines) ✅ Plugin system
├── config_loader.py            (150 lines) ✅ Config management
├── exceptions.py               (50 lines)  ✅ Custom exceptions
├── logging_config.py           (80 lines)  ✅ Structured logging
│
├── utils/
│   ├── text_cleaner.py         (40 lines)  ✅ Shared
│   ├── description_filter.py   (100 lines) ✅ Shared
│   ├── type_mapper.py          (60 lines)  ✅ Shared
│   ├── quality_scorer.py       (80 lines)  ✅ Shared
│   └── deduplicator.py         (60 lines)  ✅ Shared
│
├── strategies/
│   ├── base.py                 (50 lines)  ✅ Interface
│   ├── single.py               (80 lines)  ✅ Strategy
│   ├── parallel.py             (100 lines) ✅ Strategy
│   ├── sequential.py           (90 lines)  ✅ Strategy
│   ├── ensemble.py             (120 lines) ✅ Strategy
│   └── adaptive.py             (130 lines) ✅ Strategy
│
├── voting/
│   ├── ensemble_voter.py       (100 lines) ✅ Voting logic
│   └── weighted_consensus.py   (80 lines)  ✅ Algorithm
│
└── processors/
    ├── spacy_processor.py      (~400 lines) ✅ No duplication
    ├── natasha_processor.py    (~350 lines) ✅ No duplication
    └── stanza_processor.py     (~400 lines) ✅ No duplication

Total: ~2,400 lines (14% reduction)

Benefits:
• <10% code duplication (75% improvement)
• Clear separation of concerns
• Easy to test each component
• Easy to extend (plugins, strategies)
```

---

## Summary

### Current Architecture Issues:
1. **God Object:** 627-line manager
2. **Code Duplication:** 40% across processors
3. **Rigid Design:** Hard to add processors/modes
4. **Poor Testability:** Complex dependencies

### Target Architecture Benefits:
1. **Clean Separation:** Each component has one responsibility
2. **No Duplication:** Shared utilities (<10% duplication)
3. **Extensible:** Plugin system for processors, Strategy pattern for modes
4. **Testable:** Isolated components, easy to mock
5. **Performance:** Optimized initialization and processing

### Expected Improvements:
- **Code Quality:** 40% → <10% duplication
- **Test Coverage:** ~5% → >80%
- **Initialization:** 6-10s → 3-5s (50% faster)
- **Processing:** 4s → 3.2-3.6s (10-20% faster)
- **Maintainability:** Manager 627 → <300 lines (52% simpler)

---

**Status:** Ready for implementation
**Next Step:** Phase 1 refactoring (foundation + tests)

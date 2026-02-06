# LLM Techniques for Fiction Book Processing: Research Report

**Date:** 2026-02-06
**Project:** fancai
**Purpose:** Specialized web research on LLM techniques for entity extraction, knowledge graphs, description extraction, and spoiler-free systems for fiction books.

---

## Table of Contents

1. [Entity Extraction from Fiction with LLMs](#topic-1-entity-extraction-from-fiction-with-llms)
2. [Entity Deduplication and Resolution](#topic-2-entity-deduplication-and-resolution)
3. [Spoiler-Free Knowledge Systems](#topic-3-spoiler-free-knowledge-systems)
4. [Book Knowledge Graphs](#topic-4-book-knowledge-graphs)
5. [Chunking Strategies for Long Texts](#topic-5-chunking-strategies-for-long-texts)
6. [Description Extraction and Image Prompt Engineering](#topic-6-description-extraction-and-image-prompt-engineering)
7. [Gemini API Best Practices 2026](#topic-7-gemini-api-best-practices-2026)

---

## Topic 1: Entity Extraction from Fiction with LLMs

### Priority: Critical

### Sources Found

| Source | Description |
|--------|-------------|
| [Recall Them All (ACL 2025)](https://acl-bg.org/proceedings/2025/LM4DH%202025/pdf/2025.lm4dh-1.13.pdf) | Research on extracting long entity lists from entire novels using LLMs with RAG |
| [BookNLP (GitHub)](https://github.com/booknlp/booknlp) | Python NLP pipeline specifically for book-length documents: NER, coreference, character clustering |
| [LitBank (GitHub)](https://github.com/dbamman/litbank) | Annotated dataset of 100 works of fiction (210K tokens) for NER, events, coreference |
| [LangExtract (Google)](https://github.com/google/langextract) | Google's Gemini-powered extraction library with source grounding and character offsets |
| [Structured Entity Extraction (arXiv)](https://arxiv.org/html/2402.04437v3) | Multi-stage decomposition approach for entity extraction with LLMs |
| [Databricks: Batch Entity Extraction](https://community.databricks.com/t5/technical-blog/end-to-end-structured-extraction-with-llm-part-1-batch-entity/ba-p/98396) | End-to-end structured extraction with LLMs, single-pass vs multi-pass comparison |
| [Too Long, Didn't Model (arXiv 2025)](https://arxiv.org/abs/2505.14925) | Benchmark showing no frontier LLM retains stable understanding beyond 64K tokens |

### Key Findings

**1. Single-Pass vs Multi-Pass Extraction**

Research shows that separating generation from structuring consistently boosts precision. The two-step pipeline:
- Step 1: LLM generates answers in natural language as intermediate responses
- Step 2: LLM organizes the output into desired structure using those intermediate responses

This reduces the pressure of completing two orthogonal tasks (understanding content + formatting output) simultaneously. Adding zero-shot Chain of Thought (CoT) further improves extraction via self-verification.

**2. BookNLP: The Gold Standard Pipeline**

BookNLP provides a complete pipeline for book-length documents:
- Character name clustering: "Tom" + "Tom Sawyer" + "Mr. Sawyer" -> TOM_SAWYER
- Entity tagging trained on 968K tokens including LitBank
- Coreference resolution connecting pronouns to named entities
- Limitation: first-person novels perform significantly worse than third-person

**3. The "Recall Them All" L3X Method**

Two-stage approach for extracting complete entity lists from books:
- Stage 1: Recall-oriented generation with RAG augmentation
- Stage 2: Precision-oriented scrutinization to validate/prune candidates
- Chunks text into 15-sentence passages (~1000 chars) with sentence-overlapping passages
- Key insight: considers ALL sentence-overlapping passages to catch coreferences

**4. LangExtract: Google's Official Extraction Library**

Released as open-source (Apache 2.0), directly relevant to fancai:
- Source grounding with exact character offsets
- Intelligent chunking that respects sentence/paragraph boundaries
- Multiple extraction passes for higher recall (leverages LLM stochasticity)
- Successfully processed full text of Romeo and Juliet (147K chars)
- Supports Gemini models natively + local models via Ollama

**5. Multi-Stage Parallel Generation**

Decomposes extraction into multiple stages where all predictions can be processed in parallel within each stage:
- Reduces output tokens through special tokens replacing multiple tokens
- Each stage focuses on sub-tasks for enhanced accuracy
- Particularly effective for entity extraction with many entity types

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| Extraction approach | Single call: descriptions + entities + relationships | Multi-pass: extract first, then classify, then enrich | Medium |
| Prompt strategy | Zero-shot with detailed instructions | Few-shot with chain-of-thought reasoning | Small |
| Source grounding | LLM-provided offsets + string matching fallback | Character-level offsets with source validation (LangExtract) | Small (fancai TSA is good) |
| Entity validation | Name present in source text check | Multiple validation passes + scrutinization | Medium |
| Structured output | Pydantic schema via Gemini structured output | Same approach (industry standard) | None |
| Chunking | 100K char recursive chunking | Chapter-based + semantic boundaries + overlap | See Topic 5 |

### Specific Recommendations

1. **[Critical] Add Few-Shot Examples to Extraction Prompt**: The current prompt has good instructions but no few-shot examples of complete input/output pairs. Research shows few-shot examples dramatically improve extraction quality. Add 1-2 complete examples showing an input text chunk and the expected full JSON response.

2. **[Important] Consider Two-Pass Extraction for Complex Texts**: For books with many characters (>30), run a first pass for entity extraction only, then a second pass enriching each entity with visual summaries and relationships. The current single-call approach works well for simpler texts but may degrade for complex ensemble casts.

3. **[Important] Evaluate LangExtract for Description Extraction**: Google's LangExtract library solves the exact same problem fancai's TSA system solves (extracting spans with offsets), but with multiple passes for higher recall. The library was specifically built for Gemini. Note: fancai previously evaluated LangExtract and found it returned NER entities instead of descriptions. The library has since been updated significantly.

4. **[Nice-to-have] Add Entity Validation Pass**: After extraction, run a quick validation pass that checks each entity against the source text with fuzzy matching, ensuring no hallucinated entities slip through.

---

## Topic 2: Entity Deduplication and Resolution

### Priority: Critical

### Sources Found

| Source | Description |
|--------|-------------|
| [LlmLink: Dual LLMs for Entity Linking (COLING 2025)](https://aclanthology.org/2025.coling-main.751/) | Dual LLM approach for entity linking in long narratives with collaborative memorisation |
| [Coreference Resolution in Full-Length French Fiction](https://arxiv.org/html/2510.15594v1) | 285K tokens of coreference annotations across 3 novels |
| [Improving LLMs' Learning of Coreference Resolution](https://arxiv.org/html/2509.11466v1) | Reversed Training with Joint Inference to eliminate hallucinations in coref |
| [iText2KG: Incremental Knowledge Graphs](https://arxiv.org/html/2409.03284v1) | Incremental KG construction with entity resolution across documents |
| [Incremental Entity Extraction (ACM 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3579051.3579063) | Incremental extraction with background knowledge and entity linking |
| [Semantic Entity Resolution (Towards Data Science)](https://towardsdatascience.com/the-rise-of-semantic-entity-resolution/) | Modern embedding-based entity resolution approaches |
| [Pre-trained Embeddings for Entity Resolution (VLDB)](https://www.vldb.org/pvldb/vol16/p2225-skoutas.pdf) | Experimental analysis of embeddings for entity resolution |
| [Incremental Entity Summarization Benchmark (arXiv 2024)](https://arxiv.org/html/2406.05079v1) | MERGE vs UPDATE method: merge is superior for incremental entity enrichment |

### Key Findings

**1. LlmLink: Dual LLM Architecture for Long Narratives**

The most directly relevant research for fancai. Key innovations:
- Assigns specialized LLMs to local NER and distant coreference tasks
- Coreference LLM memorises characters and their descriptions
- Reduces token consumption vs storing full conversation history
- Automatic prompt optimisation to reduce hallucinations
- Outperforms single-LLM approaches and fine-tuning methods

**2. MERGE vs UPDATE for Incremental Entity Enrichment**

Critical finding for fancai's chapter-by-chapter processing:
- **MERGE method** (two steps): First extract entities from new chapter, then merge with existing entity table
- **UPDATE method** (one step): Directly update existing entity table with new chapter info
- MERGE consistently outperforms UPDATE because it reduces LLM cognitive load
- MERGE is particularly beneficial for maintaining recall scores

**3. Embedding-Based Deduplication**

Sentence transformers (e.g., all-MiniLM-L6-v2) for entity deduplication:
- Generate embeddings for entity names + visual summaries
- Cosine similarity threshold: 0.85-0.95 range for fiction characters
- FAISS for scalable approximate nearest neighbor search
- Advantage over string matching: catches semantic duplicates like "The Boy Who Lived" = "Harry Potter"

**4. Error Propagation in Incremental Processing**

Major challenge: errors in early chapters propagate to later chapters
- Incorrectly merged entities are hard to un-merge later
- Human-in-the-loop validation after each batch reduces error propagation
- Solution: conservative merge thresholds + periodic re-analysis

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| String matching | SequenceMatcher > 0.85 | Embedding-based similarity + string matching hybrid | Medium |
| LLM dedup | Gemini-based semantic merge (good!) | Dual LLM with memorisation (LlmLink) | Small |
| Incremental merge | Per-chapter extraction, then LLM dedup | MERGE method: extract from new, then merge with existing | Medium |
| Alias handling | LLM-extracted aliases | Alias + coreference resolution chain | Medium |
| Pronoun resolution | Not handled | LlmLink coreference resolution | Large |
| Threshold tuning | Fixed 0.85 threshold | Adaptive thresholds per entity type | Small |

### Specific Recommendations

1. **[Critical] Add Embedding-Based Similarity as First Pass**: Before the LLM dedup call, run a fast embedding similarity check (sentence-transformers) to pre-group likely duplicates. This reduces the number of entities sent to the LLM and catches semantic matches that string matching misses (e.g., "Dumbledore" vs "The Headmaster").

2. **[Critical] Implement MERGE Method for Chapter Processing**: When processing a new chapter, first extract entities independently, then explicitly merge with existing entity table. The current approach does extraction per-chunk but doesn't explicitly present existing entities to the LLM for merge context.

3. **[Important] Add Coreference-Aware Entity Extraction**: The current system extracts entities from text but doesn't resolve pronouns. Research shows that even basic pronoun resolution (linking "he" to the most recently mentioned character) significantly improves entity mention tracking and relationship extraction.

4. **[Nice-to-have] Implement Confidence Decay for Stale Entities**: Entities not mentioned for many chapters should have their importance scores gradually decay, reflecting their diminishing narrative relevance.

---

## Topic 3: Spoiler-Free Knowledge Systems

### Priority: Critical

### Sources Found

| Source | Description |
|--------|-------------|
| [Spliki: The Anti-Spoiler Wiki](https://spliki.com/) | Wiki with chapter-gated content filtering for Wheel of Time, Stormlight Archive |
| [Spliki FAQ](https://spliki.com/faq/) | Technical implementation details of chapter-gated filtering |
| [Malazan Wiki: New Readers Zone](https://malazan.fandom.com/wiki/Malazan_Wiki:New_Readers_Zone) | Book-by-book safe browsing for complex fantasy series |
| [MediaWiki Extension:Spoilers](https://www.mediawiki.org/wiki/Extension:Spoilers) | MediaWiki extension for spoiler hiding/revealing |
| [Fandom: Spoiler Handling](https://community.fandom.com/wiki/Help:Spoilers) | CSS-based spoiler blur and collapsible spoiler sections |
| [SpoilerProtection Chrome Extension](https://chromewebstore.google.com/detail/spoilerprotection/eelacikjiplnmdingehjfdjcfegclmkg) | Browser extension for spoiler filtering |

### Key Findings

**1. Spliki: The Most Advanced Spoiler-Free Wiki**

Spliki is the closest existing system to fancai's spoiler-free entity glossary:
- Every section of an article is assigned to a specific chapter/episode
- Users set a "bookmark" indicating their reading progress
- Content is automatically filtered to show only pre-bookmark information
- Writers manually assign chapter tags to each content section
- Sections can be shown AND hidden again if they stop being relevant
- Currently supports Wheel of Time and Stormlight Archive

Key difference from fancai: **Spliki uses manual human curation** while fancai uses AI-automated extraction.

**2. Malazan Wiki's Approach**

The Malazan Book of the Fallen series (10 books, extremely complex) uses:
- Separate wiki zones: "New Readers Zone" with safe links per book
- Manual curation of which information is safe at each book stage
- Limitation: very labor-intensive, often incomplete

**3. Common UX Patterns for Spoiler Protection**

- **Blur/Collapse**: CSS blur with click-to-reveal (simple but binary: either all or nothing)
- **Chapter gating**: Show content up to reader's current chapter (Spliki, fancai)
- **Expiration dates**: Some wikis remove spoiler tags after a time period
- **Mobile challenges**: CSS-based solutions often break on mobile (Fandom wikis)

**4. Edge Cases Identified**

- **Flashbacks**: Character revealed in Ch. 15 to have been present in Ch. 3 scene
- **Foreshadowing**: Subtle hints that gain meaning only later
- **Unreliable narrators**: Character descriptions may be intentionally misleading
- **Name reveals**: Character known as "Stranger" revealed to be "Gandalf"
- **Death spoilers**: Character alive in early chapters, death info must be hidden

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Best Practice (Spliki etc.) | Gap |
|--------|---------------|---------------------------|-----|
| Gating mechanism | CFI-based (character position in EPUB) | Chapter-based with manual section assignment | fancai is more precise |
| Content generation | AI-automated extraction | Manual human curation | fancai is more scalable |
| Entity info updates | Visual summary from latest visible chapter | Sections that can appear/disappear per chapter | Medium |
| Flashback handling | Not explicitly handled | Manual curation handles this | Large |
| Name reveal handling | Aliases tracked but not gated | Sections assigned to reveal chapter | Medium |
| Multi-book series | Not supported | Spliki supports book-level gating | Large |

### Specific Recommendations

1. **[Critical] Handle Entity Name Reveals**: When a character is known by different names at different points in the story (e.g., "The Stranger" in Ch. 1-5, "Gandalf" from Ch. 6 onwards), the entity card should show only the name the reader currently knows. Store chapter-gated alias associations.

2. **[Important] Add Chapter-Level Entity Summary Snapshots**: Instead of a single `visual_summary` per entity, store per-chapter snapshots. When the reader is at Chapter 5, show the summary as of Chapter 5. This prevents subtle spoilers from later description changes (e.g., "scarred face" before the scarring event happens).

3. **[Important] Handle Relationship Spoilers**: Entity relationships should also be chapter-gated. Don't show "Father of X" relationship if the parentage is revealed in a later chapter.

4. **[Nice-to-have] Add Spoiler Confidence Scoring**: For AI-extracted info, add a confidence score for how likely each piece of information is a spoiler. Flag ambiguous cases for human review.

---

## Topic 4: Book Knowledge Graphs

### Priority: Important

### Sources Found

| Source | Description |
|--------|-------------|
| [Extraction and Analysis of Fictional Character Networks (ACM)](https://dl.acm.org/doi/abs/10.1145/3344548) | Comprehensive survey of character network extraction methods |
| [HTEKG: Human-Trait-Enhanced Literary KG (KEOD 2024)](https://www.scitepress.org/Papers/2024/130136/130136.pdf) | Knowledge graph with character traits, tested with GPT-4 |
| [EvolvTrip: Temporal Theory-of-Mind Graphs (arXiv 2025)](https://arxiv.org/html/2506.13641) | Temporal graphs tracking character mental state evolution |
| [iText2KG: Incremental KG Construction](https://github.com/AuvaLab/itext2kg) | Zero-shot incremental KG with LLMs, async architecture |
| [Hierarchical KGs for Story Understanding (arXiv 2025)](https://arxiv.org/abs/2506.10008) | Multi-level narrative KGs: panel, event, macro-event |
| [Character Network (GitHub)](https://github.com/hzjken/character-network) | Harry Potter character network with entity recognition and sentiment analysis |
| [ReaGraph (GitHub)](https://github.com/reaviz/reagraph) | WebGL Graph Visualizations for React (alternative to react-force-graph) |

### Key Findings

**1. HTEKG: Character Traits in Knowledge Graphs**

Traditional literary KGs focus on events, ignoring character traits. HTEKG combines:
- Event-centered facts (who did what)
- Character personality traits (brave, cunning, etc.)
- Physical description attributes
- Tested integration with BERT classifiers and GPT-4
- Enhanced query capabilities for literary analysis

**2. EvolvTrip: Temporal Evolution of Character States**

Tracks how characters change over the narrative:
- Perspective-aware temporal knowledge graph
- Transforms implicit character psychology into explicit relation triples
- Triples evolve throughout the narrative arc
- Directly applicable to fancai's spoiler-free system: each chapter has its own state

**3. iText2KG: Best Practice for Incremental KG Construction**

Most relevant framework for fancai's architecture:
- Zero-shot, topic-independent KG construction
- Four modules: Document Distiller, Incremental Entity Extractor, Incremental Relation Extractor, Graph Integrator
- Global entity set continuously updated with new documents
- 2025 update: async architecture, dynamic KGs that evolve over time
- iText2KG_Star variant: extracts relationships directly, derives entities from relationships (simpler pipeline)

**4. Visualization Alternatives**

Beyond react-force-graph:
- **ReaGraph**: WebGL-based graph visualization for React with 3D support
- **force-graph-3d**: 3D force-directed graphs using WebGL (good for large graphs)
- **Visx**: Low-level D3 components for React, maximum customization
- **Nivo**: D3-based with motion/theming support

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| Graph algorithms | PageRank + Louvain community detection | PageRank + Betweenness Centrality + Leiden (improved Louvain) | Small |
| Character traits | Visual summary only | Explicit trait attributes (HTEKG) | Medium |
| Temporal evolution | No temporal tracking | Per-chapter state snapshots (EvolvTrip) | Large |
| Incremental building | Per-chapter extraction, no carry-over context | Incremental with global entity set (iText2KG) | Medium |
| Relationship types | Generic "related" with weight | Typed relationships (family, enemy, ally, mentor) | Medium |
| Visualization | Not specified in backend | WebGL options available for frontend | N/A |

### Specific Recommendations

1. **[Important] Add Typed Relationships**: Replace generic "related" relationship type with specific types: family, romantic, enemy, ally, mentor, servant, colleague, etc. This enables richer graph queries and better UI in the entity glossary.

2. **[Important] Add Betweenness Centrality Alongside PageRank**: PageRank measures overall importance, but Betweenness Centrality identifies "bridge" characters who connect different groups. This is valuable for identifying characters like Gandalf who connect the Shire storyline to the Rohan storyline.

3. **[Nice-to-have] Implement Temporal Graph Snapshots**: Store graph state per chapter. This enables "relationship timeline" views showing how the character network evolves through the book.

4. **[Nice-to-have] Consider Leiden Algorithm**: Replace Louvain with Leiden community detection. Leiden provides more stable and accurate community assignments, particularly for graphs with weak inter-community connections.

---

## Topic 5: Chunking Strategies for Long Texts

### Priority: Critical

### Sources Found

| Source | Description |
|--------|-------------|
| [Too Long, Didn't Model (arXiv 2025)](https://arxiv.org/abs/2505.14925) | No frontier LLM retains stable understanding beyond 64K tokens |
| [Context Rot (Chroma Research)](https://research.trychroma.com/context-rot) | Performance degrades as context length increases across all models |
| [Gemini Long Context Docs](https://ai.google.dev/gemini-api/docs/long-context) | Official Gemini guidance on long context usage |
| [Gemini 1M Token Issues](https://www.smithstephen.com/p/geminis-million-token-promise-you) | Real-world reports of Gemini degrading after 32K tokens |
| [Dynamic Chunking and Selection (ACL 2025)](https://aclanthology.org/2025.acl-long.1538.pdf) | Dynamic chunking for ultra-long context reading comprehension |
| [Pinecone: Chunking Strategies](https://www.pinecone.io/learn/chunking-strategies/) | Comprehensive guide to chunking approaches |
| [Redis: LLM Chunking](https://redis.io/blog/llm-chunking/) | Hybrid approaches with context enrichment |
| [IEEE: Text Chunking Performance Analysis](https://ieeexplore.ieee.org/document/11206896/) | Comparison of Fixed-Length, Recursive, Sliding Window, and Semantic Chunking |

### Key Findings

**1. The 1M Context Window Myth**

Critical finding for fancai's 100K char chunking strategy:
- **TLDM benchmark (May 2025)**: None of 7 frontier LLMs retain stable understanding beyond 64K tokens
- **Gemini 3 Pro MRCR v2**: Drops from 77% at 128K tokens to 26.3% at 1M tokens
- **Real-world reports**: Users report Gemini degrading after ~32K tokens
- **Context rot**: Performance degradation occurs across ALL models as context length increases

**fancai's current 100K char (~25K-35K tokens) chunks are actually well-sized**, falling within the reliable extraction window.

**2. Chapter-Based vs Fixed-Size Chunking**

Research findings:
- Chapter-based chunking preserves narrative coherence and entity context
- Fixed-size chunking is simpler but may split mid-scene or mid-dialogue
- Hybrid approach recommended: chapter boundaries as primary splits, with fixed-size as secondary when chapters exceed context limits
- Adding a brief summary of previous text to each chunk helps answer cross-chunk questions

**3. Overlap and Context Carry-Over**

- fancai's 15% overlap is standard (research recommends 10-20%)
- Better approach: **entity carry-over** instead of raw text overlap
- Include a list of known entities with current descriptions at the start of each chunk
- This is more token-efficient than text overlap and maintains entity continuity

**4. Semantic Chunking**

- Groups text by meaning rather than arbitrary boundaries
- Better for RAG but potentially worse for sequential extraction
- For fiction: chapter-based > semantic > fixed-size for entity extraction tasks

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| Chunk size | 100K chars (~25-35K tokens) | 32-64K tokens max for reliable extraction | Actually good! |
| Chunking method | Recursive text chunker (paragraph -> sentence -> word) | Chapter-based primary + recursive secondary | Medium |
| Overlap | 15% raw text overlap | Entity carry-over + summary prefix | Medium |
| Context enrichment | None | Previous chunk summary + known entity list | Large |
| Adaptive sizing | Fixed max_chunk_chars | Dynamic based on content density | Small |

### Specific Recommendations

1. **[Critical] Add Chapter-Aware Chunking**: Use EPUB chapter boundaries as the primary split points instead of fixed character counts. Most EPUB chapters are 5K-30K tokens, well within Gemini's reliable extraction window. Only apply recursive sub-chunking for unusually long chapters.

2. **[Critical] Add Entity Carry-Over Between Chunks**: Instead of raw text overlap, prepend each chunk with a compact list of entities already extracted from previous chunks. Format: "Known characters in this text so far: Aragorn (aliases: Strider, Elessar), Gandalf (aliases: Mithrandir)...". This prevents duplicate entity creation and maintains context.

3. **[Important] Add Previous Chunk Summary**: Include a 2-3 sentence summary of the previous chunk's narrative context. This helps the LLM understand ongoing scenes that span chunk boundaries.

4. **[Nice-to-have] Reduce Max Chunk Size to 50K chars**: While 100K chars works, research consistently shows extraction quality degrades after 64K tokens. Reducing to 50K chars (~15K tokens) would stay well within the reliable window while still being efficient.

---

## Topic 6: Description Extraction and Image Prompt Engineering

### Priority: Important

### Sources Found

| Source | Description |
|--------|-------------|
| [LLMs Behind the Scenes: Narrative Scene Illustration (arXiv 2025)](https://arxiv.org/abs/2509.22940) | Pipeline for automatic narrative illustration, SceneIllustrations dataset |
| [LLM Blueprint: Complex Prompt Generation (arXiv)](https://arxiv.org/abs/2310.10640) | LLM-based extraction of bounding boxes, descriptions, and backgrounds from text |
| [Imagen 4 Prompt Guide](https://gpt4oimageprompt.com/pages/blog/imagen-4-prompt-guide.html) | Comprehensive prompting guide for Imagen 4 |
| [Imagen 4 Prompting Guide (Atlabs)](https://www.atlabs.ai/blog/imagen-4-prompting-guide) | Tips, tricks, and examples for Imagen 4 |
| [AI Image Generation with Gemini and Imagen 2026](https://www.wear-your-imagination.com/en/ai-image-generation-gemini-imagen) | Guide for Imagen integration with Gemini |
| [Literary Translation Quality with LLMs (NAACL 2025)](https://aclanthology.org/2025/naacl-long.548.pdf) | Assessment of LLM translation quality for literature |
| [SpanCat (Explosion)](https://explosion.ai/blog/spancat) | Span categorization as alternative to token-based NER |

### Key Findings

**1. Narrative Scene Illustration Pipeline**

The "LLMs Behind the Scenes" paper (Sep 2025) directly addresses fancai's use case:
- Pipeline: Story text -> LLM scene analysis -> Image prompt -> Text-to-image generation
- LLMs can effectively "verbalize scene knowledge implicitly evoked by story text"
- Released SceneIllustrations dataset for benchmarking
- Key finding: LLM-generated prompts that elaborate on implicit visual details produce better illustrations than literal text extraction

**2. LLM Blueprint: Structured Visual Extraction**

A more structured approach to extracting visual information:
- LLM extracts: bounding box coordinates, detailed object descriptions, background context
- Separates foreground objects from background
- Each element gets an individual description for the image generator
- Produces significantly better compositions than single-prompt approaches

**3. Imagen 4 Prompt Engineering (2026)**

Key best practices for fancai's image generation:
- **Structure prompts**: Motif first, then context + style (e.g., "A warrior standing in a forest, medieval fantasy, golden hour lighting")
- **Text rendering**: Imagen 4 handles text up to 18-25 characters well
- **Composition**: Specify camera angle (bird's eye, eye-level), lens type (35mm, 85mm), composition rules (rule of thirds)
- **Style keywords**: "photorealistic", "digital painting", "watercolor", "concept art" significantly affect output
- **Resolution**: Supports 1K-2K output with extended features (June 2025 update)
- **Negative prompts**: Not directly supported but can be approximated through specific style descriptions

**4. TSA (Tagged Span Annotation) Analysis**

fancai's TSA approach (XML tags around descriptions in original text) is somewhat unique:
- SpanCat (spaCy) uses a similar concept: span categorization with overlapping annotations
- Most research uses either token-level NER or full-text extraction, not in-place tagging
- TSA's advantage: preserves exact source text and position
- TSA's disadvantage: LLM must reproduce the entire text with tags, increasing output tokens
- Alternative: LangExtract's approach of extracting spans with character offsets is more token-efficient

**5. Translation Quality for Image Prompts**

Research on RU->EN literary translation with lightweight models:
- Gemini 2.0 Flash Lite has "significantly worse" translation quality than Flash/Pro
- For literary descriptions, semantic accuracy matters more than fluency
- fancai's current approach (Gemini 2.0 Flash Lite for translation) may be producing suboptimal image prompts
- Recommendation: Use at least Gemini 2.5 Flash or Gemini 3 Flash for translation of visual descriptions

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| Description extraction | TSA (in-place XML tagging) | Offset-based extraction (LangExtract style) | Small (TSA works) |
| Image prompt generation | Direct translation of extracted text | LLM-enhanced elaboration of implicit visual details | Large |
| Prompt structure | Extracted text -> translation -> Imagen | Text -> LLM analysis -> structured prompt with composition | Large |
| Translation model | Gemini 2.0 Flash Lite | Gemini 3 Flash (better literary quality) | Medium |
| Style control | Not specified | Per-scene style templates (landscape, portrait, atmosphere) | Medium |

### Specific Recommendations

1. **[Critical] Add LLM-Enhanced Prompt Generation**: Instead of directly translating extracted descriptions to English for Imagen, add an intermediate "prompt engineering" step where Gemini transforms the literary description into an optimized image prompt. Include composition (camera angle, framing), style (digital painting, watercolor), and elaborate on implicit visual details.

2. **[Important] Upgrade Translation Model**: Replace Gemini 2.0 Flash Lite with Gemini 3 Flash for translation of visual descriptions. The cost difference is minimal, but translation quality is significantly better for literary content. Reserve Flash Lite for truly high-volume, low-quality-bar tasks.

3. **[Important] Add Style Templates per Description Type**: Create prompt templates:
   - LOCATION: Include wide-angle composition, environment lighting, architectural style
   - CHARACTER: Include portrait framing, expression, clothing details
   - ATMOSPHERE: Include color palette, mood lighting, weather effects
   - OBJECT: Include close-up composition, material texture, scale reference

4. **[Nice-to-have] Evaluate TSA vs Offset-Based Extraction**: TSA requires the LLM to reproduce the entire text (high output tokens). Compare with requesting only entity offsets + extracted text, which would reduce output token cost significantly.

---

## Topic 7: Gemini API Best Practices 2026

### Priority: Critical

### Sources Found

| Source | Description |
|--------|-------------|
| [Gemini 3 Flash Launch Blog](https://blog.google/products/gemini/gemini-3-flash/) | Gemini 3 Flash features, benchmarks, pricing |
| [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3) | Official developer documentation |
| [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching) | Explicit and implicit caching documentation |
| [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api) | Batch processing at 50% cost reduction |
| [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output) | JSON Schema, anyOf, $ref support |
| [Gemini Structured Output Blog](https://blog.google/technology/developers/gemini-api-structured-outputs/) | Property ordering, JSON Schema keywords |
| [Gemini Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings) | Safety categories and threshold configuration |
| [Gemini Thinking Parameter](https://ai.google.dev/gemini-api/docs/thinking) | thinking_level for Gemini 3, thinkingBudget for 2.5 |
| [Gemini Safety Settings Issue (May 2025)](https://www.theregister.com/2025/05/08/google_gemini_update_prevents_disabling/) | Safety filter controls broken in May 2025 update |
| [Gemini 3 Flash Pricing](https://www.glbgpt.com/hub/how-much-does-the-gemini-3-flash-cost/) | $0.50/1M input, $3/1M output tokens |

### Key Findings

**1. Gemini 3 Flash: Key Upgrade from 2.x**

Gemini 3 Flash is now available and represents a significant upgrade:
- Outperforms Gemini 2.5 Pro while being 3x faster
- Pricing: $0.50/1M input tokens, $3/1M output tokens
- 1M token context window
- New features: thinking_level (minimal/low/medium/high), media_resolution control
- Supports structured output + built-in tools (Search, URL Context, Code Execution)
- Improved reliability in multi-turn function calling with thought signatures

**2. Context Caching: Major Cost Optimization**

Two types of caching, both applicable to fancai:
- **Explicit caching**: 90% discount on cached tokens (Gemini 3), manually controlled
- **Implicit caching**: Automatically applied, no guaranteed discount
- Minimum cache size: 2,048 tokens
- Use case for fancai: Cache the book text, run multiple extraction queries against it
- Storage costs apply based on TTL duration

**Concrete fancai application**: Cache the full chapter text, then run separate extraction queries for descriptions, entities, and relationships. Each query after the first gets 90% off input tokens.

**3. Batch API: 50% Cost Reduction**

For non-real-time processing (which book analysis is):
- 50% discount on both input and output tokens
- Higher rate limits than standard API
- Target turnaround: 24 hours (usually much faster)
- Supports context caching within batch jobs
- Up to 2GB JSONL input files
- Supports structured output

**fancai application**: When a user uploads a book, submit all chapter extractions as a single batch job. Cost savings compound with context caching.

**4. Structured Output Improvements**

Recent Gemini API updates (relevant to fancai's Pydantic schemas):
- Added `anyOf`, `$ref` support in JSON Schema
- Property ordering preserved from schema
- Best practice: Use `description` field in schema properties
- Best practice: Don't duplicate schema in prompt (use responseSchema field only)
- Best practice: Match property ordering between prompt and schema

**5. Thinking Level for Extraction Tasks**

Gemini 3's thinking_level parameter for entity extraction:
- `"low"`: Best for straightforward structured data extraction (fastest, cheapest)
- `"medium"`: Good for entity extraction where some reasoning is needed
- `"high"`: For complex disambiguation tasks like entity deduplication
- fancai should use `"low"` for basic extraction, `"medium"` for deduplication

**6. Safety Settings for Fiction Content**

Important for fancai processing mature fiction:
- Gemini blocks content with violence, sexual themes by default
- Configurable thresholds: BLOCK_LOW_AND_ABOVE, BLOCK_MEDIUM_AND_ABOVE, BLOCK_ONLY_HIGH
- May 2025 issue: Google broke safety setting controls in an update
- Recommendation: Set to BLOCK_ONLY_HIGH for fiction processing
- Monitor for future API changes that may affect fiction extraction

### Comparison with fancai's Current Approach

| Aspect | fancai Current | Research Best Practice | Gap |
|--------|---------------|----------------------|-----|
| Model | gemini-3-flash-preview | gemini-3-flash (GA) | Small (update when GA) |
| Context caching | Redis-based LLM response caching | Gemini explicit context caching (90% off) | Large |
| Batch processing | Sequential per-chunk with semaphore(3) | Batch API (50% off) for book-level processing | Large |
| Structured output | Pydantic schemas (good!) | Same approach + property ordering best practices | Small |
| Thinking level | Not used (default) | thinking_level="low" for extraction, "medium" for dedup | Medium |
| Safety settings | Not configured | BLOCK_ONLY_HIGH for fiction content | Medium |
| Temperature | 0.3 for extraction | 0.1-0.3 for extraction (current is good) | None |

### Specific Recommendations

1. **[Critical] Implement Gemini Context Caching**: Cache the full chapter text using Gemini's explicit caching API, then run extraction queries against the cached context. For a typical book chapter:
   - Without caching: ~20K input tokens per query = 100% cost
   - With caching: First query full price, subsequent queries 90% off input tokens
   - If running descriptions, entities, and relationships as separate queries: ~63% total cost savings

2. **[Critical] Use Batch API for Book Processing**: When a full book is uploaded, submit all chapter extractions as a batch job. This saves 50% on all tokens. Combined with context caching, total savings could reach 70-80%.

3. **[Important] Add thinking_level Parameter**: Set `thinking_level="low"` for entity/description extraction (fast, cheap) and `thinking_level="medium"` for entity deduplication (needs more reasoning). This improves extraction quality at minimal cost increase.

4. **[Important] Configure Safety Settings**: Add `safety_settings` to all Gemini API calls with `BLOCK_ONLY_HIGH` threshold to prevent fiction content from being blocked. Many literary works contain violence, death, and mature themes that may trigger default safety filters.

5. **[Important] Apply Structured Output Best Practices**: Add `description` fields to all Pydantic schema properties (partially done). Ensure property ordering in the prompt matches the schema ordering. Remove any schema references from the prompt text (use responseSchema only).

6. **[Nice-to-have] Monitor Gemini 3 Flash GA Release**: The current `gemini-3-flash-preview` model will be replaced by GA. Monitor for the stable release and update the model ID. GA models typically have better reliability and may have different pricing.

---

## Summary: Priority Matrix

### Critical (Implement ASAP)

| # | Recommendation | Topic | Estimated Impact | Effort |
|---|---------------|-------|-----------------|--------|
| 1 | Gemini Context Caching | 7 | 60-90% cost reduction on input tokens | Medium |
| 2 | Batch API for book processing | 7 | 50% cost reduction + higher throughput | Medium |
| 3 | Chapter-aware chunking | 5 | Better extraction quality, fewer split entities | Low |
| 4 | Entity carry-over between chunks | 5 | Fewer duplicate entities, better continuity | Medium |
| 5 | MERGE method for incremental entity processing | 2 | Better recall, fewer merge errors | Medium |
| 6 | LLM-enhanced image prompt generation | 6 | Significantly better illustration quality | Medium |

### Important (Plan for next sprint)

| # | Recommendation | Topic | Estimated Impact | Effort |
|---|---------------|-------|-----------------|--------|
| 7 | Embedding-based entity similarity (pre-LLM dedup) | 2 | Catch semantic duplicates string matching misses | Medium |
| 8 | Few-shot examples in extraction prompt | 1 | Better extraction accuracy | Low |
| 9 | thinking_level parameter | 7 | Better extraction quality at low cost | Low |
| 10 | Safety settings for fiction | 7 | Prevent content blocking for mature fiction | Low |
| 11 | Upgrade translation model to Gemini 3 Flash | 6 | Better image prompt quality | Low |
| 12 | Typed relationships in knowledge graph | 4 | Richer entity profiles | Medium |
| 13 | Chapter-level entity summary snapshots | 3 | Better spoiler protection | High |
| 14 | Entity name reveal handling | 3 | Prevent alias-based spoilers | Medium |
| 15 | Relationship spoiler gating | 3 | Prevent relationship spoilers | Medium |

### Nice-to-have (Backlog)

| # | Recommendation | Topic | Estimated Impact | Effort |
|---|---------------|-------|-----------------|--------|
| 16 | Betweenness centrality + Leiden algorithm | 4 | Better character importance ranking | Low |
| 17 | Temporal graph snapshots | 4 | Relationship evolution visualization | High |
| 18 | Entity validation pass | 1 | Reduce hallucinated entities | Low |
| 19 | Style templates per description type | 6 | More consistent illustration style | Low |
| 20 | Coreference-aware entity extraction | 2 | Better pronoun resolution | High |
| 21 | Previous chunk summary context | 5 | Better cross-chunk continuity | Low |
| 22 | TSA vs offset-based extraction comparison | 6 | Potential output token savings | Medium |
| 23 | Confidence decay for stale entities | 2 | Better importance ranking | Low |
| 24 | Spoiler confidence scoring | 3 | Better edge case handling | Medium |

---

## Cost Impact Analysis

### Current Estimated Costs (per book, ~300K chars / ~100K tokens)

- Extraction: ~3 chunks x 35K input tokens + 5K output tokens = ~$0.10
- Deduplication: ~10K input tokens + 2K output tokens = ~$0.01
- Translation: ~15K input tokens + 5K output tokens = ~$0.04
- **Total per book: ~$0.15**

### After Recommended Optimizations

1. **Context Caching (90% off cached tokens)**: Extraction cost drops to ~$0.03
2. **Batch API (50% off all tokens)**: Further drops to ~$0.015
3. **Total per book with optimizations: ~$0.04-0.06** (60-70% savings)

For a service processing 100 books/day: $15/day -> $4-6/day savings = ~$300/month savings.

---

## Key Research Papers Referenced

1. "Recall Them All: Long List Generation from Long Novels" (ACL 2025)
2. "Too Long, Didn't Model: Decomposing LLM Long-Context Understanding" (arXiv, May 2025)
3. "LlmLink: Dual LLMs for Dynamic Entity Linking on Long Narratives" (COLING 2025)
4. "LLMs Behind the Scenes: Enabling Narrative Scene Illustration" (arXiv, Sep 2025)
5. "iText2KG: Incremental Knowledge Graphs Construction Using LLMs" (WISE 2024)
6. "HTEKG: Human-Trait-Enhanced Literary Knowledge Graph" (KEOD 2024)
7. "EvolvTrip: Enhancing Literary Character Understanding with Temporal Theory-of-Mind Graphs" (arXiv 2025)
8. "Structured Entity Extraction Using Large Language Models" (arXiv 2024)
9. "Incremental Entity Summarization: MERGE vs UPDATE" (arXiv 2024)
10. "The Elephant in the Coreference Room: Full-Length French Fiction" (arXiv 2025)

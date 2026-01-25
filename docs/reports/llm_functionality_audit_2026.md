# LLM & Image Generation Functionality Audit (Jan 2026)

**Purpose:** This document provides a deep technical overview of the current AI/LLM architecture in the "Fancai" project to facilitate the migration from Google Imagen 4 to **Replicate FLUX.2 Dev**.

**Date:** 2026-01-25
**Status:** Current Production State

---

## 1. Architecture Overview
Fancai is an AI-powered book reader that visualizes characters and locations from EPUB/FB2 books.
- **Backend:** Python (FastAPI, Celery, SQLAlchemy).
- **AI Core:** Heavily relies on Google Cloud Vertex AI (Gemini + Imagen).
- **Pipeline:** Book Text -> Gemini Extraction -> Prompt Engineering -> Image Generation.

## 2. Image Generation Pipeline (Current)
**Location:** `backend/app/services/imagen_generator.py`

### Component: `GoogleImagenGenerator`
- **Model:** `imagen-4.0-generate-001` (Google Vertex AI).
- **Integration:** Uses `google-genai` SDK.
- **Output:** Returns Base64 encoded PNGs or raw bytes.
- **Latency:** ~6-10 seconds per image.
- **Safety:** Uses "block_low_and_above" safety filter (strict).

### Component: `ImagenPromptEngineer`
- **Logic:** Constructs specific prompts optimized for Imagen 4.
- **Translation:** Uses `PromptTranslator` (Gemini 3 Flash) to translate Russian descriptions -> English visual prompts.
- **Templates:** Hardcoded style templates based on `DescriptionType` (Location, Character, Atmosphere).
    - *Example Protocol:* `"{Prefix} {English Description}, {Base Style}, {Genre Style}, {Suffix}"`
    - *Example Output:* "Detailed book illustration of a dark castle on a hill, atmospheric lighting, fantasy art, oil painting style."

## 3. Text Analysis & Extraction Pipeline
**Location:** `backend/app/services/gemini_extractor.py` & `llm_description_enricher.py`

### Component: `GeminiDirectExtractor` (Primary)
- **Model:** `gemini-3-flash-preview`.
- **Function:** Analyzes raw book chapters (chunked).
- **Task:** NER (Named Entity Recognition) + Description Extraction.
- **Structured Output:** Pydantic schemas (`GeminiResponseSchema`).
- **Extracts:**
    - Entities (Characters, Locations).
    - Visual Summary (Short text for prompting).
    - Importance Score (1-10).

### Component: `LLMDescriptionEnricher` (Secondary)
- **Library:** `langextract`.
- **Function:** Enhances short descriptions by inferring attributes (e.g. "tall" -> "height: tall").
- **Status:** Optional auxiliary step.

## 4. Migration Requirements (Imagen -> FLUX.2)
To replace Imagen 4 with **Replicate FLUX.2 Dev**, the following changes are identified:

1.  **Client Replacement:**
    - Replace `GoogleImagenGenerator` with `ReplicateFluxGenerator`.
    - Dependency: `replicate` Python client.
    - Auth: `REPLICATE_API_TOKEN`.

2.  **Prompt Engineering Adaptation:**
    - FLUX.2 tends to prefer natural language over "tag soup" or rigid templates.
    - **Current Template:** "Detailed book illustration of..." (Optimized for Imagen).
    - **New Template:** Needs testing. FLUX often handles raw descriptive text better.
    - **Translation:** Russian->English translation step MUST be kept (FLUX is English-native).

3.  **Aspect Ratio Handling:**
    - Imagen uses string "4:3".
    - FLUX usually takes specific pixel dimensions (e.g. `1024x768`) or aspect ratio strings depending on the model version.

4.  **Async/Sync Nature:**
    - Imagen API is synchronous (we wrap it in `asyncio.to_thread`).
    - Replicate API is asynchronous (predictions). We need to handle the webhook or polling mechanism if using the async client, or blocking call.

## 5. File Impact Analysis
Files that will require modification:
- `backend/app/services/image_generator.py` (Or `imagen_generator.py` renamed/replaced).
- `backend/app/core/config.py` (Add Replicate settings, remove Imagen settings).
- `backend/requirements.lite.txt` (Add `replicate`).
- `backend/app/services/imagen_generator.py` (The prompt engineering logic resides here).

## 6. Current Configuration (`config.py`)
```python
GOOGLE_API_KEY = "..." # Used for Gemini + Imagen
IMAGEN_MODEL = "imagen-4.0-generate-001"
GEMINI_MODEL = "gemini-3-flash-preview"
```
New configuration needed:
```python
REPLICATE_API_TOKEN = "..."
FLUX_MODEL_VERSION = "bfs-..." # or standard deployment
```

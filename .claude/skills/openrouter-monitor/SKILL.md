---
name: openrouter-monitor
description: Monitor and debug OpenRouter AI pipeline health, costs, rate limits, model availability. Use when AI features fail, images don't generate, or LLM responses are degraded.
allowed-tools: Bash, Read, Grep, Glob, WebFetch
---

# OpenRouter AI Pipeline Monitor

## Models

- **LLM primary:** google/gemini-3-flash-preview
- **LLM fallback 1:** anthropic/claude-haiku-4.5
- **LLM fallback 2:** google/gemini-2.5-flash-lite
- **Images:** black-forest-labs/flux.2-klein-4b

## Quick Health Check

### 1. Model Availability

```bash
curl -s https://openrouter.ai/api/v1/models | python3 -c "
import json, sys
data = json.load(sys.stdin)
targets = ['google/gemini-3-flash-preview', 'anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite', 'black-forest-labs/flux.2-klein-4b']
for m in data.get('data', []):
    if m['id'] in targets:
        print(f\"{m['id']}: pricing={m.get('pricing', 'N/A')}\")
"
```

### 2. Check API Errors

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=200 backend | grep -iE '(openrouter|rate.limit|429|500|timeout|fallback)'"
```

### 3. Check Fallback Chain

```bash
ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml logs --tail=500 backend | grep -i 'fallback\|retry\|model.*failed'"
```

## Common Issues

- **Rate limiting (429):** retry-after header, exponential backoff in core/retry.py
- **Model unavailable:** fallback chain activates. All down → check status.openrouter.ai
- **Structured output fails:** check Pydantic → JSON Schema via \_inline_defs()
- **Image generation fails:** check RU→EN translation, base64 decode, storage path

## Key Files

- `backend/app/core/openrouter_client.py` (537 lines)
- `backend/app/core/retry.py` (523 lines)
- `backend/app/services/gemini_extractor.py` (1221 lines)
- `backend/app/services/imagen_generator.py` (585 lines)

## Environment: OPENROUTER_API_KEY (NOT GOOGLE_API_KEY)

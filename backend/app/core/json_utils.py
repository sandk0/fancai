"""
Unified JSON utilities for fancai backend.

Provides:
- Robust parsing for LLM outputs (strips markdown code blocks)
- Consistent serialization (handles datetime, dataclasses)
- Pydantic model parsing integration
"""

import json
import re
import logging
from typing import Any, TypeVar, Type, Union, Dict, List, Optional
from datetime import datetime, date
from uuid import UUID
from dataclasses import is_dataclass, fields

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)

class EnhancedJSONEncoder(json.JSONEncoder):
    """
    JSON Encoder that handles:
    - datetime/date -> ISO format
    - UUID -> str
    - dataclasses -> dict
    - sets -> list
    """
    def default(self, o: Any) -> Any:
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, UUID):
            return str(o)
        if is_dataclass(o) and not isinstance(o, type):
            return {f.name: getattr(o, f.name) for f in fields(o)}
        if isinstance(o, set):
            return list(o)
        return super().default(o)

def clean_json_text(text: str) -> str:
    """
    Remove markdown code blocks and extra whitespace from potential JSON string.
    
    Example:
        ```json
        {"foo": "bar"}
        ```
        -> {"foo": "bar"}
    """
    text = text.strip()
    
    # Remove ```json ... ``` or ``` ... ```
    if text.startswith("```"):
        # Match ```<optional_lang> ... ```
        # Use DOTALL to match newlines
        match = re.search(r"^```(?:\w+)?\s*(.*?)\s*```$", text, re.DOTALL)
        if match:
            text = match.group(1)
    
    return text.strip()

def parse_json_safe(
    text: str, 
    log_error: bool = True
) -> Union[Dict[str, Any], List[Any], None]:
    """
    Parse JSON string with markdown cleanup.
    Returns None on failure (and logs error if requested).
    """
    cleaned = clean_json_text(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        if log_error:
            logger.error(f"Failed to parse JSON: {e}. Text preview: {cleaned[:100]}...")
        return None

def parse_model_safe(
    text: str, 
    model: Type[T],
    strict: bool = False
) -> T:
    """
    Parse JSON string to Pydantic model with markdown cleanup.
    Raises pydantic.ValidationError on failure.
    """
    cleaned = clean_json_text(text)
    return model.model_validate_json(cleaned, strict=strict)

def dump_json(
    data: Any, 
    indent: Optional[int] = None, 
    sort_keys: bool = False
) -> str:
    """
    Serialize data to JSON string with enhanced encoder.
    """
    return json.dumps(
        data, 
        cls=EnhancedJSONEncoder, 
        indent=indent, 
        sort_keys=sort_keys,
        ensure_ascii=False
    )

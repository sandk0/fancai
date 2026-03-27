"""LLM Extractor — Qwen3.5-9B на vLLM для извлечения сущностей и описаний."""

import json
import logging
import time

import modal

from app import app, llm_image, model_volume, COMMON_CLS_KWARGS
from config import (
    LLM_MODEL_ID,
    VOLUME_PATH,
    LLM_GPU,
    LLM_TIMEOUT,
    MAX_MODEL_LEN,
    GPU_MEMORY_UTILIZATION,
    KV_CACHE_DTYPE,
    NUM_GPU_BLOCKS_OVERRIDE,
)


@app.cls(
    image=llm_image,
    gpu=LLM_GPU,
    timeout=LLM_TIMEOUT,
    **COMMON_CLS_KWARGS,
)
class LLMExtractor:
    @modal.enter()
    def load_model(self):
        enter_start = time.monotonic()
        from vllm import LLM

        self.llm = LLM(
            model=LLM_MODEL_ID,
            download_dir=VOLUME_PATH,
            max_model_len=MAX_MODEL_LEN,
            gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            kv_cache_dtype=KV_CACHE_DTYPE,
            dtype="bfloat16",
            enable_prefix_caching=True,
            num_gpu_blocks_override=NUM_GPU_BLOCKS_OVERRIDE,
        )
        self._cold_start_ms = int((time.monotonic() - enter_start) * 1000)
        self._is_first_call = True
        logging.info(
            f"vLLM initialized: cold_start_ms={self._cold_start_ms}, "
            f"num_gpu_blocks_override={NUM_GPU_BLOCKS_OVERRIDE}, "
            f"max_model_len={MAX_MODEL_LEN}, gpu_memory_utilization={GPU_MEMORY_UTILIZATION}"
        )

    @modal.method()
    def extract_chapter(
        self, chapter_text: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Извлечение сущностей, описаний и связей из одной главы.

        Returns:
            {"result": parsed_json | None, "metrics": {...}, "truncated_text"?: str}
        """
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        inference_start = time.monotonic()
        params = SamplingParams(
            max_tokens=32768,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
        ]
        result = self.llm.chat(messages, params)
        output = result[0].outputs[0]

        inference_ms = int((time.monotonic() - inference_start) * 1000)
        metrics = {
            "cold_start_ms": self._cold_start_ms if self._is_first_call else 0,
            "inference_ms": inference_ms,
            "finish_reason": output.finish_reason,
            "is_cold_start": self._is_first_call,
        }
        self._is_first_call = False

        # STAB-04: check finish_reason BEFORE json.loads()
        if output.finish_reason == "length":
            return {
                "result": None,
                "truncated_text": output.text[:500],
                "metrics": metrics,
            }

        parsed = json.loads(output.text)
        return {
            "result": parsed,
            "metrics": metrics,
        }

    @modal.method()
    def reduce_entities(
        self, entities_json: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Дедупликация сущностей — объединение дубликатов.

        Returns:
            {"result": parsed_json | None, "metrics": {...}, "truncated_text"?: str}
        """
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        inference_start = time.monotonic()
        params = SamplingParams(
            max_tokens=16384,  # STAB-08: увеличено для книг со 100+ entities
            temperature=0.0,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": entities_json},
        ]
        result = self.llm.chat(messages, params)
        output = result[0].outputs[0]

        inference_ms = int((time.monotonic() - inference_start) * 1000)
        metrics = {
            "cold_start_ms": self._cold_start_ms if self._is_first_call else 0,
            "inference_ms": inference_ms,
            "finish_reason": output.finish_reason,
            "is_cold_start": self._is_first_call,
        }
        self._is_first_call = False

        # STAB-04: check finish_reason BEFORE json.loads()
        if output.finish_reason == "length":
            return {
                "result": None,
                "truncated_text": output.text[:500],
                "metrics": metrics,
            }

        parsed = json.loads(output.text)
        return {
            "result": parsed,
            "metrics": metrics,
        }

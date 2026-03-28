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
    def extract_chapters_batch(
        self,
        chapters: list[dict],  # [{text, system_prompt, schema_json}]
    ) -> list[dict]:
        """Batch extraction: несколько глав за один GPU pass (D-08, D-10).

        vLLM continuous batching обрабатывает все главы параллельно.
        Общие SamplingParams для всех глав в batch (D-09).
        Per-item обработка результатов с finish_reason проверкой (D-11).

        Args:
            chapters: список dict с полями:
                - text: str -- текст главы
                - system_prompt: str -- system prompt (одинаковый для всех)
                - schema_json: str -- JSON schema (одинаковый для всех)

        Returns:
            list[dict]: для каждой главы:
                - chapter_idx: int -- индекс в исходном списке
                - result: dict | None -- распарсенный JSON или None при truncation
                - metrics: dict -- cold_start_ms, inference_ms, finish_reason, is_cold_start, batch_size
                - truncated_text: str | None -- первые 500 символов при truncation
        """
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        if not chapters:
            return []

        inference_start = time.monotonic()

        # D-09: Общие params для всех глав
        params = SamplingParams(
            max_tokens=32768,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=chapters[0]["schema_json"]),
        )

        # D-08: Build messages list для vLLM batch chat
        messages_list = [
            [
                {"role": "system", "content": ch["system_prompt"]},
                {"role": "user", "content": f"<book_text>{ch['text']}</book_text>"},
            ]
            for ch in chapters
        ]

        # Один вызов -- continuous batching vLLM
        request_outputs = self.llm.chat(messages_list, params)

        inference_ms = int((time.monotonic() - inference_start) * 1000)
        batch_results = []

        # D-11: Per-item обработка
        for idx, req_output in enumerate(request_outputs):
            output = req_output.outputs[0]
            item_metrics = {
                "cold_start_ms": self._cold_start_ms if self._is_first_call else 0,
                "inference_ms": inference_ms,
                "finish_reason": output.finish_reason,
                "is_cold_start": self._is_first_call,
                "batch_size": len(chapters),
            }

            if output.finish_reason == "length":
                batch_results.append(
                    {
                        "result": None,
                        "truncated_text": output.text[:500],
                        "metrics": item_metrics,
                        "chapter_idx": idx,
                    }
                )
            else:
                parsed = json.loads(output.text)
                batch_results.append(
                    {
                        "result": parsed,
                        "metrics": item_metrics,
                        "chapter_idx": idx,
                    }
                )

        self._is_first_call = False
        return batch_results

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

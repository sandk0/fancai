"""LLM Extractor — Qwen3.5-9B на vLLM для извлечения сущностей и описаний."""

import json

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
        from vllm import LLM

        self.llm = LLM(
            model=LLM_MODEL_ID,
            download_dir=VOLUME_PATH,
            max_model_len=MAX_MODEL_LEN,
            gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
            kv_cache_dtype=KV_CACHE_DTYPE,
            dtype="bfloat16",
            enable_prefix_caching=True,
            chat_template_kwargs={"enable_thinking": False},
        )

    @modal.method()
    def extract_chapter(
        self, chapter_text: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Извлечение сущностей, описаний и связей из одной главы."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=8192,
            temperature=0.1,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"<book_text>{chapter_text}</book_text>"},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)

    @modal.method()
    def reduce_entities(
        self, entities_json: str, system_prompt: str, schema_json: str
    ) -> dict:
        """Дедупликация сущностей — объединение дубликатов."""
        from vllm import SamplingParams
        from vllm.sampling_params import StructuredOutputsParams

        params = SamplingParams(
            max_tokens=4096,
            temperature=0.0,
            structured_outputs=StructuredOutputsParams(json=schema_json),
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": entities_json},
        ]
        result = self.llm.chat(messages, params)
        return json.loads(result[0].outputs[0].text)

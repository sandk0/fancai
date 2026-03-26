"""Image Generator — FLUX.2 Klein 4B на diffusers."""

import io

import modal

from app import app, diffusers_image, COMMON_CLS_KWARGS
from config import (
    IMAGE_MODEL_ID,
    VOLUME_PATH,
    IMAGE_GPU,
    IMAGE_TIMEOUT,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
    IMAGE_NUM_STEPS,
    IMAGE_GUIDANCE_SCALE,
)


@app.cls(
    image=diffusers_image,
    gpu=IMAGE_GPU,
    timeout=IMAGE_TIMEOUT,
    **COMMON_CLS_KWARGS,
)
class ImageGenerator:
    @modal.enter()
    def load_model(self):
        """Загрузка модели FLUX.2 Klein в память GPU."""
        from diffusers import Flux2KleinPipeline
        import torch

        self.pipe = Flux2KleinPipeline.from_pretrained(
            IMAGE_MODEL_ID,
            torch_dtype=torch.bfloat16,
            cache_dir=VOLUME_PATH,
        ).to("cuda")

    @modal.method()
    def generate(
        self,
        prompt: str,
        width: int = IMAGE_WIDTH,
        height: int = IMAGE_HEIGHT,
        num_steps: int = IMAGE_NUM_STEPS,
    ) -> bytes:
        """Генерация одного изображения, возврат PNG bytes."""
        image = self.pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_steps,
            guidance_scale=IMAGE_GUIDANCE_SCALE,
        ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

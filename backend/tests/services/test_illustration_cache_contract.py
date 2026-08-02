"""
Контракт кэша изображений (S1).

До правки кэш был сломан целиком:
- значением ключа был `data:image/png;base64,…` на мегабайты, и он же уезжал
  в `ImageGenerationResult.image_url`; `regenerate` писал его в колонку
  `generated_images.image_url VARCHAR(2000)` → StringDataRightTruncation;
- на hit `local_path` не выставлялся, поэтому четыре потребителя создавали
  строку `status='completed', image_url=NULL`;
- ключ считался как md5(description + aspect) и не учитывал `custom_style`,
  `description_type`, `genre` и модель — «перегенерировать другим стилем»
  гарантированно попадало в кэш и возвращало прежнюю картинку;
- имя файла `illustration_<секунда>_<md5(prompt)[:8]>.png` совпадало у параллельных
  одинаковых запросов, а `delete_with_file()` удаляет файл по `local_path`.

Здесь проверяется контракт после правки: в Redis лежит путь, hit материализует
собственный файл, `image_url` всегда короткий HTTP-URL.
"""

import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.image import GeneratedImage
from app.services import illustration_service as ig
from app.services.illustration_service import IllustrationService

# Берётся из модели, а не константой: если колонку сузят, тест обязан упасть.
MAX_IMAGE_URL = GeneratedImage.__table__.c.image_url.type.length
MAX_LOCAL_PATH = GeneratedImage.__table__.c.local_path.type.length


class FakeRedis:
    """Минимальный Redis: только то, что использует IllustrationService."""

    def __init__(self):
        self.store: dict[str, bytes] = {}

    async def get(self, key):
        return self.store.get(key)

    async def setex(self, key, ttl, value):
        self.store[key] = value.encode() if isinstance(value, str) else value

    async def delete(self, key):
        self.store.pop(key, None)

    async def close(self):
        return None


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture
def images_dir(tmp_path, monkeypatch):
    """Хранилище картинок в tmp: на хосте /app/storage не существует."""
    target = tmp_path / "generated_images"
    monkeypatch.setattr(ig, "IMAGES_DIR", target)
    return target


@pytest.fixture
def png_bytes():
    return b"\x89PNG\r\n\x1a\n" + b"pixels" * 500


@pytest.fixture
def service(png_bytes):
    """IllustrationService с замоканными генератором и prompt engineer."""
    svc = IllustrationService.__new__(IllustrationService)
    svc._nano = MagicMock()
    svc._nano.generate = AsyncMock(return_value=png_bytes)
    svc._available = True
    svc._model = "gemini-3.1-flash-image"
    engineer = MagicMock()
    engineer.create_prompt = AsyncMock(return_value="a castle, digital art, SFW")
    svc._prompt_engineer = engineer
    return svc


async def _generate(service, fake_redis, model="gemini-3.1-flash-image", **kwargs):
    with patch("redis.asyncio.from_url", new=AsyncMock(return_value=fake_redis)):
        with patch.object(ig, "settings") as mock_settings:
            mock_settings.GEMINI_IMAGE_MODEL = model
            mock_settings.REDIS_URL = "redis://localhost:6379"
            return await service.generate_image(**kwargs)


@pytest.mark.asyncio
async def test_miss_returns_bounded_http_url_not_data_uri(
    service, fake_redis, images_dir
):
    result = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert result.success is True
    assert result.local_path is not None
    assert (
        result.image_url == f"/api/v1/images/file/{os.path.basename(result.local_path)}"
    )
    assert not result.image_url.startswith("data:")
    # Обе величины уезжают в колонки фиксированной ширины.
    assert len(result.image_url) < MAX_IMAGE_URL
    assert len(result.local_path) < MAX_LOCAL_PATH


@pytest.mark.asyncio
async def test_cache_stores_a_reference_not_the_bytes(service, fake_redis, images_dir):
    result = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert len(fake_redis.store) == 1
    key, value = next(iter(fake_redis.store.items()))
    assert key.startswith("illustration:cache:v2:")

    payload = json.loads(value)
    assert payload["path"] == result.local_path
    assert payload["prompt"] == "a castle, digital art, SFW"
    # Значение — ссылка, а не картинка: в v1 здесь лежали мегабайты base64.
    assert b"base64" not in value
    assert len(value) < 4096


@pytest.mark.asyncio
async def test_hit_materializes_its_own_file(
    service, fake_redis, images_dir, png_bytes
):
    """
    Hit обязан вернуть отдельный файл: `delete_with_file()` удаляет по
    `local_path`, и общий путь у двух строк означал бы битую картинку у второй.
    """
    first = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    second = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert service._nano.generate.call_count == 1, "второй вызов должен был взять кэш"
    assert second.model_used == "cache"
    assert second.local_path != first.local_path
    assert Path(first.local_path).read_bytes() == png_bytes
    assert Path(second.local_path).read_bytes() == png_bytes
    assert (
        second.image_url == f"/api/v1/images/file/{os.path.basename(second.local_path)}"
    )
    assert len(second.image_url) < MAX_IMAGE_URL


@pytest.mark.asyncio
async def test_deleting_one_file_keeps_the_other_readable(
    service, fake_redis, images_dir, png_bytes
):
    """Ровно то, что делает delete_with_file() для одной из двух строк."""
    first = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    second = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    os.unlink(first.local_path)

    assert Path(second.local_path).read_bytes() == png_bytes


@pytest.mark.asyncio
async def test_custom_style_is_part_of_the_key(service, fake_redis, images_dir):
    """Продовый баг: «перегенерировать другим стилем» всегда попадало в кэш."""
    await _generate(
        service,
        fake_redis,
        description="Старый замок",
        description_type="location",
        custom_style="watercolor",
    )
    await _generate(
        service,
        fake_redis,
        description="Старый замок",
        description_type="location",
        custom_style="oil painting",
    )

    assert service._nano.generate.call_count == 2
    assert len(fake_redis.store) == 2


@pytest.mark.asyncio
async def test_genre_and_type_are_part_of_the_key(service, fake_redis, images_dir):
    await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    await _generate(
        service, fake_redis, description="Старый замок", description_type="character"
    )
    await _generate(
        service,
        fake_redis,
        description="Старый замок",
        description_type="location",
        genre="fantasy",
    )

    assert service._nano.generate.call_count == 3
    assert len(fake_redis.store) == 3


@pytest.mark.asyncio
async def test_image_model_is_part_of_the_key(service, fake_redis, images_dir):
    await _generate(
        service,
        fake_redis,
        model="gemini-3.1-flash-image",
        description="Старый замок",
        description_type="location",
    )
    await _generate(
        service,
        fake_redis,
        model="some-other-image-model",
        description="Старый замок",
        description_type="location",
    )

    assert service._nano.generate.call_count == 2


@pytest.mark.asyncio
async def test_stale_entry_is_a_miss_and_gets_replaced(service, fake_redis, images_dir):
    """Файл мог быть удалён ротацией или delete_with_file() — путь в никуда недопустим."""
    first = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    os.unlink(first.local_path)

    second = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert (
        service._nano.generate.call_count == 2
    ), "протухшая запись должна быть промахом"
    assert os.path.isfile(second.local_path)
    assert len(fake_redis.store) == 1
    assert (
        json.loads(next(iter(fake_redis.store.values())))["path"] == second.local_path
    )


@pytest.mark.asyncio
async def test_save_image_names_are_unique_within_one_second(
    service, images_dir, png_bytes
):
    """Прежняя схема имени содержала только секунду и хэш промпта."""
    paths = {await service._save_image(png_bytes) for _ in range(5)}

    assert len(paths) == 5


@pytest.mark.asyncio
async def test_hit_reports_the_prompt_that_reached_the_model(
    service, fake_redis, images_dir
):
    """
    `generated_images.prompt_used` означает «что ушло в модель».

    На hit сюда попадало исходное русское описание, и половина строк в БД
    содержала не тот вид промпта, что вторая половина.
    """
    miss = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    hit = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert hit.model_used == "cache"
    assert miss.prompt_used == "a castle, digital art, SFW"
    assert hit.prompt_used == miss.prompt_used
    assert hit.prompt_used != "Старый замок"


@pytest.mark.asyncio
async def test_entry_of_another_format_version_is_a_miss(
    service, fake_redis, images_dir
):
    """Запись чужой версии разбирать «как получится» нельзя — только промах."""
    first = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )
    key = next(iter(fake_redis.store))
    fake_redis.store[key] = json.dumps(
        {"v": 99, "path": first.local_path, "prompt": "whatever"}
    ).encode()

    second = await _generate(
        service, fake_redis, description="Старый замок", description_type="location"
    )

    assert service._nano.generate.call_count == 2
    assert json.loads(fake_redis.store[key])["v"] == 2
    assert second.prompt_used == "a castle, digital art, SFW"

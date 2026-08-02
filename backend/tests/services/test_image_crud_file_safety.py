"""Файл на диске нельзя удалять раньше успешного коммита.

Реальный сценарий потери данных: кэш изображений в IllustrationService возвращает на
hit `image_url` в виде `data:image/png;base64,…` (мегабайты) и `local_path=None`.
Ключ кэша считается как md5(description + aspect) и НЕ учитывает custom_style,
поэтому «перегенерировать с другим стилем» гарантированно попадает в кэш.
Дальше `update_after_regeneration` пытался положить data-URI в VARCHAR(2000):
commit падал, rollback возвращал прежний local_path в БД — а файл к этому
моменту уже был удалён.
"""

import os
import tempfile
from types import SimpleNamespace

import pytest

from app.services.image_crud_service import ImageCRUDService


class _FailingSession:
    """Сессия, у которой commit падает — как Postgres на слишком длинном URL."""

    def __init__(self) -> None:
        self.rolled_back = False

    async def commit(self):
        raise RuntimeError("value too long for type character varying(2000)")

    async def rollback(self):
        self.rolled_back = True

    async def refresh(self, _obj):  # pragma: no cover — до refresh не доходит
        raise AssertionError("refresh не должен вызываться после провала commit")

    async def delete(self, _obj):
        return None


class _OkSession:
    """Сессия, у которой всё проходит."""

    def __init__(self) -> None:
        self.deleted: list[object] = []
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        return None

    async def delete(self, obj):
        self.deleted.append(obj)
        return None


@pytest.fixture()
def existing_file():
    fd, path = tempfile.mkstemp(suffix=".png")
    with os.fdopen(fd, "wb") as f:
        f.write(b"PNGDATA")
    yield path
    if os.path.exists(path):
        os.unlink(path)


@pytest.mark.asyncio
async def test_regeneration_keeps_old_file_when_commit_fails(existing_file):
    session = _FailingSession()
    service = ImageCRUDService(session)
    image = SimpleNamespace(
        local_path=existing_file,
        image_url="/api/v1/images/file/old.png",
        prompt_used="old",
        generation_time_seconds=1.0,
    )

    with pytest.raises(RuntimeError):
        await service.update_after_regeneration(
            image=image,
            image_url="data:image/png;base64," + "A" * 5000,  # длиннее VARCHAR(2000)
            local_path=None,
            prompt_used="new",
            generation_time_seconds=2.0,
        )

    assert os.path.exists(
        existing_file
    ), "старый файл удалён до успешного коммита — изображение потеряно"


@pytest.mark.asyncio
async def test_delete_keeps_file_when_commit_fails(existing_file):
    session = _FailingSession()
    service = ImageCRUDService(session)
    image = SimpleNamespace(local_path=existing_file)

    async def _get_by_id(_image_id, _user_id):
        return image

    service.get_by_id = _get_by_id  # type: ignore[method-assign]

    with pytest.raises(RuntimeError):
        await service.delete_with_file(image_id="i", user_id="u")

    assert os.path.exists(
        existing_file
    ), "файл удалён до успешного коммита — строка в БД осталась бы без файла"


@pytest.mark.asyncio
async def test_regeneration_removes_old_file_after_successful_commit(existing_file):
    session = _OkSession()
    service = ImageCRUDService(session)
    image = SimpleNamespace(
        local_path=existing_file,
        image_url="/api/v1/images/file/old.png",
        prompt_used="old",
        generation_time_seconds=1.0,
    )

    await service.update_after_regeneration(
        image=image,
        image_url="/api/v1/images/file/new.png",
        local_path="/tmp/new-image-that-does-not-exist.png",
        prompt_used="new",
        generation_time_seconds=2.0,
    )

    assert session.commits == 1
    assert not os.path.exists(
        existing_file
    ), "старый файл не удалён после коммита — утечка"
    assert image.image_url == "/api/v1/images/file/new.png"


@pytest.mark.asyncio
async def test_regeneration_keeps_file_when_path_unchanged(existing_file):
    """Путь не изменился — файл трогать нельзя, иначе новая запись останется без него."""
    session = _OkSession()
    service = ImageCRUDService(session)
    image = SimpleNamespace(
        local_path=existing_file,
        image_url="/api/v1/images/file/old.png",
        prompt_used="old",
        generation_time_seconds=1.0,
    )

    await service.update_after_regeneration(
        image=image,
        image_url="/api/v1/images/file/same.png",
        local_path=existing_file,
        prompt_used="new",
        generation_time_seconds=2.0,
    )

    assert os.path.exists(existing_file), "файл удалён, хотя путь не менялся"


@pytest.mark.asyncio
async def test_delete_removes_file_after_successful_commit(existing_file):
    session = _OkSession()
    service = ImageCRUDService(session)
    image = SimpleNamespace(local_path=existing_file)

    async def _get_by_id(_image_id, _user_id):
        return image

    service.get_by_id = _get_by_id  # type: ignore[method-assign]

    assert await service.delete_with_file(image_id="i", user_id="u") is True
    assert session.deleted == [image]
    assert not os.path.exists(existing_file), "файл не удалён после коммита — утечка"

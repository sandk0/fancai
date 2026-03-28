"""Tests for Modal compile cache volume configuration.

BATCH-03: Compile cache volumes for faster cold start.
D-13, D-14: TORCHINDUCTOR env vars + volume mount paths.
"""

from pathlib import Path


class TestCompileCacheConfig:
    """Verify compile cache volumes and env vars in modal/app.py."""

    def _read_app_py(self) -> str:
        """Read modal/app.py source."""
        app_path = Path(__file__).resolve().parents[3] / "modal" / "app.py"
        return app_path.read_text()

    def test_compile_cache_volume_defined(self):
        """Verify fancai-compile-cache volume exists in app.py."""
        app_py = self._read_app_py()
        assert "fancai-compile-cache" in app_py

    def test_triton_cache_volume_defined(self):
        """Verify fancai-triton-cache volume exists in app.py."""
        app_py = self._read_app_py()
        assert "fancai-triton-cache" in app_py

    def test_nv_cache_volume_defined(self):
        """Verify fancai-nv-cache volume exists in app.py."""
        app_py = self._read_app_py()
        assert "fancai-nv-cache" in app_py

    def test_torchinductor_env_in_image(self):
        """Verify TORCHINDUCTOR_CACHE_DIR env var set in llm_image."""
        app_py = self._read_app_py()
        assert "TORCHINDUCTOR_CACHE_DIR" in app_py
        assert "TORCHINDUCTOR_FX_GRAPH_CACHE" in app_py

    def test_inductor_cache_mount_path(self):
        """Verify /root/.inductor-cache mount path (per D-13 correction)."""
        app_py = self._read_app_py()
        assert "/root/.inductor-cache" in app_py

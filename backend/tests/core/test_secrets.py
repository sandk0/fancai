"""Валидация secrets: `app/core/secrets.py`.

Модуль читает окружение напрямую (`os.getenv`), поэтому его покрытие
зависело от того, ГДЕ идёт прогон: в dev-контейнере `startup_secrets_check`
выполнялся целиком, а на раннере GitHub Actions переменная `CI=true`
короткозамыкала функцию на первой же проверке, и 60 строк модуля числились
непокрытыми только в CI. Здесь окружение задаётся явно, и результат
одинаков в обеих средах.
"""

import pytest

from app.core.secrets import (
    SECRETS_CONFIG,
    SecretCategory,
    SecretsValidator,
    check_secrets_in_file,
    generate_secret_key,
    get_secret_template,
    startup_secrets_check,
    validate_email_format,
    validate_secret_exists,
    validate_secret_not_default,
    validate_secret_strength,
)

STRONG_KEY = "Xk9-Quiet-Forest-Runs-Deep-2026-Winter!"
ALL_SECRET_NAMES = [s["name"] for group in SECRETS_CONFIG.values() for s in group]
CI_MARKERS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "ENVIRONMENT", "DEBUG"]


@pytest.fixture
def clean_env(monkeypatch):
    """Пустое окружение: иначе исход зависит от того, где идёт прогон."""
    for name in ALL_SECRET_NAMES + CI_MARKERS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def _set_valid_required(monkeypatch, *, production: bool) -> None:
    monkeypatch.setenv("SECRET_KEY", STRONG_KEY)
    monkeypatch.setenv(
        "DATABASE_URL",
        (
            "postgresql+asyncpg://app:S3cure@db:5432/fancai"
            if production
            else "postgresql+asyncpg://app:S3cure@db:5432/fancai"
        ),
    )
    monkeypatch.setenv("REDIS_URL", "redis://:S3cure@cache:6379/0")


# ============================================================================
# Отдельные проверки
# ============================================================================


class TestValidateSecretExists:
    def test_unset_secret_is_absent(self, clean_env):
        assert validate_secret_exists("SECRET_KEY") is False

    def test_whitespace_only_counts_as_absent(self, clean_env):
        """Пробелы в .env — типичная опечатка; секретом это не является."""
        clean_env.setenv("SECRET_KEY", "   ")

        assert validate_secret_exists("SECRET_KEY") is False

    def test_set_secret_is_present(self, clean_env):
        clean_env.setenv("SECRET_KEY", STRONG_KEY)

        assert validate_secret_exists("SECRET_KEY") is True


class TestValidateSecretStrength:
    def test_short_secret_is_rejected(self):
        ok, error = validate_secret_strength("Ab1!", min_length=32)

        assert ok is False
        assert "too short" in error

    @pytest.mark.parametrize(
        "value,expected",
        [
            ("a" * 40 + "1!", "uppercase"),
            ("A" * 40 + "1!", "lowercase"),
            ("Aa" * 20 + "!!", "digit"),
        ],
    )
    def test_missing_character_class_is_rejected(self, value, expected):
        ok, error = validate_secret_strength(value)

        assert ok is False
        assert expected in error

    def test_missing_special_char_passes_with_warning(self):
        """Спецсимволы — рекомендация, а не требование: ключ валиден."""
        ok, error = validate_secret_strength("Aa1" + "b" * 40)

        assert ok is True
        assert error.startswith("WARNING")

    def test_strong_secret_has_no_remarks(self):
        assert validate_secret_strength(STRONG_KEY) == (True, None)

    def test_min_length_is_honoured(self):
        assert validate_secret_strength("Aa1!bcde", min_length=8)[0] is True
        assert validate_secret_strength("Aa1!bcde", min_length=9)[0] is False


class TestValidateSecretNotDefault:
    def test_forbidden_substring_is_caught_case_insensitively(self):
        ok, error = validate_secret_not_default(
            "postgresql://user:POSTGRES123@db/app", ["postgres123"]
        )

        assert ok is False
        assert "postgres123" in error

    def test_clean_value_passes(self):
        assert validate_secret_not_default("opaque-value", ["postgres123"]) == (
            True,
            None,
        )


class TestValidateEmailFormat:
    @pytest.mark.parametrize(
        "email", ["admin@fancai.ru", "a.b+c_d%e-f@sub.example.co"]
    )
    def test_valid_addresses(self, email):
        assert validate_email_format(email) is True

    @pytest.mark.parametrize(
        "email", ["no-at-sign", "user@", "@example.com", "user@example", "user@ex.c"]
    )
    def test_invalid_addresses(self, email):
        assert validate_email_format(email) is False


# ============================================================================
# SecretsValidator
# ============================================================================


class TestSecretsValidator:
    def test_full_valid_production_setup(self, clean_env):
        _set_valid_required(clean_env, production=True)
        clean_env.setenv("HAWK_TOKEN", "hawk-token")

        is_valid, report = SecretsValidator(is_production=True).validate_all_secrets()

        assert is_valid is True
        assert report["errors"] == []
        assert report["missing_required"] == []

    def test_missing_required_secrets_are_reported(self, clean_env):
        is_valid, report = SecretsValidator(is_production=False).validate_all_secrets()

        assert is_valid is False
        assert set(report["missing_required"]) == {
            "SECRET_KEY",
            "DATABASE_URL",
            "REDIS_URL",
        }
        assert len(report["errors"]) >= 3

    def test_dev_default_key_is_warning_in_development(self, clean_env):
        """`allow_dev_default` существует ровно ради этого сценария."""
        clean_env.setenv("SECRET_KEY", "dev-secret-key")
        clean_env.setenv("DATABASE_URL", "postgresql://app:S3cure@db/fancai")
        clean_env.setenv("REDIS_URL", "redis://cache:6379/0")

        is_valid, report = SecretsValidator(is_production=False).validate_all_secrets()

        assert is_valid is True
        assert any("development default" in w for w in report["warnings"])

    def test_dev_default_key_is_error_in_production(self, clean_env):
        """Тот же ключ на проде обязан ронять валидацию, а не предупреждать."""
        clean_env.setenv("SECRET_KEY", "dev-secret-key")
        clean_env.setenv("DATABASE_URL", "postgresql://app:S3cure@db/fancai")
        clean_env.setenv("REDIS_URL", "redis://cache:6379/0")
        clean_env.setenv("HAWK_TOKEN", "hawk-token")

        is_valid, report = SecretsValidator(is_production=True).validate_all_secrets()

        assert is_valid is False
        assert any("SECRET_KEY" in e for e in report["errors"])

    def test_weak_key_without_special_chars_only_warns(self, clean_env):
        _set_valid_required(clean_env, production=False)
        clean_env.setenv("SECRET_KEY", "Aa1" + "b" * 40)

        is_valid, report = SecretsValidator(is_production=False).validate_all_secrets()

        assert is_valid is True
        assert any("special characters" in w for w in report["warnings"])

    def test_dev_credentials_are_warning_in_development(self, clean_env):
        clean_env.setenv("SECRET_KEY", STRONG_KEY)
        clean_env.setenv("DATABASE_URL", "postgresql://fancai_dev:postgres123@db/x")
        clean_env.setenv("REDIS_URL", "redis://:redis123@cache:6379/0")

        is_valid, report = SecretsValidator(is_production=False).validate_all_secrets()

        assert is_valid is True
        assert any("development credentials" in w for w in report["warnings"])

    def test_dev_credentials_are_fatal_in_production(self, clean_env):
        """`forbidden_in_production_only` — единственная защита от боевого
        деплоя с паролем `postgres123`."""
        clean_env.setenv("SECRET_KEY", STRONG_KEY)
        clean_env.setenv("DATABASE_URL", "postgresql://fancai_dev:postgres123@db/x")
        clean_env.setenv("REDIS_URL", "redis://:redis123@cache:6379/0")
        clean_env.setenv("HAWK_TOKEN", "hawk-token")

        is_valid, report = SecretsValidator(is_production=True).validate_all_secrets()

        assert is_valid is False
        assert any("DATABASE_URL" in e for e in report["errors"])
        assert any("REDIS_URL" in e for e in report["errors"])

    def test_hawk_token_required_only_in_production(self, clean_env):
        _set_valid_required(clean_env, production=True)

        prod_valid, prod_report = SecretsValidator(
            is_production=True
        ).validate_all_secrets()
        dev_valid, dev_report = SecretsValidator(
            is_production=False
        ).validate_all_secrets()

        assert prod_valid is False
        assert "HAWK_TOKEN" in prod_report["missing_recommended"]
        assert dev_valid is True
        assert any("HAWK_TOKEN" in w for w in dev_report["warnings"])

    def test_optional_secrets_are_listed_not_enforced(self, clean_env):
        _set_valid_required(clean_env, production=False)

        is_valid, report = SecretsValidator(is_production=False).validate_all_secrets()

        assert is_valid is True
        assert set(report["missing_optional"]) == {
            s["name"] for s in SECRETS_CONFIG[SecretCategory.OPTIONAL]
        }

    def test_print_report_covers_both_verdicts(self, clean_env):
        """Отчёт печатается и на провале, и на успехе — падать он не должен."""
        failing = SecretsValidator(is_production=True)
        failing.validate_all_secrets()
        failing.print_report()

        _set_valid_required(clean_env, production=True)
        clean_env.setenv("HAWK_TOKEN", "hawk-token")
        clean_env.setenv("SMTP_PASSWORD", "smtp")
        for optional in SECRETS_CONFIG[SecretCategory.OPTIONAL]:
            clean_env.setenv(optional["name"], "set")

        passing = SecretsValidator(is_production=True)
        assert passing.validate_all_secrets()[0] is True
        passing.print_report()


# ============================================================================
# startup_secrets_check
# ============================================================================


class TestStartupSecretsCheck:
    def test_ci_environment_skips_validation(self, clean_env):
        """В CI секретов нет по построению; строгая проверка там неуместна."""
        clean_env.setenv("CI", "true")

        startup_secrets_check()

    @pytest.mark.parametrize(
        "marker,value",
        [
            ("GITHUB_ACTIONS", "true"),
            ("GITLAB_CI", "true"),
            ("CIRCLECI", "true"),
            ("ENVIRONMENT", "test"),
        ],
    )
    def test_every_ci_marker_short_circuits(self, clean_env, marker, value):
        clean_env.setenv(marker, value)

        startup_secrets_check()

    def test_missing_secrets_stop_the_application(self, clean_env):
        """Приложение обязано не стартовать без required secrets."""
        with pytest.raises(SystemExit) as exit_info:
            startup_secrets_check(is_production=True)

        assert exit_info.value.code == 1

    def test_development_mode_starts_with_warnings(self, clean_env):
        clean_env.setenv("SECRET_KEY", "dev-secret-key")
        clean_env.setenv("DATABASE_URL", "postgresql://fancai_dev:postgres123@db/x")
        clean_env.setenv("REDIS_URL", "redis://cache:6379/0")

        startup_secrets_check(is_production=False)

    def test_production_mode_starts_clean(self, clean_env):
        _set_valid_required(clean_env, production=True)
        clean_env.setenv("HAWK_TOKEN", "hawk-token")
        clean_env.setenv("SMTP_PASSWORD", "smtp")
        for optional in SECRETS_CONFIG[SecretCategory.OPTIONAL]:
            clean_env.setenv(optional["name"], "set")

        startup_secrets_check(is_production=True)

    def test_production_flag_is_derived_from_debug(self, clean_env):
        """`DEBUG=false` без явного аргумента означает production."""
        clean_env.setenv("DEBUG", "false")

        with pytest.raises(SystemExit):
            startup_secrets_check()


# ============================================================================
# Вспомогательные функции
# ============================================================================


class TestSecretHelpers:
    def test_generated_key_is_64_hex_chars_and_unique(self):
        first, second = generate_secret_key(), generate_secret_key()

        assert len(first) == 64
        assert int(first, 16) >= 0
        assert first != second

    def test_template_lists_every_configured_secret(self):
        template = get_secret_template()

        for name in ALL_SECRET_NAMES:
            assert f"{name}=" in template

    @pytest.mark.asyncio
    async def test_absent_file_reports_nothing(self, tmp_path):
        has_secrets, found = await check_secrets_in_file(
            str(tmp_path / "nope.env")
        )

        assert (has_secrets, found) == (False, [])

    @pytest.mark.asyncio
    async def test_filled_values_are_detected(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text(
            "SECRET_KEY=actual-value\nDATABASE_URL=postgresql://x\nREDIS_URL=\n"
        )

        has_secrets, found = await check_secrets_in_file(str(env_file))

        assert has_secrets is True
        # REDIS_URL пустой — это не заполненный секрет.
        assert set(found) == {"SECRET_KEY", "DATABASE_URL"}

    @pytest.mark.asyncio
    async def test_unreadable_file_is_reported_as_clean(self, tmp_path):
        """Каталог вместо файла: ошибка чтения не должна ронять проверку."""
        directory = tmp_path / "as_dir"
        directory.mkdir()

        has_secrets, found = await check_secrets_in_file(str(directory))

        assert (has_secrets, found) == (False, [])

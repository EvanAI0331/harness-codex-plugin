from pathlib import Path

from scripts.harness_cli import explain, verify_plugin, verify_specs


ROOT = Path(__file__).resolve().parents[1]


def test_verify_plugin_passes_for_package() -> None:
    result = verify_plugin(ROOT)
    assert result["ok"] is True, result


def test_verify_specs_passes_for_package() -> None:
    result = verify_specs(ROOT)
    assert result["ok"] is True, result


def test_verify_plugin_fails_closed_for_missing_root(tmp_path: Path) -> None:
    result = verify_plugin(tmp_path)
    assert result["ok"] is False
    assert result["failure_state"] == "failed_plugin_verification"
    assert result["details"]["missing_files"]


def test_explain_reports_combined_status() -> None:
    result = explain(ROOT)
    assert result["ok"] is True, result
    assert "plugin_verification" in result["result"]
    assert "spec_verification" in result["result"]

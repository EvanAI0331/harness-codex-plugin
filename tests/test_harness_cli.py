import json
from pathlib import Path

from scripts.harness_cli import explain, init_workflow, list_workflow_templates, verify_plugin, verify_specs, verify_workflow


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


def test_list_workflow_templates_passes() -> None:
    result = list_workflow_templates(ROOT)
    assert result["ok"] is True, result
    assert set(result["result"]["templates"]) == {"software_delivery", "research_ops", "content_pipeline"}


def test_init_workflow_creates_valid_contract(tmp_path: Path) -> None:
    output = tmp_path / "workflow.json"
    result = init_workflow("software_delivery", output, ROOT)
    assert result["ok"] is True, result
    assert output.exists()
    verify_result = verify_workflow(output)
    assert verify_result["ok"] is True, verify_result


def test_verify_workflow_fails_closed_for_missing_gate(tmp_path: Path) -> None:
    output = tmp_path / "workflow.json"
    init_result = init_workflow("research_ops", output, ROOT)
    assert init_result["ok"] is True, init_result

    payload = json.loads(output.read_text(encoding="utf-8"))
    payload["gates"] = []
    output.write_text(json.dumps(payload), encoding="utf-8")

    result = verify_workflow(output)
    assert result["ok"] is False
    assert result["failure_state"] == "failed_workflow_verification"
    assert result["details"]["invalid_gates"]


def test_verify_workflow_fails_closed_for_non_llm_role(tmp_path: Path) -> None:
    output = tmp_path / "workflow.json"
    init_result = init_workflow("content_pipeline", output, ROOT)
    assert init_result["ok"] is True, init_result

    payload = output.read_text(encoding="utf-8").replace('"llm_driven": true', '"llm_driven": false', 1)
    output.write_text(payload, encoding="utf-8")

    result = verify_workflow(output)
    assert result["ok"] is False
    assert result["details"]["invalid_roles"]

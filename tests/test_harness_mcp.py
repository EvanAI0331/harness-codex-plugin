from pathlib import Path

from scripts.harness_mcp import harness_init_workflow, harness_list_workflow_templates, harness_verify_workflow


ROOT = Path(__file__).resolve().parents[1]


def test_mcp_list_workflow_templates() -> None:
    result = harness_list_workflow_templates(str(ROOT))
    assert result["ok"] is True, result
    assert "software_delivery" in result["result"]["templates"]


def test_mcp_init_and_verify_workflow(tmp_path: Path) -> None:
    output = tmp_path / "workflow.json"
    init_result = harness_init_workflow("software_delivery", str(output), str(ROOT))
    assert init_result["ok"] is True, init_result

    verify_result = harness_verify_workflow(str(output))
    assert verify_result["ok"] is True, verify_result


def test_mcp_verify_workflow_fails_closed_on_invalid_contract(tmp_path: Path) -> None:
    output = tmp_path / "invalid.workflow.json"
    output.write_text('{"schema_version":"0.1"}', encoding="utf-8")

    result = harness_verify_workflow(str(output))
    assert result["ok"] is False
    assert result["failure_state"] == "failed_workflow_verification"
    assert result["details"]["missing_fields"]

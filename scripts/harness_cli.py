#!/usr/bin/env python3
"""Harness Codex plugin verification CLI.

The verifier is intentionally fail-closed: missing metadata, missing specs, or
invalid plugin wiring returns ok=false with explicit failure_state/details.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


PLUGIN_NAME = "harness-codex-plugin"
REQUIRED_ROOT_FILES = [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "package.json",
    "shared/schemas/harness-workflow.schema.json",
    "shared/schemas/harness-blueprint.schema.json",
    "shared/schemas/specx-contract.schema.json",
]
REQUIRED_SKILLS = [
    "harness-workflow-builder",
    "harness-runtime-verifier",
    "harness-plugin-packager",
]
REQUIRED_SPEC_FAMILIES = [
    "harness",
    "planner",
    "runtime",
    "run",
    "specx",
    "script_authoring",
]
REQUIRED_SPEC_FILES = [
    "role.spec.json",
    "execution.spec.json",
    "output.spec.json",
    "manifest.json",
]
LLM_STAGE_TOKENS = ["llm"]
CAPABILITY_STAGE_TOKENS = ["capability", "skill", "script"]
WORKFLOW_TEMPLATES = {
    "software_delivery": "templates/software_delivery.workflow.json",
    "research_ops": "templates/research_ops.workflow.json",
    "content_pipeline": "templates/content_pipeline.workflow.json",
}
WORKFLOW_REQUIRED_FIELDS = [
    "workflow_id",
    "schema_version",
    "name",
    "objective",
    "roles",
    "gates",
    "artifacts",
    "failure_semantics",
    "execution_policy",
]


def ok(result: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "result": result}


def fail(error: str, failure_state: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "error": error,
        "failure_state": failure_state,
        "details": details or {},
    }


def load_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, "file_not_found"
    except json.JSONDecodeError as exc:
        return None, f"invalid_json: {exc}"
    if not isinstance(payload, dict):
        return None, "json_root_must_be_object"
    return payload, None


def verify_plugin(root_path: str | Path = ".") -> dict[str, Any]:
    root = Path(root_path).resolve()
    details: dict[str, Any] = {
        "missing_files": [],
        "invalid_plugin_json": [],
        "missing_skills": [],
        "invalid_mcp": [],
        "missing_marketplace": [],
    }

    for relative in REQUIRED_ROOT_FILES:
        if not (root / relative).exists():
            details["missing_files"].append(relative)

    plugin_json_path = root / ".codex-plugin" / "plugin.json"
    plugin_json, plugin_error = load_json(plugin_json_path)
    if plugin_error:
        details["invalid_plugin_json"].append({"path": str(plugin_json_path), "error": plugin_error})
    elif plugin_json:
        if plugin_json.get("name") != PLUGIN_NAME:
            details["invalid_plugin_json"].append(
                {"field": "name", "expected": PLUGIN_NAME, "actual": plugin_json.get("name")}
            )
        if plugin_json.get("skills") != "./skills/":
            details["invalid_plugin_json"].append(
                {"field": "skills", "expected": "./skills/", "actual": plugin_json.get("skills")}
            )
        if plugin_json.get("mcpServers") != "./.mcp.json":
            details["invalid_plugin_json"].append(
                {"field": "mcpServers", "expected": "./.mcp.json", "actual": plugin_json.get("mcpServers")}
            )

    for skill in REQUIRED_SKILLS:
        skill_path = root / "skills" / skill / "SKILL.md"
        if not skill_path.exists():
            details["missing_skills"].append(str(skill_path.relative_to(root)))

    mcp_json, mcp_error = load_json(root / ".mcp.json")
    if mcp_error:
        details["invalid_mcp"].append({"path": ".mcp.json", "error": mcp_error})
    elif mcp_json:
        servers = mcp_json.get("mcpServers")
        if not isinstance(servers, dict) or "harness" not in servers:
            details["invalid_mcp"].append({"field": "mcpServers.harness", "error": "missing"})
        else:
            harness = servers["harness"]
            if not isinstance(harness, dict) or harness.get("command") != "python3":
                details["invalid_mcp"].append({"field": "harness.command", "expected": "python3"})
            if not isinstance(harness, dict) or "./scripts/launch_harness_mcp.py" not in harness.get("args", []):
                details["invalid_mcp"].append({"field": "harness.args", "expected": "./scripts/launch_harness_mcp.py"})

    if not (root / ".agents" / "plugins" / "marketplace.json").exists():
        details["missing_marketplace"].append(".agents/plugins/marketplace.json")

    if has_errors(details):
        return fail("Harness Codex plugin verification failed.", "failed_plugin_verification", details)

    return ok(
        {
            "plugin": PLUGIN_NAME,
            "root": str(root),
            "skills": REQUIRED_SKILLS,
            "mcp_tools": [
                "harness.verify_plugin",
                "harness.verify_specs",
                "harness.list_workflow_templates",
                "harness.init_workflow",
                "harness.verify_workflow",
                "harness.explain",
            ],
        }
    )


def list_workflow_templates(root_path: str | Path = ".") -> dict[str, Any]:
    root = Path(root_path).resolve()
    templates: dict[str, Any] = {}
    missing_templates = []
    for name, relative in WORKFLOW_TEMPLATES.items():
        path = root / relative
        if not path.exists():
            missing_templates.append(relative)
            continue
        payload, error = load_json(path)
        if error:
            return fail(
                "Harness workflow template registry contains invalid JSON.",
                "failed_workflow_template_registry",
                {"template": name, "path": relative, "error": error},
            )
        templates[name] = {
            "path": relative,
            "name": payload.get("name") if payload else name,
            "objective": payload.get("objective") if payload else "",
        }
    if missing_templates:
        return fail(
            "Harness workflow template registry is incomplete.",
            "failed_workflow_template_registry",
            {"missing_templates": missing_templates},
        )
    return ok({"templates": templates})


def init_workflow(template: str, output: str | Path | None = None, root_path: str | Path = ".") -> dict[str, Any]:
    root = Path(root_path).resolve()
    relative = WORKFLOW_TEMPLATES.get(template)
    if not relative:
        return fail(
            "Unknown Harness workflow template.",
            "failed_unknown_workflow_template",
            {"template": template, "available_templates": sorted(WORKFLOW_TEMPLATES)},
        )

    source_path = root / relative
    payload, error = load_json(source_path)
    if error:
        return fail(
            "Harness workflow template is unreadable.",
            "failed_workflow_template_load",
            {"template": template, "path": relative, "error": error},
        )

    validation = verify_workflow_payload(payload or {}, source_path)
    if not validation["ok"]:
        return validation

    if output is not None:
        output_path = Path(output).expanduser()
        if not output_path.is_absolute():
            output_path = (Path.cwd() / output_path).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return ok({"template": template, "output": str(output_path), "workflow": payload})

    return ok({"template": template, "workflow": payload})


def verify_workflow(path: str | Path) -> dict[str, Any]:
    workflow_path = Path(path).expanduser()
    if not workflow_path.is_absolute():
        workflow_path = (Path.cwd() / workflow_path).resolve()
    payload, error = load_json(workflow_path)
    if error:
        return fail(
            "Harness workflow verification failed.",
            "failed_workflow_verification",
            {"path": str(workflow_path), "invalid_json": error},
        )
    return verify_workflow_payload(payload or {}, workflow_path)


def verify_workflow_payload(payload: dict[str, Any], source_path: Path) -> dict[str, Any]:
    details: dict[str, Any] = {
        "missing_fields": [],
        "invalid_roles": [],
        "invalid_gates": [],
        "invalid_artifacts": [],
        "invalid_failure_semantics": [],
        "invalid_execution_policy": [],
    }

    for field in WORKFLOW_REQUIRED_FIELDS:
        if field not in payload:
            details["missing_fields"].append(field)

    if payload.get("schema_version") != "0.1":
        details["missing_fields"].append("schema_version=0.1")

    roles = payload.get("roles")
    if not isinstance(roles, list) or not roles:
        details["invalid_roles"].append("roles must be a non-empty array")
    else:
        for index, role in enumerate(roles):
            if not isinstance(role, dict):
                details["invalid_roles"].append({"index": index, "error": "role must be object"})
                continue
            missing = [field for field in ("role_id", "role_spec", "execution_spec", "output_spec", "llm_driven") if field not in role]
            if missing:
                details["invalid_roles"].append({"index": index, "missing_fields": missing})
            if role.get("llm_driven") is not True:
                details["invalid_roles"].append({"index": index, "error": "agent roles must be explicitly llm_driven=true"})

    gates = payload.get("gates")
    if not isinstance(gates, list) or not gates:
        details["invalid_gates"].append("gates must be a non-empty array")
    else:
        for index, gate in enumerate(gates):
            if not isinstance(gate, dict):
                details["invalid_gates"].append({"index": index, "error": "gate must be object"})
                continue
            missing = [field for field in ("gate_id", "condition", "required_evidence", "on_pass", "on_failure") if field not in gate]
            if missing:
                details["invalid_gates"].append({"index": index, "missing_fields": missing})

    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        details["invalid_artifacts"].append("artifacts must be a non-empty array")
    else:
        for index, artifact in enumerate(artifacts):
            if not isinstance(artifact, dict):
                details["invalid_artifacts"].append({"index": index, "error": "artifact must be object"})
                continue
            missing = [field for field in ("artifact_id", "artifact_type", "required") if field not in artifact]
            if missing:
                details["invalid_artifacts"].append({"index": index, "missing_fields": missing})

    failure_semantics = payload.get("failure_semantics")
    if not isinstance(failure_semantics, dict):
        details["invalid_failure_semantics"].append("failure_semantics must be object")
    else:
        for key in ("no_fake_success", "no_silent_fallback", "explicit_failure_state"):
            if failure_semantics.get(key) is not True:
                details["invalid_failure_semantics"].append({key: "must be true"})

    execution_policy = payload.get("execution_policy")
    if not isinstance(execution_policy, dict):
        details["invalid_execution_policy"].append("execution_policy must be object")
    else:
        required_checks = execution_policy.get("required_checks")
        if not isinstance(required_checks, list) or not required_checks:
            details["invalid_execution_policy"].append("execution_policy.required_checks must be non-empty")

    if has_errors(details):
        return fail(
            "Harness workflow verification failed.",
            "failed_workflow_verification",
            {"path": str(source_path), **details},
        )

    return ok(
        {
            "path": str(source_path),
            "workflow_id": payload.get("workflow_id"),
            "schema_version": payload.get("schema_version"),
            "roles": len(payload.get("roles", [])),
            "gates": len(payload.get("gates", [])),
            "artifacts": len(payload.get("artifacts", [])),
        }
    )


def verify_specs(root_path: str | Path = ".") -> dict[str, Any]:
    root = Path(root_path).resolve()
    details: dict[str, Any] = {
        "missing_spec_files": [],
        "invalid_json": [],
        "invalid_execution_specs": [],
        "missing_llm_driven_stage": [],
    }

    for family in REQUIRED_SPEC_FAMILIES:
        family_dir = root / "shared" / "specs" / family
        for spec_file in REQUIRED_SPEC_FILES:
            path = family_dir / spec_file
            if not path.exists():
                details["missing_spec_files"].append(str(path.relative_to(root)))
                continue
            payload, error = load_json(path)
            if error:
                details["invalid_json"].append({"path": str(path.relative_to(root)), "error": error})
                continue
            if spec_file == "execution.spec.json":
                stages = payload.get("stages") if payload else None
                if stages is None and payload:
                    stages = payload.get("requiredStages")
                if not isinstance(stages, list) or not stages:
                    details["invalid_execution_specs"].append(
                        {"path": str(path.relative_to(root)), "error": "stages or requiredStages must be a non-empty array"}
                    )
                elif family in {"planner", "runtime", "run", "specx", "script_authoring"}:
                    normalized_stages = [str(stage).lower() for stage in stages]
                    has_llm_stage = any(any(token in stage for token in LLM_STAGE_TOKENS) for stage in normalized_stages)
                    has_capability_stage = any(
                        any(token in stage for token in CAPABILITY_STAGE_TOKENS) for stage in normalized_stages
                    )
                    missing_stages = []
                    if not has_llm_stage:
                        missing_stages.append("llm-driven-decision-stage")
                    if not has_capability_stage:
                        missing_stages.append("capability-or-skill-stage")
                    if missing_stages:
                        details["missing_llm_driven_stage"].append(
                            {"path": str(path.relative_to(root)), "missing_stages": missing_stages}
                        )

    if has_errors(details):
        return fail("Harness spec verification failed.", "failed_spec_verification", details)

    return ok(
        {
            "spec_families": REQUIRED_SPEC_FAMILIES,
            "required_files": REQUIRED_SPEC_FILES,
            "llm_stage_tokens": LLM_STAGE_TOKENS,
            "capability_stage_tokens": CAPABILITY_STAGE_TOKENS,
        }
    )


def explain(root_path: str | Path = ".") -> dict[str, Any]:
    root = Path(root_path).resolve()
    plugin_result = verify_plugin(root)
    specs_result = verify_specs(root)
    return {
        "ok": plugin_result["ok"] and specs_result["ok"],
        "result": {
            "plugin": PLUGIN_NAME,
            "root": str(root),
            "purpose": "Workflow-first Codex plugin for custom agent harnesses.",
            "principles": [
                "LLM-driven agent logic",
                "role/execution/output specs",
                "artifact evidence",
                "fail-closed verification",
                "no fake success",
                "no silent fallback",
            ],
            "plugin_verification": plugin_result,
            "spec_verification": specs_result,
        },
    }


def has_errors(details: dict[str, Any]) -> bool:
    return any(bool(value) for value in details.values())


def print_json(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0 if payload.get("ok") is True else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Harness Codex plugin CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command in ("verify-plugin", "verify-specs", "explain"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("root", nargs="?", default=".")

    init_parser = subparsers.add_parser("init-workflow")
    init_parser.add_argument("--template", required=True, choices=sorted(WORKFLOW_TEMPLATES))
    init_parser.add_argument("--output", required=True)
    init_parser.add_argument("--root", default=".")

    verify_workflow_parser = subparsers.add_parser("verify-workflow")
    verify_workflow_parser.add_argument("path")

    list_templates_parser = subparsers.add_parser("list-workflow-templates")
    list_templates_parser.add_argument("root", nargs="?", default=".")

    args = parser.parse_args(argv)

    if args.command == "verify-plugin":
        return print_json(verify_plugin(args.root))
    if args.command == "verify-specs":
        return print_json(verify_specs(args.root))
    if args.command == "explain":
        return print_json(explain(args.root))
    if args.command == "list-workflow-templates":
        return print_json(list_workflow_templates(args.root))
    if args.command == "init-workflow":
        return print_json(init_workflow(args.template, args.output, args.root))
    if args.command == "verify-workflow":
        return print_json(verify_workflow(args.path))

    return print_json(fail("Unsupported command.", "failed_unsupported_command", {"command": args.command}))


if __name__ == "__main__":
    sys.exit(main())

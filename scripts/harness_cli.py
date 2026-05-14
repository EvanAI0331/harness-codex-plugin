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
            "mcp_tools": ["harness.verify_plugin", "harness.verify_specs", "harness.explain"],
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

    args = parser.parse_args(argv)

    if args.command == "verify-plugin":
        return print_json(verify_plugin(args.root))
    if args.command == "verify-specs":
        return print_json(verify_specs(args.root))
    if args.command == "explain":
        return print_json(explain(args.root))

    return print_json(fail("Unsupported command.", "failed_unsupported_command", {"command": args.command}))


if __name__ == "__main__":
    sys.exit(main())

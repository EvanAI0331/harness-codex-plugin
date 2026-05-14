#!/usr/bin/env python3
"""MCP tools for Harness Codex plugin verification."""

from __future__ import annotations

from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover
    raise ImportError("Install the MCP SDK with `python3 -m pip install -r requirements.txt`.") from exc

from scripts.harness_cli import explain, init_workflow, list_workflow_templates, verify_plugin, verify_specs, verify_workflow


def harness_verify_plugin(root: str = ".") -> dict[str, Any]:
    return verify_plugin(root)


def harness_verify_specs(root: str = ".") -> dict[str, Any]:
    return verify_specs(root)


def harness_list_workflow_templates(root: str = ".") -> dict[str, Any]:
    return list_workflow_templates(root)


def harness_init_workflow(template: str, output: str | None = None, root: str = ".") -> dict[str, Any]:
    return init_workflow(template, output, root)


def harness_verify_workflow(path: str) -> dict[str, Any]:
    return verify_workflow(path)


def harness_explain(root: str = ".") -> dict[str, Any]:
    return explain(root)


def build_server() -> FastMCP:
    server = FastMCP(
        "harness-codex-plugin",
        instructions=(
            "Harness builds and verifies custom workflow frameworks for Codex. "
            "Tools fail closed and never convert missing specs or artifacts into success."
        ),
    )

    @server.tool(
        name="harness.verify_plugin",
        description="Verify Codex plugin metadata, skills, MCP wiring, and marketplace metadata.",
    )
    def verify_plugin_tool(root: str = ".") -> dict[str, Any]:
        return harness_verify_plugin(root)

    @server.tool(
        name="harness.verify_specs",
        description="Verify Harness role, execution, and output specs for required LLM-driven stages.",
    )
    def verify_specs_tool(root: str = ".") -> dict[str, Any]:
        return harness_verify_specs(root)

    @server.tool(
        name="harness.list_workflow_templates",
        description="List built-in Harness workflow contract templates.",
    )
    def list_workflow_templates_tool(root: str = ".") -> dict[str, Any]:
        return harness_list_workflow_templates(root)

    @server.tool(
        name="harness.init_workflow",
        description="Create a workflow contract skeleton from a built-in template. This does not execute the workflow.",
    )
    def init_workflow_tool(template: str, output: str | None = None, root: str = ".") -> dict[str, Any]:
        return harness_init_workflow(template, output, root)

    @server.tool(
        name="harness.verify_workflow",
        description="Fail-closed verification for a Harness workflow contract file.",
    )
    def verify_workflow_tool(path: str) -> dict[str, Any]:
        return harness_verify_workflow(path)

    @server.tool(
        name="harness.explain",
        description="Explain Harness plugin status and verification results.",
    )
    def explain_tool(root: str = ".") -> dict[str, Any]:
        return harness_explain(root)

    return server


mcp = build_server()


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()

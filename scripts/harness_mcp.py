#!/usr/bin/env python3
"""MCP tools for Harness Codex plugin verification."""

from __future__ import annotations

from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover
    raise ImportError("Install the MCP SDK with `python3 -m pip install -r requirements.txt`.") from exc

from scripts.harness_cli import explain, verify_plugin, verify_specs


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
    def harness_verify_plugin(root: str = ".") -> dict[str, Any]:
        return verify_plugin(root)

    @server.tool(
        name="harness.verify_specs",
        description="Verify Harness role, execution, and output specs for required LLM-driven stages.",
    )
    def harness_verify_specs(root: str = ".") -> dict[str, Any]:
        return verify_specs(root)

    @server.tool(
        name="harness.explain",
        description="Explain Harness plugin status and verification results.",
    )
    def harness_explain(root: str = ".") -> dict[str, Any]:
        return explain(root)

    return server


mcp = build_server()


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()

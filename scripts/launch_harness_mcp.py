#!/usr/bin/env python3
"""Launch the Harness MCP server from the plugin root."""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from scripts.harness_mcp import main


if __name__ == "__main__":
    main()

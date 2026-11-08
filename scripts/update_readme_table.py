#!/usr/bin/env python3
"""
Scan subdirectories in the repository, detect tool metadata, and update the
table in README.md between the <!-- TOOLS_TABLE_START --> and
<!-- TOOLS_TABLE_END --> markers.
"""

import json
import os
import re
import sys
from pathlib import Path

START_MARKER = "<!-- TOOLS_TABLE_START -->"
END_MARKER = "<!-- TOOLS_TABLE_END -->"

IGNORED_DIRS = {".git", ".github", "scripts", "node_modules", "dist", "build"}


def infer_tool_info(tool_dir: Path):
    name = tool_dir.name
    tool_type = "Utility"
    description = ""

    # Check for browser extension manifest
    manifest_path = tool_dir / "manifest.json"
    if manifest_path.is_file():
        tool_type = "Browser Extension"
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "description" in data:
                    description = data["description"].strip()
                if "name" in data and not description:
                    description = data["name"].strip()
        except Exception:
            pass

    # Check package.json
    pkg_path = tool_dir / "package.json"
    if pkg_path.is_file():
        if tool_type == "Utility":
            tool_type = "Node.js Tool"
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "description" in data and not description:
                    description = data["description"].strip()
        except Exception:
            pass

    # Check python setup / pyproject
    if (tool_dir / "pyproject.toml").is_file() or (tool_dir / "setup.py").is_file():
        if tool_type == "Utility":
            tool_type = "Python Tool"

    # Check shell scripts
    sh_files = list(tool_dir.glob("*.sh"))
    if sh_files and tool_type == "Utility":
        tool_type = "Shell Script"

    # Fallback to tool README.md if description is missing
    readme_path = tool_dir / "README.md"
    if readme_path.is_file() and not description:
        try:
            with open(readme_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        description = line
                        break
        except Exception:
            pass

    if not description:
        description = f"{name} utility"

    # Clean description (remove pipe characters to avoid breaking markdown tables)
    description = description.replace("|", "-").strip()

    return {
        "name": name,
        "rel_path": f"{name}/",
        "type": tool_type,
        "description": description,
    }


def generate_table(tools):
    lines = [
        "| Tool | Type | Description |",
        "|---|---|---|",
    ]
    for t in tools:
        lines.append(f"| [`{t['name']}`]({t['rel_path']}) | {t['type']} | {t['description']} |")
    return "\n".join(lines)


def update_readme(repo_root: Path):
    readme_path = repo_root / "README.md"
    if not readme_path.is_file():
        print(f"README.md not found at {readme_path}", file=sys.stderr)
        return False

    with open(readme_path, "r", encoding="utf-8") as f:
        content = f.read()

    tools = []
    for item in sorted(repo_root.iterdir()):
        if item.is_dir() and item.name not in IGNORED_DIRS and not item.name.startswith("."):
            tools.append(infer_tool_info(item))

    table_markdown = generate_table(tools)

    if START_MARKER in content and END_MARKER in content:
        pattern = re.compile(
            rf"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}",
            re.DOTALL,
        )
        new_content = pattern.sub(
            f"{START_MARKER}\n{table_markdown}\n{END_MARKER}",
            content,
        )
    else:
        # If markers don't exist, replace the existing table under Directory or add one
        dir_heading = "## Directory\n"
        if dir_heading in content:
            parts = content.split(dir_heading, 1)
            # Find next heading if any
            rest = parts[1]
            next_heading_idx = rest.find("\n## ")
            if next_heading_idx != -1:
                after = rest[next_heading_idx:]
            else:
                after = ""
            new_content = (
                f"{parts[0]}{dir_heading}\n{START_MARKER}\n{table_markdown}\n{END_MARKER}\n{after}"
            )
        else:
            new_content = f"{content}\n\n## Directory\n\n{START_MARKER}\n{table_markdown}\n{END_MARKER}\n"

    if new_content != content:
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("README.md updated with latest tools table.")
        return True
    else:
        print("README.md is already up to date.")
        return False


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    update_readme(repo_root)

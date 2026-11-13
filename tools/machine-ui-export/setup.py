"""Prepare a separate UI snapshot client from an existing validated disposable export."""

import argparse
import json
import shutil
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--prepared-export", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = args.prepared_export.resolve()
target = args.output.resolve()
workspace = root / ".export-work"
if (
    not source.is_relative_to(workspace)
    or not target.is_relative_to(workspace)
    or target == workspace
):
    raise ValueError(
        "Both workspaces must be below this repository .export-work directory"
    )
if target.exists():
    raise ValueError("UI output workspace must be new")
session = json.loads((source / "export-session.json").read_text(encoding="utf-8"))
if session["gtnhVersion"] != "2.9.0":
    raise ValueError("This adapter is pinned to GTNH 2.9.0 / GT5 5.09.54.265")
target.mkdir(parents=True)
build = target / "nesql-exporter"
shutil.copytree(
    source / "nesql-exporter",
    build,
    ignore=shutil.ignore_patterns("build", ".gradle", ".git"),
)
package = build / "src/main/java/com/github/dcysteine/nesql/exporter/main"
shutil.copy2(
    root / "tools/machine-ui-export/BrowserLayoutExporter.java",
    package / "BrowserLayoutExporter.java",
)
shutil.copy2(
    root / "tools/machine-ui-export/BrowserOreDiagramExporter.java",
    package / "BrowserOreDiagramExporter.java",
)
main = package / "Main.java"
text = main.read_text(encoding="utf-8")
anchor = "ExportAutomationController.install();"
if text.count(anchor) != 1:
    raise ValueError("Exporter controller entry point changed")
main.write_text(
    text.replace(anchor, anchor + "\n        BrowserLayoutExporter.install();"),
    encoding="utf-8",
    newline="\n",
)
instance = target / "client-instance"
instance.mkdir()
for name in ["mmc-pack.json", "instance.cfg", "patches", "libraries"]:
    src = source / "client-instance" / name
    if src.is_dir():
        shutil.copytree(src, instance / name)
    else:
        shutil.copy2(src, instance / name)
game = instance / ".minecraft"
game.mkdir()
for name in [
    "mods",
    "config",
    "scripts",
    "resourcepacks",
    "assets",
    "fonts",
    "angelica",
    "coretweaks",
    "falsepattern",
]:
    src = source / "client-instance/.minecraft" / name
    if src.exists():
        shutil.copytree(src, game / name)
# All paths refer to independent copies. Saves, credentials and player files are never copied.
subprocess.run(
    ["sh", "gradlew", "--no-daemon", "--offline", "build", "-x", "test"],
    cwd=build,
    check=True,
)
for name in [session["exporter"]["mainJar"], session["exporter"]["dependenciesJar"]]:
    shutil.copy2(build / "build/libs" / name, game / "mods" / name)
print("Prepared UI snapshot client:", instance)

"""Extract the unchanged ARI 1.1.6 recipe artwork from the pinned 2.9.0 client."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--jar", required=True, type=Path)
args = parser.parse_args()
digest = hashlib.sha256(args.jar.read_bytes()).hexdigest()
if digest != "3dba9786966974701578a658d1bb369bf35bdf5f363079f5ac9c4910a39113be":
    raise ValueError("Expected the pinned GTNH 2.9.0 Thaumcraft 4.2.3.5 jar")
resource = "assets/thaumcraft/textures/gui/gui_researchbook_overlay.png"
with zipfile.ZipFile(args.jar) as archive:
    texture = archive.read(resource)
source = Path("assets/source/machine-ui/thaumcraft")
source.mkdir(parents=True, exist_ok=True)
(source / "researchbook-overlay.png").write_bytes(texture)
target = Path("public/assets/machine-ui/thaumcraft-overlay.png")
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(texture)
(source / "provenance.json").write_bytes(
    (
        json.dumps(
            {
                "gtnhVersion": "2.9.0",
                "thaumcraftVersion": "4.2.3.5",
                "jarSha256": digest,
                "resource": resource,
                "textureSha256": hashlib.sha256(texture).hexdigest(),
                "renderer": "GTNewHorizons/AspectRecipeIndex",
                "rendererVersion": "1.1.6",
                "copyright": "Original Thaumcraft artwork by Azanor; not part of Shadow UI.",
                "processing": "Unchanged source pixels; renderer uses the original 256-unit UV coordinates.",
            },
            indent=2,
        )
        + "\n"
    ).encode()
)
print(f"Extracted {resource} ({len(texture)} bytes)")

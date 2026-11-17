"""Extract NEI utility icons from the pinned GTNH 2.9.0 client jar."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--jar", required=True, type=Path)
args = parser.parse_args()
digest = hashlib.sha256(args.jar.read_bytes()).hexdigest()
if digest != "9a822134bda6cbaf4f414b825fc10dcde8e2944cc366f96df92420e54c88b5a3":
    raise ValueError("Expected pinned NotEnoughItems 2.8.171-GTNH jar")
resource = "assets/nei/textures/nei_sprites.png"
with zipfile.ZipFile(args.jar) as archive:
    texture = archive.read(resource)
source = Path("assets/source/machine-ui/nei")
source.mkdir(parents=True, exist_ok=True)
(source / "nei_sprites.png").write_bytes(texture)
output = Path("public/assets/machine-ui/nei-trash.png")
output.parent.mkdir(parents=True, exist_ok=True)
# LayoutStyleMinecraft.init(): LayoutManager.delete.icon = new Image(144, 12, 12, 12).
image = Image.open(io.BytesIO(texture))
scale = image.width // 256
if image.width != image.height or scale < 1 or image.width % 256:
    raise ValueError("Unexpected NEI texture dimensions")
image.crop(tuple(coordinate * scale for coordinate in (144, 12, 156, 24))).save(output)
if not Image.open(output).convert("RGBA").getbbox():
    raise ValueError("NEI utility icon crop is empty")
(source / "provenance.json").write_bytes(
    (
        json.dumps(
            {
                "gtnhVersion": "2.9.0",
                "neiVersion": "2.8.171-GTNH",
                "jarSha256": digest,
                "resource": resource,
                "textureSha256": hashlib.sha256(texture).hexdigest(),
                "renderer": "GTNewHorizons/NotEnoughItems LayoutStyleMinecraft.init",
                "referenceCommit": "0185cd64b10ed30af47d09e17d5e6062b09226f5",
                "uvCrop": [144, 12, 12, 12],
                "textureScale": scale,
                "outputSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "processing": "Exact source crop; unchanged pixels.",
            },
            indent=2,
        )
        + "\n"
    ).encode()
)
print(f"Extracted {output}")

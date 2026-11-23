"""Extract the recipe backgrounds used by the pinned GTNH NEI handlers."""

import argparse
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from PIL import Image

PINNED_VERSIONS = {
    "Botania": {"1.13.37-GTNH", "1.13.42-GTNH", "1.13.44-GTNH"},
    "BloodMagic": {"1.9.14", "1.9.16", "1.9.18"},
    "TConstruct": {"1.14.118-GTNH", "1.14.123-GTNH", "1.14.124-GTNH"},
}

# Source UV rectangles from the native drawBackground methods. Blood Magic
# inherits TemplateRecipeHandler's 166x65 crop at (5, 11).
CROPS = {
    "Botania": {
        "botania-mana-bar": ("botania/textures/gui/manaHud.png", (0, 0, 102, 5)),
        "botania-mana-pool": (
            "botania/textures/gui/manaInfusionOverlay.png",
            (38, 35, 92, 50),
        ),
        "botania-petals": ("botania/textures/gui/petalOverlay.png", (38, 7, 92, 92)),
        "botania-elven-trade": (
            "botania/textures/gui/elvenTradeOverlay.png",
            (17, 17, 100, 80),
        ),
        "botania-elven-portal": (
            "botania/textures/blocks/alfheimPortalInside.png",
            None,
        ),
        "botania-brewery": ("botania/textures/gui/neiBrewery.png", (0, 0, 166, 65)),
    },
    "BloodMagic": {
        "blood-magic-alchemy": (
            "alchemicalwizardry/gui/nei/alchemy.png",
            (5, 11, 166, 65),
        ),
        "blood-magic-altar": ("alchemicalwizardry/gui/nei/altar.png", (5, 11, 166, 65)),
        "blood-magic-calcinator": (
            "alchemicalwizardry/gui/nei/calcinator.png",
            (5, 11, 166, 65),
        ),
    },
    "TConstruct": {
        "tinkers-casting-table": (
            "tinker/textures/gui/nei/casting.png",
            (0, 0, 112, 55),
        ),
        "tinkers-smeltery-melting": (
            "tinker/textures/gui/nei/smeltery.png",
            (0, 0, 160, 55),
        ),
    },
}

parser = argparse.ArgumentParser()
parser.add_argument(
    "--mods", type=Path, required=True, help="Pinned client mod directory"
)
args = parser.parse_args()
destination = Path("public/assets/machine-ui")
for mod, resources in CROPS.items():
    (jar,) = args.mods.glob(f"{mod}-*.jar")
    if jar.stem.removeprefix(f"{mod}-") not in PINNED_VERSIONS[mod]:
        raise ValueError(f"Unsupported origin for native NEI backgrounds: {jar.name}")
    with ZipFile(jar) as archive:
        for name, (resource, rectangle) in resources.items():
            with Image.open(BytesIO(archive.read(f"assets/{resource}"))) as image:
                # Animations with default frame dimensions stack square frames vertically.
                x, y, width, height = rectangle or (0, 0, image.width, image.width)
                if x + width > image.width or y + height > image.height:
                    raise ValueError(
                        f"{jar.name}: {resource} is smaller than the source UV area"
                    )
                crop = image.crop((x, y, x + width, y + height)).convert("RGBA")
                if crop.getpixel((0, 0)) == (198, 198, 198, 255):
                    # Let the browser panel supply NEI's flat base colour.
                    crop.putdata(
                        [
                            (*pixel[:3], 0) if pixel == (198, 198, 198, 255) else pixel
                            for pixel in crop.getdata()
                        ]
                    )
                crop.save(destination / f"{name}-nei.png", optimize=True)
            print(f"{jar.name}: {resource} -> {name}-nei.png")

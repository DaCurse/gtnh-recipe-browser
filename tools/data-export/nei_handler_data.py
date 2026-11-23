"""Add native recipe pages from a pinned NEI snapshot to a browser sidecar."""

import hashlib
import json

CATEGORY = "botania-pure-daisy"
HANDLER_PREFIX = "vazkii.botania.client.integration.nei.recipe.RecipeHandler"
BATCH_HANDLERS = {
    "ManaPool": "botania-mana-pool",
    "PetalApothecary": "botania-petal-apothecary",
    "RunicAltar": "botania-runic-altar",
    "ElvenTrade": "botania-elven-trade",
    "Brewery": "botania-brewery",
    "FloatingFlowers": "botania-floating-flowers",
    "LexicaBotania": "botania-lexica",
}

ADDITIONAL_HANDLERS = {
    "WayofTime.alchemicalWizardry.client.nei.NEIAlchemyRecipeHandler": "blood-magic-alchemy",
    "WayofTime.alchemicalWizardry.client.nei.NEIAltarRecipeHandler": "blood-magic-altar",
    "WayofTime.alchemicalWizardry.client.nei.NEICalcinatorHandler": "blood-magic-calcinator",
    "WayofTime.alchemicalWizardry.client.nei.NEIBloodOrbShapedHandler": "blood-magic-orb-shaped",
    "tconstruct.plugins.nei.RecipeHandlerCastingTable": "tinkers-casting-table",
    "tconstruct.plugins.nei.RecipeHandlerMelting": "tinkers-smeltery-melting",
}
MATERIAL_DIAGRAMS = ("gt-material-tools", "gt-material-parts")
METADATA = (
    "mana",
    "lifePoints",
    "altarTier",
    "orbTier",
    "consumption",
    "drain",
    "reagentAmount",
    "reagentName",
    "reagentColour",
    "temperature",
    "coolingTicks",
    "consumesCast",
    "entryTitle",
    "entryTagline",
)


def goods_id(stack):
    if "goodsId" in stack:
        return stack["goodsId"]
    goods = f"i:{stack['registryName']}:{stack['damage']}"
    if "nbt" in stack:
        goods += ":" + hashlib.sha1(stack["nbt"].encode()).hexdigest()
    return goods


def slot(source):
    stacks = source["alternatives"]
    ids = list(dict.fromkeys(map(goods_id, stacks)))
    if len({stack["amount"] for stack in stacks}) != 1:
        raise ValueError("NEI slot alternatives disagree on the stack size")
    return {
        "x": source["x"],
        "y": source["y"],
        "alternatives": ids,
        "goodsId": ids[0],
        "amount": stacks[0]["amount"],
    }


def add_native_handler(sidecar, handler, category):
    if "tabIcon" in handler:
        tab_goods = goods_id(handler["tabIcon"])
    elif category == "blood-magic-calcinator":
        # The pinned NEI handler has no tab icon registration. Use the actual
        # Calcinator block, also retained explicitly by current collectors.
        tab_goods = "i:AWWayofTime:blockAlchemicCalcinator:0"
    else:
        raise ValueError(f"No registered tab icon for {category}")
    label = handler["label"]
    icon = register_view(sidecar, category, label, tab_goods)
    seen = set()
    catalysts = (
        {
            goods_id(stack)
            for entry in handler.get("handlerCatalysts", [])
            for stack in entry["alternatives"]
        }
        if category != CATEGORY
        else {tab_goods}
    )
    for page in handler["recipes"]:
        add_native_page(sidecar, page, handler, category, icon, catalysts, seen)


def register_view(sidecar, category, label, tab_goods):
    if category in sidecar["categories"]:
        raise ValueError(f"The sidecar already contains {category} pages")
    icon = f"service:{category}"
    sidecar["categories"].append(category)
    sidecar["serviceIconIds"].append(icon)
    sidecar["serviceIcons"].append(
        {"id": icon, "label": label, "goodsId": tab_goods, "searchable": False}
    )
    sidecar["specialViewTypes"].append(
        {"id": category, "label": label, "serviceIconId": icon}
    )
    return icon


def add_native_page(sidecar, page, handler, category, icon, catalysts, seen):
    source_slots = page["ingredients"] + page["other"]
    if "finisher" in page:
        source_slots.append(page["finisher"])
    inputs = [slot(item) for item in source_slots]
    output = slot(page["result"])
    metadata = {key: page[key] for key in METADATA if key in page}
    identity_fields = [inputs, output]
    if category != CATEGORY:
        identity_fields.extend((metadata, page.get("heightOverride")))
    identity = json.dumps(identity_fields, separators=(",", ":"), sort_keys=True)
    fluid_usages = set()
    for source, ingredient in zip(source_slots, inputs, strict=True):
        fluid_ids = {
            stack["placedFluidId"]
            for stack in source["alternatives"]
            if stack.get("placedFluidId")
        }
        if fluid_ids:
            ingredient["tooltipNotes"] = ["Requires a placed source block"]
            fluid_usages.update(fluid_ids)
    finisher = page.get("finisher", {}).get("kind")
    if finisher == "any-seed":
        inputs[-1]["tooltipNotes"] = ["Requires a seed to finish"]
    elif finisher == "livingrock":
        inputs[-1]["tooltipNotes"] = ["Requires Livingrock to finish"]
    reagent_queries = set(page.get("reagentContainers", ()))
    produced = sorted({*output["alternatives"], *reagent_queries})
    if category == "blood-magic-alchemy":
        for catalyst in inputs[len(page["ingredients"]) :]:
            catalyst["tooltipNotes"] = ["Requires a blood orb"]
    used = sorted(
        {
            *catalysts,
            *fluid_usages,
            *(
                produced
                if category in ("botania-lexica", "blood-magic-calcinator")
                else []
            ),
            *(item for source in inputs for item in source["alternatives"]),
        }
    )
    record_id = f"{category}:{hashlib.sha256(identity.encode()).hexdigest()[:20]}"
    if record_id in seen:
        return
    seen.add(record_id)
    label = handler["label"]
    sidecar["records"].append(
        {
            "id": record_id,
            "category": category,
            "title": page.get("entryTitle") or label,
            "searchText": " ".join([label, *produced, *used]),
            "serviceIconId": icon,
            "goodsIds": sorted(set(produced) | set(used)),
            "productionGoodsIds": produced,
            "usageGoodsIds": used,
            "recipesLookupId": f"special:{record_id}:recipes",
            "usagesLookupId": f"special:{record_id}:usages",
            "inputs": inputs,
            "outputs": [output],
            "payload": {
                **(
                    {"daisy": goods_id(handler["tabIcon"])}
                    if category == CATEGORY
                    else {}
                ),
                **metadata,
                "width": handler["width"],
                "height": page.get("heightOverride") or handler["height"],
                "positions": [[item["x"], item["y"]] for item in [*inputs, output]],
                "regions": [
                    [item.get("width", 16), item.get("height", 16)]
                    for item in [*source_slots, page["result"]]
                ],
            },
        }
    )


def add_nei_handlers(sidecar, snapshot):
    if snapshot.get("schemaVersion") != 1:
        raise ValueError("Unsupported NEI handler snapshot schema")
    if snapshot.get("neiHandlerItemCount", 0) <= 0:
        raise ValueError("NEI handler snapshot predates item-list readiness validation")
    handlers = snapshot["neiHandlers"]
    add_native_handler(sidecar, handlers[HANDLER_PREFIX + "PureDaisy"], CATEGORY)
    # Legacy captures stay Pure Daisy only. The live export provides canonical
    # stack identities for the additional handlers, including exact NBT.
    if snapshot.get("retainedBotaniaStacks"):
        for name, category in BATCH_HANDLERS.items():
            add_native_handler(sidecar, handlers[HANDLER_PREFIX + name], category)
        for name, category in ADDITIONAL_HANDLERS.items():
            add_native_handler(sidecar, handlers[name], category)
        for category in MATERIAL_DIAGRAMS:
            add_material_diagrams(
                sidecar, category, snapshot["materialDiagrams"][category]
            )


def add_material_diagrams(sidecar, category, group):
    label = group["label"]
    icon = register_view(sidecar, category, label, group["icon"])
    recipes = invert_scene_matches(group["matches"]["CRAFTING"])
    usages = invert_scene_matches(group["matches"]["USAGE"])
    if not recipes and not usages:
        raise ValueError(f"No native directional matches for {category}")
    for scene_id, scene in group["scenes"].items():
        directions = {
            "recipes": recipes.get(scene_id, []),
            "usages": usages.get(scene_id, []),
        }
        if not any(directions.values()):
            continue
        goods = {item["id"] for item in scene["labels"]}
        goods.update(
            item["id"] for entry in scene["groups"] for item in entry["components"]
        )
        goods.update(directions["recipes"])
        goods.update(directions["usages"])
        record_id = f"{category}:{scene_id}"
        sidecar["records"].append(
            {
                "id": record_id,
                "category": category,
                "title": label,
                "searchText": " ".join([label, *sorted(goods)]),
                "serviceIconId": icon,
                "goodsIds": sorted(goods),
                "productionGoodsIds": directions["recipes"],
                "usageGoodsIds": directions["usages"],
                "recipesLookupId": f"special:{record_id}:recipes",
                "usagesLookupId": f"special:{record_id}:usages",
                "payload": {"nativeScene": scene},
            }
        )


def invert_scene_matches(matches):
    by_scene = {}
    for goods_id, scene_ids in sorted(matches.items()):
        for scene_id in scene_ids:
            by_scene.setdefault(scene_id, []).append(goods_id)
    return by_scene

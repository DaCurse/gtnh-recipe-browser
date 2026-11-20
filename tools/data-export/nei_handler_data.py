"""Add the native Pure Daisy pages from a pinned NEI snapshot to a browser sidecar."""

import hashlib
import json

CATEGORY = "botania-pure-daisy"
HANDLER = "vazkii.botania.client.integration.nei.recipe.RecipeHandlerPureDaisy"


def goods_id(stack):
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


def add_pure_daisy(sidecar, handler):
    if CATEGORY in sidecar["categories"]:
        raise ValueError("The sidecar already contains Pure Daisy pages")
    icon = f"service:{CATEGORY}"
    daisy = goods_id(handler["tabIcon"])
    label = handler["label"]
    sidecar["categories"].append(CATEGORY)
    sidecar["serviceIconIds"].append(icon)
    sidecar["serviceIcons"].append(
        {"id": icon, "label": label, "goodsId": daisy, "searchable": False}
    )
    sidecar["specialViewTypes"].append(
        {"id": CATEGORY, "label": label, "serviceIconId": icon}
    )
    for page in handler["recipes"]:
        source_slots = page["ingredients"] + page["other"]
        inputs = [slot(item) for item in source_slots]
        output = slot(page["result"])
        identity = json.dumps([inputs, output], separators=(",", ":"), sort_keys=True)
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
        produced = sorted(output["alternatives"])
        used = sorted(
            {
                daisy,
                *fluid_usages,
                *(item for source in inputs for item in source["alternatives"]),
            }
        )
        record_id = f"{CATEGORY}:{hashlib.sha256(identity.encode()).hexdigest()[:20]}"
        sidecar["records"].append(
            {
                "id": record_id,
                "category": CATEGORY,
                "title": label,
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
                    "daisy": daisy,
                    "width": handler["width"],
                    "height": page.get("heightOverride") or handler["height"],
                    "positions": [[item["x"], item["y"]] for item in [*inputs, output]],
                },
            }
        )


def add_nei_handlers(sidecar, snapshot):
    if snapshot.get("schemaVersion") != 1:
        raise ValueError("Unsupported NEI handler snapshot schema")
    if snapshot.get("neiHandlerItemCount", 0) <= 0:
        raise ValueError("NEI handler snapshot predates item-list readiness validation")
    add_pure_daisy(sidecar, snapshot["neiHandlers"][HANDLER])

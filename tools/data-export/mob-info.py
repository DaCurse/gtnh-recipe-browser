"""Project the pinned NESQL MobsInfo tables into the browser special sidecar."""

import argparse
import base64
import csv
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from nei_handler_data import add_nei_handlers

CATALYST = "i:minecraft:diamond_sword:0"
DROP_GROUPS = ("NORMAL", "RARE", "ADDITIONAL")


def decode(value):
    expanded = re.sub(
        r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), value
    )
    return expanded.encode("utf-16", "surrogatepass").decode("utf-16")


def records(script, images):
    items, mobs, info = {}, {}, {}
    drops = defaultdict(list)
    tables = {"ITEM", "MOB", "MOB_INFO", "MOB_INFO_DROPS"}
    csv.field_size_limit(10_000_000)
    with script.open(encoding="utf-8") as stream:
        for row in stream:
            if not row.startswith("INSERT INTO "):
                continue
            table = row.split(" ", 3)[2]
            if table not in tables:
                continue
            fields = next(
                csv.reader(
                    [row.split(" VALUES(", 1)[1].rsplit(")", 1)[0]], quotechar="'"
                )
            )
            key = decode(fields[0])
            if table == "ITEM":
                goods_id = f"i:{decode(fields[8])}:{decode(fields[2])}:{fields[3]}"
                if fields[9]:
                    goods_id += (
                        ":"
                        + hashlib.sha1(decode(fields[9]).encode("utf-8")).hexdigest()
                    )
                items[key] = goods_id
            elif table == "MOB":
                mobs[key] = fields
            elif table == "MOB_INFO":
                info[key] = fields
            else:
                native_notes = (
                    decode(fields[6]).splitlines() if len(fields) == 8 else None
                )
                drop_type = fields[-1]
                if drop_type == "INFERNAL":
                    continue
                if drop_type not in DROP_GROUPS:
                    raise ValueError(f"Unknown Mob Info drop type: {drop_type}")
                chance = float(fields[4])
                amount = int(fields[5])
                if not math.isfinite(chance) or not 0 <= chance <= 1 or amount < 1:
                    raise ValueError(f"Invalid Mob Info drop for {key}")
                if native_notes is None:
                    notes = []
                    if fields[2] == "TRUE":
                        notes.append("Affected by Looting")
                    if fields[3] == "TRUE":
                        notes.append("Player kill required")
                    chance_fields = {"chance": chance}
                else:
                    # NEI supplies the exact chance line or the applicable conditions.
                    notes = native_notes
                    chance_fields = {}
                drops[key].append(
                    (
                        decode(fields[1]),
                        {
                            "groupId": drop_type,
                            **chance_fields,
                            "amount": amount,
                            "tooltipNotes": notes,
                        },
                    )
                )
    for key, mob_drops in sorted(drops.items()):
        mob_info = info[key]
        mob = mobs[decode(mob_info[5])]
        name = decode(mob[8])
        outputs = sorted(
            ({"goodsId": items[item], **drop} for item, drop in mob_drops),
            key=lambda drop: DROP_GROUPS.index(drop["groupId"]),
        )
        image_path = decode(mob[4])
        image = images.getinfo(image_path)
        if image.file_size > 256 * 1024:
            raise ValueError(f"Oversized Mob Info portrait: {image_path}")
        portrait = images.read(image)
        if not portrait.startswith(bytes.fromhex("89504e470d0a1a0a")):
            raise ValueError(f"Invalid Mob Info portrait: {image_path}")
        ids = sorted({drop["goodsId"] for drop in outputs})
        record_id = f"mob-info:{key}"
        yield {
            "id": record_id,
            "title": name,
            "category": "mob-info",
            "searchText": f"{name} {decode(mob[6])} {decode(mob[9])} {' '.join(ids)}",
            "serviceIconId": "service:mob-info",
            "goodsIds": sorted(set(ids) | {CATALYST}),
            "productionGoodsIds": ids,
            "usageGoodsIds": [CATALYST],
            "recipesLookupId": f"special:{record_id}:recipes",
            "usagesLookupId": f"special:{record_id}:usages",
            "outputs": outputs,
            "payload": {
                "health": float(mob[2]),
                "mod": decode(mob[9]),
                "portraitPng": base64.b64encode(portrait).decode("ascii"),
                "peaceful": mob_info[1] == "TRUE",
                "infernal": mob_info[2] == "TRUE",
                "alwaysInfernal": mob_info[3] == "TRUE",
                "soulVial": mob_info[4] == "TRUE",
            },
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--sidecar", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--infernal-config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--nei-snapshot", type=Path)
    args = parser.parse_args()
    sidecar = json.loads(args.sidecar.read_text(encoding="utf-8"))
    with ZipFile(args.images) as images:
        entries = list(records(args.script, images))
    if not entries:
        raise ValueError("NESQL contains no Mob Info drops")
    sidecar["categories"].append("mob-info")
    sidecar["serviceIcons"].append(
        {
            "id": "service:mob-info",
            "label": "Mob Info",
            "goodsId": CATALYST,
            "searchable": False,
        }
    )
    sidecar["serviceIconIds"].append("service:mob-info")
    sidecar["specialViewTypes"].append(
        {"id": "mob-info", "label": "Mob Info", "serviceIconId": "service:mob-info"}
    )
    sidecar["records"].extend(entries)
    infernal = infernal_record(args.infernal_config)
    sidecar["categories"].append("infernal-drops")
    sidecar["serviceIconIds"].append("service:infernal-drops")
    sidecar["serviceIcons"].append(
        {
            "id": "service:infernal-drops",
            "label": "Infernal Drops",
            "goodsId": CATALYST,
            "searchable": False,
        }
    )
    sidecar["specialViewTypes"].append(
        {
            "id": "infernal-drops",
            "label": "Infernal Drops",
            "serviceIconId": "service:infernal-drops",
        }
    )
    sidecar["records"].append(infernal)
    if args.nei_snapshot:
        snapshot = json.loads(args.nei_snapshot.read_text(encoding="utf-8"))
        add_nei_handlers(sidecar, snapshot)
    args.output.write_text(
        json.dumps(sidecar, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Exported {len(entries)} Mob Info drop tables")


def infernal_record(path):
    config = dict(
        re.findall(
            r"^\s*[IS]:([A-Za-z]+)=(.*)$", path.read_text(encoding="utf-8"), re.M
        )
    )
    outputs, tiers = [], []
    normal_chance = forced_chance = 1.0
    for index, (tier, suffix, rarity) in enumerate(
        (
            ("Elite", "Elite", "eliteRarity"),
            ("Ultra", "Ultra", "ultraRarity"),
            ("Inferno", "Infernal", "infernoRarity"),
        )
    ):
        denominator = int(config[rarity])
        if denominator < 1:
            raise ValueError(f"Invalid Infernal Mobs rarity: {rarity}")
        normal_chance /= denominator
        if index:
            forced_chance /= denominator
        pool = []
        for token in config[f"droppedItemIDs{suffix}"].split(","):
            name, *arguments = token.strip().split("-")
            # The pinned core passes the first field directly to the item/block
            # registry. These legacy potion tokens are not registered names.
            if name in {"potion@8225", "potion@8229"}:
                print(f"Infernal Mobs skips unregistered registry name {name}")
                continue
            if not name or len(arguments) > 3:
                raise ValueError(f"Malformed Infernal Mobs drop: {token}")
            meta, amount, extra = (
                list(map(int, arguments)) + [0, 1, 0][len(arguments) :]
            )
            registry_name = name if ":" in name else f"minecraft:{name}"
            pool.append(
                {
                    "goodsId": f"i:{registry_name}:{meta}",
                    "groupId": tier,
                    "minAmount": amount,
                    "maxAmount": amount + max(0, extra),
                }
            )
        if not pool:
            raise ValueError(f"Empty Infernal Mobs drop pool: {tier}")
        for drop in pool:
            drop["tooltipNotes"] = [
                f"Total chance to get: {normal_chance / len(pool):.4%}",
                f"Total chance to get when always infernal: {forced_chance / len(pool):.4%}",
            ]
        outputs.extend(pool)
        tiers.append(
            {"name": tier, "chance": normal_chance, "alwaysChance": forced_chance}
        )
    ids = sorted({drop["goodsId"] for drop in outputs})
    return {
        "id": "infernal-drops:configured-pools",
        "category": "infernal-drops",
        "title": "Infernal Mobs Drop Table",
        "searchText": "Infernal Mobs Elite Ultra Inferno " + " ".join(ids),
        "serviceIconId": "service:infernal-drops",
        "goodsIds": sorted(set(ids) | {CATALYST}),
        "productionGoodsIds": ids,
        "usageGoodsIds": [CATALYST],
        "recipesLookupId": "special:infernal-drops:configured-pools:recipes",
        "usagesLookupId": "special:infernal-drops:configured-pools:usages",
        "outputs": outputs,
        "payload": {
            "tiers": tiers,
            "configSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
    }


if __name__ == "__main__":
    main()

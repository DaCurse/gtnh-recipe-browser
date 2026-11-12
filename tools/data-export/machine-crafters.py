"""Retain all GT recipe catalysts independently of format-v5's tier representatives."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import quote

parser = argparse.ArgumentParser()
parser.add_argument('--script', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
csv.field_size_limit(10_000_000)

def text(value):
    value = re.sub(r'\\u([a-fA-F0-9]{4})', lambda m: chr(int(m[1], 16)), value)
    return value.encode('utf-16', 'surrogatepass').decode('utf-16')

items, types, links = {}, {}, []
tiers = ['LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UMV', 'UXV', 'MAX']
with args.script.open(encoding='utf-8') as stream:
    for line in stream:
        table = next((name for name in ['ITEM', 'RECIPE_TYPE', 'RECIPE_TYPE_ITEM'] if line.startswith('INSERT INTO ' + name + ' VALUES(')), None)
        if table is None:
            continue
        values = [text(value) for value in next(csv.reader([line[line.index('(') + 1:line.rindex(')')]], delimiter=',', quotechar="'", doublequote=True))]
        if table == 'ITEM':
            goods_id = f'i:{values[8]}:{values[2]}:{values[3]}'
            if values[9]:
                goods_id += ':' + hashlib.sha1(values[9].encode('utf-8')).hexdigest()
            tooltip = re.sub(r'§.', '', values[10])
            tooltip = re.sub(r'<br\s*/?>', '\n', tooltip)
            tooltip = re.sub(r'<[^>]+>', '', tooltip)
            voltage = re.search(r'Voltage IN[^\n(]*\((' + '|'.join(tiers) + r')\)', tooltip)
            items[values[0]] = (goods_id, tooltip, tiers.index(voltage[1]) if voltage else None)
        elif table == 'RECIPE_TYPE':
            if values[1] == 'gregtech':
                name = values[12].split(' (', 1)[0]
                types[values[0]] = 'recipeType:gregtech:' + quote(name, safe="~()*!.'-_")
        else:
            links.append(values)
result = {}
for type_id, item_id in links:
    if type_id not in types:
        continue
    goods_id, tooltip, tier = items[item_id]
    if 'DEPRECATED' in tooltip:
        continue
    if 'Voltage IN' in tooltip and tier is None:
        raise ValueError('Unrecognized machine input voltage: ' + goods_id)
    crafter = {'id': goods_id, 'role': 'singleblock' if tier is not None else 'multiblock'}
    if tier is not None:
        crafter['maxVoltageTier'] = tier
    bucket = result.setdefault(types[type_id], {})
    if goods_id in bucket and bucket[goods_id] != crafter:
        raise ValueError('Conflicting machine capability: ' + goods_id)
    bucket[goods_id] = crafter
output = {'schemaVersion': 1, 'sourceScriptSha256': hashlib.sha256(args.script.read_bytes()).hexdigest(),
          'types': {key: list(sorted(value.values(), key=lambda item: (item.get('maxVoltageTier', 99), item['id']))) for key, value in sorted(result.items())}}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
print(f'Recovered {sum(map(len, output["types"].values()))} catalysts across {len(result)} GT recipe categories')

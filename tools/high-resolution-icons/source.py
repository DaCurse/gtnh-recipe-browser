"""Recover original 64px renders and exact goods identities from a validated export."""
import argparse
import csv
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--export', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = args.output.resolve()
if not output.is_relative_to(root/'.export-work') or output == root/'.export-work':
    raise ValueError('Recovered sources must stay in a private .export-work subdirectory')
output.mkdir(parents=True, exist_ok=True)
(output/'png').mkdir(exist_ok=True)
csv.field_size_limit(10_000_000)
def text(value):
    value = re.sub(r'\\u([a-fA-F0-9]{4})', lambda m: chr(int(m[1],16)), value)
    return value.encode('utf-16', 'surrogatepass').decode('utf-16')

goods = {}
script = args.export/'nesql-db.script'
archive = args.export/'image.zip'
with script.open() as stream:
    for line in stream:
        item = line.startswith('INSERT INTO ITEM VALUES(')
        fluid = line.startswith('INSERT INTO FLUID VALUES(')
        if not item and not fluid:
            continue
        values = [text(value) for value in next(csv.reader([line[line.index('(')+1:line.rindex(')')]], delimiter=',', quotechar="'", doublequote=True))]
        if item:
            key = f'i:{values[8]}:{values[2]}:{values[3]}'
            if values[9]:
                key += ':'+hashlib.sha1(values[9].encode('utf-8')).hexdigest()
            path = values[1]
        else:
            key = f'f:{values[8]}:{values[5]}'
            path = values[4]
        if key in goods and goods[key] != path:
            raise ValueError(f'Conflicting source image identity: {key}')
        goods[key] = path

records = {}
unavailable = []
with zipfile.ZipFile(archive) as images:
    files = set(images.namelist())
    for key, path in sorted(goods.items()):
        if path not in files:
            unavailable.append(key)
            continue
        content = images.read(path)
        if content[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II',content[16:24]) != (64,64):
            raise ValueError(f'Original is not a 64x64 PNG: {path}')
        digest = hashlib.sha256(content).hexdigest()
        target = output/'png'/f'{digest}.png'
        if not target.exists():
            target.write_bytes(content)
        records[key] = digest
def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
(output/'sources.json').write_text(json.dumps({
    'schemaVersion':1, 'spriteSize':64, 'scriptSha256':file_hash(script),
    'imagesSha256':file_hash(archive), 'goods':records, 'unavailable':unavailable
},separators=(',',':'))+'\n')
print(f'Recovered {len(records)} exact goods identities from original 64px PNGs')

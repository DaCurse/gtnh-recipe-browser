"""Convert the read-only client UI snapshot and original mod textures to browser assets."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--snapshot', required=True, type=Path)
parser.add_argument('--mods', required=True, type=Path)
parser.add_argument('--root', default=Path('.'), type=Path)
args = parser.parse_args()
snapshot = json.loads(args.snapshot.read_text())
if snapshot.get('error') or len(snapshot.get('maps', [])) < 100:
    raise ValueError('Incomplete UI snapshot')
asset_dir = args.root / 'public/assets/machine-ui'
asset_dir.mkdir(parents=True, exist_ok=True)
resources = {}
for jar in sorted(args.mods.glob('*.jar')):
    with zipfile.ZipFile(jar) as archive:
        for name in archive.namelist():
            if name.startswith('assets/') and '/textures/' in name and name.endswith('.png'):
                resources[name] = jar
sources = {}

def texture(raw, progress=False):
    if not raw or not raw.get('location'):
        return None
    namespace, resource = raw['location'].split(':', 1)
    key = f'assets/{namespace}/{resource}'
    if key not in resources:
        raise ValueError(f'Missing UI texture: {key}')
    jar = resources[key]
    with zipfile.ZipFile(jar) as archive:
        content = archive.read(key)
    digest = hashlib.sha256(content).hexdigest()
    filename = digest[:20] + '.png'
    (asset_dir / filename).write_bytes(content)
    width, height = struct.unpack('>II', content[16:24])
    sources[key] = {'jar': jar.name, 'sha256': digest, 'output': filename}
    u0, v0, u1, v1 = [raw.get(k, d) for k, d in [('u0',0),('v0',0),('u1',1),('v1',1)]]
    if progress:
        v1 = v0 + (v1-v0)/2
    return {'file': filename, 'size': [width,height], 'uv': [u0,v0,u1,v1]}

maps = []
for raw in snapshot['maps']:
    profile = {k: raw[k] for k in ['id','name','frontend','size']}
    for group in ['itemInputs','itemOutputs','fluidInputs','fluidOutputs']:
        profile[group] = []
        for slot in raw[group]:
            cell = {'pos': slot['pos']}
            overlay = texture(slot.get('overlay'))
            if overlay:
                cell['overlay'] = overlay
            profile[group].append(cell)
    profile['widgets'] = []
    if 'widgets' in raw:
        for widget in raw['widgets']:
            image = texture(widget.get('texture'))
            if image and min(widget['size']) > 0:
                profile['widgets'].append({'pos':widget['pos'], 'size':widget['size'], 'texture':image,
                                          'kind': 'Logo' if widget.get('role') == 'logo' else widget['type']})
    elif raw.get('useProgressBar'):
        image = texture(raw.get('progressTexture'), progress=True)
        if image:
            profile['widgets'].append({'pos':raw['progressPos'], 'size':raw['progressSize'], 'texture':image, 'kind':'ProgressBar'})
    if raw.get('useSpecialSlot'):
        profile['specialPos'] = raw['specialPos']
    maps.append(profile)
# Exact original ModularUI cells, not resized copies.
for kind in ['item','fluid']:
    raw = {'location':f'modularui:textures/gui/slot/{kind}.png'}
    image = texture(raw)
    (asset_dir / f'slot-{kind}.png').write_bytes((asset_dir/image['file']).read_bytes())
output = {'schemaVersion':1, 'gtnhVersion':'2.9.0', 'gregtechVersion':'5.09.54.265', 'maps':maps}
target = args.root / 'src/lib/generated/machine-ui.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(output,separators=(',',':'))+'\n')
presentations = snapshot.get('recipePresentation', [])
if len(presentations) != 43 or len({entry['trigger'] for entry in presentations}) != 43:
    raise ValueError('Missing or duplicate custom recipe presentation records')
def amount(value):
    number = int(value)
    if number < 0 or number > 9_007_199_254_740_991:
        raise ValueError(f'Quantity outside JavaScript exact integer range: {value}')
    return number
recipes = []
for entry in sorted(presentations, key=lambda entry: entry['trigger']):
    recipes.append({
        'trigger':entry['trigger'], 'totalItems':amount(entry['SumOfItems']),
        'hydrogen':amount(entry['HydrogenRequirement']), 'helium':amount(entry['HeliumRequirement']),
        'durationTicks':amount(entry['RecipeTimeInTicks']),
        'items': [[item['id'],amount(item['amount']),item.get('solidMass')] for item in entry['items']],
        'fluids': [[f'f:gregtech:{fluid["name"]}',amount(fluid['amount'])] for fluid in entry['fluids']]
    })
(target.parent/'recipe-presentation.json').write_text(json.dumps({
    'gtnhVersion':'2.9.0', 'gregtechVersion':'5.09.54.265', 'recipes':recipes
},separators=(',',':'))+'\n')
provenance = args.root / 'assets/source/machine-ui'
provenance.mkdir(parents=True,exist_ok=True)
(provenance/'textures.json').write_text(json.dumps(sources,indent=2,sort_keys=True)+'\n')
jars = {name: hashlib.sha256((args.mods/name).read_bytes()).hexdigest()
        for name in sorted({entry['jar'] for entry in sources.values()})}
(provenance/'runtime.json').write_text(json.dumps({
    'gtnhVersion':'2.9.0', 'gregtechVersion':'5.09.54.265', 'gregtechCommit':'bb00f3f1',
    'maps':len(maps), 'frontendClasses':len({entry['frontend'] for entry in snapshot['maps']}),
    'snapshotSha256':hashlib.sha256(args.snapshot.read_bytes()).hexdigest(), 'jarSha256':jars
},indent=2)+'\n')
print(f'Generated {len(maps)} machine layouts; {len(sources)} source textures; {target.stat().st_size} JSON bytes')

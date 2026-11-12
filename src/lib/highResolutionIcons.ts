import releases from './generated/high-resolution-icons.json';
import { decompress, fetchVerified } from './datasetAssets';
import { resolveIconSheetUrl, decodeIconSheetUrl, iconSheetCacheEpoch } from './iconCache';
import { recordDatasetAsset } from './storage';
import type { CatalogEntry } from './types';

interface Descriptor { sha256:string; bytes:number }
interface Manifest { schemaVersion:number; datasetId:string; lookups:Record<string,Descriptor>; unavailable?:string[] }
interface Lookup {
  schemaVersion:number; datasetId:string; lowSheet:string; spriteSize:number; columns:number;
  pages:Descriptor[]; cells:Record<string,[number,number]>; owners:Record<string,[number,number]>;
}
export interface RenderedIcon { url:string; index:number; columns:number; resolution:32|64 }
const registry:Record<string,Descriptor> = releases.releases;
export function supportsHighResolutionIcon(icon:NonNullable<CatalogEntry['icon']>,displayedPixels:number):boolean {
  return displayedPixels > 32 && Boolean(icon.sha256 && icon.datasetId && registry[icon.datasetId]);
}
type Icon = NonNullable<CatalogEntry['icon']>;
const readyIcons = new Map<string,RenderedIcon>();
const iconLoads = new Map<string,Promise<RenderedIcon>>();
let renderedEpoch = -1;
function synchronizeCache(): void {
  const epoch = iconSheetCacheEpoch();
  if (epoch !== renderedEpoch) { readyIcons.clear(); iconLoads.clear(); renderedEpoch = epoch; }
}
export function iconIdentity(icon:Icon,ownerId:string): string {
  return JSON.stringify([icon.sha256 ?? icon.url,icon.url,icon.index,icon.columns,icon.datasetId,ownerId]);
}
export function iconRenderKey(icon:Icon,ownerId:string,displayedPixels:number):string {
  return `${iconIdentity(icon,ownerId)}:${supportsHighResolutionIcon(icon,displayedPixels) ? 64 : 32}`;
}
export function cachedRenderedIcon(key:string):RenderedIcon|undefined {
  synchronizeCache();
  return readyIcons.get(key.replace(/:(32|64)$/,':64')) ?? readyIcons.get(key.replace(/:(32|64)$/,':32'));
}

const jsonLoads = new Map<string,Promise<unknown>>();
const isDescriptor = (asset:Descriptor) => /^[a-f0-9]{64}$/.test(asset?.sha256)
  && Number.isSafeInteger(asset.bytes) && asset.bytes > 0;
function descriptorAsset(asset:Descriptor, encoding:'gzip'|'identity') {
  if (!isDescriptor(asset)) throw new Error('Invalid high-resolution icon asset');
  return { ...asset,id:`icons64-${asset.sha256}`,encoding,
    url:new URL(`${import.meta.env.BASE_URL}assets/sha256/${asset.sha256}`,document.baseURI).href };
}
async function loadJson<T>(asset:Descriptor,datasetId:string):Promise<T> {
  let pending = jsonLoads.get(asset.sha256);
  if (!pending) {
    pending = (async () => {
      const bytes = await fetchVerified(descriptorAsset(asset,'gzip'),document.baseURI);
      const result:unknown = JSON.parse(new TextDecoder().decode(await decompress(bytes)));
      void recordDatasetAsset(datasetId,asset.sha256,asset.bytes).catch(()=>{});
      return result;
    })();
    jsonLoads.set(asset.sha256,pending);
    void pending.catch(()=>jsonLoads.delete(asset.sha256));
  }
  return pending as Promise<T>;
}

/** Original 64px renders are optional, verified companions to an unchanged pack. */
async function loadRenderedIcon(
  icon:NonNullable<CatalogEntry['icon']>, ownerId:string, displayedPixels:number
):Promise<RenderedIcon> {
  const release = icon.datasetId ? registry[icon.datasetId] : undefined;
  if (supportsHighResolutionIcon(icon,displayedPixels) && release && icon.sha256 && icon.datasetId) {
    try {
      const manifest = await loadJson<Manifest>(release,icon.datasetId);
      if (manifest.schemaVersion!==1 || manifest.datasetId!==icon.datasetId) throw new Error('High-resolution icon release mismatch');
      const descriptor = manifest.unavailable?.includes(ownerId) ? undefined : manifest.lookups[icon.sha256];
      if (descriptor) {
        const lookup = await loadJson<Lookup>(descriptor,icon.datasetId);
        if (lookup.schemaVersion!==1 || lookup.datasetId!==icon.datasetId || lookup.lowSheet!==icon.sha256
          || lookup.columns!==8 || lookup.spriteSize!==64) throw new Error('High-resolution icon sheet mismatch');
        const cell = lookup.owners[ownerId] ?? lookup.cells[String(icon.index)];
        if (cell) {
          const [page,index] = cell;
          if (!Number.isSafeInteger(page) || !Number.isSafeInteger(index) || page<0 || index<0 || index>=64
            || !lookup.pages[page]) throw new Error('Invalid high-resolution icon cell');
          const asset = descriptorAsset(lookup.pages[page]!,'identity');
          const url = await resolveIconSheetUrl({ ...asset,datasetId:icon.datasetId },{fallbackToUrl:false});
          await decodeIconSheetUrl(url);
          return {url,index,columns:8,resolution:64};
        }
      }
    } catch {
      // Offline/missing/corrupt optional data must never blank an existing icon.
    }
  }
  const url = await resolveIconSheetUrl(icon);
  await decodeIconSheetUrl(url);
  return {url,index:icon.index,columns:icon.columns,resolution:32};
}

/** Ready sprites are synchronous on remount; concurrent consumers share one upgrade. */
export function resolveRenderedIcon(source:Icon,ownerId:string,displayedPixels:number):Promise<RenderedIcon> {
  const icon = {...source};
  synchronizeCache();
  const key=iconRenderKey(icon,ownerId,displayedPixels);
  const ready=cachedRenderedIcon(key);
  if (ready && (ready.resolution === 64 || !supportsHighResolutionIcon(icon,displayedPixels))) return Promise.resolve(ready);
  let pending=iconLoads.get(key);
  if (!pending) {
    const epoch=renderedEpoch;
    pending=loadRenderedIcon(icon,ownerId,displayedPixels).then(value=>{
      if (iconSheetCacheEpoch()===epoch) readyIcons.set(`${iconIdentity(icon,ownerId)}:${value.resolution}`,value);
      return value;
    });
    iconLoads.set(key,pending);
    const finished=()=>{if(iconLoads.get(key)===pending) iconLoads.delete(key);};
    void pending.then(finished,finished);
  }
  return pending;
}

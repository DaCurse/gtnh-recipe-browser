/** Lossless defaults embedded in upstream stable goods IDs; explicit wire fields override them. */
export function goodsIdentityFromId(id: string): {
  kind: 'item' | 'fluid'; mod: string; internalName: string; damage?: number;
} {
  const match = id.match(/^([if]):([^:]+):(.*)$/) ?? id.match(/^([if])~([^~]+)~(.*)$/);
  if (!match) throw new Error(`Invalid goods identity ${id}`);
  const [, kind, mod, rest] = match;
  if (kind === 'f') return { kind: 'fluid', mod: mod!, internalName: rest! };
  const item = rest!.match(/^(.*):(\d+)(?::[a-f0-9]{40})?$/)
    ?? rest!.match(/^(.*)~(\d+)(?:~[a-f0-9]{40})?$/);
  return { kind: 'item', mod: mod!, internalName: item?.[1] ?? rest!,
    ...(item ? { damage: Number(item[2]) } : {}) };
}

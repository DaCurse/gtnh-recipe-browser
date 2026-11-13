import { nbtScalar } from '../nbt';
import { questUuid } from './types';

/** Preserve both signed 64-bit halves from VendingMachine's BQ condition. */
export function vendingQuestId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.nbt !== 'string' ||
    !/(?:betterquesting|bqcondition)/i.test(String(row.type) + ' ' + row.nbt)
  )
    return undefined;
  try {
    const low = nbtScalar(row.nbt, ['quest', 'questIDLow']) ?? nbtScalar(row.nbt, ['questIDLow']);
    if (low === undefined) return undefined;
    const high =
      nbtScalar(row.nbt, ['quest', 'questIDHigh']) ?? nbtScalar(row.nbt, ['questIDHigh']) ?? 0;
    return questUuid(String(high), String(low));
  } catch {
    return undefined;
  }
}

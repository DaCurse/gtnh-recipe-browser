import type { DecodedItem, DecodedRepository } from './model';
import type { SpecialData } from '../data-export/special';

/**
 * Resolve service-tab sprites from the same registered objects used by the
 * upstream integrations.  The runtime overlay emits these references
 * directly; this deterministic repair keeps a pack built from an older
 * sidecar from falling back to the first loot item in a record.
 */
export function repairSpecialServiceIcons(
  data: SpecialData,
  repository: DecodedRepository
): SpecialData {
  const items = repository.items;
  const worldgenChest = items.find((item) => (
    item.mod.toLocaleLowerCase() === 'minecraft'
    && item.internalName.toLocaleLowerCase() === 'chest'
    && item.damage === 0
  ));
  const vendingMachine = items.find(isVendingMachineItem);

  let changed = false;
  const serviceIcons = data.serviceIcons.map((icon) => {
    // These two service IDs have a canonical upstream anchor. Always replace
    // a stale sidecar value (not only an omitted one), otherwise rebuilding an
    // older export would preserve the first arbitrary referenced item as the
    // tab sprite forever.
    const anchoredGoodsId = icon.id === 'service:worldgen'
      ? worldgenChest?.id
      : icon.id === 'service:vending'
        ? vendingMachine?.id
        : undefined;
    if (!anchoredGoodsId || icon.goodsId === anchoredGoodsId) return icon;
    changed = true;
    return { ...icon, goodsId: anchoredGoodsId };
  });
  return changed ? { ...data, serviceIcons } : data;
}

/** Exported for focused tests without exposing the decoded item model. */
export function isVendingMachineItem(item: DecodedItem): boolean {
  return item.mod.toLocaleLowerCase() === 'gregtech'
    && item.internalName.toLocaleLowerCase() === 'gt.blockmachines'
    && (
      item.unlocalizedName.toLocaleLowerCase().endsWith('.multimachine.vendingmachine')
      || item.name.toLocaleLowerCase() === 'vending machine'
    );
}

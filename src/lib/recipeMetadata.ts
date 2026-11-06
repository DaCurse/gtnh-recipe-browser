export interface GtMetadata {
  key: string;
  value: number;
}

export interface GtPower {
  voltage: number;
  amperage: number;
  durationTicks: number;
}

const fuelTypes = ['Diesel', 'Gas', 'Hot', 'Dense Steam', 'Plasma', 'Magic'];
const voltageTiers = ['LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV', 'UMV', 'UXV', 'MAX'];
const coilTiers = ['Cupronickel', 'Kanthal', 'Nichrome', 'TPV', 'HSS-G', 'HSS-S', 'Naquadah', 'Naquadah Alloy', 'Trinium', 'Electrum Flux', 'Awakened Draconium', 'Infinity', 'Hypogen', 'Eternal'];

export interface GtMetadataContext {
  recipeType: string;
  voltageTier: number;
}

// GTValues.TIER_COLORS, GT5-Unofficial 5.09.54.265. Formatting distinguishes
// tiers sharing a colour (LV/UV), so preserve underline and bold as well.
const tierFormats: Readonly<Record<string, readonly string[]>> = {
  ULV: ['c'], LV: ['2'], MV: ['6'], HV: ['e'], EV: ['8'], IV: ['9'], LuV: ['d'], ZPM: ['b'],
  UV: ['2', 'n'], UHV: ['4', 'n'], UEV: ['5', 'n'], UIV: ['1', 'l', 'n'],
  UMV: ['c', 'l', 'n'], UXV: ['4', 'l', 'n'], MAX: ['f', 'l', 'n'], 'MAX+': ['f', 'l', 'n', 'o']
};
export function voltageTierFormats(tier: string): readonly string[] {
  return tierFormats[tier] ?? [];
}

// GTValues.VOLTAGE_NAMES, keyed by abbreviation rather than the packed tier index.
const tierDescriptions: Readonly<Record<string, string>> = {
  ULV: 'Ultra Low Voltage', LV: 'Low Voltage', MV: 'Medium Voltage', HV: 'High Voltage',
  EV: 'Extreme Voltage', IV: 'Insane Voltage', LuV: 'Ludicrous Voltage', ZPM: 'ZPM Voltage',
  UV: 'Ultimate Voltage', UHV: 'Ultimate High Voltage', UEV: 'Ultimate Extreme Voltage',
  UIV: 'Ultimate Insane Voltage', UMV: 'Ultimate Mega Voltage', UXV: 'Ultimate Extended Mega Voltage',
  MAX: 'Maximum Voltage', 'MAX+': 'Above Maximum Voltage'
};

export function voltageTierDescription(tier: string): string {
  return `Tier: ${tierDescriptions[tier] ?? tier}`;
}

export function recipeMetadataDescription(line: string): string {
  const descriptions: ReadonlyArray<readonly [string, string]> = [
    ['Heat:', 'Required operating temperature and suitable heating coils.'],
    ['Requires low gravity', 'This recipe needs a machine in a low-gravity dimension.'],
    ['Requires cleanroom', 'This recipe needs a machine inside a working cleanroom.'],
    ['Fuel type:', 'The generator fuel category assigned to this recipe.'],
    ['Fuel value:', 'Energy available from each litre of this fuel.'],
    ['To start:', 'Energy the fusion reactor must store before starting this recipe.'],
    ['Multi-step plasma', 'This plasma recipe requires multi-step processing.'],
    ['Single-step plasma', 'This plasma recipe uses single-step processing.'],
    ['Plasma tier:', 'Required plasma-processing tier.'],
    ['Requires tier', 'Minimum machine upgrade tier required for this recipe.'],
    ['QFT focus tier:', 'Required Quantum Force Transformer focusing tier.'],
    ['Glass tier:', 'Minimum voltage tier of the machine structure’s glass.'],
    ['Recycle recipe', 'This recipe recovers materials through recycling.'],
    ['Kinetic energy:', 'Allowed particle energy range for this accelerator recipe.'],
  ];
  return descriptions.find(([prefix]) => line.startsWith(prefix))?.[1]
    ?? 'Additional machine-specific information for this recipe.';
}

export function voltageTierName(tier: number): string {
  return voltageTiers[tier] ?? `T${tier}`;
}

function formatAmount(value: number): string {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}B`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))}k`;
  return value.toLocaleString('en-US');
}

function fusionTier(startupEu: number): number | null {
  if (startupEu < 160_000_000) return 1;
  if (startupEu < 320_000_000) return 2;
  if (startupEu < 640_000_000) return 3;
  if (startupEu < 5_120_000_000) return 4;
  if (startupEu < 20_480_000_000) return 5;
  return null;
}

function heatRequired(heat: number, context?: GtMetadataContext): string {
  const rawTier = Math.min(13, Math.max(0, (heat - 1_800) / 900));
  const tier = Math.ceil(rawTier);
  if (context?.recipeType === 'Blast Furnace' && tier > 0) {
    const ebfTierSkip = 1 + Math.ceil((rawTier - tier + 1) * 9);
    if (ebfTierSkip <= context.voltageTier + 2) {
      if (context.voltageTier >= ebfTierSkip) {
        return `Heat: ${heat}K (Volc ${coilTiers[tier]} / EBF ${coilTiers[tier - 1]})`;
      }
      return `Heat: ${heat}K (Volc ${coilTiers[tier]} / ${voltageTiers[ebfTierSkip]} EBF ${coilTiers[tier - 1]})`;
    }
  }
  return `Heat: ${heat}K (${coilTiers[tier]})`;
}

export function formatGtMetadata(
  metadata: GtMetadata,
  context?: GtMetadataContext
): string | null {
  switch (metadata.key) {
    case 'low_gravity':
      return metadata.value === 1 ? 'Requires low gravity' : null;
    case 'cleanroom':
      return metadata.value === 1 ? 'Requires cleanroom' : null;
    case 'fuel_type':
      return `Fuel type: ${fuelTypes[metadata.value] ?? metadata.value}`;
    case 'fuel_value':
      return `Fuel value: ${formatAmount(metadata.value)} EU/L`;
    case 'fusion_threshold': {
      const tier = fusionTier(metadata.value);
      return `To start: ${formatAmount(metadata.value)} EU${tier === null ? '' : ` (T${tier})`}`;
    }
    case 'fog_plasma_multistep':
      return metadata.value === 1 ? 'Multi-step plasma' : 'Single-step plasma';
    case 'fog_plasma_tier':
      return `Plasma tier: ${metadata.value}`;
    case 'pcb_factory_tier':
    case 'nano_forge_tier':
      return `Requires tier ${metadata.value}`;
    case 'qft_focus_tier':
      return `QFT focus tier: ${metadata.value}`;
    case 'GLASS':
      return `Glass tier: ${voltageTiers[metadata.value - 1] ?? metadata.value}`;
    case 'recycle':
      return metadata.value === 1 ? 'Recycle recipe' : null;
    case 'coil_heat':
      return heatRequired(metadata.value, context);
    case 'nke_range':
      return `Kinetic energy: ${metadata.value % 10_000} - ${Math.floor(metadata.value / 10_000)} MeV`;
    default:
      return `${metadata.key}: ${formatAmount(metadata.value)}`;
  }
}

export function formatCircuitConflicts(circuitConflicts: number): string {
  if (circuitConflicts === 0) return 'No recipe conflicts';
  const circuits: number[] = [];
  let remaining = circuitConflicts;
  while (remaining !== 0) {
    const bit = Math.log2(remaining & -remaining);
    circuits.push(bit);
    remaining &= remaining - 1;
  }
  return circuits.length === 1
    ? `Recipe conflicts on circuit #${circuits[0]}`
    : `Recipe conflicts on circuits #${circuits.join(', #')}`;
}

export function hasRelevantPower(gt: GtPower | null): gt is GtPower {
  return gt !== null && gt.voltage > 0 && gt.amperage > 0 && gt.durationTicks > 0;
}

export interface GtMetadata {
  key: string;
  value: number;
}

const fuelTypes = ['Diesel', 'Gas', 'Hot', 'Dense Steam', 'Plasma', 'Magic'];

function formatAmount(value: number): string {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}B`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))}k`;
  return value.toLocaleString('en-US');
}

export function formatGtMetadata(metadata: GtMetadata): string | null {
  switch (metadata.key) {
    case 'low_gravity':
      return metadata.value === 1 ? 'Requires low gravity' : null;
    case 'cleanroom':
      return metadata.value === 1 ? 'Requires cleanroom' : null;
    case 'fuel_type':
      return `Fuel type: ${fuelTypes[metadata.value] ?? metadata.value}`;
    case 'fuel_value':
      return `Fuel value: ${formatAmount(metadata.value)} EU/L`;
    case 'fusion_threshold':
      return `To start: ${formatAmount(metadata.value)} EU`;
    case 'fog_plasma_multistep':
      return metadata.value === 1 ? 'Multi-step plasma' : 'Single-step plasma';
    case 'fog_plasma_tier':
      return `Plasma tier: ${metadata.value}`;
    case 'pcb_factory_tier':
    case 'nano_forge_tier':
      return `Requires tier ${metadata.value}`;
    case 'qft_focus_tier':
      return `QFT focus tier: ${metadata.value}`;
    case 'recycle':
      return metadata.value === 1 ? 'Recycle recipe' : null;
    case 'coil_heat':
      return `Heat: ${formatAmount(metadata.value)} K`;
    case 'nke_range':
      return `Kinetic energy: ${metadata.value % 10_000} - ${Math.floor(metadata.value / 10_000)} MeV`;
    default:
      return `${metadata.key}: ${formatAmount(metadata.value)}`;
  }
}

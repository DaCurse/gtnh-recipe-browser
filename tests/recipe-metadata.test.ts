import { describe, expect, it } from 'vitest';
import { formatGtMetadata, hasRelevantPower } from '../src/lib/recipeMetadata';

describe('GT recipe metadata', () => {
  it('formats semi-fluid fuel values in EU per litre', () => {
    expect(formatGtMetadata({ key: 'fuel_value', value: 48 })).toBe('Fuel value: 48 EU/L');
  });

  it('formats known flags and preserves unknown metadata', () => {
    expect(formatGtMetadata({ key: 'cleanroom', value: 1 })).toBe('Requires cleanroom');
    expect(formatGtMetadata({ key: 'cleanroom', value: 0 })).toBeNull();
    expect(formatGtMetadata({ key: 'coil_heat', value: 10800 })).toBe('Heat: 10,800 K');
    expect(formatGtMetadata({ key: 'custom_rule', value: 2500 })).toBe('custom_rule: 2.5k');
  });

  it('hides default zero power while retaining real ULV recipes', () => {
    expect(hasRelevantPower({ voltage: 0, amperage: 0, durationTicks: 0 })).toBe(false);
    expect(hasRelevantPower({ voltage: 8, amperage: 1, durationTicks: 20 })).toBe(true);
  });
});

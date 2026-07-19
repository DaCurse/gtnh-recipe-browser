import { describe, expect, it } from 'vitest';
import { formatGtMetadata } from '../src/lib/recipeMetadata';

describe('GT recipe metadata', () => {
  it('formats semi-fluid fuel values in EU per litre', () => {
    expect(formatGtMetadata({ key: 'fuel_value', value: 48 })).toBe('Fuel value: 48 EU/L');
  });

  it('formats known flags and preserves unknown metadata', () => {
    expect(formatGtMetadata({ key: 'cleanroom', value: 1 })).toBe('Requires cleanroom');
    expect(formatGtMetadata({ key: 'cleanroom', value: 0 })).toBeNull();
    expect(formatGtMetadata({ key: 'custom_rule', value: 2500 })).toBe('custom_rule: 2.5k');
  });
});

import { type Hex } from 'viem';

export function normalizePrivateKey(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as `0x${string}`;
  return null;
}

export function isBytes32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function normalizeBytes32(value: unknown, name: string): Hex {
  if (!isBytes32(value)) {
    throw new Error(`${name}_invalid_bytes32`);
  }

  return value.toLowerCase() as Hex;
}

export function parseBigIntField(value: unknown, name: string): bigint {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name}_required`);
  }

  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`${name}_must_be_integer`);
    return BigInt(value);
  }

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${name}_must_be_integer_string`);
    }
    return BigInt(value.trim());
  }

  throw new Error(`${name}_invalid`);
}

export function parseUint8Field(value: unknown, name: string): number {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name}_required`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) throw new Error(`${name}_must_be_uint8`);
  if (parsed < 0 || parsed > 255) throw new Error(`${name}_out_of_uint8_range`);

  return parsed;
}

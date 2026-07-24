import { gunzipSync } from 'node:zlib';

const ROOT_WORDS = 8;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class PackDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackDecodeError';
  }
}

export class WordReader {
  readonly bytes: Buffer;
  readonly words: Int32Array;
  private readonly stringCache = new Map<number, string>();

  constructor(compressed: Uint8Array) {
    try {
      this.bytes = gunzipSync(compressed);
    } catch (error) {
      throw new PackDecodeError(
        `Unable to decompress data.bin: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (this.bytes.byteLength % 4 !== 0) {
      throw new PackDecodeError(
        `Decoded data length ${this.bytes.byteLength} is not aligned to 32-bit words`
      );
    }
    this.words = new Int32Array(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength / 4
    );
    if (this.words.length < ROOT_WORDS) {
      throw new PackDecodeError(
        `Decoded repository is truncated: expected at least ${ROOT_WORDS} words`
      );
    }
  }

  int(offset: number, context: string): number {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.words.length) {
      throw new PackDecodeError(
        `${context}: word offset ${offset} is outside 0..${this.words.length - 1}`
      );
    }
    return this.words[offset];
  }

  uint(offset: number, context: string): number {
    return this.int(offset, context) >>> 0;
  }

  pointer(offset: number, context: string, nullable = false): number | null {
    const value = this.int(offset, context);
    if (value === -1 && nullable) return null;
    if (value < 0 || value >= this.words.length) {
      throw new PackDecodeError(`${context}: invalid pointer ${value}`);
    }
    return value;
  }

  slice(pointer: number, context: string): Int32Array {
    const length = this.int(pointer, `${context} length`);
    if (length < 0) throw new PackDecodeError(`${context}: negative slice length ${length}`);
    const end = pointer + 1 + length;
    if (end > this.words.length) {
      throw new PackDecodeError(
        `${context}: slice ending at ${end} exceeds ${this.words.length} words`
      );
    }
    return this.words.subarray(pointer + 1, end);
  }

  sliceAt(offset: number, context: string): Int32Array {
    const pointer = this.pointer(offset, `${context} pointer`);
    return this.slice(pointer!, context);
  }

  pointersAt(offset: number, context: string): number[] {
    return Array.from(this.sliceAt(offset, context), (pointer, index) => {
      if (pointer < 0 || pointer >= this.words.length) {
        throw new PackDecodeError(`${context}[${index}]: invalid pointer ${pointer}`);
      }
      return pointer;
    });
  }

  string(pointer: number | null, context: string): string | null {
    if (pointer === null || pointer === -1) return null;
    const cached = this.stringCache.get(pointer);
    if (cached !== undefined) return cached;
    const byteLength = this.int(pointer, `${context} byte length`);
    if (byteLength < 0) {
      throw new PackDecodeError(`${context}: negative string length ${byteLength}`);
    }
    const begin = (pointer + 1) * 4;
    const end = begin + byteLength;
    if (end > this.bytes.byteLength) {
      throw new PackDecodeError(
        `${context}: string ending at byte ${end} exceeds ${this.bytes.byteLength}`
      );
    }
    let decoded: string;
    try {
      decoded = textDecoder.decode(this.bytes.subarray(begin, end));
    } catch (error) {
      throw new PackDecodeError(
        `${context}: invalid UTF-8 (${error instanceof Error ? error.message : String(error)})`
      );
    }
    this.stringCache.set(pointer, decoded);
    return decoded;
  }

  stringAt(offset: number, context: string, nullable = false): string | null {
    return this.string(this.pointer(offset, `${context} pointer`, nullable), context);
  }

  double(offset: number, context: string): number {
    this.int(offset, context);
    this.int(offset + 1, context);
    return this.bytes.readDoubleLE(offset * 4);
  }
}

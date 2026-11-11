/**
 * The protobuf wire format, only as much as OpAMP needs: varints, length-
 * delimited fields and fixed 64-bit doubles. Numbers are JavaScript numbers,
 * which is exact for every value OpAMP carries below 2^53.
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH = 2;
export const WIRE_FIXED32 = 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Writer {
  private chunks: number[] = [];

  varint(value: number): this {
    let v = Math.max(0, Math.floor(value));
    while (v >= 0x80) {
      this.chunks.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.chunks.push(v);
    return this;
  }

  tag(field: number, wireType: number): this {
    return this.varint(field * 8 + wireType);
  }

  uint(field: number, value: number): this {
    if (value === 0) return this;
    return this.tag(field, WIRE_VARINT).varint(value);
  }

  bool(field: number, value: boolean): this {
    return value ? this.tag(field, WIRE_VARINT).varint(1) : this;
  }

  bytes(field: number, value: Uint8Array): this {
    if (value.length === 0) return this;
    this.tag(field, WIRE_LENGTH).varint(value.length);
    for (const b of value) this.chunks.push(b);
    return this;
  }

  string(field: number, value: string): this {
    return this.bytes(field, encoder.encode(value));
  }

  double(field: number, value: number): this {
    if (value === 0) return this;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, value, true);
    this.tag(field, WIRE_FIXED64);
    for (let i = 0; i < 8; i++) this.chunks.push(buf.getUint8(i));
    return this;
  }

  /** Writes a nested message. An empty message is still written when `always` is set (presence matters). */
  message(field: number, build: (w: Writer) => void, always = false): this {
    const inner = new Writer();
    build(inner);
    const bytes = inner.finish();
    if (bytes.length === 0 && !always) return this;
    this.tag(field, WIRE_LENGTH).varint(bytes.length);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export class Reader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let multiplier = 1;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error("truncated varint");
      const byte = this.buf[this.pos++]!;
      result += (byte & 0x7f) * multiplier;
      if (byte < 0x80) return result;
      multiplier *= 0x80;
      if (multiplier > 2 ** 70) throw new Error("varint too long");
    }
  }

  tag(): { field: number; wireType: number } {
    const tag = this.varint();
    return { field: Math.floor(tag / 8), wireType: tag % 8 };
  }

  bytes(): Uint8Array {
    const length = this.varint();
    if (this.pos + length > this.buf.length) throw new Error("truncated field");
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  string(): string {
    return decoder.decode(this.bytes());
  }

  double(): number {
    if (this.pos + 8 > this.buf.length) throw new Error("truncated double");
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_FIXED64:
        this.pos += 8;
        return;
      case WIRE_LENGTH:
        this.bytes();
        return;
      case WIRE_FIXED32:
        this.pos += 4;
        return;
    }
    throw new Error(`unsupported wire type ${wireType}`);
  }
}

export class TypedRing<T> {
  private arr: (T | null)[];
  private head: number = 0;
  private _capacity: number;
  private _len: number = 0;

  constructor(capacity: number) {
    this._capacity = capacity;
    this.arr = new Array<T | null>(capacity).fill(null);
  }

  get length(): number {
    return this._len;
  }

  get capacity(): number {
    return this._capacity;
  }

  push(val: T): void {
    this.arr[this.head] = val;
    this.head = (this.head + 1) % this._capacity;
    if (this._len < this._capacity) {
      this._len += 1;
    }
  }

  readAll(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this._len; i++) {
      const idx =
        (this.head - this._len + i + this._capacity) % this._capacity;
      result.push(this.arr[idx] as T);
    }
    return result;
  }

  clear(): void {
    for (let i = 0; i < this.arr.length; i++) {
      this.arr[i] = null;
    }
    this.head = 0;
    this._len = 0;
  }

  remove(vals: T[]): number {
    if (vals.length === 0) return 0;

    const toRemove = new Set<T>(vals);
    let writeIdx = 0;
    let removed = 0;

    for (let i = 0; i < this._len; i++) {
      const readIdx =
        (this.head - this._len + i + this._capacity) % this._capacity;
      if (toRemove.has(this.arr[readIdx] as T)) {
        removed++;
      } else {
        if (writeIdx !== i) {
          const destIdx =
            (this.head - this._len + writeIdx + this._capacity) %
            this._capacity;
          this.arr[destIdx] = this.arr[readIdx];
        }
        writeIdx++;
      }
    }

    for (let i = writeIdx; i < this._len; i++) {
      const idx =
        (this.head - this._len + i + this._capacity) % this._capacity;
      this.arr[idx] = null;
    }

    this._len = writeIdx;
    this.head = (this.head - removed + this._capacity) % this._capacity;

    return removed;
  }
}

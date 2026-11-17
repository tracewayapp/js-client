import { Histogram } from "./histogram.js";

export type MetricDims = Record<string, string>;

export interface MetricExemplar {
  value: number;
  timeMs: number;
  sessionId: string;
  /** What caused the value, when known: a CSS selector. */
  target?: string;
}

export type ExemplarSource = string | { sessionId: string; target?: string };

export interface HistogramPoint {
  name: string;
  unit: string;
  dims: MetricDims;
  histogram: Histogram;
  exemplars: MetricExemplar[];
}

export interface SumPoint {
  name: string;
  dims: MetricDims;
  value: number;
}

/** Everything observed between two flushes: delta temporality, so batches from different devices add up. */
export interface MetricBatch {
  startMs: number;
  endMs: number;
  histograms: HistogramPoint[];
  sums: SumPoint[];
}

export interface MetricAggregatorOptions {
  /** Distinct (metric, dimensions) cells kept between flushes. Past it `url.path` is folded to `other`. */
  maxCells?: number;
  now?: () => number;
}

const DEFAULT_MAX_CELLS = 200;
const MAX_EXEMPLARS = 3;
/** Slack for the folded cells, so folding never has to drop an observation of a known metric. */
const FOLD_HEADROOM = 50;
export const OVERFLOW_VALUE = "other";
export const VIEW_DIMENSION = "url.path";

function cellKey(name: string, dims: MetricDims): string {
  let key = name;
  for (const k of Object.keys(dims).sort()) key += `\u001f${k}=${dims[k]}`;
  return key;
}

/**
 * In-memory metrics of one device. An observation increments a bucket or a counter and nothing else; nothing is
 * kept per observation, so memory depends on the number of cells and never on how long the page lives.
 */
export class MetricAggregator {
  private histograms = new Map<string, HistogramPoint>();
  private sums = new Map<string, SumPoint>();
  private startMs: number;
  private readonly maxCells: number;
  private readonly now: () => number;
  /** Observations lost because the cell limit was reached even after folding. */
  dropped = 0;

  constructor(options: MetricAggregatorOptions = {}) {
    this.maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
    this.now = options.now ?? Date.now;
    this.startMs = this.now();
  }

  get size(): number {
    return this.histograms.size + this.sums.size;
  }

  /** `exemplar` is a session id, with its culprit when known; pass it only for a value worth opening a session for. */
  observe(
    name: string,
    value: number,
    dims: MetricDims = {},
    unit = "",
    exemplar?: ExemplarSource,
  ): void {
    const cell = this.cell(this.histograms, name, dims, (d) => ({
      name,
      unit,
      dims: d,
      histogram: new Histogram(),
      exemplars: [],
    }));
    if (!cell || !cell.histogram.record(value)) return;
    if (exemplar) this.keepExemplar(cell, value, exemplar);
  }

  count(name: string, n = 1, dims: MetricDims = {}): void {
    if (!Number.isFinite(n) || n <= 0) return;
    const cell = this.cell(this.sums, name, dims, (d) => ({
      name,
      dims: d,
      value: 0,
    }));
    if (cell) cell.value += n;
  }

  /** A ratio is two counters, `<name>` and `<name>.total`, so ratios from different devices add up. */
  ratio(
    name: string,
    part: number,
    total: number,
    dims: MetricDims = {},
  ): void {
    if (!(total > 0)) return;
    this.count(`${name}.total`, total, dims);
    this.count(name, Math.min(Math.max(part, 0), total), dims);
  }

  /** Hands over what was collected and starts a new interval. Null when nothing was observed. */
  drain(): MetricBatch | null {
    const endMs = this.now();
    const startMs = this.startMs;
    this.startMs = endMs;
    if (!this.size) return null;
    const batch: MetricBatch = {
      startMs,
      endMs,
      histograms: [...this.histograms.values()],
      sums: [...this.sums.values()],
    };
    this.histograms = new Map();
    this.sums = new Map();
    return batch;
  }

  private cell<T>(
    cells: Map<string, T>,
    name: string,
    dims: MetricDims,
    create: (dims: MetricDims) => T,
  ): T | null {
    let key = cellKey(name, dims);
    let found = cells.get(key);
    if (found) return found;
    let kept = dims;
    if (this.size >= this.maxCells) {
      if (
        dims[VIEW_DIMENSION] === undefined ||
        this.size >= this.maxCells + FOLD_HEADROOM
      ) {
        this.dropped++;
        return null;
      }
      kept = { ...dims, [VIEW_DIMENSION]: OVERFLOW_VALUE };
      key = cellKey(name, kept);
      found = cells.get(key);
      if (found) return found;
    }
    const created = create({ ...kept });
    cells.set(key, created);
    return created;
  }

  private keepExemplar(
    cell: HistogramPoint,
    value: number,
    source: ExemplarSource,
  ): void {
    const exemplar: MetricExemplar =
      typeof source === "string"
        ? { value, timeMs: this.now(), sessionId: source }
        : { value, timeMs: this.now(), ...source };
    if (!exemplar.sessionId) return;
    if (!exemplar.target) delete exemplar.target;
    if (cell.exemplars.length < MAX_EXEMPLARS) {
      cell.exemplars.push(exemplar);
      return;
    }
    let lowest = 0;
    for (let i = 1; i < cell.exemplars.length; i++) {
      if (cell.exemplars[i]!.value < cell.exemplars[lowest]!.value) lowest = i;
    }
    if (cell.exemplars[lowest]!.value < value)
      cell.exemplars[lowest] = exemplar;
  }
}

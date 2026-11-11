import type { Condition, Matcher } from "../settings/types.js";

/** Resolves a matcher key such as `event.name` or `attributes.http.response.status_code` to a value. */
export type FieldLookup = (key: string) => unknown;

function isCondition(m: Matcher): m is Condition {
  return typeof (m as Condition).key === "string";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function same(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === undefined || actual === null) return false;
  const a = asNumber(actual);
  const e = asNumber(expected);
  if (a !== undefined && e !== undefined) return a === e;
  return String(actual) === String(expected);
}

function versionParts(version: string): number[] | null {
  const match = version.trim().match(/^v?(\d+(?:\.\d+)*)/);
  if (!match) return null;
  return match[1]!.split(".").map((p) => parseInt(p, 10));
}

export function compareVersions(a: string, b: string): number | null {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Checks a version against a constraint such as `>=2.1 <3` (comparators separated by spaces or commas, all must hold). */
export function satisfiesVersion(version: string, constraint: string): boolean {
  const comparators = constraint.split(/[\s,]+/).filter(Boolean);
  if (comparators.length === 0) return false;
  for (const comparator of comparators) {
    const match = comparator.match(/^(>=|<=|>|<|=|==|!=)?(.+)$/);
    if (!match) return false;
    const cmp = compareVersions(version, match[2]!);
    if (cmp === null) return false;
    const ok =
      match[1] === ">=" ? cmp >= 0
      : match[1] === "<=" ? cmp <= 0
      : match[1] === ">" ? cmp > 0
      : match[1] === "<" ? cmp < 0
      : match[1] === "!=" ? cmp !== 0
      : cmp === 0;
    if (!ok) return false;
  }
  return true;
}

/** Text conditions look at most at this much of a value, so a huge log line cannot stall the page. */
const MAX_MATCH_TEXT = 4096;

function text(value: unknown): string {
  const s = typeof value === "string" ? value : String(value);
  return s.length > MAX_MATCH_TEXT ? s.slice(0, MAX_MATCH_TEXT) : s;
}

/**
 * Case-insensitive wildcard match: `*` is any run of characters, `?` one character, everything else literal.
 * Greedy with a single backtrack point, so it runs in O(text × pattern) at worst and never explodes the way
 * a backtracking regex can. That is why triggers offer this rather than regular expressions.
 */
export function globMatch(value: string, pattern: string): boolean {
  const t = value.toLowerCase();
  const p = pattern.toLowerCase();
  let ti = 0;
  let pi = 0;
  let star = -1;
  let mark = 0;
  while (ti < t.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) {
      ti++;
      pi++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = ti;
    } else if (star >= 0) {
      pi = star + 1;
      ti = ++mark;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

function evaluateCondition(condition: Condition, lookup: FieldLookup): boolean {
  const actual = lookup(condition.key);
  const present = actual !== undefined && actual !== null && actual !== "";
  switch (condition.op) {
    case "exists":
      return present;
    case "not_exists":
      return !present;
    case "eq":
      return same(actual, condition.value);
    case "neq":
      return !same(actual, condition.value);
    case "in":
      return (condition.values ?? []).some((v) => same(actual, v));
    case "not_in":
      return !(condition.values ?? []).some((v) => same(actual, v));
    case "contains":
      return present && condition.value !== undefined && text(actual).includes(String(condition.value));
    case "icontains":
      return present && condition.value !== undefined && text(actual).toLowerCase().includes(String(condition.value).toLowerCase());
    case "starts_with":
      return present && condition.value !== undefined && text(actual).startsWith(String(condition.value));
    case "glob":
      return present && condition.value !== undefined && globMatch(text(actual), String(condition.value));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(actual);
      const e = asNumber(condition.value);
      if (a === undefined || e === undefined) return false;
      return condition.op === "gt" ? a > e : condition.op === "gte" ? a >= e : condition.op === "lt" ? a < e : a <= e;
    }
    case "version":
      return present && condition.value !== undefined && satisfiesVersion(String(actual), String(condition.value));
  }
  return false;
}

export function matches(matcher: Matcher, lookup: FieldLookup): boolean {
  if (isCondition(matcher)) return evaluateCondition(matcher, lookup);
  if ("all" in matcher) return matcher.all.every((m) => matches(m, lookup));
  if ("any" in matcher) return matcher.any.some((m) => matches(m, lookup));
  if ("not" in matcher) return !matches(matcher.not, lookup);
  return false;
}

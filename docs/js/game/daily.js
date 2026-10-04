// 出題（SPEC.md §6）。日付は JST（UTC+9）で決め、端末のタイムゾーンに依存しない。
import { createRng, shuffleInPlace } from "../engine/rng.js";

export const BASE_DATE = "2026-10-01";
export const PERM_SEED = 20261001;
export const DAILY_COUNT = 10;
const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

// Date → "YYYY-MM-DD"（JST）
export function jstDateString(now = new Date()) {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function dateToUtcDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`不正な日付: ${dateStr}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
}

// 基準日からの経過日数
export function dayIndex(dateStr) {
  return dateToUtcDay(dateStr) - dateToUtcDay(BASE_DATE);
}

export function addDays(dateStr, delta) {
  const d = new Date((dateToUtcDay(dateStr) + delta) * DAY_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// "2026-10-03" → "10/3"
export function shortDate(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${+m}/${+d}`;
}

// 問題 N 個の添字の固定順列
export function permutation(n, seed = PERM_SEED) {
  const perm = Array.from({ length: n }, (_, i) => i);
  return shuffleInPlace(perm, createRng(seed));
}

// その日の問題の添字（長さ count）。stride は 1日あたりに進める問題数
export function dailyIndices(n, dateStr, count = DAILY_COUNT, stride = DAILY_COUNT, seed = PERM_SEED) {
  const perm = permutation(n, seed);
  const d = dayIndex(dateStr);
  const out = [];
  for (let j = 0; j < count; j++) {
    const k = (((stride * d + j) % n) + n) % n;
    out.push(perm[k]);
  }
  return out;
}

// 速度問題だけの10問（旧仕様。テスト・互換用）
export function pickDaily(problems, dateStr) {
  return dailyIndices(problems.length, dateStr).map((i) => problems[i]);
}

// 今日の10問 = 速度7問＋押し引き3問（4・7・10問目が押し引き）
export const OSHI_SEED = 20261002;
export const OSHI_COUNT = 3;
export const OSHI_POSITIONS = [3, 6, 9]; // 0始まり
export function pickDailyMixed(speed, oshi, dateStr) {
  const sp = dailyIndices(speed.length, dateStr, DAILY_COUNT - OSHI_COUNT, DAILY_COUNT - OSHI_COUNT).map((i) => speed[i]);
  const os = dailyIndices(oshi.length, dateStr, OSHI_COUNT, OSHI_COUNT, OSHI_SEED).map((i) => oshi[i]);
  const out = [];
  let si = 0, oi = 0;
  for (let pos = 0; pos < DAILY_COUNT; pos++) out.push(OSHI_POSITIONS.includes(pos) ? os[oi++] : sp[si++]);
  return out;
}

// 練習モード: 無作為に count 問（重複なし。問題が足りなければある分だけ）
export function pickPractice(problems, rng = Math.random, count = DAILY_COUNT) {
  const idx = shuffleInPlace(Array.from({ length: problems.length }, (_, i) => i), rng);
  return idx.slice(0, Math.min(count, idx.length)).map((i) => problems[i]);
}

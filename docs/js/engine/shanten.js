// シャンテン数（SPEC.md §4）。門前前提、counts の合計は 13 または 14。
//
// 通常手は「スートごとの表」方式（正確なシャンテン数）:
//   定義: shanten = min over 和了形 H（各種類4枚以下）of (14 - |H ∩ 手|) - 1 = 13 - 最大重なり。
//   各スート（数牌9種 / 字牌7種）の枚数の組を5進数のキーにし、(雀頭 h, 面子数 m) ごとに
//   「そのスートで作る h 雀頭・m 面子の形」と手との最大重なり枚数を求めて表に入れる（遅延計算）。
//   4グループを合計 m=4・h=1 で合成する。
//   「手の中で4枚使っている牌を待つ」ような実現不能な形は、形の側の枚数を4以下に制限することで自然に除かれる。

const P5 = [1, 5, 25, 125, 625, 3125, 15625, 78125, 390625, 1953125];

// 表: キーごとに10スロット（j = h*5 + m）。値 = 最大重なり+1、0 = 不可能。スロット0は常に1以上なので計算済みの印になる
let suitTable = null;  // 10 * 5^9
let honorTable = null; // 10 * 5^7

// スート内の DP。位置 i で「刻子 t・雀頭 p・ここから始まる順子 s」を選び、
// 形の枚数 P_i = 3t + 2p + s + (前2つの位置から続く順子) が4以下。重なり += min(P_i, 手の枚数)
const dpA = new Int16Array(250), dpB = new Int16Array(250); // [a][b][m][h] = ((a*5+b)*5+m)*2+h
function computeGroup(c, n, seq, table, base) {
  let dp = dpA, nd = dpB;
  dp.fill(-1);
  dp[0] = 0;
  for (let i = 0; i < n; i++) {
    nd.fill(-1);
    const ci = c[i];
    const maxS = seq && i <= n - 3 ? 4 : 0;
    for (let a = 0; a <= 4; a++) for (let b = 0; a + b <= 4; b++) for (let m = 0; m <= 4; m++) for (let h = 0; h <= 1; h++) {
      const v = dp[((a * 5 + b) * 5 + m) * 2 + h];
      if (v < 0) continue;
      for (let t = 0; t <= 1; t++) {
        for (let p = 0; p + h <= 1; p++) {
          for (let s = 0; s <= maxS; s++) {
            const P = a + b + 3 * t + 2 * p + s;
            if (P > 4) break;
            const m2 = m + t + s;
            if (m2 > 4) break;
            const idx = ((s * 5 + a) * 5 + m2) * 2 + h + p;
            const nv = v + (P < ci ? P : ci);
            if (nv > nd[idx]) nd[idx] = nv;
          }
        }
      }
    }
    const tmp = dp; dp = nd; nd = tmp;
  }
  for (let h = 0; h <= 1; h++) for (let m = 0; m <= 4; m++) {
    const v = dp[m * 2 + h]; // a = b = 0
    table[base + h * 5 + m] = v < 0 ? 0 : v + 1;
  }
}

const digits = new Int8Array(9);
function group(counts, off, n) {
  let key = 0;
  for (let i = n - 1; i >= 0; i--) key = key * 5 + counts[off + i];
  let table;
  if (n === 9) { if (suitTable === null) suitTable = new Int8Array(10 * P5[9]); table = suitTable; }
  else { if (honorTable === null) honorTable = new Int8Array(10 * P5[7]); table = honorTable; }
  const base = key * 10;
  if (table[base] === 0) {
    for (let i = 0; i < n; i++) digits[i] = counts[off + i];
    computeGroup(digits, n, n === 9, table, base);
  }
  return base;
}

// 合成用の作業領域（再入しないので共有してよい）。値 = 最大重なり、-1 = 不可能
const cur = new Int8Array(10);
const nxt = new Int8Array(10);

function mergeInto(table, base) {
  nxt.fill(-1);
  for (let a = 0; a < 10; a++) {
    const va = cur[a];
    if (va < 0) continue;
    const ha = a >= 5 ? 1 : 0, ma = a - ha * 5;
    for (let b = 0; b < 10; b++) {
      const vb = table[base + b];
      if (vb === 0) continue;
      const hb = b >= 5 ? 1 : 0;
      if (ha + hb > 1) continue;
      const m = ma + b - hb * 5;
      if (m > 4) continue;
      const j = (ha + hb) * 5 + m;
      const v = va + vb - 1;
      if (v > nxt[j]) nxt[j] = v;
    }
  }
  cur.set(nxt);
}

export function shantenNormal(counts) {
  const b0 = group(counts, 0, 9);
  const t0 = suitTable;
  for (let j = 0; j < 10; j++) cur[j] = t0[b0 + j] - 1;
  mergeInto(suitTable, group(counts, 9, 9));
  mergeInto(suitTable, group(counts, 18, 9));
  const bh = group(counts, 27, 7);
  mergeInto(honorTable, bh);
  return 13 - cur[9]; // h=1, m=4
}

// 七対子: 4枚持ちは1対子としか数えない
export function shantenChiitoi(counts) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] >= 1) kinds++;
    if (counts[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function shantenKokushi(counts) {
  let kinds = 0, pair = 0;
  for (const k of YAOCHU) {
    if (counts[k] >= 1) kinds++;
    if (counts[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

export function shanten(counts) {
  const a = shantenNormal(counts);
  if (a < 0) return a;
  return Math.min(a, shantenChiitoi(counts), shantenKokushi(counts));
}

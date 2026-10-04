// テスト用の参照実装: 「真の定義」によるシャンテン数（独立レビューの実装を移植）。
//   shanten = min over 和了形14枚 H（各種類4枚以下）of (14 - |H ∩ 手|) - 1 = 13 - 最大重なり
// エンジンの公式・DP は一切使わず、和了形をすべて列挙して手との重なりを数える。遅いが明らかに正しい。

// 1スート分の「m 面子 + h 雀頭」の形をすべて列挙する（各種類4枚以下）
function enumSuit(n, seq) {
  const melds = [];
  for (let i = 0; i < n; i++) melds.push([i, i, i]);
  if (seq) for (let i = 0; i + 2 < n; i++) melds.push([i, i + 1, i + 2]);
  const seen = new Set();
  const out = [];
  const c = new Array(n).fill(0);
  function rec(start, m) {
    for (let h = 0; h <= 1; h++) {
      const pairs = h ? [...Array(n).keys()] : [-1];
      for (const p of pairs) {
        if (p >= 0) c[p] += 2;
        if (c.every((x) => x <= 4)) {
          const key = c.join("") + "|" + m + "|" + h;
          if (!seen.has(key)) { seen.add(key); out.push({ c: Int8Array.from(c), m, h }); }
        }
        if (p >= 0) c[p] -= 2;
      }
    }
    if (m === 4) return;
    for (let i = start; i < melds.length; i++) {
      for (const k of melds[i]) c[k]++;
      if (c.every((x) => x <= 4)) rec(i, m + 1);
      for (const k of melds[i]) c[k]--;
    }
  }
  rec(0, 0);
  return out;
}
const SUIT = enumSuit(9, true);
const HON = enumSuit(7, false);

// (h, m) ごとの最大重なり（-1 = その形は無い）
function bestTable(pats, hand, off, n, memo) {
  let key = "";
  for (let i = 0; i < n; i++) key += hand[off + i];
  let r = memo.get(key);
  if (r) return r;
  r = new Int8Array(10).fill(-1);
  for (const p of pats) {
    let ov = 0;
    for (let i = 0; i < n; i++) { const a = p.c[i], b = hand[off + i]; ov += a < b ? a : b; }
    const j = p.h * 5 + p.m;
    if (ov > r[j]) r[j] = ov;
  }
  memo.set(key, r);
  return r;
}
const memoS = new Map(), memoH = new Map();

export function refNormal(hand) {
  const tabs = [
    bestTable(SUIT, hand, 0, 9, memoS), bestTable(SUIT, hand, 9, 9, memoS),
    bestTable(SUIT, hand, 18, 9, memoS), bestTable(HON, hand, 27, 7, memoH),
  ];
  let best = -1;
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) for (let d = 0; d < 10; d++) {
    const t = [a, b, c, d];
    let m = 0, h = 0, ov = 0, ok = true;
    for (let g = 0; g < 4; g++) {
      const v = tabs[g][t[g]];
      if (v < 0) { ok = false; break; }
      ov += v; h += t[g] >= 5 ? 1 : 0; m += t[g] % 5;
    }
    if (!ok || m !== 4 || h !== 1) continue;
    if (ov > best) best = ov;
  }
  return 13 - best;
}

export function refChiitoi(hand) {
  const v = Array.from(hand, (x) => Math.min(x, 2)).sort((a, b) => b - a);
  return 13 - v.slice(0, 7).reduce((a, b) => a + b, 0);
}

const Y = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
export function refKokushi(hand) {
  let ov = 0, pair = 0;
  for (const k of Y) { if (hand[k] >= 1) ov++; if (hand[k] >= 2) pair = 1; }
  return 13 - ov - pair;
}

export function refShanten(hand) {
  return Math.min(refNormal(hand), refChiitoi(hand), refKokushi(hand));
}

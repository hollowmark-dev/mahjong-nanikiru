// 受け入れ（SPEC.md §4）。
// visible: 長さ34。自分から見えている枚数（手牌＋ドラ表示牌）。残り = 4 - visible[k]。
import { shanten } from "./shanten.js";

// 13枚の手でシャンテン数を下げる種類。残り0枚の種類は含めない。
export function ukeire(counts13, visible) {
  const c = Array.from(counts13);
  const s = shanten(c);
  const tiles = [];
  let count = 0;
  for (let k = 0; k < 34; k++) {
    const rest = 4 - visible[k];
    if (rest <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c) < s) { tiles.push(k); count += rest; }
    c[k]--;
  }
  return { shanten: s, tiles, count };
}

// 14枚から種類ごとに1枚切った場合
export function discardOptions(counts14, visible) {
  const c = Array.from(counts14);
  const out = [];
  for (let k = 0; k < 34; k++) {
    if (c[k] === 0) continue;
    c[k]--;
    const u = ukeire(c, visible);
    c[k]++;
    out.push({ kind: k, shanten: u.shanten, ukeireTiles: u.tiles, ukeireCount: u.count });
  }
  return out;
}

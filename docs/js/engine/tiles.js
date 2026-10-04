// 牌の表現（SPEC.md §2）。ブラウザと Node の両方から読む純粋な ESM。
export const KIND_COUNT = 34;

const SUITS = "mpsz";
const HONOR_NAMES = ["東", "南", "西", "北", "白", "發", "中"];
const NUM_KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

// "0p" → { kind: 13, red: true }
export function parseTile(str) {
  if (typeof str !== "string" || str.length !== 2) throw new Error(`不正な牌: ${str}`);
  const n = str.charCodeAt(0) - 48;
  const suit = SUITS.indexOf(str[1]);
  if (suit < 0 || n < 0 || n > 9) throw new Error(`不正な牌: ${str}`);
  if (suit === 3) {
    if (n < 1 || n > 7) throw new Error(`不正な牌: ${str}`);
    return { kind: 27 + n - 1, red: false };
  }
  if (n === 0) return { kind: suit * 9 + 4, red: true };
  return { kind: suit * 9 + n - 1, red: false };
}

export function kindToStr(kind) {
  if (!Number.isInteger(kind) || kind < 0 || kind >= KIND_COUNT) throw new Error(`不正な種類: ${kind}`);
  if (kind >= 27) return `${kind - 26}z`;
  return `${(kind % 9) + 1}${SUITS[Math.floor(kind / 9)]}`;
}

export function tileToStr({ kind, red }) {
  const s = kindToStr(kind);
  return red ? `0${s[1]}` : s;
}

// 赤5を通常5の表記にそろえる（"0p" → "5p"）
export function normalizeTile(str) {
  return kindToStr(parseTile(str).kind);
}

export function toCounts(tileStrs) {
  const counts = new Array(KIND_COUNT).fill(0);
  for (const s of tileStrs) counts[parseTile(s).kind]++;
  return counts;
}

// kind 昇順、同じ kind の中では赤を通常5の後ろ
export function sortTiles(tileStrs) {
  return [...tileStrs].sort((a, b) => {
    const ta = parseTile(a), tb = parseTile(b);
    return ta.kind - tb.kind || Number(ta.red) - Number(tb.red);
  });
}

// 解説文用の日本語名
export function tileLabel(str) {
  const { kind, red } = parseTile(str);
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  const n = (kind % 9) + 1;
  const suit = Math.floor(kind / 9);
  const base = suit === 0 ? `${NUM_KANJI[n - 1]}萬` : `${n}${suit === 1 ? "筒" : "索"}`;
  return red ? `${base}(赤)` : base;
}

// ドラ表示牌 → ドラの種類
export function doraFromIndicator(str) {
  const { kind } = parseTile(str);
  if (kind < 27) return Math.floor(kind / 9) * 9 + ((kind % 9) + 1) % 9;
  if (kind <= 30) return 27 + ((kind - 27 + 1) % 4);
  return 31 + ((kind - 31 + 1) % 3);
}

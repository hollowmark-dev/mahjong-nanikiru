// 牌の自作 SVG（SPEC.md §8）。外部画像・フォントは使わない。
// tileSvg("0p") → <svg> 文字列。サイズは CSS（width）で決める。
import { parseTile } from "../engine/tiles.js";

const FONT = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP','MS Mincho','Times New Roman',serif";
const INK = "#1d1d1b", RED = "#d0262e", GREEN = "#1b7a3e", BLUE = "#1c4f9c", FACE = "#fbfaf4";
const COLOR = { g: GREEN, r: RED, b: BLUE };

function pinDot(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.62).toFixed(2)}" fill="${FACE}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.34).toFixed(2)}" fill="${color}"/>`;
}

// 筒子: [x, y, 色] の配置（1〜9）
const PIN_LAYOUT = {
  2: [[20, 16, "g"], [20, 40, "b"]],
  3: [[10, 12, "b"], [20, 28, "r"], [30, 44, "g"]],
  4: [[12, 16, "b"], [28, 16, "g"], [12, 40, "g"], [28, 40, "b"]],
  5: [[11, 15, "b"], [29, 15, "b"], [11, 41, "b"], [29, 41, "b"], [20, 28, "r"]],
  6: [[12, 13, "g"], [28, 13, "g"], [12, 28, "r"], [28, 28, "r"], [12, 43, "r"], [28, 43, "r"]],
  7: [[9, 9, "g"], [20, 15, "g"], [31, 21, "g"], [12, 35, "r"], [28, 35, "r"], [12, 47, "r"], [28, 47, "r"]],
  8: [[12, 10, "b"], [28, 10, "b"], [12, 22, "b"], [28, 22, "b"], [12, 34, "b"], [28, 34, "b"], [12, 46, "b"], [28, 46, "b"]],
  9: [[10, 13, "g"], [20, 13, "g"], [30, 13, "g"], [10, 28, "r"], [20, 28, "r"], [30, 28, "r"], [10, 43, "b"], [20, 43, "b"], [30, 43, "b"]],
};

function pinFace(n, red) {
  if (n === 1) {
    const c = red ? RED : GREEN;
    return `<circle cx="20" cy="28" r="14" fill="${c}"/><circle cx="20" cy="28" r="11" fill="${FACE}"/>` +
      `<circle cx="20" cy="28" r="9" fill="${red ? RED : RED}"/><circle cx="20" cy="28" r="5.5" fill="${FACE}"/>` +
      `<circle cx="20" cy="28" r="2.6" fill="${c}"/>`;
  }
  const r = n <= 4 ? 7 : n <= 6 ? 6.2 : n === 9 ? 4.8 : n === 8 ? 5 : 4.6;
  return PIN_LAYOUT[n].map(([x, y, c]) => pinDot(x, y, r, red ? RED : COLOR[c])).join("");
}

function bar(cx, cy, w, h, color) {
  const x = cx - w / 2, y = cy - h / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(w / 2.3).toFixed(2)}" fill="${color}"/>` +
    `<rect x="${x}" y="${cy - 0.6}" width="${w}" height="1.2" fill="${FACE}" opacity="0.8"/>` +
    `<rect x="${x + w * 0.2}" y="${y + 1.5}" width="${(w * 0.18).toFixed(2)}" height="${h - 3}" fill="#fff" opacity="0.25"/>`;
}

// 八索の絵柄（遊ぶ人が選べる）。どれも棒8本。
export const SOU8_STYLES = [
  { id: "mw", label: "実物風（M・W）" },
  { id: "x", label: "X字" },
  { id: "straight", label: "縦並び" },
];
let sou8Style = "mw";
export function setSou8Style(id) {
  if (SOU8_STYLES.some((s) => s.id === id)) sou8Style = id;
}
export function getSou8Style() {
  return sou8Style;
}

// 傾けた棒（deg は時計回り）
function tiltedBar(cx, cy, w, h, color, deg) {
  return `<g transform="rotate(${deg} ${cx} ${cy})">${bar(cx, cy, w, h, color)}</g>`;
}

function sou8Face(c) {
  if (sou8Style === "straight") {
    return [8.5, 16.5, 23.5, 31.5].map((x, i) => {
      const k = i % 3 === 0 ? "g" : "b";
      return bar(x, 17, 5.5, 17, c(k)) + bar(x, 39, 5.5, 17, c(k));
    }).join("");
  }
  // 外側は縦、内側の2本を傾ける。mw: 上段 ∧・下段 ∨（実物の八索）。x: 上段 ∨・下段 ∧
  const t = sou8Style === "mw" ? 1 : -1;
  return bar(7.5, 17, 5.5, 18, c("g")) + bar(32.5, 17, 5.5, 18, c("g")) +
    tiltedBar(15.5, 17.5, 5.5, 18, c("b"), 20 * t) + tiltedBar(24.5, 17.5, 5.5, 18, c("b"), -20 * t) +
    bar(7.5, 39, 5.5, 18, c("g")) + bar(32.5, 39, 5.5, 18, c("g")) +
    tiltedBar(15.5, 38.5, 5.5, 18, c("b"), -20 * t) + tiltedBar(24.5, 38.5, 5.5, 18, c("b"), 20 * t);
}

// 索子: [cx, cy, 色]（bar の大きさは別途）
function souFace(n, red) {
  const c = (k) => (red ? RED : COLOR[k]);
  const out = [];
  const add = (cx, cy, w, h, k) => out.push(bar(cx, cy, w, h, c(k)));
  switch (n) {
    case 1: {
      // 鳥（簡略）
      const g = red ? RED : GREEN;
      return `<ellipse cx="20" cy="33" rx="8" ry="11" fill="${g}"/><circle cx="20" cy="19" r="5.5" fill="${g}"/>` +
        `<path d="M24.5 18 L31 20 L24.5 22 Z" fill="${red ? RED : RED}"/><circle cx="22" cy="17.5" r="1.2" fill="${FACE}"/>` +
        `<ellipse cx="17" cy="33" rx="4" ry="7" fill="${red ? FACE : RED}" opacity="0.9"/>` +
        `<path d="M16 43 L20 52 L24 43 Z" fill="${g}"/>`;
    }
    case 2: add(20, 16, 6, 16, "g"); add(20, 40, 6, 16, "b"); break;
    case 3: add(20, 16, 6, 16, "g"); add(12, 40, 6, 16, "b"); add(28, 40, 6, 16, "b"); break;
    case 4: [[12, 16], [28, 16], [12, 40], [28, 40]].forEach(([x, y], i) => add(x, y, 6, 16, i % 3 === 0 ? "b" : "g")); break;
    case 5: [[11, 15], [29, 15], [11, 41], [29, 41]].forEach(([x, y]) => add(x, y, 6, 15, "g")); add(20, 28, 6, 15, "r"); break;
    case 6: [10, 20, 30].forEach((x, i) => { add(x, 17, 6, 16, i === 1 ? "b" : "g"); add(x, 39, 6, 16, i === 1 ? "b" : "g"); }); break;
    case 7: add(20, 10, 6, 12, "r"); [10, 20, 30].forEach((x) => { add(x, 26, 6, 14, "g"); add(x, 42, 6, 14, "g"); }); break;
    case 8: return sou8Face(c);
    case 9: [10, 20, 30].forEach((x, i) => [12, 28, 44].forEach((y) => add(x, y, 6, 13, i === 1 ? "r" : i === 0 ? "g" : "b"))); break;
  }
  return out.join("");
}

function text(ch, x, y, size, color, weight = 700) {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}">${ch}</text>`;
}

const NUM_KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR = ["東", "南", "西", "北", "白", "發", "中"];

function faceOf(kind, red) {
  if (kind >= 27) {
    const i = kind - 27;
    if (i === 4) return `<rect x="9" y="10" width="22" height="36" rx="2" fill="none" stroke="${BLUE}" stroke-width="2.6"/>`;
    const color = i === 5 ? GREEN : i === 6 ? RED : INK;
    return text(HONOR[i], 20, 40, 32, color);
  }
  const n = (kind % 9) + 1;
  const suit = Math.floor(kind / 9);
  if (suit === 0) {
    return text(NUM_KANJI[n - 1], 20, 26, 25, red ? RED : INK) + text("萬", 20, 49, 22, RED) +
      (red ? `<circle cx="6.5" cy="6.5" r="2.6" fill="${RED}"/>` : "");
  }
  return suit === 1 ? pinFace(n, red) : souFace(n, red);
}

// str: "5p" / "0p" など
export function tileSvg(str) {
  const { kind, red } = parseTile(str);
  return `<svg class="tile" viewBox="0 0 40 56" aria-hidden="true" focusable="false">` +
    `<rect x="0.75" y="0.75" width="38.5" height="54.5" rx="5" fill="${FACE}" stroke="#8a867a" stroke-width="1.3"/>` +
    `<rect x="2.6" y="2.6" width="34.8" height="50.8" rx="3.6" fill="none" stroke="#e4e0d2" stroke-width="1"/>` +
    faceOf(kind, red) + `</svg>`;
}

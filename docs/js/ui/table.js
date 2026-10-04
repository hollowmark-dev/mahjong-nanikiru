// 卓の盤面。正方形・中央に巡目とドラ表示牌・四辺に各家の河（6枚で折り返し）。
// 各家の河はその家から見た向きに回転させる（下=自家 / 右=下家 / 上=対面 / 左=上家）。
import { h, tileNode } from "./dom.js";
import { parseTile, tileLabel } from "../engine/tiles.js";

const SEATS = [
  ["self", "自家", "seat-self"],
  ["shimo", "下家", "seat-shimo"],
  ["toimen", "対面", "seat-toimen"],
  ["kami", "上家", "seat-kami"],
];

// 戻り値: { el, highlight(kind|null) }
export function createTable(problem) {
  const el = h("div", { class: "table", role: "group", "aria-label": "卓。各家の捨て牌とドラ表示牌" });
  const byKind = new Map();
  const reg = (node, str) => {
    const k = parseTile(str).kind;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(node);
  };

  for (const [key, name, cls] of SEATS) {
    const tiles = (problem.rivers && problem.rivers[key]) || [];
    const river = h("div", { class: "river", role: "group", "aria-label": `${name}の河 ${tiles.length}枚` });
    const riichiIdx = problem.riichi && problem.riichi.seat === key ? problem.riichi.index : -1;
    tiles.forEach((t, i) => {
      const n = tileNode(t, "rt", true);
      reg(n, t);
      if (i === riichiIdx) {
        // リーチ宣言牌は横向き（その家から見て横）。幅 1.4 枚分の枠の中で 90° 回す
        const cell = h("span", { class: "rt-riichi", role: "img", "aria-label": `${tileLabel(t)}（リーチ宣言牌）` }, n);
        n.removeAttribute("role"); n.removeAttribute("aria-label");
        river.append(cell);
      } else river.append(n);
    });
    el.append(h("div", { class: `seat ${cls}` }, river,
      h("div", { class: "seat-name" }, name, riichiIdx >= 0 ? h("span", { class: "riichi-tag" }, "リーチ") : null)));
  }

  const dora = tileNode(problem.doraIndicator, "dora-tile", true);
  reg(dora, problem.doraIndicator);
  el.append(h("div", { class: "table-center" },
    h("div", { class: "table-turn" }, `${problem.turn}巡目`),
    h("div", { class: "table-dora-label" }, "ドラ表示牌"),
    dora,
    problem.riichi ? h("div", { class: "kyotaku", "aria-label": "供託 1000点棒" }, stickSvg(), h("span", {}, "供託")) : null));

  let cur = [];
  function highlight(kind) {
    cur.forEach((n) => n.classList.remove("hl"));
    cur = kind == null ? [] : (byKind.get(kind) || []);
    cur.forEach((n) => n.classList.add("hl"));
  }
  return { el, highlight };
}

// 1000点棒（白い棒に黒い点1つ）
function stickSvg() {
  const s = document.createElement("span");
  s.className = "stick";
  s.innerHTML = '<svg viewBox="0 0 60 10" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="59" height="9" rx="2" fill="#f4f1e6" stroke="#8a867a"/><circle cx="30" cy="5" r="1.8" fill="#1d1d1b"/></svg>';
  return s;
}

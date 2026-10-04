// 卓の盤面。正方形・中央に巡目とドラ表示牌・四辺に各家の河（6枚で折り返し）。
// 各家の河はその家から見た向きに回転させる（下=自家 / 右=下家 / 上=対面 / 左=上家）。
import { h, tileNode } from "./dom.js";
import { parseTile } from "../engine/tiles.js";

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
    tiles.forEach((t) => {
      const n = tileNode(t, "rt", true);
      reg(n, t);
      river.append(n);
    });
    el.append(h("div", { class: `seat ${cls}` }, river, h("div", { class: "seat-name" }, name)));
  }

  const dora = tileNode(problem.doraIndicator, "dora-tile", true);
  reg(dora, problem.doraIndicator);
  el.append(h("div", { class: "table-center" },
    h("div", { class: "table-turn" }, `${problem.turn}巡目`),
    h("div", { class: "table-dora-label" }, "ドラ表示牌"),
    dora));

  let cur = [];
  function highlight(kind) {
    cur.forEach((n) => n.classList.remove("hl"));
    cur = kind == null ? [] : (byKind.get(kind) || []);
    cur.forEach((n) => n.classList.add("hl"));
  }
  return { el, highlight };
}

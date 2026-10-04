// 小さな DOM ヘルパ
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

import { tileSvg } from "./tileSvg.js";
import { tileLabel } from "../engine/tiles.js";

// 牌の SVG を包んだ span。labeled=true なら読み上げ用に role="img" と aria-label を付ける。
// innerHTML に入れるのは tileSvg() が自前で組み立てた文字列だけ（外部入力は入らない。str は parseTile で検証される）。
export function tileNode(str, cls = "", labeled = false) {
  const s = document.createElement("span");
  s.className = `tw ${cls}`.trim();
  s.innerHTML = tileSvg(str);
  if (labeled) { s.setAttribute("role", "img"); s.setAttribute("aria-label", tileLabel(str)); }
  return s;
}

export function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

export function secText(ms) {
  return `${(ms / 1000).toFixed(1)}秒`;
}

// root の中身を置き換える（null / false は無視）
export function mount(root, ...kids) {
  root.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

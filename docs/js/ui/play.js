// 出題画面。タイマーは描画完了（rAF×2）から performance.now() で計測する。
import { h, tileNode } from "./dom.js";
import { tileLabel, parseTile } from "../engine/tiles.js";
import { createTable } from "./table.js";

// 戻り値: 後片付け関数
export function renderPlay(root, { problem, index, total, limitMs, mode, onAnswer }) {
  const fill = h("div", { class: "timer-fill" });
  const limitSec = Math.ceil(limitMs / 1000);
  const bar = h("div", { class: "timer", role: "progressbar", "aria-label": "残り時間（秒）", "aria-valuemin": "0", "aria-valuemax": String(limitSec), "aria-valuenow": String(limitSec) }, fill);
  const num = h("div", { class: "timer-num", "aria-hidden": "true" }, (limitMs / 1000).toFixed(1));
  let lastSec = limitSec;
  const hand = h("div", { class: "hand", role: "group", "aria-label": "手牌。切る牌を選んでください" });
  const modeLabel = mode === "daily" ? "今日の10問" : mode === "retry" ? "再挑戦（練習扱い）" : mode === "practice_oshi" ? "練習（押し引き）" : "練習";
  const isOshi = problem.kind === "oshihiki";

  let t0 = null, done = false, raf = 0, timeoutId = 0;

  function answer(tile, index, timedOut) {
    if (done || t0 == null) return;
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(timeoutId);
    const raw = performance.now() - t0;
    // タブ非表示などでタイマーが止まっていても、制限時間を過ぎていれば時間切れ
    if (raw >= limitMs) timedOut = true;
    const elapsed = Math.min(raw, limitMs);
    onAnswer({
      tile: timedOut ? problem.draw : tile,
      index: timedOut ? 13 : index,
      timeMs: timedOut ? limitMs : elapsed,
      remainingMs: timedOut ? 0 : Math.max(0, limitMs - elapsed),
      timedOut,
    });
  }

  const table = createTable(problem);
  const mkBtn = (tile, isDraw, i) => {
    const b = h("button", {
      type: "button", class: `tilebtn${isDraw ? " draw" : ""}`,
      "aria-label": `${isDraw ? "ツモ牌 " : ""}${tileLabel(tile)}を切る`,
      onclick: () => answer(tile, i, false),
    });
    b.append(tileNode(tile));
    // マウスのホバー／キーボードフォーカスのときだけ卓の同じ種類を強調する。
    // タッチは即回答のため、長押し判定は作らない（誤回答を防ぐ）。
    const kind = parseTile(tile).kind;
    b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") table.highlight(kind); });
    b.addEventListener("pointerleave", () => table.highlight(null));
    b.addEventListener("focus", () => table.highlight(kind));
    b.addEventListener("blur", () => table.highlight(null));
    return b;
  };
  problem.hand.forEach((t, i) => hand.append(mkBtn(t, false, i)));
  hand.append(mkBtn(problem.draw, true, 13));

  root.replaceChildren(
    h("div", { class: "play-head" },
      h("div", { class: "qno" }, `問 ${index + 1}/${total}`),
      isOshi ? h("div", { class: "kind-tag" }, "押し引き") : null,
      h("div", { class: "mode-note" }, modeLabel),
    ),
    h("div", { class: "timer-wrap" },
      bar,
      num),
    table.el,
    hand,
    h("p", { class: "hint" }, isOshi ? "リーチ者がいます。押すか降りるか、切る牌をタップ。" : "切る牌をタップ。右端が今引いた牌です。"),
  );

  function frame() {
    if (done) return;
    const remaining = limitMs - (performance.now() - t0);
    if (remaining <= 0) { fill.style.transform = "scaleX(0)"; num.textContent = "0.0"; bar.setAttribute("aria-valuenow", "0"); answer(null, 13, true); return; }
    const ratio = remaining / limitMs;
    fill.style.transform = `scaleX(${ratio})`;
    fill.classList.toggle("low", ratio < 0.3);
    num.textContent = (remaining / 1000).toFixed(1);
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastSec) { lastSec = sec; bar.setAttribute("aria-valuenow", String(sec)); }
    raf = requestAnimationFrame(frame);
  }
  // 描画完了を待ってから計測開始
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      if (done) return;
      t0 = performance.now();
      // タブが隠れて rAF が止まっても時間切れになるようにする
      timeoutId = setTimeout(() => answer(null, 13, true), limitMs + 50);
      frame();
    });
  });

  return () => { done = true; cancelAnimationFrame(raf); clearTimeout(timeoutId); };
}

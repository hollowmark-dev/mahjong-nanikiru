// 解説画面（押し引き問題）
import { h, tileNode, pct, secText } from "./dom.js";
import { createTable } from "./table.js";
import { tileLabel, parseTile, kindToStr } from "../engine/tiles.js";

const RANK_CLASS = { 最善: "r-best", 好手: "r-good", 次善: "r-ok", 悪手: "r-bad", 時間切れ: "r-bad" };
const ANSWER_TEXT = {
  push: "この局面は押しが正解",
  fold: "この局面は降りが正解",
  mawashi: "この局面は回し打ち（安全に手を保つ）が正解",
};
const yen = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`;

export function renderExplainOshi(root, { problem, index, total, answer, result, isLast, onNext }) {
  const mineKind = kindToStr(parseTile(answer.tile).kind);
  const bestKind = kindToStr(parseTile(problem.best).kind);
  const all = [...problem.hand, problem.draw];
  const pickedIdx = answer.timedOut || answer.index == null ? 13 : answer.index;
  const handRow = h("div", { class: "hand static", role: "group", "aria-label": "手牌" });
  all.forEach((t, i) => {
    const w = tileNode(t, i === pickedIdx ? "picked" : "", true);
    if (i === 13) w.classList.add("draw");
    handRow.append(w);
  });

  const mineC = problem.candidates.find((c) => c.tile === mineKind);
  const bestC = problem.candidates.find((c) => c.tile === bestKind);
  const lossText = result.redPenalty
    ? `${Math.round(result.rawLoss)} ＋ 300（赤5を切ったため） = ${Math.round(result.loss)} 点`
    : `${Math.round(result.loss)} 点`;

  const breakdown = h("dl", { class: "breakdown" },
    h("dt", {}, "期待収支"), h("dd", {}, `あなた ${yen(mineC.ev)} ／ 最善 ${yen(bestC.ev)}（点）`),
    h("dt", {}, "損失"), h("dd", {}, lossText),
    h("dt", {}, "基礎点"), h("dd", {}, result.timedOut ? "0（時間切れは0点）"
      : result.capped ? "100 × (1 − 損失/3000) < 0 → 0（3000点以上の損失は0点）"
        : `100 × (1 − ${Math.round(result.loss)}/3000) = ${result.base.toFixed(1)}`),
    h("dt", {}, "時間係数"), h("dd", {}, result.timedOut ? "－（時間切れ）" : `×${result.factor.toFixed(2)}（残り ${secText(result.remainingMs)}）`),
    h("dt", {}, "得点"), h("dd", { class: "pts" }, `${result.points}点`),
  );

  const head = h("div", { class: "row head", role: "row" },
    h("div", { class: "c-tile" }, "切る牌"),
    h("div", { class: "c-sh" }, "向聴"),
    h("div", { class: "c-n" }, "放銃率(即)"),
    h("div", { class: "c-n" }, "和了率"),
    h("div", { class: "c-n" }, "放銃率(局)"),
    h("div", { class: "c-n" }, "期待収支"),
  );
  const rows = problem.candidates.map((c) => {
    const cls = ["row"];
    if (c.tile === mineKind) cls.push("mine");
    if (c.tile === bestKind) cls.push("best");
    return h("div", { class: cls.join(" "), role: "row" },
      h("div", { class: "c-tile" }, tileNode(c.tile, "", true),
        c.tile === mineKind ? h("span", { class: "tag mine-tag" }, "あなた") : null,
        c.tile === bestKind ? h("span", { class: "tag best-tag" }, "最善") : null),
      h("div", { class: "c-sh" }, String(c.shanten)),
      h("div", { class: "c-n" }, c.dealIn === 0 ? h("b", {}, "現物") : pct(c.dealIn)),
      h("div", { class: "c-n" }, pct(c.agari)),
      h("div", { class: "c-n" }, pct(c.lose)),
      h("div", { class: "c-n c-ev" }, yen(c.ev)),
    );
  });

  const summary = answer.timedOut
    ? h("p", { class: "lead" }, `時間切れ。ツモ切り（${tileLabel(problem.draw)}）として表示しています（0点）。`)
    : h("p", { class: "lead" }, `あなたの選択: ${tileLabel(answer.tile)}`);

  root.replaceChildren(
    h("div", { class: "play-head" }, h("div", { class: "qno" }, `問 ${index + 1}/${total} 解説`), h("div", { class: "kind-tag" }, "押し引き")),
    createTable(problem).el,
    handRow,
    h("h2", { class: "oshi-verdict" }, ANSWER_TEXT[problem.answerType] || ANSWER_TEXT.push),
    h("div", { class: "verdict" },
      h("span", { class: `rank ${RANK_CLASS[result.rank]}` }, result.rank),
      h("span", { class: "verdict-pts" }, `${result.points}点`)),
    summary,
    h("p", { class: "lead" }, `最善: ${tileLabel(bestKind)}${result.isBest ? "（正解）" : ""}`),
    breakdown,
    h("h2", {}, "全候補の比較"),
    h("p", { class: "note" }, "リーチ者の手は、見えている情報と矛盾しない形をランダムに作って評価しています（実際の手ではありません）。"),
    h("p", { class: "note" }, "期待収支の高い順です。放銃率(即)はその牌を今切って放銃する確率、放銃率(局)は局が終わるまでに自分が放銃する確率です。打点の読みは含みます（親・東1局・全員25000点）。"),
    h("div", { class: "ctable oshi", role: "table" }, head, rows),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn primary", onclick: onNext }, isLast ? "結果を見る" : "次へ")),
  );
  window.scrollTo(0, 0);
}

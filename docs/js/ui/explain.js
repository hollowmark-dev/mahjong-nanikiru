// 解説画面（1問ごと）
import { h, tileNode, pct, secText } from "./dom.js";
import { createTable } from "./table.js";
import { renderExplainOshi } from "./explainOshi.js";
import { tileLabel, parseTile, kindToStr } from "../engine/tiles.js";

export function renderExplain(root, args) {
  if (args.problem.kind === "oshihiki") return renderExplainOshi(root, args);
  const { problem, index, total, answer, result, isLast, onNext } = args;
  // answer.index: 実際に押したボタンの位置（0〜12 が手牌、13 がツモ牌）
  const mineKind = kindToStr(parseTile(answer.tile).kind);
  const bestKind = kindToStr(parseTile(problem.best).kind);

  // 手牌（選んだ牌を枠で示す）
  const all = [...problem.hand, problem.draw];
  const pickedIdx = answer.timedOut || answer.index == null ? 13 : answer.index;
  const handRow = h("div", { class: "hand static", role: "group", "aria-label": "手牌" });
  all.forEach((t, i) => {
    const w = tileNode(t, i === pickedIdx ? "picked" : "", true);
    if (i === 13) w.classList.add("draw");
    handRow.append(w);
  });

  const rankClass = { 最善: "r-best", 好手: "r-good", 次善: "r-ok", 悪手: "r-bad", 時間切れ: "r-bad" }[result.rank];
  const mineC = problem.candidates.find((c) => c.tile === mineKind);
  const bestC = problem.candidates.find((c) => c.tile === bestKind);

  const breakdown = h("dl", { class: "breakdown" },
    h("dt", {}, "和了率"), h("dd", {}, `あなた ${pct(mineC.agari)} ／ 最善 ${pct(bestC.agari)}`),
    h("dt", {}, "評価 q"), h("dd", {}, `${result.rawQ.toFixed(3)}${result.redPenalty ? " × 0.9（赤5を切ったため）" : ""} = ${result.q.toFixed(3)}`),
    h("dt", {}, "基礎点"), h("dd", {}, result.timedOut ? "0（時間切れは0点）"
      : result.capped ? `100 × (1 − 3×(1 − q)) < 0 → 0（q が 2/3 以下は0点）`
        : `100 × (1 − 3×(1 − ${result.q.toFixed(3)})) = ${result.base.toFixed(1)}`),
    h("dt", {}, "時間係数"), h("dd", {}, result.timedOut ? "－（時間切れ）" : `×${result.factor.toFixed(2)}（残り ${secText(result.remainingMs)}）`),
    h("dt", {}, "得点"), h("dd", { class: "pts" }, `${result.points}点`),
  );

  const head = h("div", { class: "row head", role: "row" },
    h("div", { class: "c-tile", role: "columnheader" }, "切る牌"),
    h("div", { class: "c-sh", role: "columnheader" }, "向聴"),
    h("div", { class: "c-uk", role: "columnheader" }, "受け入れ"),
    h("div", { class: "c-tp", role: "columnheader" }, "テンパイ"),
    h("div", { class: "c-ag", role: "columnheader" }, "和了"),
  );
  const rows = problem.candidates.map((c) => {
    const cls = ["row"];
    if (c.tile === mineKind) cls.push("mine");
    if (c.tile === bestKind) cls.push("best");
    const tiles = h("div", { class: "uk-tiles" });
    c.ukeireTiles.forEach((t) => tiles.append(tileNode(t, "mini", true)));
    return h("div", { class: cls.join(" "), role: "row" },
      h("div", { class: "c-tile", role: "cell" }, tileNode(c.tile, "", true),
        c.tile === mineKind ? h("span", { class: "tag mine-tag" }, "あなた") : null,
        c.tile === bestKind ? h("span", { class: "tag best-tag" }, "最善") : null),
      h("div", { class: "c-sh", role: "cell" }, String(c.shanten)),
      h("div", { class: "c-uk", role: "cell" }, h("b", {}, `${c.ukeire}枚`), tiles),
      h("div", { class: "c-tp", role: "cell" }, pct(c.tenpai), c.furiten ? h("span", { class: "tag furiten-tag" }, "フリテン") : null),
      h("div", { class: "c-ag", role: "cell" }, pct(c.agari)),
    );
  });

  const summary = answer.timedOut
    ? h("p", { class: "lead" }, `時間切れ。ツモ切り（${tileLabel(problem.draw)}）として採点しました。`)
    : h("p", { class: "lead" }, `あなたの選択: ${tileLabel(answer.tile)}`);

  root.replaceChildren(
    h("div", { class: "play-head" },
      h("div", { class: "qno" }, `問 ${index + 1}/${total} 解説`),
    ),
    createTable(problem).el,
    handRow,
    h("div", { class: "verdict" },
      h("span", { class: `rank ${rankClass}` }, result.rank),
      h("span", { class: "verdict-pts" }, `${result.points}点`)),
    summary,
    h("p", { class: "lead" }, `最善: ${tileLabel(bestKind)}${result.isBest ? "（正解）" : ""}`),
    breakdown,
    h("h2", {}, "全候補の比較"),
    h("p", { class: "note" }, "和了率はツモ＋他家の打牌でのロンを含みます。見えている牌（全員の河・ドラ表示牌）は山にない前提です。"),
    h("p", { class: "note" }, `切ったあと残り${problem.draws}回のツモをシミュレーションした値です。和了率の高い順に並んでいます。打点（ドラ・赤・役）は評価に含みません。フリテンの印は、待ちの牌を自分で切っていてロンできない候補です。`),
    h("div", { class: "ctable", role: "table" }, head, rows),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn primary", onclick: onNext }, isLast ? "結果を見る" : "次へ")),
  );
  window.scrollTo(0, 0);
}

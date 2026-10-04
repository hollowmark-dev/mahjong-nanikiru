// ランキング画面（今日／直近7日の切替）
import { h, mount } from "./dom.js";
import * as ranking from "../ranking.js";
import { shortDate } from "../game/daily.js";

// ctx: { today, date?, go(name) }  date: 表示する日付（省略時は today）。直近7日合計はこの日までの7日
export function renderRankingScreen(root, ctx) {
  const date = ctx.date || ctx.today;
  let tab = "daily";
  let seq = 0;
  const body = h("div", { class: "rank-body" });

  const mkTab = (id, label) => h("button", {
    type: "button", role: "tab", class: "tab", id: `tab-${id}`,
    "aria-selected": String(tab === id), onclick: () => { tab = id; sync(); load(); },
  }, label);
  const tabs = h("div", { class: "tabs", role: "tablist" });

  function sync() {
    tabs.replaceChildren(mkTab("daily", date === ctx.today ? "今日" : shortDate(date)), mkTab("weekly", "直近7日合計"));
  }

  async function load() {
    const my = ++seq;
    body.replaceChildren(h("p", { class: "msg" }, "読み込み中…"));
    let rows = null;
    try {
      rows = tab === "daily" ? await ranking.fetchDaily(date) : await ranking.fetchWeekly(date);
    } catch { rows = null; }
    if (my !== seq) return;
    if (!Array.isArray(rows)) {
      body.replaceChildren(h("p", { class: "msg err" }, "取得できませんでした"));
      return;
    }
    if (rows.length === 0) {
      body.replaceChildren(h("p", { class: "msg" }, "まだ記録がありません"));
      return;
    }
    const daily = tab === "daily";
    const head = h("tr", {}, h("th", {}, "順位"), h("th", {}, "名前"), h("th", { class: "num" }, "点数"),
      h("th", { class: "num" }, daily ? "最善" : "日数"));
    const trs = rows.map((r, i) => {
      const me = r.me === true;
      return h("tr", { class: me ? "me" : "" },
        h("td", {}, String(i + 1)),
        h("td", { class: "nm" }, r.name, me ? h("span", { class: "tag mine-tag" }, "あなた") : null),
        h("td", { class: "num" }, String(r.score)),
        h("td", { class: "num" }, daily ? `${r.bestCount ?? "-"}` : `${r.days ?? "-"}`));
    });
    body.replaceChildren(h("table", { class: "rank-table" }, h("thead", {}, head), h("tbody", {}, trs)));
  }

  mount(root, 
    h("header", { class: "title" }, h("h1", {}, "ランキング"), h("p", {}, "上位50件")),
    tabs, body,
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn", onclick: () => ctx.go("home") }, "ホームへ")),
  );
  sync();
  load();
}

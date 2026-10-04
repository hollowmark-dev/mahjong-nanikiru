// ホーム画面
import { h, mount } from "./dom.js";
import * as ranking from "../ranking.js";
import * as storage from "../game/storage.js";
import { shortDate, addDays } from "../game/daily.js";
import { yesterdayAction } from "../game/progress.js";

// ctx: { today, startGame(mode, sec), showRecord(record), go(name) }
export function renderHome(root, ctx) {
  const today = ctx.today;
  const record = storage.loadDaily(today);
  const rankingOn = ranking.isRankingEnabled();

  const nameInput = h("input", {
    type: "text", id: "nick", maxlength: "12", autocomplete: "nickname",
    placeholder: "1〜12文字", value: storage.getName(), "aria-describedby": "nick-msg",
  });
  const nameMsg = h("p", { class: "msg", id: "nick-msg", role: "status" });
  const saveName = () => {
    const ok = storage.setName(nameInput.value);
    nameMsg.textContent = ok ? "" : "ニックネームは1〜12文字で入力してください";
    return ok;
  };
  nameInput.addEventListener("change", saveName);

  const daily = h("section", { class: "card" },
    h("h2", {}, `今日の10問（${shortDate(today)}）`),
    h("p", { class: "note" }, "全員同じ10問・制限時間20秒。ランキングは1日1回です。"),
  );
  if (record && record.status === "playing") {
    daily.append(
      h("p", { class: "done-line" }, `途中です: ${record.answers.length}/${record.count}問まで回答済み`),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn primary big", onclick: () => ctx.resume(record) }, "続きから")),
      h("p", { class: "note" }, "表示したまま中断した問題は時間切れ（ツモ切り）になります。"),
    );
  } else if (record) {
    daily.append(
      h("p", { class: "done-line" }, `挑戦済み: ${record.score}点 ／ 最善 ${record.bestCount}/${record.count}`),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "btn primary", onclick: () => ctx.showRecord(record) }, "結果を見る"),
        rankingOn ? h("button", { type: "button", class: "btn", onclick: () => ctx.go("ranking", { date: record.date }) }, "ランキング") : null,
        h("button", { type: "button", class: "btn", onclick: () => ctx.startGame("retry", 20, record.date) }, "もう一度（練習扱い）"),
      ),
      h("p", { class: "note" }, "再挑戦はランキングに送信されません。"),
    );
  } else {
    daily.append(h("div", { class: "actions" },
      h("button", {
        type: "button", class: "btn primary big",
        onclick: () => { if (saveName()) ctx.startGame("daily", 20); else nameInput.focus(); },
      }, "今日の10問を始める")));
  }

  // 昨日の分（日付またぎで途中・未送信のもの）
  const yRec = rankingOn ? storage.loadDaily(addDays(today, -1)) : null;
  const yAct = yesterdayAction(yRec);
  const yesterday = yAct === "none" ? null : h("section", { class: "card" },
    h("h2", {}, `昨日（${shortDate(yRec.date)}）の10問`),
    yAct === "resume"
      ? [h("p", { class: "done-line" }, `途中です: ${yRec.answers.length}/${yRec.count}問まで回答済み`),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => ctx.resume(yRec) }, "昨日の続きから"))]
      : [h("p", { class: "done-line" }, `未送信: ${yRec.score}点 ／ 最善 ${yRec.bestCount}/${yRec.count}`),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => ctx.showRecord(yRec) }, "結果を見て送信"))],
    h("p", { class: "note" }, "昨日付のままランキングに送れます。"));

  // 練習モード
  const secs = storage.PRACTICE_SECS;
  const cur = storage.getPracticeSec();
  const radios = secs.map((s) => {
    const id = `sec${s}`;
    const r = h("input", { type: "radio", name: "sec", id, value: String(s), checked: s === cur });
    r.addEventListener("change", () => storage.setPracticeSec(s));
    return h("label", { class: "chip", for: id }, r, h("span", {}, `${s}秒`));
  });
  const practice = h("section", { class: "card" },
    h("h2", {}, "練習モード"),
    h("p", { class: "note" }, "無作為に10問。ランキングには送信されません。"),
    h("div", { class: "chips", role: "radiogroup", "aria-label": "制限時間" }, radios),
    h("div", { class: "actions" },
      h("button", {
        type: "button", class: "btn",
        onclick: () => {
          const sel = root.querySelector('input[name="sec"]:checked');
          ctx.startGame("practice", sel ? Number(sel.value) : storage.DEFAULT_PRACTICE_SEC);
        },
      }, "練習を始める")),
  );

  const how = h("details", { class: "card how" },
    h("summary", {}, "遊び方"),
    h("ul", {},
      h("li", {}, "卓には全員の捨て牌とドラ表示牌が出ています。手牌13枚＋ツモ牌1枚から、切る牌を1枚タップします（確認はありません）。"),
      h("li", {}, "見えている牌（全員の河・ドラ表示牌）は山にない前提で、数えて受け入れ枚数を考えます。"),
      h("li", {}, "切った後の手を何度もシミュレーションし、和了率（ツモ＋ロン）の高さで採点します。最善手との比が評価 q です。"),
      h("li", {}, "待ちの牌を自分の河に切っていると、他家の打牌ではロンできません（フリテン）。解説の表に印が付きます。"),
      h("li", {}, "1問の基礎点は 100 × (1 − 3×(1 − q))。最善なら100点、次善でも q=0.9 なら70点、q が2/3以下なら0点で、手の良し悪しに差がつきます。"),
      h("li", {}, "基礎点に、残り時間が多いほど最大1.5倍の時間係数がかかります（最大150点）。時間切れは0点です。"),
      h("li", {}, "赤5は残すほうが有利です。通常の5があるのに赤5を切ると q が0.9倍になります。"),
      h("li", {}, "時間切れは0点です（解説ではツモ切りしたものとして表示）。解説を見ている間はタイマーが止まります。"),
      h("li", {}, "リーチ麻雀（赤ドラ3枚・門前のみ）の想定です。他家の手牌は未知として扱い、鳴きや押し引きは考えません。"),
    ),
  );

  mount(root, 
    h("header", { class: "title" }, h("h1", {}, "何切る道場"), h("p", {}, "制限時間つきの何切る練習")),
    h("section", { class: "card" },
      h("label", { for: "nick" }, "ニックネーム"),
      nameInput, nameMsg),
    yesterday,
    daily,
    practice,
    rankingOn
      ? h("section", { class: "card" }, h("div", { class: "actions" },
        h("button", { type: "button", class: "btn", onclick: () => ctx.go("ranking") }, "ランキングを見る")))
      : null,
    how,
  );
}

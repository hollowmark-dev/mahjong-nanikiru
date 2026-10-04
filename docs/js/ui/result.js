// 結果画面（今日の10問は初回表示時にランキングへ自動送信）
import { h, tileNode, secText, mount } from "./dom.js";
import * as ranking from "../ranking.js";
import * as storage from "../game/storage.js";
import { toSubmitAnswers, buildShareText, summarizeByType } from "../game/session.js";
import { tileLabel } from "../engine/tiles.js";
import { shortDate } from "../game/daily.js";
import { submitView, PENDING_MS } from "../game/progress.js";

const sending = new Set(); // 送信中の日付（この画面を開き直しても二重送信しない）
const RANK_CLASS = { 最善: "r-best", 好手: "r-good", 次善: "r-ok", 悪手: "r-bad", 時間切れ: "r-bad" };

// ctx: { go(name), today }
export function renderResult(root, { record, ctx }) {
  const isDaily = record.mode === "daily";
  const rankingOn = ranking.isRankingEnabled();
  const modeLabel = isDaily ? "今日の10問" : record.mode === "retry" ? "再挑戦（練習扱い）" : record.mode === "practice_oshi" ? "練習（押し引き）" : "練習";
  const byType = summarizeByType(record.answers);
  const typeLine = byType.oshihiki.count > 0 && byType.speed.count > 0
    ? `速度 ${byType.speed.best}/${byType.speed.count} 最善 ／ 押し引き ${byType.oshihiki.best}/${byType.oshihiki.count} 最善` : "";

  const submitBox = h("p", { class: "msg submit", role: "status" });
  const shareBox = h("div", { class: "share-box" });

  function showSubmit() {
    // 別の画面・タブで送信が終わっているかもしれないので、保存済みの状態を読み直す
    const stored = storage.loadDaily(record.date);
    if (stored && stored.submit) record.submit = stored.submit;
    const s = record.submit;
    submitBox.className = "msg submit";
    if (!isDaily) { submitBox.textContent = "練習のため、ランキングには送信されません。"; return; }
    if (!rankingOn) { submitBox.textContent = ""; return; }
    if (!s) { submitBox.textContent = "ランキングに送信中…"; return; }
    // 送信中のまま PENDING_MS を超えたものは失敗扱い（再送信できる）
    const view = submitView(s);
    const stale = view === "stale";
    if (view === "pending") {
      submitBox.textContent = "ランキングに送信中…";
      clearTimeout(staleTimer);
      // 保存済みの状態を見直しながら待つ（画面が消えたら止める）
      staleTimer = setTimeout(() => { if (submitBox.isConnected) showSubmit(); }, 1500);
      return;
    }
    const d = shortDate(record.date);
    if (s.status === "ok") submitBox.textContent = s.rank ? `ランキングに送信しました（${d} ${s.rank}位）` : "ランキングに送信しました";
    else if (s.status === "already") submitBox.textContent = `${d} の分はすでに送信済みです。`;
    else { submitBox.textContent = "ランキングに送信できませんでした。"; submitBox.classList.add("err"); }
    if (s.status === "failed" || stale) {
      submitBox.append(" ", h("button", { type: "button", class: "btn small", onclick: () => doSubmit() }, "再送信"));
    }
  }

  let staleTimer = 0;
  async function doSubmit() {
    if (sending.has(record.date)) return; // 二重送信の防止
    sending.add(record.date);
    record.submit = { status: "pending", at: Date.now() };
    storage.saveDaily(record);
    showSubmit();
    let r;
    try {
      r = await ranking.submitScore({
        date: record.date, name: storage.getName(), clientId: ranking.getClientId(),
        score: record.score, totalTimeMs: record.totalTimeMs, bestCount: record.bestCount,
        answers: toSubmitAnswers(record),
      });
    } catch (e) {
      r = { ok: false, error: String(e && e.message || e) };
    }
    record.submit = r && r.ok ? { status: "ok", rank: r.rank }
      : r && r.error === "already" ? { status: "already" }
        : { status: "failed", error: r && r.error };
    storage.saveDaily(record);
    sending.delete(record.date);
    showSubmit();
  }

  const list = h("ol", { class: "answers" }, record.answers.map((a, i) =>
    h("li", {},
      h("span", { class: "a-no" }, `${i + 1}`),
      tileNode(a.tile, "mini2"),
      h("span", { class: "a-label" }, a.timedOut ? "時間切れ" : tileLabel(a.tile)),
      h("span", { class: `rank ${RANK_CLASS[a.rank]}` }, a.rank),
      h("span", { class: "a-time" }, secText(a.timeMs)),
      h("span", { class: "a-pts" }, `${a.points}点`),
    )));

  async function share() {
    const url = location.origin + location.pathname;
    const text = buildShareText({ date: record.date, score: record.score, bestCount: record.bestCount, count: record.count, url, mode: record.mode });
    shareBox.replaceChildren();
    try {
      await navigator.clipboard.writeText(text);
      shareBox.append(h("p", { class: "msg", role: "status" }, "コピーしました。"));
    } catch {
      const ta = h("textarea", { readonly: true, rows: "3", "aria-label": "共有テキスト" }, text);
      shareBox.append(h("p", { class: "msg", role: "status" }, "コピーできませんでした。下の文を選んでコピーしてください。"), ta);
      ta.focus(); ta.select();
    }
  }

  mount(root, 
    h("header", { class: "title" }, h("h1", {}, "結果"), h("p", {}, modeLabel)),
    h("section", { class: "card total" },
      h("div", { class: "big-score" }, h("span", {}, String(record.score)), h("small", {}, "点 / 1500点")),
      h("dl", { class: "stats" },
        h("dt", {}, "最善"), h("dd", {}, `${record.bestCount}/${record.count}`),
        h("dt", {}, "平均回答時間"), h("dd", {}, secText(record.avgTimeMs)),
      ),
      typeLine ? h("p", { class: "type-line" }, typeLine) : null,
      submitBox,
    ),
    h("section", { class: "card" }, h("h2", {}, "各問の結果"), list),
    h("div", { class: "actions" },
      h("button", { type: "button", class: "btn primary", onclick: share }, "結果を共有"),
      rankingOn ? h("button", { type: "button", class: "btn", onclick: () => ctx.go("ranking", { date: record.date }) }, "ランキング") : null,
      h("button", { type: "button", class: "btn", onclick: () => ctx.go("home") }, "ホームへ"),
    ),
    shareBox,
  );
  window.scrollTo(0, 0);
  showSubmit();

  // 初回のみ自動送信（送信済み・送信不要のときは何もしない）
  if (isDaily && rankingOn && !record.submit && !sending.has(record.date)) doSubmit();
}

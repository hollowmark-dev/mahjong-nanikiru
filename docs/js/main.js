// 画面遷移の起点
import { h } from "./ui/dom.js";
import { renderHome } from "./ui/home.js";
import { renderPlay } from "./ui/play.js";
import { renderExplain } from "./ui/explain.js";
import { renderResult } from "./ui/result.js";
import { renderRankingScreen } from "./ui/rankingScreen.js";
import { scoreAnswer } from "./game/scoring.js";
import { jstDateString, pickDailyMixed, pickPractice, addDays } from "./game/daily.js";
import { createSession, currentProblem, recordAnswer, toRecord, isFinished, DAILY_LIMIT_MS } from "./game/session.js";
import { startProgress, isPlaying, isComplete, markShowing, resolveInterrupted, finalize, problemsOf, decideStart } from "./game/progress.js";
import * as storage from "./game/storage.js";
import { setSou8Style } from "./ui/tileSvg.js";

const root = document.getElementById("app");
const status = document.getElementById("sr-status");
let cleanup = null;
let problems = null;      // 速度問題
let oshiProblems = null;  // 押し引き問題
let allProblems = null;   // 記録の id 引き用
const dailySet = (date) => pickDailyMixed(problems, oshiProblems, date);

function show(fn) {
  if (cleanup) { cleanup(); cleanup = null; }
  const r = fn();
  if (typeof r === "function") cleanup = r;
  // 画面切替を読み上げる（見出しか問題番号だけ。アプリ全体は live にしない）
  const head = root.querySelector("h1, .qno");
  if (status && head) status.textContent = head.textContent;
}

function ctxNow() {
  return { today: jstDateString(), go, startGame, showRecord, resume };
}

// 今日の記録が「問題を表示したまま中断」だったら時間切れとして確定する
function settle(date) {
  const rec = storage.loadDaily(date);
  if (!isPlaying(rec)) return;
  const list = problemsOf(rec, allProblems) || dailySet(date);
  const changed = resolveInterrupted(rec, list);
  if (isComplete(rec)) { finalize(rec); storage.saveDaily(rec); }
  else if (changed) storage.saveDaily(rec);
}

function go(name, opts = {}) {
  const ctx = ctxNow();
  if (name === "ranking") show(() => renderRankingScreen(root, { ...ctx, date: opts.date }));
  else {
    // 日付をまたいだ途中記録も確定する（昨日の分は昨日付で送信できる）
    settle(addDays(ctx.today, -1));
    settle(ctx.today);
    show(() => renderHome(root, ctx));
  }
  window.scrollTo(0, 0);
}

function showRecord(record) {
  show(() => renderResult(root, { record, ctx: ctxNow() }));
}

// date は「もう一度」のとき record.date を渡す（押した時点の日付ではなく）
function startGame(mode, sec, date) {
  const d = date || jstDateString();
  if (mode === "practice") {
    question(createSession({ mode, date: d, limitMs: sec * 1000, problems: pickPractice(problems) }));
    return;
  }
  if (mode === "practice_oshi") {
    question(createSession({ mode, date: d, limitMs: sec * 1000, problems: pickPractice(oshiProblems) }));
    return;
  }
  const set = dailySet(d); // daily / retry は同じ10問
  if (mode === "retry") {
    question(createSession({ mode, date: d, limitMs: sec * 1000, problems: set }));
    return;
  }
  // 別タブなどで既に記録があれば上書きしない
  const existing = storage.loadDaily(d);
  const act = decideStart(existing);
  if (act === "resume") { resume(existing); return; }
  if (act === "show") { showRecord(existing); return; }
  const rec = startProgress({ date: d, limitMs: DAILY_LIMIT_MS, problems: set });
  storage.saveDaily(rec);
  const session = createSession({ mode, date: d, limitMs: DAILY_LIMIT_MS, problems: set, answers: rec.answers });
  session.record = rec;
  question(session);
}

// 途中の今日の10問を続きから
function resume(rec) {
  settle(rec.date);
  rec = storage.loadDaily(rec.date);
  if (!isPlaying(rec)) { showRecord(rec); return; }
  let set = problemsOf(rec, allProblems);
  if (!set) { set = dailySet(rec.date); rec.problemIds = set.map((p) => p.id); }
  const session = createSession({ mode: "daily", date: rec.date, limitMs: rec.limitMs, problems: set, answers: rec.answers });
  session.record = rec;
  question(session);
}

function question(session) {
  const problem = currentProblem(session);
  if (session.record) { markShowing(session.record, session.index); storage.saveDaily(session.record); }
  show(() => renderPlay(root, {
    problem, index: session.index, total: session.problems.length,
    limitMs: session.limitMs, mode: session.mode,
    onAnswer: (a) => {
      const result = scoreAnswer({ problem, tile: a.tile, remainingMs: a.remainingMs, limitMs: session.limitMs, timedOut: a.timedOut });
      const ans = recordAnswer(session, { problem, tile: a.tile, timeMs: a.timeMs, result });
      if (session.record) { session.record.showing = null; storage.saveDaily(session.record); }
      explain(session, problem, { ...ans, index: a.index }, result);
    },
  }));
  window.scrollTo(0, 0);
}

function explain(session, problem, answer, result) {
  const finished = isFinished(session);
  show(() => renderExplain(root, {
    problem, index: session.index - 1, total: session.problems.length,
    answer: { tile: answer.tile, timedOut: answer.timedOut, index: answer.index }, result, isLast: finished,
    onNext: () => {
      if (!finished) { question(session); return; }
      let record;
      if (session.record) { record = finalize(session.record); storage.saveDaily(record); }
      else record = toRecord(session);
      showRecord(record);
    },
  }));
}

function showError(msg) {
  root.replaceChildren(h("div", { class: "card" }, h("h1", {}, "何切る道場"), h("p", { class: "msg err" }, msg),
    h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => location.reload() }, "再読み込み"))));
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

async function boot() {
  setSou8Style(storage.getSou8Style()); // 保存された八索の絵柄（未保存なら既定のまま）
  // 2ファイルを並列に取得する
  const [speedRes, oshiRes] = await Promise.allSettled([
    loadJson("data/problems.json"),
    loadJson("data/problems-oshihiki.json"),
  ]);
  try {
    if (speedRes.status !== "fulfilled") throw speedRes.reason;
    const data = speedRes.value;
    if (!data || data.version !== 2) throw new Error("問題データの版が違います");
    if (!Array.isArray(data.problems) || data.problems.length === 0) throw new Error("問題がありません");
    problems = data.problems;
  } catch (e) {
    showError("問題データを読み込めませんでした。");
    return;
  }
  // 押し引き問題: 読めなければエラー（sample へのフォールバックはしない。
  // 公開時にダミーで黙って動くのを防ぎ、日によって構成が変わるとランキングが不公平になるため）
  try {
    if (oshiRes.status !== "fulfilled") throw oshiRes.reason;
    const data = oshiRes.value;
    if (!data || data.version !== 1 || data.kind !== "oshihiki") throw new Error("押し引きデータの版が違います");
    if (!Array.isArray(data.problems) || data.problems.length === 0) throw new Error("押し引き問題がありません");
    // 問題ごとの kind はファイル全体の kind から付ける（採点・表示の分岐に使う）
    oshiProblems = data.problems.map((p) => ({ ...p, kind: "oshihiki" }));
  } catch (e) {
    showError("押し引きの問題データを読み込めませんでした。");
    return;
  }
  allProblems = [...problems, ...oshiProblems];
  go("home");
}

boot();

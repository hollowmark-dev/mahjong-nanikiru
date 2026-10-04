import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAnswer, rankOf, timeFactor } from "../docs/js/game/scoring.js";
import { parseTile } from "../docs/js/engine/tiles.js";
import { genbutsuKinds, dealInView } from "../docs/js/game/safety.js";
import { pickDailyMixed, OSHI_POSITIONS } from "../docs/js/game/daily.js";
import { oshiRankOf } from "../docs/js/game/scoring.js";
import { summarizeByType } from "../docs/js/game/session.js";
import { jstDateString, dayIndex, addDays, dailyIndices, pickDaily, pickPractice, shortDate } from "../docs/js/game/daily.js";
import { createSession, recordAnswer, summarize, buildShareText } from "../docs/js/game/session.js";
import { normalizePracticeSec } from "../docs/js/game/storage.js";
import { DAILY_LIMIT_MS } from "../docs/js/game/session.js";
import { submitView, isUnsent, decideStart, yesterdayAction, startProgress, isPlaying, isComplete, markShowing, resolveInterrupted, finalize, problemsOf } from "../docs/js/game/progress.js";

function mkProblem(over = {}) {
  return {
    id: "t1",
    hand: ["1m", "2m", "3m", "4p", "0p", "6p", "5p", "7s", "8s", "9s", "1z", "1z", "5z"],
    draw: "5z",
    doraIndicator: "3z", turn: 5, draws: 13,
    candidates: [
      { tile: "5p", agari: 0.40, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.6 },
      { tile: "4p", agari: 0.30, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.5 },
      { tile: "5z", agari: 0.20, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.4 },
      { tile: "1z", agari: 0.0, ukeire: 8, ukeireTiles: [], shanten: 2, tenpai: 0.1 },
    ],
    best: "5p",
    ...over,
  };
}
const L = 15000;

test("採点: 最善・残り時間満タンは150点", () => {
  const r = scoreAnswer({ problem: mkProblem({ hand: mkProblem().hand.filter((t) => t !== "5p").concat("1m") }), tile: "5p", remainingMs: L, limitMs: L });
  assert.equal(r.q, 1);
  assert.equal(r.points, 150);
  assert.equal(r.rank, "最善");
  assert.equal(r.isBest, true);
});

test("採点: q は agari の比、基礎点は 100×(1−3×(1−q))", () => {
  const r = scoreAnswer({ problem: mkProblem(), tile: "4p", remainingMs: 0, limitMs: L });
  assert.ok(Math.abs(r.q - 0.75) < 1e-12);
  assert.equal(r.points, 25); // 100 × (1 − 3×0.25)
  assert.equal(r.rank, "次善");
});

test("採点: 時間係数", () => {
  assert.equal(timeFactor(L, L), 1.5);
  assert.equal(timeFactor(L / 2, L), 1.25);
  assert.equal(timeFactor(0, L), 1);
  assert.equal(timeFactor(-100, L), 1);
  assert.equal(timeFactor(L * 2, L), 1.5);
  const r = scoreAnswer({ problem: mkProblem(), tile: "4p", remainingMs: 7500, limitMs: L });
  assert.equal(r.points, Math.round(25 * 1.25)); // 31
});

test("採点: 赤5を切り、通常5もあれば q×0.9", () => {
  const p = mkProblem({ draw: "5p", hand: ["1m", "2m", "3m", "4p", "0p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "5z"] });
  const red = scoreAnswer({ problem: p, tile: "0p", remainingMs: 0, limitMs: L });
  assert.equal(red.redPenalty, true);
  assert.ok(Math.abs(red.q - 0.9) < 1e-12);
  assert.equal(red.points, 70);
  assert.equal(red.rank, "好手");
  const normal = scoreAnswer({ problem: p, tile: "5p", remainingMs: 0, limitMs: L });
  assert.equal(normal.redPenalty, false);
  assert.equal(normal.points, 100);
});

test("採点: 通常5が手牌になければ赤を切っても減点なし", () => {
  const p2 = mkProblem({ hand: ["1m", "2m", "3m", "4p", "5p", "6p", "0s", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "5z" });
  p2.candidates.push({ tile: "5s", agari: 0.2, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 0.3 });
  const r = scoreAnswer({ problem: p2, tile: "0s", remainingMs: 0, limitMs: L });
  assert.equal(r.redPenalty, false);
  assert.ok(Math.abs(r.q - 0.5) < 1e-12);
});

test("採点: 時間切れはツモ切り扱いで時間係数1", () => {
  const p = mkProblem();
  const r = scoreAnswer({ problem: p, tile: p.draw, remainingMs: 9999, limitMs: L, timedOut: true });
  assert.equal(r.factor, 1);
  assert.equal(r.timedOut, true);
  assert.equal(r.points, 0); // 時間切れは0点
  assert.equal(r.rank, "時間切れ");
  assert.equal(r.isBest, false);
});

test("採点: best の agari が 0 のとき、best なら 1・それ以外 0", () => {
  const p = mkProblem({
    candidates: [
      { tile: "5p", agari: 0, ukeire: 0, ukeireTiles: [], shanten: 3, tenpai: 0 },
      { tile: "4p", agari: 0, ukeire: 0, ukeireTiles: [], shanten: 3, tenpai: 0 },
      { tile: "5z", agari: 0, ukeire: 0, ukeireTiles: [], shanten: 3, tenpai: 0 },
    ],
  });
  p.hand = p.hand.map((t) => (t === "0p" ? "6p" : t));
  const a = scoreAnswer({ problem: p, tile: "5p", remainingMs: 0, limitMs: L });
  assert.equal(a.q, 1);
  assert.equal(a.points, 100);
  const b = scoreAnswer({ problem: p, tile: "4p", remainingMs: L, limitMs: L });
  assert.equal(b.q, 0);
  assert.equal(b.points, 0);
  assert.equal(b.rank, "悪手");
});

test("採点: 丸めと最大値", () => {
  const p = mkProblem();
  // q = 0.30/0.40 = 0.75, 残り 3333ms → 25 × (1+0.5×3333/15000)
  const r = scoreAnswer({ problem: p, tile: "4p", remainingMs: 3333, limitMs: L });
  assert.equal(r.points, Math.round(25 * (1 + 0.5 * 3333 / 15000)));
  assert.ok(Number.isInteger(r.points));
  const max = scoreAnswer({ problem: p, tile: "5p", remainingMs: L * 3, limitMs: L });
  assert.equal(max.points, 150);
  assert.throws(() => scoreAnswer({ problem: p, tile: "9m", remainingMs: 0, limitMs: L }));
});

test("判定ランクの境界", () => {
  assert.equal(rankOf(1), "最善");
  assert.equal(rankOf(0.9), "好手");
  assert.equal(rankOf(0.89), "次善");
  assert.equal(rankOf(0.7), "次善");
  assert.equal(rankOf(0.69), "悪手");
});

test("JST の日付: 端末タイムゾーンに依存しない", () => {
  assert.equal(jstDateString(new Date("2026-10-03T15:30:00Z")), "2026-10-04");
  assert.equal(jstDateString(new Date("2026-10-03T14:59:59Z")), "2026-10-03");
  assert.equal(jstDateString(new Date("2026-10-03T15:00:00Z")), "2026-10-04");
  assert.equal(jstDateString(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
  assert.equal(dayIndex("2026-10-01"), 0);
  assert.equal(dayIndex("2026-10-04"), 3);
  assert.equal(dayIndex("2026-11-01"), 31);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
  assert.equal(shortDate("2026-10-03"), "10/3");
});

test("今日の10問: 重複せず、同じ日は同じ、連続日で重ならない", () => {
  const N = 50;
  for (let d = 0; d < 10; d++) {
    const date = addDays("2026-10-01", d);
    const a = dailyIndices(N, date);
    assert.equal(a.length, 10);
    assert.equal(new Set(a).size, 10);
    assert.deepEqual(a, dailyIndices(N, date));
    const b = dailyIndices(N, addDays(date, 1));
    assert.equal(a.filter((x) => b.includes(x)).length, 0);
  }
  // N/10 日で全問を使い切る
  const used = new Set();
  for (let d = 0; d < N / 10; d++) dailyIndices(N, addDays("2026-10-01", d)).forEach((i) => used.add(i));
  assert.equal(used.size, N);
  // 基準日より前でも範囲内
  for (const i of dailyIndices(N, "2026-09-20")) assert.ok(i >= 0 && i < N);
});

test("問題 pickDaily / pickPractice", () => {
  const problems = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}` }));
  const d = pickDaily(problems, "2026-10-03");
  assert.equal(new Set(d.map((p) => p.id)).size, 10);
  const pr = pickPractice(problems);
  assert.equal(new Set(pr.map((p) => p.id)).size, 10);
  assert.equal(pickPractice(problems.slice(0, 4)).length, 4);
});

test("セッション集計と共有テキスト", () => {
  const p = mkProblem();
  const s = createSession({ mode: "daily", date: "2026-10-03", limitMs: L, problems: [p, p] });
  recordAnswer(s, { problem: p, tile: "5p", timeMs: 4000, result: scoreAnswer({ problem: p, tile: "5p", remainingMs: 11000, limitMs: L }) });
  recordAnswer(s, { problem: p, tile: "4p", timeMs: 15000, result: scoreAnswer({ problem: p, tile: "4p", remainingMs: 0, limitMs: L }) });
  const sum = summarize(s.answers);
  assert.equal(sum.count, 2);
  assert.equal(sum.bestCount, 1);
  assert.equal(sum.totalTimeMs, 19000);
  assert.equal(sum.avgTimeMs, 9500);
  assert.equal(sum.score, s.answers[0].points + s.answers[1].points);
  assert.equal(
    buildShareText({ date: "2026-10-03", score: 1234, bestCount: 7, url: "https://example.com/x/" }),
    "何切る道場 10/3 1234点 最善7/10 #何切る道場 https://example.com/x/",
  );
  assert.equal(
    buildShareText({ date: "2026-10-03", score: 1234, bestCount: 7, url: "https://example.com/x/", mode: "practice" }),
    "何切る道場（練習） 10/3 1234点 最善7/10 #何切る道場 https://example.com/x/",
  );
  assert.ok(buildShareText({ date: "2026-10-03", score: 1, bestCount: 0, url: "u", mode: "retry" }).includes("（練習）"));
  assert.ok(!buildShareText({ date: "2026-10-03", score: 1, bestCount: 0, url: "u", mode: "daily" }).includes("（練習）"));
});

test("赤5をツモって時間切れ: 通常5が手牌にあっても赤の減点なし", () => {
  const p = mkProblem({ draw: "0p", hand: ["1m", "2m", "3m", "4p", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "5z"] });
  p.candidates.push({ tile: "7p", agari: 0.1, ukeire: 1, ukeireTiles: [], shanten: 2, tenpai: 0.2 });
  const r = scoreAnswer({ problem: p, tile: p.draw, remainingMs: 0, limitMs: L, timedOut: true });
  assert.equal(r.redPenalty, false);
  assert.ok(Math.abs(r.q - 1) < 1e-12); // 5p は最善(0.40)
  // 時間内に同じ赤を切れば減点される
  const r2 = scoreAnswer({ problem: p, tile: "0p", remainingMs: 0, limitMs: L });
  assert.equal(r2.redPenalty, true);
});

test("最善の数え方: 同率の最善は isBest、赤の減点で好手になったら isBest ではない", () => {
  const p = mkProblem({
    hand: ["1m", "2m", "3m", "4p", "6p", "7p", "8p", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "5p",
    candidates: [
      { tile: "5p", agari: 0.40, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.6 },
      { tile: "4p", agari: 0.40, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.6 },
      { tile: "5z", agari: 0.10, ukeire: 8, ukeireTiles: [], shanten: 1, tenpai: 0.4 },
    ],
  });
  const tie = scoreAnswer({ problem: p, tile: "4p", remainingMs: 0, limitMs: L });
  assert.equal(tie.q, 1);
  assert.equal(tie.isBest, true);
  assert.equal(tie.rank, "最善");
  const worse = scoreAnswer({ problem: p, tile: "5z", remainingMs: 0, limitMs: L });
  assert.equal(worse.isBest, false);

  const red = mkProblem({
    hand: ["1m", "2m", "3m", "4p", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "0p",
  });
  red.candidates.push({ tile: "7p", agari: 0.1, ukeire: 1, ukeireTiles: [], shanten: 2, tenpai: 0.2 });
  const r = scoreAnswer({ problem: red, tile: "0p", remainingMs: 0, limitMs: L });
  assert.equal(r.redPenalty, true);
  assert.equal(r.rank, "好手");
  assert.equal(r.isBest, false);
  const ok = scoreAnswer({ problem: red, tile: "5p", remainingMs: 0, limitMs: L });
  assert.equal(ok.isBest, true);
});

test("進行中記録: 保存・追記・中断の時間切れ確定・再開・完了", () => {
  const problems = Array.from({ length: 3 }, (_, i) => mkProblem({ id: `t${i}` }));
  const rec = startProgress({ date: "2026-10-03", limitMs: L, problems });
  assert.equal(isPlaying(rec), true);
  assert.deepEqual(rec.problemIds, ["t0", "t1", "t2"]);
  // JSON に往復しても同じ（localStorage 想定）
  const back = JSON.parse(JSON.stringify(rec));
  assert.deepEqual(problemsOf(back, problems).map((p) => p.id), ["t0", "t1", "t2"]);
  assert.equal(problemsOf({ problemIds: ["x"] }, problems), null);

  // 問0を表示して回答
  markShowing(rec, 0);
  const res0 = scoreAnswer({ problem: problems[0], tile: "5p", remainingMs: L, limitMs: L });
  rec.answers.push({ id: "t0", tile: "5p", timeMs: 1000, points: res0.points, isBest: res0.isBest, timedOut: false });
  rec.showing = null;
  assert.equal(resolveInterrupted(rec, problems), false);
  assert.equal(rec.answers.length, 1);

  // 問1を表示したままリロード → 時間切れ（ツモ切り・時間係数1）
  markShowing(rec, 1);
  const reloaded = JSON.parse(JSON.stringify(rec));
  assert.equal(resolveInterrupted(reloaded, problems), true);
  assert.equal(reloaded.answers.length, 2);
  const a1 = reloaded.answers[1];
  assert.equal(a1.timedOut, true);
  assert.equal(a1.tile, problems[1].draw);
  assert.equal(a1.timeMs, L);
  assert.equal(a1.points, scoreAnswer({ problem: problems[1], tile: problems[1].draw, remainingMs: 0, limitMs: L, timedOut: true }).points);
  assert.equal(reloaded.showing, null);
  // もう一度解決しても増えない
  assert.equal(resolveInterrupted(reloaded, problems), false);
  assert.equal(reloaded.answers.length, 2);
  assert.equal(isComplete(reloaded), false);

  // 問2も中断 → 全問完了 → 確定
  markShowing(reloaded, 2);
  resolveInterrupted(reloaded, problems);
  assert.equal(isComplete(reloaded), true);
  finalize(reloaded);
  assert.equal(reloaded.status, "done");
  assert.equal(isPlaying(reloaded), false);
  assert.equal(reloaded.score, reloaded.answers.reduce((s, a) => s + a.points, 0));
  assert.equal(reloaded.count, 3);
});

test("制限時間: 今日の10問は20秒、保存済みの旧い秒数は15/20/30に丸める", () => {
  assert.equal(DAILY_LIMIT_MS, 20000);
  assert.equal(normalizePracticeSec(10), 15);
  assert.equal(normalizePracticeSec(15), 15);
  assert.equal(normalizePracticeSec(20), 20);
  assert.equal(normalizePracticeSec(25), 30);
  assert.equal(normalizePracticeSec(30), 30);
  assert.equal(normalizePracticeSec(99), 30);
  assert.equal(normalizePracticeSec(NaN), 20);
});

test("送信状態: pending は60秒で stale、isUnsent は送信済み・送信中を除く", () => {
  const now = 1_000_000;
  assert.equal(submitView(null, now), "none");
  assert.equal(submitView({ status: "pending", at: now - 1000 }, now), "pending");
  assert.equal(submitView({ status: "pending", at: now - 61000 }, now), "stale");
  assert.equal(submitView({ status: "ok", rank: 3 }, now), "ok");
  assert.equal(submitView({ status: "already" }, now), "already");
  assert.equal(submitView({ status: "failed" }, now), "failed");
  const done = (submit) => ({ mode: "daily", status: "done", answers: [], submit });
  assert.equal(isUnsent(done(null), now), true);
  assert.equal(isUnsent(done({ status: "failed" }), now), true);
  assert.equal(isUnsent(done({ status: "pending", at: now - 61000 }), now), true);
  assert.equal(isUnsent(done({ status: "pending", at: now - 100 }), now), false);
  assert.equal(isUnsent(done({ status: "ok" }), now), false);
  assert.equal(isUnsent({ ...done(null), status: "playing" }, now), false);
  assert.equal(isUnsent({ ...done(null), mode: "retry" }, now), false);
  assert.equal(isUnsent(null, now), false);
});

test("今日の10問の開始: 既存の記録は上書きしない／昨日の分の導線", () => {
  assert.equal(decideStart(null), "start");
  assert.equal(decideStart({ status: "playing" }), "resume");
  assert.equal(decideStart({ status: "done" }), "show");
  assert.equal(decideStart({ answers: [] }), "show"); // 旧形式（status なし）は完了扱い
  const now = 5000;
  assert.equal(yesterdayAction(null, now), "none");
  assert.equal(yesterdayAction({ mode: "daily", status: "playing" }, now), "resume");
  assert.equal(yesterdayAction({ mode: "daily", status: "done", submit: null }, now), "send");
  assert.equal(yesterdayAction({ mode: "daily", status: "done", submit: { status: "ok" } }, now), "none");
});

test("基礎点: q の境界（1, 0.9, 0.8, 2/3, 0.5）", () => {
  const mk = (a) => mkProblem({
    hand: ["1m", "2m", "3m", "4p", "6p", "7p", "8p", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "9p",
    candidates: [
      { tile: "9p", agari: 1, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 },
      { tile: "5z", agari: a, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 },
    ],
    best: "9p",
  });
  const base = (a) => scoreAnswer({ problem: mk(a), tile: "5z", remainingMs: 0, limitMs: L });
  assert.equal(scoreAnswer({ problem: mk(1), tile: "9p", remainingMs: 0, limitMs: L }).points, 100);
  assert.equal(base(0.9).points, 70);
  assert.equal(base(0.8).points, 40);
  assert.equal(base(2 / 3).points, 0);
  assert.equal(base(0.5).points, 0);
  assert.equal(base(0.5).capped, true);
  assert.equal(base(0.8).capped, false);
});

test("赤の減点との組み合わせ: q=1 の赤切りは70点、q=0.9 の赤切りは 100×(1−3×(1−0.81))=43", () => {
  const p = mkProblem({
    hand: ["1m", "2m", "3m", "4p", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "0p",
    candidates: [
      { tile: "5p", agari: 1, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 },
      { tile: "7p", agari: 0.9, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 },
    ],
    best: "5p",
  });
  assert.equal(scoreAnswer({ problem: p, tile: "0p", remainingMs: 0, limitMs: L }).points, 70);
  const p2 = { ...p, candidates: [{ ...p.candidates[0], agari: 0.9 }, { ...p.candidates[1], tile: "5p", agari: 0.81 }].slice(0, 2), best: "7p" };
  p2.candidates = [{ tile: "7p", agari: 0.9, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 }, { tile: "5p", agari: 0.81, ukeire: 1, ukeireTiles: [], shanten: 1, tenpai: 1 }];
  // q = 0.81/0.9 = 0.9 → ×0.9 = 0.81 → 100×(1−0.57)=43
  assert.equal(scoreAnswer({ problem: p2, tile: "0p", remainingMs: 0, limitMs: L }).points, 43);
});

test("時間切れは時間に関わらず0点、上限は150点", () => {
  const p = mkProblem();
  assert.equal(scoreAnswer({ problem: p, tile: "5p", remainingMs: L, limitMs: L, timedOut: true }).points, 0);
  const best = scoreAnswer({ problem: p, tile: "5p", remainingMs: L, limitMs: L });
  assert.equal(best.points, 150);
});

function mkOshi(evs, over = {}) {
  // evs: { 牌: ev }。best は ev 最大
  const candidates = Object.entries(evs).map(([tile, ev]) => ({ tile, shanten: 1, ukeire: 1, ukeireTiles: [], dealIn: 0.05, agari: 0.1, lose: 0.1, ev }));
  candidates.sort((a, b) => b.ev - a.ev);
  return {
    id: "o1", kind: "oshihiki", hand: ["1m", "2m", "3m", "4p", "5p", "6p", "7p", "7s", "8s", "9s", "1z", "1z", "5z"], draw: "9p",
    doraIndicator: "3z", turn: 9, draws: 9, rivers: { self: [], shimo: [], toimen: [], kami: [] },
    riichi: { seat: "toimen", index: 2 }, candidates, best: candidates[0].tile, answerType: "push", ...over,
  };
}

test("押し引き採点: 損失ベース（0→100、1500→50、3000以上→0）", () => {
  const p = mkOshi({ "9p": 1000, "5z": 250, "1z": -500, "7s": -2000 });
  const sc = (tile) => scoreAnswer({ problem: p, tile, remainingMs: 0, limitMs: L });
  assert.equal(sc("9p").points, 100);
  assert.equal(sc("9p").isBest, true);
  assert.equal(sc("5z").loss, 750);
  assert.equal(sc("5z").points, 75);
  assert.equal(sc("1z").loss, 1500);
  assert.equal(sc("1z").points, 50);
  assert.equal(scoreAnswer({ problem: mkOshi({ "9p": 3000, "5z": 0 }), tile: "5z", remainingMs: 0, limitMs: L }).points, 0);
  assert.equal(sc("7s").points, 0);
  assert.equal(sc("7s").capped, true);
  assert.equal(sc("7s").rank, "悪手");
  // 時間係数と上限
  assert.equal(scoreAnswer({ problem: p, tile: "9p", remainingMs: L, limitMs: L }).points, 150);
});

test("押し引き採点: ランク境界と同率最善", () => {
  assert.equal(oshiRankOf(0), "最善");
  assert.equal(oshiRankOf(300), "好手");
  assert.equal(oshiRankOf(301), "次善");
  assert.equal(oshiRankOf(900), "次善");
  assert.equal(oshiRankOf(901), "悪手");
  const p = mkOshi({ "9p": 500, "5z": 500, "1z": 0 });
  assert.equal(scoreAnswer({ problem: p, tile: "5z", remainingMs: 0, limitMs: L }).isBest, true);
});

test("押し引き採点: 赤5は損失+300、時間切れは0点", () => {
  const p = mkOshi({ "5p": 800, "9p": 800, "1z": 0 }, { draw: "0p" });
  const red = scoreAnswer({ problem: p, tile: "0p", remainingMs: 0, limitMs: L });
  assert.equal(red.redPenalty, true);
  assert.equal(red.loss, 300);
  assert.equal(red.points, 90);
  assert.equal(red.isBest, false);
  assert.equal(red.rank, "好手"); // 損失300
  const to = scoreAnswer({ problem: p, tile: "0p", remainingMs: L, limitMs: L, timedOut: true });
  assert.equal(to.points, 0);
  assert.equal(to.rank, "時間切れ");
  assert.equal(to.isBest, false);
  assert.equal(to.redPenalty, false);
});

test("今日の10問（混在）: 速度7＋押し引き3、4・7・10問目が押し引き、重複なし、連続日で重ならない", () => {
  const speed = Array.from({ length: 50 }, (_, i) => ({ id: `q${i}` }));
  const oshi = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, kind: "oshihiki" }));
  assert.deepEqual(OSHI_POSITIONS, [3, 6, 9]);
  let prev = null;
  for (let d = 0; d < 20; d++) {
    const date = addDays("2026-10-01", d);
    const set = pickDailyMixed(speed, oshi, date);
    assert.equal(set.length, 10);
    assert.equal(new Set(set.map((p) => p.id)).size, 10);
    set.forEach((p, i) => assert.equal(p.id.startsWith("o"), [3, 6, 9].includes(i), `${date} #${i + 1}`));
    assert.deepEqual(set.map((p) => p.id), pickDailyMixed(speed, oshi, date).map((p) => p.id));
    if (prev) assert.equal(set.filter((p) => prev.includes(p.id)).length, 0);
    prev = set.map((p) => p.id);
  }
  // 30問・3問/日 → 10日で押し引きを使い切る
  const used = new Set();
  for (let d = 0; d < 10; d++) pickDailyMixed(speed, oshi, addDays("2026-10-01", d)).filter((p) => p.kind).forEach((p) => used.add(p.id));
  assert.equal(used.size, 30);
});

test("種類別の最善数", () => {
  const a = (type, isBest) => ({ type, isBest });
  const r = summarizeByType([a("speed", true), a("speed", false), a("oshihiki", true), a(undefined, true)]);
  assert.deepEqual(r, { speed: { best: 2, count: 3 }, oshihiki: { best: 1, count: 1 } });
});

test("現物判定: リーチ者の河＋宣言後の他家の打牌だけ。0%でも壁は現物ではない", () => {
  // リーチ者=対面(index 2)、宣言は第3巡。自家は対面より先、下家も先、上家は後に打つ
  const p = {
    riichi: { seat: "toimen", index: 2 },
    rivers: {
      self: ["1m", "2m", "3m", "4m"],        // 4m は第4巡 → 宣言後
      shimo: ["1p", "2p", "3p", "4p"],       // 3p は第3巡で対面より前 → 宣言前。4p は宣言後
      toimen: ["1s", "2s", "3s", "9s"],      // 自身の河はすべて現物
      kami: ["1z", "2z", "3z", "4z"],        // 3z は第3巡で対面より後 → 宣言後
    },
  };
  const g = genbutsuKinds(p);
  const has = (t) => g.has(parseTile(t).kind);
  ["1s", "2s", "3s", "9s", "4m", "4p", "3z", "4z"].forEach((t) => assert.ok(has(t), t));
  ["1m", "2m", "3m", "1p", "2p", "3p", "1z", "2z"].forEach((t) => assert.ok(!has(t), t));
  const cand = (tile, dealIn) => ({ tile, dealIn });
  assert.equal(dealInView(cand("9s", 0), p, g), "genbutsu");
  assert.equal(dealInView(cand("5m", 0), p, g), "zero");
  assert.equal(dealInView(cand("4m", 0.01), p, g), "risk");
  assert.equal(genbutsuKinds({}).size, 0);
});

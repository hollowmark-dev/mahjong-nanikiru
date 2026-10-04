// 1回の挑戦（10問）の状態と集計。DOM に依存しない。
import { kindToStr, parseTile } from "../engine/tiles.js";
import { shortDate } from "./daily.js";

export const DAILY_LIMIT_MS = 20000;

// mode: "daily"（ランキング対象）| "retry"（今日の10問の再挑戦。練習扱い）| "practice"
// answers を渡すと途中再開（同じ配列を共有する。index は回答済みの数）
export function createSession({ mode, date, limitMs, problems, answers = [] }) {
  return { mode, date, limitMs, problems, index: answers.length, answers };
}

export function currentProblem(session) {
  return session.problems[session.index];
}

export function isFinished(session) {
  return session.answers.length >= session.problems.length;
}

// result は scoring.scoreAnswer の戻り値
export function makeAnswer({ problem, tile, timeMs, result }) {
  return {
    id: problem.id, tile, timeMs: Math.round(timeMs), points: result.points,
    type: result.type === "oshihiki" ? "oshihiki" : "speed",
    q: result.q, loss: result.loss, rank: result.rank, isBest: result.isBest, timedOut: result.timedOut,
  };
}

export function recordAnswer(session, { problem, tile, timeMs, result }) {
  const ans = makeAnswer({ problem, tile, timeMs, result });
  session.answers.push(ans);
  session.index = session.answers.length;
  return ans;
}

export function summarize(answers) {
  const count = answers.length;
  const score = answers.reduce((s, a) => s + a.points, 0);
  const bestCount = answers.filter((a) => a.isBest).length;
  const totalTimeMs = answers.reduce((s, a) => s + a.timeMs, 0);
  return { count, score, bestCount, totalTimeMs, avgTimeMs: count ? totalTimeMs / count : 0 };
}

// 保存・表示用の結果レコード
export function toRecord(session) {
  return {
    mode: session.mode, date: session.date, limitMs: session.limitMs,
    ...summarize(session.answers),
    answers: session.answers.map((a) => ({ ...a })),
    submit: null,
  };
}

// ranking.submitScore に渡す answers
export function toSubmitAnswers(record) {
  return record.answers.map((a) => ({ id: a.id, tile: kindToStr(parseTile(a.tile).kind), timeMs: a.timeMs, points: a.points }));
}

// 共有テキスト（SPEC §8-4）
// mode が daily 以外（練習・再挑戦）なら「（練習）」を入れる。mode 省略は今日の10問
export function buildShareText({ date, score, bestCount, count = 10, url, mode = "daily" }) {
  const label = mode === "daily" ? "" : "（練習）";
  return `何切る道場${label} ${shortDate(date)} ${score}点 最善${bestCount}/${count} #何切る道場 ${url}`;
}

// 種類別の最善数: { speed: {best, count}, oshihiki: {best, count} }
export function summarizeByType(answers) {
  const out = { speed: { best: 0, count: 0 }, oshihiki: { best: 0, count: 0 } };
  for (const a of answers) {
    const t = a.type === "oshihiki" ? out.oshihiki : out.speed;
    t.count++;
    if (a.isBest) t.best++;
  }
  return out;
}

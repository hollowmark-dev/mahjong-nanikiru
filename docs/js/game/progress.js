// 今日の10問の「進行中」記録（途中リロードで問題を見直せないようにする）。DOM 非依存の純粋関数。
// 流れ: startProgress → 出題表示ごとに markShowing → 回答ごとに answers へ追記 → finalize。
// 回答前にリロード／離脱すると showing が残る → resolveInterrupted が時間切れ（ツモ切り）として確定する。
import { scoreAnswer } from "./scoring.js";
import { summarize, makeAnswer } from "./session.js";

export function startProgress({ date, limitMs, problems }) {
  return {
    mode: "daily", date, limitMs, status: "playing",
    problemIds: problems.map((p) => p.id), count: problems.length,
    showing: null, answers: [], submit: null,
  };
}

export function isPlaying(rec) {
  return !!rec && rec.status === "playing";
}

export function isComplete(rec) {
  return rec.answers.length >= rec.count;
}

// 表示した問題の番号（0始まり）を記録する
export function markShowing(rec, index) {
  rec.showing = index;
}

// 回答前に中断された問題を時間切れとして確定する。変更したら true
export function resolveInterrupted(rec, problems) {
  if (rec.showing == null) return false;
  if (rec.showing === rec.answers.length && rec.answers.length < rec.count) {
    const problem = problems[rec.showing];
    const result = scoreAnswer({ problem, tile: problem.draw, remainingMs: 0, limitMs: rec.limitMs, timedOut: true });
    rec.answers.push(makeAnswer({ problem, tile: problem.draw, timeMs: rec.limitMs, result }));
  }
  rec.showing = null;
  return true;
}

// 全問終わった記録を確定する（合計などを埋める）
export function finalize(rec) {
  Object.assign(rec, summarize(rec.answers));
  rec.status = "done";
  rec.showing = null;
  return rec;
}

// 記録の問題 id から問題の配列を作る。見つからない id があれば null
export function problemsOf(rec, allProblems) {
  const map = new Map(allProblems.map((p) => [p.id, p]));
  const list = rec.problemIds.map((id) => map.get(id));
  return list.every(Boolean) ? list : null;
}

export const PENDING_MS = 60000;

// 送信状態の見え方: none / pending / stale / ok / already / failed
// pending のまま PENDING_MS を超えたものは stale（失敗扱いで再送信できる）
export function submitView(submit, now = Date.now(), pendingMs = PENDING_MS) {
  if (!submit) return "none";
  if (submit.status === "pending") return now - (submit.at || 0) > pendingMs ? "stale" : "pending";
  if (submit.status === "ok" || submit.status === "already") return submit.status;
  return "failed";
}

// 完了済みの今日の10問で、ランキングにまだ送れていないもの（送信中は除く）
export function isUnsent(rec, now = Date.now()) {
  if (!rec || rec.mode !== "daily" || rec.status === "playing") return false;
  const v = submitView(rec.submit, now);
  return v === "none" || v === "failed" || v === "stale";
}

// 今日の10問を始めようとしたときの扱い。既存の記録があれば上書きしない
export function decideStart(rec) {
  if (!rec) return "start";
  return isPlaying(rec) ? "resume" : "show";
}

// 前日の記録をホームに出すか: "none" | "resume"（途中）| "send"（未送信）
export function yesterdayAction(rec, now = Date.now()) {
  if (!rec || rec.mode !== "daily") return "none";
  if (isPlaying(rec)) return "resume";
  return isUnsent(rec, now) ? "send" : "none";
}

// 採点（SPEC.md §7）。DOM に依存しない純粋関数。
import { parseTile, kindToStr } from "../engine/tiles.js";

export const MAX_POINTS = 150;
export const RED_PENALTY = 0.9;

// 判定ランク（時間切れは scoreAnswer が「時間切れ」にする）
export function rankOf(q) {
  if (q >= 1) return "最善";
  if (q >= 0.9) return "好手";
  if (q >= 0.7) return "次善";
  return "悪手";
}

// 時間係数 = 1 + 0.5 × (残り / 制限)。残りは 0〜制限に丸める
export function timeFactor(remainingMs, limitMs) {
  const r = Math.min(Math.max(remainingMs, 0), limitMs);
  return 1 + 0.5 * (limitMs > 0 ? r / limitMs : 0);
}

// 手牌14枚に同じ種類の通常5があるのに赤5を切るか
export function isRedPenalty(problem, tile) {
  const t = parseTile(tile);
  if (!t.red) return false;
  return [...problem.hand, problem.draw].some((s) => {
    const p = parseTile(s);
    return p.kind === t.kind && !p.red;
  });
}

// tile: 切った牌（"0p" などそのままの表記）。timedOut のときは呼び出し側が tile=draw を渡す
export function scoreAnswer({ problem, tile, remainingMs, limitMs, timedOut = false }) {
  const kind = parseTile(tile).kind;
  const kindStr = kindToStr(kind);
  const cand = problem.candidates.find((c) => c.tile === kindStr);
  if (!cand) throw new Error(`候補にない牌: ${tile}`);
  const bestKind = parseTile(problem.best).kind;
  const bestCand = problem.candidates.find((c) => c.tile === kindToStr(bestKind));
  const isBestTile = kind === bestKind;
  const bestAgari = bestCand.agari;

  let rawQ;
  if (bestAgari <= 0) rawQ = isBestTile ? 1 : 0;
  else rawQ = Math.min(1, cand.agari / bestAgari);

  // 時間切れのツモ切りは時間係数で既に罰しているので、赤の減点はかけない
  const redPenalty = !timedOut && isRedPenalty(problem, tile);
  const q = redPenalty ? rawQ * RED_PENALTY : rawQ;
  // 最善の数え方: 減点後の q が 1 以上（同率の最善を含む。赤の減点で好手になったら最善ではない）
  // 時間切れは最善に数えない
  const isBest = !timedOut && q >= 1;
  // 基礎点 = 100 × max(0, 1 − 3(1 − q))。q=0.9 → 70、0.8 → 40、2/3 以下 → 0
  const rawBase = 100 * (1 - 3 * (1 - q));
  const capped = rawBase < 0;
  const base = timedOut ? 0 : Math.max(0, rawBase);
  const remaining = timedOut ? 0 : Math.min(Math.max(remainingMs, 0), limitMs);
  const factor = timeFactor(remaining, limitMs);
  const points = timedOut ? 0 : Math.round(base * factor);
  return {
    tile, kind: kindStr, isBest, timedOut,
    agari: cand.agari, bestAgari,
    rawQ, q, redPenalty, base, capped, remainingMs: remaining, factor, points,
    rank: timedOut ? "時間切れ" : rankOf(q),
  };
}

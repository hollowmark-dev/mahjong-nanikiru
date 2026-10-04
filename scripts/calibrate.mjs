// モデル（endHazard・ronRate）の較正用。代表局面を集めてパラメータ別の和了率の表を出す。
//   node scripts/calibrate.mjs
// A: 6巡目・1シャンテン・受け入れ18〜22枚の局面の best 和了率（目安 35〜45%）
// B: 8巡目（残り10巡）・両面テンパイ（非フリテン）に取れる局面の、その打牌の和了率（目安 55〜70%）
import { makePosition } from "./generate.mjs";
import { evaluateRaw, prepareState } from "../docs/js/engine/simulate.js";
import { discardOptions } from "../docs/js/engine/ukeire.js";
import { hashString } from "../docs/js/engine/rng.js";

const N = 24, TRIALS = 1500;
const A = [], B = [];
for (let a = 0; (A.length < N || B.length < N) && a < 200000; a++) {
  const want = A.length < N && (B.length >= N || a % 2 === 0) ? 6 : 8;
  const pos = makePosition(hashString(`calib:${a}`), want);
  if (!pos) continue;
  const { counts14, visible, selfRiver } = prepareState(pos);
  const opts = discardOptions(counts14, visible);
  const minS = Math.min(...opts.map((o) => o.shanten));
  if (want === 6 && A.length < N && minS === 1) {
    const u = Math.max(...opts.filter((o) => o.shanten === 1).map((o) => o.ukeireCount));
    if (u >= 18 && u <= 22) A.push(pos);
  }
  if (want === 8 && B.length < N && minS === 0) {
    const ry = opts.find((o) => o.shanten === 0 && o.ukeireTiles.length === 2 &&
      o.ukeireTiles[1] - o.ukeireTiles[0] === 3 && o.ukeireTiles[0] < 27 &&
      Math.floor(o.ukeireTiles[0] / 9) === Math.floor(o.ukeireTiles[1] / 9) &&
      !o.ukeireTiles.some((k) => selfRiver[k] || k === o.kind) && o.ukeireCount >= 5);
    if (ry) B.push({ ...pos, cut: ry.kind });
  }
}
console.log(`局面: A ${A.length} 件 / B ${B.length} 件、各 ${TRIALS} 試行`);

const models = [];
for (const ronRate of [1, 0.5, 0.35, 0.3, 0.25]) {
  for (const hz of [[99, 0, 0], [6, 0.01, 0.2], [4, 0.015, 0.3], [1, 0.015, 0.3], [1, 0.025, 0.4]]) {
    models.push({ hazardStart: hz[0], hazardSlope: hz[1], hazardMax: hz[2], ronRate });
  }
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log("ronRate  hazard(start,slope,max)   A: best和了率   B: 両面テンパイ和了率");
for (const m of models) {
  const a = mean(A.map((p, i) => evaluateRaw(p, { trials: TRIALS, seed: 100 + i, model: m }).candidates[0].agariN / TRIALS));
  const b = mean(B.map((p, i) => {
    const r = evaluateRaw(p, { trials: TRIALS, seed: 200 + i, model: m });
    return r.candidates.find((c) => c.kind === p.cut).agariN / TRIALS;
  }));
  console.log(`${String(m.ronRate).padEnd(8)} ${`(${m.hazardStart},${m.hazardSlope},${m.hazardMax})`.padEnd(26)} ${(100 * a).toFixed(1).padStart(6)}%      ${(100 * b).toFixed(1).padStart(6)}%`);
}

// 押し引きのリーチ者モデル（seqWeight・nonRyanmenAccept など）の較正用。
//   node scripts/calibrate-oshihiki.mjs
// 生成と同じ4人の対局から「リーチ後2〜3巡」の局面を集め、牌の分類ごとの平均 dealIn を出す。
// 分類はリーチ者から見たもの（現物・宣言後の通過牌は除く）:
//   無スジ4-6 / 無スジ2378 / 無スジ19 / スジ19 / 字牌（1枚見え）
import { makeOshiPosition } from "./generate-oshihiki.mjs";
import { prepareOshihiki, prepareTrials, OSHIHIKI_MODEL } from "../docs/js/engine/oshihiki.js";
import { hashString } from "../docs/js/engine/rng.js";

const N = Number(process.argv[2] || 40), TRIALS = 2500;
const states = [];
for (let a = 0; states.length < N; a++) {
  const p = makeOshiPosition(hashString(`calib-oshi:${a}`));
  if (!p) continue;
  const since = p.turn - 1 - p.riichi.index; // リーチ後に自家が打った回数
  if (since < 2 || since > 3) continue;
  states.push(p);
}

function classify(info, k) {
  if (info.riichiRiver[k] || info.postRiichi[k]) return null; // 現物・通過牌
  if (k >= 27) return info.visible[k] === 1 ? "字牌1枚見え" : null;
  const n = k % 9 + 1;
  const g = (m) => m >= 1 && m <= 9 && info.riichiRiver[k - n + m] === 1; // 同スートの数字 m が現物
  if (n === 1 || n === 9) {
    const suji = n === 1 ? g(4) : g(6);
    return suji ? "スジ19" : "無スジ19";
  }
  if (n >= 4 && n <= 6) {
    if (g(n - 3) || g(n + 3)) return null; // 片スジ・両スジは対象外
    return "無スジ456";
  }
  const suji = n <= 3 ? g(n + 3) : g(n - 3);
  return suji ? null : "無スジ2378";
}

export function measure(model, trials = TRIALS) {
  const sum = {}, num = {};
  states.forEach((st, i) => {
    const info = prepareOshihiki(st);
    const T = prepareTrials(st, info, trials, 1000 + i, model);
    for (let k = 0; k < 34; k++) {
      const c = classify(info, k);
      if (!c) continue;
      sum[c] = (sum[c] || 0) + T.dealIn[k];
      num[c] = (num[c] || 0) + 1;
    }
  });
  const out = {};
  for (const c of Object.keys(sum)) out[c] = sum[c] / num[c];
  return out;
}

const ORDER = ["無スジ456", "無スジ2378", "無スジ19", "スジ19", "字牌1枚見え"];
const TARGET = { "無スジ456": "10-14", "無スジ2378": "8-12", "無スジ19": "5-9", "スジ19": "1.5-4", "字牌1枚見え": "3-7" };
if (process.argv[1] && process.argv[1].endsWith("calibrate-oshihiki.mjs")) {
  console.log(`局面 ${states.length} 件（リーチ後2〜3巡）、各 ${TRIALS} 試行`);
  console.log("設定".padEnd(44) + ORDER.map((c) => c.padStart(10)).join(""));
  console.log("目安".padEnd(44) + ORDER.map((c) => TARGET[c].padStart(10)).join(""));
  const grid = JSON.parse(process.env.GRID || "null") || [
    {}, { seqWeight: 0.85 }, { nonRyanmenAccept: 0.4 }, { seqWeight: 0.85, nonRyanmenAccept: 0.4 },
  ];
  for (const g of grid) {
    const m = { ...OSHIHIKI_MODEL, ...g };
    const r = measure(m);
    console.log(JSON.stringify(g).padEnd(44) + ORDER.map((c) => ((100 * (r[c] ?? NaN)).toFixed(1) + "%").padStart(10)).join(""));
  }
}

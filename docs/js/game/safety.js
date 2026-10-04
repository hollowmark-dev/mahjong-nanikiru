// 押し引き問題の「現物」判定（公開情報だけで決まる。DOM 非依存）。
// 現物 = リーチ者の河にある種類、または宣言後に他家（自家を含む）が切った種類。
// 壁・ノーチャンスで放銃率が 0% になる牌は現物ではない。
import { parseTile } from "../engine/tiles.js";

// 打牌の順: 自家(親) → 下家 → 対面 → 上家
const ORDER = ["self", "shimo", "toimen", "kami"];

// 戻り値: 現物の kind の Set
export function genbutsuKinds(problem) {
  const set = new Set();
  const ri = problem.riichi;
  if (!ri) return set;
  const rp = ORDER.indexOf(ri.seat);
  const rivers = problem.rivers || {};
  for (const t of rivers[ri.seat] || []) set.add(parseTile(t).kind); // リーチ者自身の河（宣言牌を含む）
  ORDER.forEach((seat, p) => {
    if (seat === ri.seat) return;
    (rivers[seat] || []).forEach((t, i) => {
      // 第 i+1 巡の seat の打牌。宣言（第 ri.index+1 巡のリーチ者）より後か
      if (i > ri.index || (i === ri.index && p > rp)) set.add(parseTile(t).kind);
    });
  });
  return set;
}

// 候補 c の表示: "genbutsu"（現物）| "zero"（0% だが現物ではない）| "risk"
export function dealInView(candidate, problem, genb = genbutsuKinds(problem)) {
  if (candidate.dealIn !== 0) return "risk";
  return genb.has(parseTile(candidate.tile).kind) ? "genbutsu" : "zero";
}

// 押し引き問題の生成（SPEC.md §11.5）。
//   node scripts/generate-oshihiki.mjs --count 1000 --trials 10000 --seed 12345 --out docs/data/problems-oshihiki.json [--generated-at ISO文字列]
// worker_threads で並列化する。決定性は generate.mjs と同じ方式: 試行番号 a ごとに seed から派生したシードで
// 局面を作って評価し、試行番号の昇順に枠（push/fold 半々など）を判定して先頭 count 件を出力する。
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sortTiles, parseTile, doraFromIndicator } from "../docs/js/engine/tiles.js";
import { createRng, hashString, shuffleInPlace } from "../docs/js/engine/rng.js";
import { shanten } from "../docs/js/engine/shanten.js";
import { discardOptions } from "../docs/js/engine/ukeire.js";
import {
  evaluateOshihikiRaw, toOshihikiCandidateJson, answerTypeOf, OSHIHIKI_MODEL, waitsOf,
} from "../docs/js/engine/oshihiki.js";
import { idKind, idStr, chooseDiscard } from "./generate.mjs";

const MAX_TURN = 18;
const SEATS = ["self", "shimo", "toimen", "kami"];
const FILTER = {
  minRiichiTurn: 5,      // リーチは5巡目以降
  maxTurn: 13,           // 出題の巡目の上限
  maxShanten: 2,         // 自家の手（最良の打牌後）が3シャンテン以上なら捨てる
  sigma: 3,
  genbutsuRatio: 0.8,    // 「現物が手にある問題」は全体のこの割合まで（＝現物なしを2割以上含める）
};
const kindOf = (s) => parseTile(s).kind;

// 4人で打ち、子のだれかがテンパイしたらリーチ。リーチの1〜3巡後の自家のツモで止める
export function makeOshiPosition(posSeed) {
  const rng = createRng(posSeed);
  const wall = shuffleInPlace([...Array(136).keys()], rng);
  let p = 0;
  const hands = [];
  for (let s = 0; s < 4; s++) { hands.push(wall.slice(p, p + 13)); p += 13; }
  const dora = wall[p++];
  const doraKind = doraFromIndicator(idStr(dora));
  const stride = 1 + Math.floor(rng() * 3); // リーチの何巡後に出題するか
  const rivers = [[], [], [], []];
  const riverCounts = new Array(34).fill(0);
  riverCounts[idKind(dora)]++;
  let riichiSeat = -1, riichiIndex = -1, riichiWaits = null, stopTurn = 99;
  for (let r = 1; r <= FILTER.maxTurn; r++) {
    for (let s = 0; s < 4; s++) {
      if (s === 0 && r === stopTurn) {
        const draw = wall[p++];
        const out = {};
        SEATS.forEach((key, i) => { out[key] = rivers[i].map(idStr); });
        return {
          hand: sortTiles(hands[0].map(idStr)), draw: idStr(draw), doraIndicator: idStr(dora),
          turn: r, draws: MAX_TURN - r, rivers: out,
          riichi: { seat: SEATS[riichiSeat], index: riichiIndex },
        };
      }
      const hand = hands[s];
      const tile = wall[p++];
      hand.push(tile);
      const counts = new Array(34).fill(0);
      for (const id of hand) counts[idKind(id)]++;
      if (shanten(counts) === -1) return null; // だれかのツモ和了
      let d;
      if (s === riichiSeat) {
        d = hand.splice(hand.length - 1, 1)[0]; // リーチ後はツモ切り
      } else {
        const visible = riverCounts.slice();
        for (const id of hand) visible[idKind(id)]++;
        d = chooseDiscard(hand, visible, rng, doraKind, s);
        if (riichiWaits && riichiWaits.includes(idKind(d))) return null; // リーチ者への放銃（ロンされるはず）
      }
      rivers[s].push(d);
      riverCounts[idKind(d)]++;
      // 子のテンパイ → リーチ
      if (riichiSeat < 0 && s > 0 && r >= FILTER.minRiichiTurn) {
        const c13 = new Array(34).fill(0);
        for (const id of hand) c13[idKind(id)]++;
        if (shanten(c13) === 0) {
          riichiSeat = s; riichiIndex = r - 1; riichiWaits = waitsOf(c13);
          stopTurn = r + stride;
          if (stopTurn > FILTER.maxTurn) return null;
        }
      }
    }
  }
  return null;
}

// 対応のある差の有意性（a − b の平均 ≥ sigma × 標準誤差）
function significant(a, b, trials, sigma) {
  let s1 = 0, s2 = 0;
  for (let i = 0; i < trials; i++) { const d = a[i] - b[i]; s1 += d; s2 += d * d; }
  const mean = s1 / trials;
  const v = (s2 - trials * mean * mean) / (trials - 1);
  const se = Math.sqrt(Math.max(0, v) / trials);
  return mean > 0 && mean >= sigma * se;
}

function attempt(a, seed, trials) {
  const pos = makeOshiPosition(hashString(`${seed}:opos:${a}`));
  if (!pos) return { a, ok: false, reason: "noPosition" };
  const counts14 = new Array(34).fill(0);
  for (const s of [...pos.hand, pos.draw]) counts14[kindOf(s)]++;
  if (shanten(counts14) === -1) return { a, ok: false, reason: "agari14" };
  const visible = counts14.slice();
  visible[kindOf(pos.doraIndicator)]++;
  for (const key of SEATS) for (const t of pos.rivers[key]) visible[kindOf(t)]++;
  const minS = Math.min(...discardOptions(counts14, visible).map((o) => o.shanten));
  if (minS > FILTER.maxShanten) return { a, ok: false, reason: "shanten" };

  const raw = evaluateOshihikiRaw(pos, { trials, seed: hashString(`${seed}:oeval:${a}`) });
  const c = raw.candidates;
  const best = c[0];
  // ベタオリの第一打（dealIn 最小、同率は ev 大）
  const fold1 = c.reduce((m, x) => (x.dealIn < m.dealIn ? x : m), c[0]);
  const sigFold = fold1 !== best && significant(best.payoff, fold1.payoff, trials, FILTER.sigma);
  const sigSecond = c.length > 1 && significant(best.payoff, c[1].payoff, trials, FILTER.sigma);
  if (!sigFold && !sigSecond) return { a, ok: false, reason: "notSignificant", evaluated: true };

  const candidates = c.map((x) => toOshihikiCandidateJson(x, trials));
  const answerType = answerTypeOf(c);
  const riichiRiver = pos.rivers[pos.riichi.seat].map(kindOf);
  const genbutsu = [...new Set([...pos.hand, pos.draw].map(kindOf))].some((k) => riichiRiver.includes(k));
  return {
    a, ok: true, evaluated: true,
    problem: { ...pos, candidates, best: candidates[0].tile, answerType },
    stat: {
      answerType, genbutsu, turn: pos.turn,
      bestEv: candidates[0].ev,
      lossSecond: c.length > 1 ? (best.evSum - c[1].evSum) / trials : 0,
      lossFold: (best.evSum - fold1.evSum) / trials,
      shanten: best.shanten,
    },
  };
}

// 採用順に枠を判定: push/fold 半々、現物ありの問題は genbutsuRatio まで
export function createOshiSelector(count) {
  const quota = { push: Math.floor(count / 2), fold: count - Math.floor(count / 2) };
  const used = { push: 0, fold: 0 };
  const gMax = Math.floor(count * FILTER.genbutsuRatio);
  let g = 0;
  return {
    offer(r) {
      if (!r.ok) return r.reason;
      const t = r.stat.answerType;
      if (used[t] >= quota[t]) return `${t}Quota`;
      if (r.stat.genbutsu && g >= gMax) return "genbutsuQuota";
      used[t]++;
      if (r.stat.genbutsu) g++;
      return "ok";
    },
  };
}

// ---------------- worker ----------------
if (!isMainThread && workerData && workerData.script === "generate-oshihiki") {
  const { seed, trials } = workerData;
  parentPort.on("message", (msg) => {
    if (msg === null) process.exit(0);
    parentPort.postMessage(msg.batch.map((a) => attempt(a, seed, trials)));
  });
}

// ---------------- main ----------------
function parseArgs(argv) {
  const o = { count: 1000, trials: 10000, seed: 12345, out: "docs/data/problems-oshihiki.json", threads: availableParallelism(), "generated-at": "" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    const v = argv[i + 1];
    if (k in o && v !== undefined) { o[k] = typeof o[k] === "number" ? Number(v) : v; i++; }
    else throw new Error(`不明な引数: ${argv[i]}`);
  }
  return o;
}

function jstIso(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().replace(/\.\d{3}Z$/, "+09:00");
}

const pct = (arr, p) => {
  if (arr.length === 0) return NaN;
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const results = new Map();
  const selector = createOshiSelector(args.count);
  const accepted = [];
  const reasons = {};
  let nextA = 0, prefix = 0, done = false, active = 0, lastLog = 0, evaluated = 0;
  let finishResolve;
  const finished = new Promise((r) => { finishResolve = r; });
  function advance() {
    while (results.has(prefix)) {
      const r = results.get(prefix);
      results.delete(prefix);
      if (r.evaluated) evaluated++;
      const v = selector.offer(r);
      if (v === "ok") accepted.push(r); else reasons[v] = (reasons[v] || 0) + 1;
      prefix++;
      if (accepted.length >= args.count) return true;
    }
    return false;
  }
  const BATCH = 1;
  function dispatch(w) {
    if (done) { w.postMessage(null); return; }
    const batch = [];
    for (let i = 0; i < BATCH; i++) batch.push(nextA++);
    active++;
    w.postMessage({ batch });
  }
  const self = fileURLToPath(import.meta.url);
  for (let i = 0; i < args.threads; i++) {
    const w = new Worker(self, { workerData: { script: "generate-oshihiki", seed: args.seed, trials: args.trials } });
    w.on("message", (out) => {
      active--;
      for (const r of out) results.set(r.a, r);
      if (!done && advance()) done = true;
      const now = Date.now();
      if (now - lastLog > 10000) {
        lastLog = now;
        process.stderr.write(`  進捗: 採用 ${accepted.length}/${args.count}（試行 ${prefix} 件、${((now - t0) / 1000).toFixed(0)} 秒）\n`);
      }
      dispatch(w);
      if (done && active === 0) finishResolve();
    });
    w.on("error", (e) => { console.error(e); process.exit(1); });
    dispatch(w);
  }
  await finished;

  const problems = accepted.map((r, i) => ({ id: `o${String(i + 1).padStart(5, "0")}`, ...r.problem }));
  const data = {
    version: 1,
    kind: "oshihiki",
    generatedAt: args["generated-at"] || jstIso(),
    params: { trials: args.trials, maxTurn: MAX_TURN, seed: args.seed, model: "oshihiki-v1", ...OSHIHIKI_MODEL },
    problems,
  };
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data) + "\n");

  const sec = (Date.now() - t0) / 1000;
  const st = accepted.map((r) => r.stat);
  const hist = (arr) => arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  const evs = st.map((s) => s.bestEv);
  const lossS = st.map((s) => s.lossSecond), lossF = st.map((s) => s.lossFold).filter((x) => x > 0);
  console.log(`出力: ${outPath}`);
  console.log(`採用 ${problems.length} 問 / 試行 ${prefix} 件（評価まで進んだもの ${evaluated} 件）`);
  console.log("不採用の内訳:", reasons);
  console.log("answerType:", hist(st.map((s) => s.answerType)), " 現物あり:", st.filter((s) => s.genbutsu).length);
  console.log("巡目分布:", hist(st.map((s) => s.turn)), " best のシャンテン:", hist(st.map((s) => s.shanten)));
  console.log(`best の ev: 最小 ${pct(evs, 0)} / 10% ${pct(evs, 0.1)} / 中央 ${pct(evs, 0.5)} / 90% ${pct(evs, 0.9)} / 最大 ${pct(evs, 1)}`);
  console.log(`best と次点の損失: 中央 ${pct(lossS, 0.5).toFixed(0)} / 90% ${pct(lossS, 0.9).toFixed(0)} / 最大 ${pct(lossS, 1).toFixed(0)}`);
  console.log(`best とベタオリ第一打の損失（best≠第一打のとき）: 件数 ${lossF.length} / 中央 ${pct(lossF, 0.5)?.toFixed?.(0)} / 90% ${pct(lossF, 0.9)?.toFixed?.(0)}`);
  console.log(`所要時間: ${sec.toFixed(1)} 秒（${args.threads} スレッド）。評価1件あたり ${(sec * args.threads / Math.max(1, evaluated)).toFixed(2)} 秒`);
  process.exit(0);
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

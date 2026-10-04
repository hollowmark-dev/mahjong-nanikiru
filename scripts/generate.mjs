// 問題生成（SPEC.md §3・§5）。
//   node scripts/generate.mjs --count 1500 --trials 10000 --seed 12345 --out docs/data/problems.json [--generated-at ISO文字列]
// worker_threads で並列化する。決定性: 試行番号 a（0,1,2,...）ごとに seed から派生したシードで局面を作って評価し、
// 採用された問題を a の昇順に並べて先頭 count 件を出力する（並列数や完了順に依存しない）。
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tileToStr, sortTiles, parseTile, doraFromIndicator } from "../docs/js/engine/tiles.js";
import { createRng, hashString, shuffleInPlace } from "../docs/js/engine/rng.js";
import { shanten } from "../docs/js/engine/shanten.js";
import { discardOptions } from "../docs/js/engine/ukeire.js";
import { evaluateRaw, toCandidateJson, DEFAULT_MODEL } from "../docs/js/engine/simulate.js";

const MAX_TURN = 18;
let FURITEN_CHECK = false;
const RED_KINDS = new Set([4, 13, 22]);

// ---------------- 設定 ----------------
const FILTER = {
  maxBestShanten: 2,
  minBestAgari: 0.08,
  qMin: 0.5,
  qMax: 0.97,
  sigma: 3,
  easyRatio: 0.1, // best が孤立牌の問題は全体のこの割合まで
  tsumogiriRatio: 0.15, // best がツモ切り（best == ツモ牌の種類）の問題は全体のこの割合まで
};

// 牌ID 0..135: kind = id>>2、赤は各赤種類の (id&3)==0
export const idKind = (id) => id >> 2;
export const idRed = (id) => RED_KINDS.has(id >> 2) && (id & 3) === 0;
export const idStr = (id) => tileToStr({ kind: idKind(id), red: idRed(id) });

const SEATS = ["self", "shimo", "toimen", "kami"];

// 1人分の打牌: 最小シャンテン → 受け入れ最大。
// 同シャンテンで受け入れ差が AI_NEAR 枚以内の候補どうしでは、価値のある牌を切る候補に罰点を付けて避ける:
//   ドラ・赤5・役牌の対子以上を崩す = 2、ドラ・赤5の単体を切る = 1。
//   比較は (罰点 小 → 受け入れ 大 → 乱数)。同じ種類に赤と通常があれば通常を切る。
// 役牌 = 三元牌 + 東（場風）+ その家の自風（自家=東, 下家=南, 対面=西, 上家=北）
const AI_NEAR = 2;
function discardPenalty(k, counts, hand, doraKind, seat) {
  const yakuhai = k >= 31 || k === 27 || k === 27 + seat;
  let hasRed = false;
  for (const id of hand) if (idKind(id) === k && idRed(id)) hasRed = true;
  const valuable = k === doraKind || yakuhai || hasRed;
  if (counts[k] >= 2 && valuable) return 2;
  if (counts[k] === 1 && (k === doraKind || hasRed)) return 1;
  return 0;
}
export function chooseDiscard(hand, visible, rng, doraKind, seat) {
  const counts = new Array(34).fill(0);
  for (const id of hand) counts[idKind(id)]++;
  const opts = discardOptions(counts, visible);
  const minS = Math.min(...opts.map((o) => o.shanten));
  const sameS = opts.filter((o) => o.shanten === minS);
  const maxU = Math.max(...sameS.map((o) => o.ukeireCount));
  let pool = [], bestKey = null;
  for (const o of sameS) {
    if (o.ukeireCount < maxU - AI_NEAR) continue;
    const pen = discardPenalty(o.kind, counts, hand, doraKind, seat);
    const key = [pen, -o.ukeireCount];
    const cmp = bestKey === null ? -1 : key[0] - bestKey[0] || key[1] - bestKey[1];
    if (cmp < 0) { bestKey = key; pool = [o.kind]; } else if (cmp === 0) pool.push(o.kind);
  }
  const k = pool[Math.floor(rng() * pool.length)];
  let idx = -1;
  for (let i = 0; i < hand.length; i++) {
    if (idKind(hand[i]) !== k) continue;
    if (idx < 0 || (idRed(hand[idx]) && !idRed(hand[i]))) idx = i;
  }
  return hand.splice(idx, 1)[0];
}

// 局面を作る: 4人で実際に打つ（自家が親）。自家の turn 巡目のツモで止める。
// 成功なら {hand, draw, doraIndicator, turn, rivers, draws}。途中で誰かがツモ和了したら null
export function makePosition(posSeed, forceTurn = 0) {
  const rng = createRng(posSeed);
  const wall = shuffleInPlace([...Array(136).keys()], rng);
  let p = 0;
  const hands = [];
  for (let s = 0; s < 4; s++) { hands.push(wall.slice(p, p + 13)); p += 13; }
  const dora = wall[p++];
  const turnRoll = 3 + Math.floor(rng() * 9); // 3〜11
  const turn = forceTurn || turnRoll;
  const rivers = [[], [], [], []];
  const riverCounts = new Array(34).fill(0);
  riverCounts[idKind(dora)]++; // ドラ表示牌も全員から見える
  const doraKind = doraFromIndicator(idStr(dora));
  for (let r = 1; r < turn; r++) {
    for (let s = 0; s < 4; s++) {
      const hand = hands[s];
      hand.push(wall[p++]);
      // 各家の visible = 自分の手＋ドラ表示牌＋全員の河
      const visible = riverCounts.slice();
      const counts = new Array(34).fill(0);
      for (const id of hand) { visible[idKind(id)]++; counts[idKind(id)]++; }
      if (shanten(counts) === -1) return null; // 途中のツモ和了は捨てる（他家のロンは無視）
      const d = chooseDiscard(hand, visible, rng, doraKind, s);
      rivers[s].push(d);
      riverCounts[idKind(d)]++;
    }
  }
  const draw = wall[p++];
  const out = {};
  SEATS.forEach((key, s) => { out[key] = rivers[s].map(idStr); });
  return {
    hand: sortTiles(hands[0].map(idStr)),
    draw: idStr(draw),
    doraIndicator: idStr(dora),
    turn,
    rivers: out,
    draws: MAX_TURN - turn,
  };
}

// 孤立牌か: 字牌で1枚だけ、または数牌で1枚だけかつ同スートの ±2 以内に他の牌が無い（14枚で判定）
export function isIsolated(counts14, kind) {
  if (counts14[kind] !== 1) return false;
  if (kind >= 27) return true;
  const base = kind - (kind % 9);
  for (let d = -2; d <= 2; d++) {
    if (d === 0) continue;
    const k = kind + d;
    if (k >= base && k < base + 9 && counts14[k] > 0) return false;
  }
  return true;
}

// 巡目ごとの枠: count/9（端数は前の巡目から）
export function turnQuotas(count) {
  const q = {};
  for (let i = 0; i < 9; i++) q[3 + i] = Math.floor(count / 9) + (i < count % 9 ? 1 : 0);
  return q;
}

// 採用順（試行番号の昇順）に結果を受け取り、枠を超えたものを捨てる。決定的
export function createSelector(count, easyRatio = FILTER.easyRatio, tsumogiriRatio = FILTER.tsumogiriRatio) {
  const quota = turnQuotas(count);
  const used = {};
  const easyMax = Math.floor(count * easyRatio);
  const tgMax = Math.floor(count * tsumogiriRatio);
  let easy = 0, tg = 0, total = 0;
  return {
    offer(r) {
      if (!r.ok) return r.reason;
      const t = r.problem.turn;
      if ((used[t] || 0) >= quota[t]) return "turnQuota";
      if (r.stat.isolated && easy >= easyMax) return "easyQuota";
      if (r.stat.tsumogiri && tg >= tgMax) return "tsumogiriQuota";
      used[t] = (used[t] || 0) + 1;
      if (r.stat.isolated) easy++;
      if (r.stat.tsumogiri) tg++;
      total++;
      return "ok";
    },
    fullTurns() { return Object.keys(quota).map(Number).filter((t) => (used[t] || 0) >= quota[t]); },
    get total() { return total; },
  };
}

// 1つの試行番号を処理する → { a, ok, reason?, problem?, stat? }
// fullTurns: 先頭部分で既に枠が埋まった巡目（評価しても必ず捨てるので省く）
function attempt(a, seed, trials, fullTurns = []) {
  const pos = makePosition(hashString(`${seed}:pos:${a}`));
  if (!pos) return { a, ok: false, reason: "midAgari" };
  if (fullTurns.includes(pos.turn)) return { a, ok: false, reason: "turnQuota" };
  const counts14 = new Array(34).fill(0);
  for (const s of [...pos.hand, pos.draw]) counts14[kindOf(s)]++;
  if (shanten(counts14) === -1) return { a, ok: false, reason: "agari14" };

  // 安い事前判定: 最小シャンテンになる打牌が2種類以上ないと「迷いどころ」にならない
  const visible = counts14.slice();
  visible[kindOf(pos.doraIndicator)]++;
  for (const key of SEATS) for (const t of pos.rivers[key]) visible[kindOf(t)]++;
  const opts = discardOptions(counts14, visible);
  const minS = Math.min(...opts.map((o) => o.shanten));
  if (minS > FILTER.maxBestShanten) return { a, ok: false, reason: "shanten" };
  if (opts.filter((o) => o.shanten === minS).length < 2) return { a, ok: false, reason: "noRival" };

  const raw = evaluateRaw(pos, { trials, seed: hashString(`${seed}:eval:${a}`) });
  const r = attemptJudge(a, pos, raw, trials, seed);
  r.evaluated = true;
  return r;
}

function attemptJudge(a, pos, raw, trials, seed) {
  const c = raw.candidates;
  const best = c[0];
  const bestAgari = best.agariN / trials;
  if (best.shanten > FILTER.maxBestShanten) return { a, ok: false, reason: "shanten" };
  if (bestAgari < FILTER.minBestAgari) return { a, ok: false, reason: "lowAgari" };
  const rivals = c.slice(1).filter((x) => x.shanten === best.shanten);
  if (rivals.length === 0) return { a, ok: false, reason: "noRival" };
  const q = rivals[0].agariN / best.agariN; // c は agari 降順なので rivals[0] が最良
  if (q > FILTER.qMax) return { a, ok: false, reason: "qHigh" };
  if (q < FILTER.qMin) return { a, ok: false, reason: "qLow" };
  // best と次点の対応のある差: 平均 ≥ sigma × 標準誤差
  const second = c[1];
  let s1 = 0, s2 = 0;
  for (let i = 0; i < trials; i++) {
    const d = best.agariHits[i] - second.agariHits[i];
    s1 += d; s2 += d * d;
  }
  const mean = s1 / trials;
  const varD = (s2 - trials * mean * mean) / (trials - 1);
  const se = Math.sqrt(Math.max(0, varD) / trials);
  if (!(mean > 0 && mean >= FILTER.sigma * se)) return { a, ok: false, reason: "notSignificant" };

  const candidates = c.map((x) => toCandidateJson(x, trials));
  // 分析用: フリテンを無視して評価し直したとき best が変わるか（--furiten-check 1 のときだけ）
  let furitenChangesBest = null;
  if (FURITEN_CHECK) {
    const alt = evaluateRaw(pos, { trials, seed: hashString(`${seed}:eval:${a}`), ignoreFuriten: true });
    furitenChangesBest = alt.candidates[0].kind !== best.kind;
  }
  return {
    a, ok: true,
    problem: { ...pos, candidates, best: candidates[0].tile },
    stat: {
      q, bestShanten: best.shanten, nCand: c.length, turn: pos.turn,
      // best の上にいるはずの（受け入れが best 以上の同シャンテン）候補がフリテンで順位を下げたか
      furitenFlip: c.some((x) => x.furiten && x.shanten === best.shanten && x.ukeire >= best.ukeire && x !== best),
      anyFuriten: c.some((x) => x.furiten),
      bestFuriten: best.furiten,
      furitenChangesBest,
      isolated: isIsolated(toCountsKinds([...pos.hand, pos.draw]), best.kind),
      tsumogiri: best.kind === kindOf(pos.draw),
    },
  };
}

const kindOf = (s) => parseTile(s).kind;
function toCountsKinds(strs) {
  const c = new Array(34).fill(0);
  for (const s of strs) c[kindOf(s)]++;
  return c;
}

// ---------------- worker ----------------
// 他のスクリプト（generate-oshihiki.mjs）の worker から import されたときは動かない
if (!isMainThread && workerData && workerData.script === "generate") {
  const { seed, trials } = workerData;
  FURITEN_CHECK = !!workerData.furitenCheck;
  parentPort.on("message", (msg) => {
    if (msg === null) { process.exit(0); }
    const out = msg.batch.map((a) => attempt(a, seed, trials, msg.fullTurns));
    parentPort.postMessage(out);
  });
}

// ---------------- main ----------------
function parseArgs(argv) {
  const o = { count: 1500, trials: 10000, seed: 12345, out: "docs/data/problems.json", threads: availableParallelism(), bench: 0, "generated-at": "", "furiten-check": 0 };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  // --bench N: 単一スレッドで N 試行を回して1問あたりの時間を測る
  if (args.bench > 0) {
    const reasons = {};
    let ok = 0, evalMs = 0, nEval = 0;
    for (let a = 0; a < args.bench; a++) {
      const s = Date.now();
      const r = attempt(a, args.seed, args.trials);
      const ms = Date.now() - s;
      if (r.evaluated) { evalMs += ms; nEval++; }
      if (r.ok) ok++; else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    }
    const total = (Date.now() - t0) / 1000;
    console.log(`試行 ${args.bench} 件 / 採用 ${ok} 件 / ${total.toFixed(1)} 秒（単一スレッド）`);
    console.log(`評価まで進んだ試行 ${nEval} 件、平均 ${(evalMs / Math.max(1, nEval) / 1000).toFixed(3)} 秒`);
    console.log("不採用の内訳:", reasons);
    const perAccepted = total / Math.max(1, ok);
    console.log(`採用1問あたり ${perAccepted.toFixed(2)} 秒（単一）→ ${args.threads} 並列で count=1500 は約 ${(perAccepted * 1500 / args.threads / 60).toFixed(1)} 分`);
    return;
  }

  const workers = [];
  const results = new Map(); // a → result
  let nextA = 0;
  let done = false;
  const BATCH = 2;
  let finishResolve;
  const finished = new Promise((r) => { finishResolve = r; });
  let lastLog = 0;

  // 連続して完了している先頭部分で採用数が count に達したら終了
  // 枠の判定は試行番号の昇順に行う（並列でも決定的）
  const selector = createSelector(args.count);
  const accepted = [];
  const reasons = {};
  let prefix = 0, prefixOk = 0;
  function advancePrefix() {
    while (results.has(prefix)) {
      const r = results.get(prefix);
      results.delete(prefix);
      const v = selector.offer(r);
      if (v === "ok") { accepted.push(r); prefixOk++; }
      else reasons[v] = (reasons[v] || 0) + 1;
      prefix++;
      if (prefixOk >= args.count) return true;
    }
    return false;
  }

  let active = 0;
  function dispatch(w) {
    if (done) { w.postMessage(null); return; }
    const batch = [];
    for (let i = 0; i < BATCH; i++) batch.push(nextA++);
    active++;
    w.postMessage({ batch, fullTurns: selector.fullTurns() });
  }

  const self = fileURLToPath(import.meta.url);
  for (let i = 0; i < args.threads; i++) {
    const w = new Worker(self, { workerData: { script: "generate", seed: args.seed, trials: args.trials, furitenCheck: args["furiten-check"] > 0 } });
    w.on("message", (out) => {
      active--;
      for (const r of out) results.set(r.a, r);
      if (!done && advancePrefix()) done = true;
      const now = Date.now();
      if (now - lastLog > 5000) {
        lastLog = now;
        process.stderr.write(`  進捗: 採用 ${prefixOk}/${args.count}（試行 ${prefix} 件完了、${((now - t0) / 1000).toFixed(0)} 秒）\n`);
      }
      dispatch(w);
      if (done && active === 0) finishResolve();
    });
    w.on("error", (e) => { console.error(e); process.exit(1); });
    workers.push(w);
  }
  for (const w of workers) dispatch(w);
  await finished;

  const problems = accepted.map((r, i) => ({ id: `q${String(i + 1).padStart(5, "0")}`, ...r.problem }));
  const data = {
    version: 2,
    generatedAt: args["generated-at"] || jstIso(),
    params: { trials: args.trials, maxTurn: MAX_TURN, seed: args.seed, model: "ron-random-v2", ...DEFAULT_MODEL },
    problems,
  };
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data) + "\n");

  // ---- 統計 ----
  const sec = (Date.now() - t0) / 1000;
  const hist = (arr) => arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  const qs = accepted.map((r) => r.stat.q);
  const qBins = {};
  for (const q of qs) {
    const b = Math.min(0.9, Math.floor(q * 10) / 10).toFixed(1);
    qBins[b] = (qBins[b] || 0) + 1;
  }
  console.log(`出力: ${outPath}`);
  console.log(`採用 ${problems.length} 問 / 試行 ${prefix} 件（採用率 ${(100 * problems.length / prefix).toFixed(1)}%）`);
  console.log("不採用の内訳:", reasons);
  console.log("巡目分布:", hist(problems.map((p) => p.turn)));
  console.log("best のシャンテン分布:", hist(accepted.map((r) => r.stat.bestShanten)));
  const nTg = accepted.filter((r) => r.stat.tsumogiri).length;
  console.log(`best がツモ切り: ${nTg} 問（${(100 * nTg / Math.max(1, accepted.length)).toFixed(1)}%）`);
  // 河の自然さ: 第1打の字牌率、第1打がドラ・赤の河の数
  let first = 0, firstHonor = 0, firstDoraRed = 0;
  for (const p of problems) {
    const doraK = doraFromIndicator(p.doraIndicator);
    for (const key of SEATS) {
      const t = p.rivers[key][0];
      if (!t) continue;
      first++;
      if (kindOf(t) >= 27) firstHonor++;
      if (kindOf(t) === doraK || t[0] === "0") firstDoraRed++;
    }
  }
  console.log(`第1打の字牌率: ${(100 * firstHonor / Math.max(1, first)).toFixed(1)}%（${first} 河）／ 第1打がドラか赤の河: ${firstDoraRed}`);
  const ag = problems.map((p) => p.candidates[0].agari).sort((x, y) => x - y);
  const agBins = {};
  for (const x of ag) { const b = (Math.floor(x * 10) / 10).toFixed(1); agBins[b] = (agBins[b] || 0) + 1; }
  console.log("best の和了率分布:", agBins, " 中央値", ag[Math.floor(ag.length / 2)]);
  const nIso = accepted.filter((r) => r.stat.isolated).length;
  console.log(`best が孤立牌: ${nIso} 問（${(100 * nIso / Math.max(1, accepted.length)).toFixed(1)}%）`);
  console.log("best のシャンテン別 × 巡目:");
  console.log("  向聴/巡目" + [3, 4, 5, 6, 7, 8, 9, 10, 11].map((t) => String(t).padStart(4)).join(""));
  for (const sh of [0, 1, 2]) {
    const row = [3, 4, 5, 6, 7, 8, 9, 10, 11].map((t) =>
      String(accepted.filter((r) => r.stat.bestShanten === sh && r.problem.turn === t).length).padStart(4));
    console.log(`  ${sh}       ` + row.join(""));
  }
  const nFlip = accepted.filter((r) => r.stat.furitenFlip).length;
  const nAnyF = accepted.filter((r) => r.stat.anyFuriten).length;
  console.log(`フリテン候補がある問題: ${nAnyF} 問 / うち受け入れ枚数では best 以上の候補がフリテンで順位を下げた問題: ${nFlip} 問 / best がフリテン: ${accepted.filter((r) => r.stat.bestFuriten).length} 問`);
  if (args["furiten-check"] > 0) {
    console.log(`フリテンを無視すると best が変わる問題: ${accepted.filter((r) => r.stat.furitenChangesBest).length} 問`);
  }
  console.log("平均候補数:", (accepted.reduce((s, r) => s + r.stat.nCand, 0) / Math.max(1, accepted.length)).toFixed(2));
  console.log("q（同シャンテン次点/best）分布:", qBins, " 平均", (qs.reduce((s, x) => s + x, 0) / Math.max(1, qs.length)).toFixed(3));
  console.log(`所要時間: ${sec.toFixed(1)} 秒（${args.threads} スレッド）`);
  process.exit(0);
}

// テストから import されたときは実行しない
if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

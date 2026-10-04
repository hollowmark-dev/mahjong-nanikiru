// 何切る候補の評価（SPEC.md §5、立体何切る版）。
// 「切った後の13枚」から draws 巡を進め、テンパイ到達率と和了率（ツモ＋ロン）を数える。
// 1巡 = 自家ツモ → 下家・対面・上家がプールの次の牌を1枚ずつ切る。
// 試行 i のプールの並びは全候補で共通（共通乱数）。
import { parseTile, kindToStr } from "./tiles.js";
import { createRng } from "./rng.js";
import { shanten } from "./shanten.js";
import { discardOptions } from "./ukeire.js";

const RIVER_KEYS = ["self", "shimo", "toimen", "kami"];

// 13枚の手牌ごとの節点。見えている枚数に依存しない情報だけを持つ。
//   s:    シャンテン数
//   eff:  シャンテン数を下げる種類（s=0 なら待ち）。残り枚数は問わない
//   isEff:種類 → 有効牌か
//   trans:ツモ t ごとの「シャンテン数が下がる打牌」の [打牌kind, 行き先節点] 一覧（kind 昇順）。遅延計算
//   swap: テンパイ節点で有効牌でない t をツモったとき、t 以外を切ってテンパイを保つ打牌の一覧（待ち替え用）
export function createGraph() {
  const cache = new Map();
  const work = new Int8Array(34);

  function node(counts) {
    const key = String.fromCharCode.apply(null, counts);
    let n = cache.get(key);
    if (n) return n;
    const c = Int8Array.from(counts);
    const s = shanten(c);
    const eff = [];
    const isEff = new Uint8Array(34);
    work.set(c);
    for (let k = 0; k < 34; k++) {
      if (work[k] >= 4) continue;
      work[k]++;
      if (shanten(work) < s) { eff.push(k); isEff[k] = 1; }
      work[k]--;
    }
    n = { counts: c, s, eff, isEff, trans: null, swap: null };
    cache.set(key, n);
    return n;
  }

  function transitions(n, t) {
    if (n.trans === null) n.trans = new Array(34);
    let list = n.trans[t];
    if (list) return list;
    list = [];
    const c = Int8Array.from(n.counts);
    c[t]++;
    for (let d = 0; d < 34; d++) {
      if (c[d] === 0) continue;
      c[d]--;
      if (shanten(c) === n.s - 1) list.push([d, node(c)]);
      c[d]++;
    }
    n.trans[t] = list;
    return list;
  }

  function swaps(n, t) {
    if (n.swap === null) n.swap = new Array(34);
    let list = n.swap[t];
    if (list) return list;
    list = [];
    const c = Int8Array.from(n.counts);
    c[t]++;
    for (let d = 0; d < 34; d++) {
      if (c[d] === 0 || d === t) continue;
      c[d]--;
      if (shanten(c) === 0) list.push([d, node(c)]);
      c[d]++;
    }
    n.swap[t] = list;
    return list;
  }

  return { node, transitions, swaps, get size() { return cache.size; } };
}

// 有効牌の残り枚数（見えている枚数は都度数える）
export function remainingCount(n, vis) {
  let sum = 0;
  const eff = n.eff;
  for (let i = 0; i < eff.length; i++) sum += 4 - vis[eff[i]];
  return sum;
}

// テンパイ節点の待ちに、河の種類（river）または extra が含まれるか
export function isFuriten(n, river, extra) {
  const eff = n.eff;
  for (let i = 0; i < eff.length; i++) {
    const k = eff[i];
    if (river[k] || k === extra) return true;
  }
  return false;
}

// 出題局面を数値化する（テストの素朴な実装と共有）
export function prepareState(problemState) {
  const { hand, draw, doraIndicator, rivers = {} } = problemState;
  const counts14 = new Array(34).fill(0);
  for (const s of hand) counts14[parseTile(s).kind]++;
  counts14[parseTile(draw).kind]++;
  const visible = counts14.slice();
  visible[parseTile(doraIndicator).kind]++;
  const selfRiver = new Uint8Array(34);
  for (const key of RIVER_KEYS) {
    for (const s of rivers[key] || []) {
      const k = parseTile(s).kind;
      visible[k]++;
      if (key === "self") selfRiver[k] = 1;
    }
  }
  for (let k = 0; k < 34; k++) if (visible[k] > 4) throw new Error(`同じ牌が5枚以上見えています: ${kindToStr(k)}`);
  return { counts14, visible, selfRiver };
}

// 局の打ち切り・ロンの見込みのモデル（SPEC §5、model "ron-random-v2"）。既定値は較正で決めた値
export const DEFAULT_MODEL = Object.freeze({ hazardStart: 6, hazardSlope: 0.01, hazardMax: 0.2, ronRate: 0.3 });

// 巡目 turn の開始時に局が終わる確率: hazardStart 巡目から hazardSlope ずつ増え、hazardMax で頭打ち
export function endHazard(turn, model = DEFAULT_MODEL) {
  if (turn < model.hazardStart) return 0;
  return Math.min(model.hazardMax, model.hazardSlope * (turn - model.hazardStart + 1));
}

// プールの並び: 先頭3枚 = 出題局面で自家が切った直後の他家3人の打牌、
// 以後4枚ずつ = 1巡（自家ツモ → 下家・対面・上家の打牌）。
export const isSelfDraw = (j) => j >= 3 && ((j - 3) & 3) === 0;

// 試行ごとの「打ち切り巡」と「他家の打牌がロン可能か」。全候補で共通
//   endRound[i]: 試行 i で実際に進める巡の数（0〜rounds）。先頭の他家3枚は打ち切り判定の対象外
//   ronOk[i*len + j]: プールの j 番目が他家の打牌のとき、ロン可能なら 1
export function buildEvents(trials, len, turn, seed, model = DEFAULT_MODEL) {
  const rounds = Math.max(0, Math.ceil((len - 3) / 4));
  const endRound = new Uint8Array(trials);
  const ronOk = new Uint8Array(trials * len);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  for (let i = 0; i < trials; i++) {
    let r = 0;
    for (; r < rounds; r++) if (rng() < endHazard(turn + 1 + r, model)) break;
    endRound[i] = r;
    for (let j = 0; j < len; j++) if (!isSelfDraw(j) && rng() < model.ronRate) ronOk[i * len + j] = 1;
  }
  return { endRound, ronOk };
}

// 試行ごとのプールの先頭 3 + 4*draws 枚（部分 Fisher–Yates）。全候補で共通
export function buildPools(visible, draws, trials, seed) {
  const pool = [];
  for (let k = 0; k < 34; k++) for (let i = visible[k]; i < 4; i++) pool.push(k);
  const len = Math.max(0, Math.min(3 + 4 * draws, pool.length));
  const out = new Uint8Array(trials * len);
  const rng = createRng(seed);
  for (let i = 0; i < trials; i++) {
    for (let j = 0; j < len; j++) {
      const r = j + Math.floor(rng() * (pool.length - j));
      const x = pool[j]; pool[j] = pool[r]; pool[r] = x;
      out[i * len + j] = pool[j];
    }
  }
  return { pools: out, len };
}

// 内部用: 試行ごとの和了フラグまで返す（生成スクリプトの統計判定で使う）
// ignoreFuriten: 分析用（フリテンを無視した場合と比べる）。出題データの生成には使わない
export function evaluateRaw(problemState, { trials = 10000, seed = 1, model = DEFAULT_MODEL, ignoreFuriten = false } = {}) {
  const fur = ignoreFuriten ? () => false : isFuriten;
  const { counts14, visible, selfRiver } = prepareState(problemState);
  const { pools, len } = buildPools(visible, problemState.draws, trials, seed);
  const { endRound, ronOk } = buildEvents(trials, len, problemState.turn, seed, model);

  const graph = createGraph();
  const opts = discardOptions(counts14, visible);
  const vis = Int8Array.from(visible);
  const river = new Uint8Array(34);
  const candidates = [];

  for (const opt of opts) {
    const c13 = counts14.slice();
    c13[opt.kind]--;
    const start = graph.node(c13);
    const furitenAtStart = start.s === 0 && isFuriten(start, selfRiver, opt.kind);
    const agariHits = new Uint8Array(trials);
    let tenpaiN = 0, agariN = 0;
    for (let i = 0; i < trials; i++) {
      river.set(selfRiver);
      river[opt.kind] = 1;
      let n = start;
      let tenpai = n.s <= 0;
      let agari = false;
      const base = i * len;
      let used = 0;
      const stop = Math.min(len, 3 + 4 * endRound[i]); // 局の打ち切り
      // 出題局面で自家が切った直後の他家3人の打牌（ロン判定あり）
      for (; used < 3 && used < stop; ) {
        const x = pools[base + used++];
        vis[x]++;
        if (n.s === 0 && n.isEff[x] === 1 && ronOk[base + used - 1] === 1 && !fur(n, river, -1)) { agari = true; break; }
      }
      while (!agari && used < stop) {
        // 自家ツモ
        const t = pools[base + used++];
        vis[t]++;
        if (n.isEff[t] === 1) {
          if (n.s === 0) { agari = true; break; } // ツモ和了
          const list = graph.transitions(n, t);
          let bd = list[0][0], bn = list[0][1];
          if (bn.s === 0) {
            // テンパイにする打牌: フリテンでないもの優先 → 待ち枚数最大 → kind 小
            let bf = fur(bn, river, bd), bu = remainingCount(bn, vis);
            for (let q = 1; q < list.length; q++) {
              const [d, m] = list[q];
              const f = fur(m, river, d), u = remainingCount(m, vis);
              if ((bf && !f) || (bf === f && u > bu)) { bd = d; bn = m; bf = f; bu = u; }
            }
          } else {
            let bu = remainingCount(bn, vis);
            for (let q = 1; q < list.length; q++) {
              const u = remainingCount(list[q][1], vis);
              if (u > bu) { bu = u; bd = list[q][0]; bn = list[q][1]; }
            }
          }
          river[bd] = 1;
          n = bn;
          if (n.s === 0) tenpai = true;
        } else if (n.s === 0) {
          // 待ち替え: ツモ切り（現状維持）より「非フリテン優先 → 待ちの残り枚数」で真に良くなるなら替える
          let bd = t, bn = n;
          let bf = fur(n, river, t), bu = remainingCount(n, vis);
          const list = graph.swaps(n, t);
          for (let q = 0; q < list.length; q++) {
            const [d, m] = list[q];
            const f = fur(m, river, d), u = remainingCount(m, vis);
            if ((bf && !f) || (bf === f && u > bu)) { bd = d; bn = m; bf = f; bu = u; }
          }
          river[bd] = 1;
          n = bn;
        } else {
          river[t] = 1; // ツモ切り
        }
        // 他家3人の打牌
        for (let p = 0; p < 3 && used < stop; p++) {
          const x = pools[base + used++];
          vis[x]++;
          if (n.s === 0 && n.isEff[x] === 1 && ronOk[base + used - 1] === 1 && !fur(n, river, -1)) { agari = true; break; } // ロン
        }
        if (agari) break;
      }
      for (let q = 0; q < used; q++) vis[pools[base + q]]--;
      if (agari) { agariHits[i] = 1; agariN++; }
      if (tenpai) tenpaiN++;
    }
    candidates.push({
      kind: opt.kind,
      shanten: opt.shanten,
      ukeire: opt.ukeireCount,
      ukeireTiles: opt.ukeireTiles,
      furiten: furitenAtStart,
      tenpaiN, agariN, agariHits,
    });
  }

  // agari 降順、同率なら ukeire 大、なお同率なら kind 小
  candidates.sort((a, b) => b.agariN - a.agariN || b.ukeire - a.ukeire || a.kind - b.kind);
  return { trials, candidates, nodes: graph.size };
}

const r4 = (x) => Math.round(x * 10000) / 10000;

export function toCandidateJson(c, trials) {
  return {
    tile: kindToStr(c.kind),
    shanten: c.shanten,
    ukeire: c.ukeire,
    ukeireTiles: c.ukeireTiles.map(kindToStr),
    tenpai: r4(c.tenpaiN / trials),
    agari: r4(c.agariN / trials),
    furiten: c.furiten,
  };
}

export function evaluate(problemState, { trials = 10000, seed = 1, model = DEFAULT_MODEL } = {}) {
  const raw = evaluateRaw(problemState, { trials, seed, model });
  const candidates = raw.candidates.map((c) => toCandidateJson(c, trials));
  return { candidates, best: candidates[0].tile };
}

// 押し引き（SPEC.md §11.3・§11.4）。他家1人のリーチに対して、各打牌の期待収支を評価する。
//
// 流れ:
//   1. 試行ごとに、公開情報と矛盾しないリーチ者のテンパイ形を1つ作る（sampleRiichiHand）。
//   2. 残りの未知牌をシャッフルしてプールにし、§5 と同じ巡の進め方で局を進める（共通乱数）。
//   3. 自家の方策（§11.4）に従って打ち、収支（点）を数える。
// 速度問題（simulate.js）の節点キャッシュを再利用する。
import { parseTile, kindToStr, doraFromIndicator } from "./tiles.js";
import { createRng } from "./rng.js";
import { shanten, shantenKokushi } from "./shanten.js";
import { discardOptions } from "./ukeire.js";
import { createGraph, remainingCount, isFuriten, buildEvents, DEFAULT_MODEL } from "./simulate.js";
import { scoreHand } from "./score.js";

export const OSHIHIKI_MODEL = Object.freeze({
  ...DEFAULT_MODEL,
  seqWeight: 0.65,         // ブロックを順子にする確率（較正: scripts/calibrate-oshihiki.mjs）
  nonRyanmenAccept: 0.5,   // 両面以外の待ちを採用する確率（同上）
  otherDealInRate: 0.3,    // 他家（リーチ者以外）がリーチ者の待ちの牌を実際に切る確率
  goodUkeire: 12,          // 1シャンテンの受け入れがこの枚数以上なら良形
  pushThresholdGood: 0.12, // 良形1シャンテンで押す打牌の dealIn 上限（定説チェックで決めた値）
  pushThresholdBad: 0.06,  // 愚形1シャンテンで押す打牌の dealIn 上限（同上）
});

const SEAT_KEYS = ["self", "shimo", "toimen", "kami"];
const RED_KIND = [4, 13, 22];

// 牌コード = kind*2 + 赤
const codeOf = (s) => { const t = parseTile(s); return t.kind * 2 + (t.red ? 1 : 0); };

// ---------------- 局面の前処理 ----------------
export function prepareOshihiki(state) {
  const { hand, draw, doraIndicator, rivers, riichi } = state;
  if (hand.length !== 13) throw new Error(`手牌は13枚: ${hand.length}`);
  const r = SEAT_KEYS.indexOf(riichi.seat);
  if (r < 1) throw new Error(`リーチ者の席が不正: ${riichi.seat}`);
  const counts14 = new Array(34).fill(0);
  const myRed = new Uint8Array(34);
  for (const s of [...hand, draw]) {
    const t = parseTile(s);
    counts14[t.kind]++;
    if (t.red) myRed[t.kind] = 1;
  }
  // 見えている牌（コード単位）
  const seen = new Uint8Array(68);
  const see = (s) => { seen[codeOf(s)]++; };
  [...hand, draw, doraIndicator].forEach(see);
  const visible = counts14.slice();
  visible[parseTile(doraIndicator).kind]++;
  const selfRiver = new Uint8Array(34);
  const riichiRiver = new Uint8Array(34);
  const postRiichi = new Uint8Array(34); // リーチ宣言後に他家（自家を含む）が切った種類
  SEAT_KEYS.forEach((key, s) => {
    (rivers[key] || []).forEach((str, j) => {
      see(str);
      const k = parseTile(str).kind;
      visible[k]++;
      if (s === 0) selfRiver[k] = 1;
      if (s === r) riichiRiver[k] = 1;
      // 巡 j の中の手番は 自家→下家→対面→上家。宣言は巡 riichi.index の r 番目の手番
      else if (j > riichi.index || (j === riichi.index && s > r)) postRiichi[k] = 1;
    });
  });
  for (let k = 0; k < 34; k++) if (visible[k] > 4) throw new Error(`同じ牌が5枚以上見えています: ${kindToStr(k)}`);
  // 未知の牌（コード）
  const unknown = [];
  for (let k = 0; k < 34; k++) {
    const hasRed = RED_KIND.includes(k);
    const redLeft = hasRed ? 1 - seen[k * 2 + 1] : 0;
    const normalLeft = 4 - visible[k] - redLeft;
    for (let i = 0; i < normalLeft; i++) unknown.push(k * 2);
    if (redLeft > 0) unknown.push(k * 2 + 1);
  }
  return {
    counts14, myRed, visible, selfRiver, riichiRiver, postRiichi, unknown, r,
    doraKinds: [doraFromIndicator(doraIndicator)],
  };
}

// ---------------- リーチ者の手のサンプリング（§11.3） ----------------
// 待ちが「両面系」か: 同じスートで3離れた2種類を含む（両面・ノベタン・三面張など）
export function isRyanmenLike(waits) {
  for (const a of waits) for (const b of waits) {
    if (b - a === 3 && a < 27 && Math.floor(a / 9) === Math.floor(b / 9)) return true;
  }
  return false;
}

// 13枚のテンパイ形の待ち（その種類で和了形になる種類。手に4枚ある種類は除く）
// 速さのため、国士のテンパイでなければ「手にある種類か、同じスートで ±2 以内に手牌がある種類」だけを調べる
// （通常手・七対子の待ちは必ずこの中にある）
export function waitsOf(c13) {
  const w = [];
  const full = shantenKokushi(c13) === 0;
  for (let k = 0; k < 34; k++) {
    if (c13[k] >= 4) continue;
    if (!full && c13[k] === 0) {
      if (k >= 27) continue;
      const p = k % 9;
      if (!((p >= 1 && c13[k - 1]) || (p >= 2 && c13[k - 2]) || (p <= 7 && c13[k + 1]) || (p <= 6 && c13[k + 2]))) continue;
    }
    c13[k]++;
    if (shanten(c13) === -1) w.push(k);
    c13[k]--;
  }
  return w;
}

// cnt: 未知プールの種類別枚数。→ { hand: 13枚の counts, waits }
export function sampleRiichiHand(cnt, info, rng, model = OSHIHIKI_MODEL) {
  for (let attempt = 0; attempt < 20000; attempt++) {
    const c = new Array(34).fill(0);
    let ok = true;
    for (let b = 0; b < 4 && ok; b++) {
      if (rng() < model.seqWeight) {
        const opts = [];
        for (let s = 0; s < 3; s++) for (let n = 0; n < 7; n++) {
          const k = s * 9 + n;
          if (cnt[k] - c[k] >= 1 && cnt[k + 1] - c[k + 1] >= 1 && cnt[k + 2] - c[k + 2] >= 1) opts.push(k);
        }
        if (opts.length === 0) { ok = false; break; }
        const k = opts[Math.floor(rng() * opts.length)];
        c[k]++; c[k + 1]++; c[k + 2]++;
      } else {
        const opts = [];
        for (let k = 0; k < 34; k++) if (cnt[k] - c[k] >= 3) opts.push(k);
        if (opts.length === 0) { ok = false; break; }
        c[opts[Math.floor(rng() * opts.length)]] += 3;
      }
    }
    if (!ok) continue;
    const pairs = [];
    for (let k = 0; k < 34; k++) if (cnt[k] - c[k] >= 2) pairs.push(k);
    if (pairs.length === 0) continue;
    c[pairs[Math.floor(rng() * pairs.length)]] += 2;
    // 14枚から1枚抜く（牌単位で一様）
    let x = Math.floor(rng() * 14);
    let rm = 0;
    while (x >= c[rm]) { x -= c[rm]; rm++; }
    c[rm]--;
    const w = waitsOf(c);
    if (w.some((k) => info.riichiRiver[k] || info.postRiichi[k])) continue; // フリテン・宣言後の通過牌
    if (!isRyanmenLike(w) && rng() >= model.nonRyanmenAccept) continue;
    return { hand: c, waits: w };
  }
  throw new Error("リーチ者の手を作れませんでした");
}

// ---------------- 試行データ（全候補で共通） ----------------
// 試行 i:
//   waits[i*34+k]  リーチ者の待ちか
//   rHand[i*34+k]  リーチ者の13枚
//   pools[i*len+j] 牌コード。先頭3枚 = 自家の打牌直後の他家3人、以後4枚ずつ = 自家ツモ・下家・対面・上家
//   ura[i]         裏ドラの種類（プールの最後の1枚を裏ドラ表示牌とする）
export function prepareTrials(state, info, trials, seed, model = OSHIHIKI_MODEL) {
  const rng = createRng(seed);
  const cnt = new Array(34).fill(0);
  for (const code of info.unknown) cnt[code >> 1]++;
  const poolSize = info.unknown.length - 13 - 1;
  const len = Math.max(0, Math.min(3 + 4 * state.draws, poolSize));
  const waits = new Uint8Array(trials * 34);
  const rHand = new Uint8Array(trials * 34);
  const rRed = new Uint8Array(trials);
  const pools = new Uint8Array(trials * len);
  const ura = new Uint8Array(trials);
  const work = info.unknown.slice();
  for (let i = 0; i < trials; i++) {
    const { hand, waits: w } = sampleRiichiHand(cnt, info, rng, model);
    for (const k of w) waits[i * 34 + k] = 1;
    // シャッフルして、リーチ者の13枚を先に現れる順に取り除く
    for (let a = work.length - 1; a > 0; a--) {
      const b = Math.floor(rng() * (a + 1));
      const t = work[a]; work[a] = work[b]; work[b] = t;
    }
    const need = hand.slice();
    let p = 0, red = 0;
    const rest = new Array(poolSize + 1);
    for (const code of work) {
      const k = code >> 1;
      if (need[k] > 0) { need[k]--; rHand[i * 34 + k]++; red += code & 1; continue; }
      rest[p++] = code;
    }
    rRed[i] = red;
    for (let j = 0; j < len; j++) pools[i * len + j] = rest[j];
    ura[i] = doraFromIndicator(kindToStr(rest[poolSize] >> 1));
  }
  const ev = buildEvents(trials, len, state.turn, seed, model);
  // 他家（リーチ者以外）がリーチ者の待ちを実際に切るか
  const otherOk = new Uint8Array(trials * len);
  const rng2 = createRng((seed ^ 0x51ed270b) >>> 0);
  for (let j = 0; j < trials * len; j++) if (rng2() < model.otherDealInRate) otherOk[j] = 1;
  const dealIn = new Float64Array(34);
  for (let i = 0; i < trials; i++) for (let k = 0; k < 34; k++) dealIn[k] += waits[i * 34 + k];
  for (let k = 0; k < 34; k++) dealIn[k] /= trials;
  return { trials, len, waits, rHand, rRed, pools, ura, endRound: ev.endRound, ronOk: ev.ronOk, otherOk, dealIn };
}

// ---------------- 和了点 ----------------
function makeScorer(info, state) {
  const cache = new Map();
  return function score(who, counts14, win, tsumo, aka, uraKind) {
    const key = `${who}|${String.fromCharCode.apply(null, counts14)}|${win}|${tsumo ? 1 : 0}|${aka}|${uraKind}`;
    let v = cache.get(key);
    if (v !== undefined) return v;
    const dealer = who === 0;
    const r = scoreHand({
      counts14: Array.from(counts14), winTile: win, tsumo, riichi: true, dealer,
      doraKinds: info.doraKinds, akaCount: aka, uraKinds: [uraKind],
      seatWind: 27 + who, roundWind: 27,
    });
    if (!r) throw new Error(`和了点を計算できません: ${kindToStr(win)} ${Array.from(counts14).join("")}`);
    // 自家から見た受け取り（自家の和了）／支払い（リーチ者の和了）の額
    v = dealer ? r.points : (tsumo ? r.payments.dealer : r.points);
    cache.set(key, v);
    return v;
  };
}

// ---------------- シミュレーション（§11.4） ----------------
// 結果コード
// NONE = 流局・打ち切り、WIN = 自家の和了、DEALIN = 自家の放銃、RTSUMO = リーチ者のツモ、OTHER = 他家の放銃
export const END = Object.freeze({ NONE: 0, WIN: 1, DEALIN: 2, RTSUMO: 3, OTHER: 4 });

export function evaluateOshihikiRaw(state, { trials = 10000, seed = 1, model = OSHIHIKI_MODEL } = {}) {
  const info = prepareOshihiki(state);
  const T = prepareTrials(state, info, trials, seed, model);
  const { len, waits, rHand, rRed, pools, ura, endRound, ronOk, otherOk, dealIn } = T;
  const score = makeScorer(info, state);
  const graph = createGraph();
  const r = info.r;
  const opts = discardOptions(info.counts14, info.visible);
  const vis = Int8Array.from(info.visible);
  const river = new Uint8Array(34);
  const safe = new Uint8Array(34);
  const redIn = new Uint8Array(34);
  const rc = new Uint8Array(34);
  const candidates = [];
  // 1シャンテンの手 n に t をツモったとき、シャンテン数を保つ・下げる打牌 [打牌, 行き先] の一覧（kind 昇順）
  const keepOptions = (n, t) => {
    if (!n.keep) n.keep = new Array(34);
    let list = n.keep[t];
    if (list) return list;
    list = [];
    const c = Int8Array.from(n.counts);
    c[t]++;
    for (let dd = 0; dd < 34; dd++) {
      if (c[dd] === 0) continue;
      c[dd]--;
      if (shanten(c) <= n.s) list.push([dd, graph.node(c)]);
      c[dd]++;
    }
    n.keep[t] = list;
    return list;
  };
  const fold = { counts: new Int8Array(34), s: 99, eff: [], isEff: null }; // 降りた後の手（枚数だけ）

  // 危険度（シミュレーション中に通った牌は 0）
  const danger = (k) => (safe[k] ? 0 : dealIn[k]);

  for (const opt of opts) {
    const d0 = opt.kind;
    const c13 = info.counts14.slice();
    c13[d0]--;
    const start = graph.node(c13);
    const payoff = new Int32Array(trials);
    const results = new Uint8Array(trials);
    let agariN = 0, loseN = 0;
    for (let i = 0; i < trials; i++) {
      const wb = i * 34;
      river.set(info.selfRiver);
      safe.fill(0);
      redIn.set(info.myRed);
      const d0Red = redIn[d0] && c13[d0] === 0 ? 1 : 0; // 赤は最後まで残す（最後の1枚なら赤が出る）
      if (d0Red) redIn[d0] = 0;
      const aka = () => { let a = 0; for (const k of RED_KIND) a += redIn[k]; return a; };
      let n = start;
      let myRiichi = false, folded = false;
      let result = END.NONE, pts = 0;
      const base = i * len;
      let used = 0;

      // リーチ者の和了点（ロン / ツモ）
      const riichiWin = (k, tsumo, winRed) => {
        for (let q = 0; q < 34; q++) rc[q] = rHand[wb + q];
        rc[k]++;
        return score(r, rc, k, tsumo, rRed[i] + winRed, ura[i]);
      };
      const myWin = (k, tsumo, winRed) => {
        for (let q = 0; q < 34; q++) rc[q] = n.counts[q];
        rc[k]++;
        return score(0, rc, k, tsumo, aka() + winRed, ura[i]);
      };
      // 自家の打牌 k（declare: この打牌でリーチ宣言、red: 切る牌が赤5）。放銃なら true
      const myDiscard = (k, declare, red) => {
        if (waits[wb + k]) {
          result = END.DEALIN;
          pts = -riichiWin(k, false, red) - (myRiichi ? 1000 : 0);
          return true;
        }
        river[k] = 1; safe[k] = 1;
        if (declare) myRiichi = true;
        return false;
      };
      // 他家 s の打牌（リーチ者ならツモ切り）。局が終われば true
      const otherDiscard = (s, j) => {
        const code = pools[base + j];
        const x = code >> 1;
        vis[x]++;
        if (s === r) {
          if (waits[wb + x]) { // リーチ者のツモ和了
            result = END.RTSUMO;
            pts = -riichiWin(x, true, code & 1) - (myRiichi ? 1000 : 0);
            return true;
          }
          safe[x] = 1;
          if (myRiichi && n.isEff[x] === 1 && !isFuriten(n, river, -1)) {
            result = END.WIN; pts = myWin(x, false, code & 1) + 1000;
            return true;
          }
          return false;
        }
        // 頭ハネ: 打牌者の次の席から順に
        for (let q = 1; q <= 3; q++) {
          const t = (s + q) & 3;
          if (t === r && waits[wb + x]) {
            // 他家はリーチに対して危険牌を抱えるので、待ちの牌は確率 otherDealInRate でだけ実際に切られる。
            // 切られなかった（抱えた）ときは、その打牌は通過牌として扱わず、自家のロンも無い
            if (otherOk[base + j] === 1) { result = END.OTHER; pts = myRiichi ? -1000 : 0; return true; }
            return false;
          }
          if (t === 0 && myRiichi && n.isEff[x] === 1 && ronOk[base + j] === 1 && !isFuriten(n, river, -1)) {
            result = END.WIN; pts = myWin(x, false, code & 1) + 1000;
            return true;
          }
        }
        safe[x] = 1;
        return false;
      };

      // 出題局面の打牌
      if (!myDiscard(d0, start.s === 0, d0Red)) {
        const stop = Math.min(len, 3 + 4 * endRound[i]);
        for (let s = 1; s <= 3 && used < stop && result === END.NONE; s++) {
          if (otherDiscard(s, used++)) break;
        }
        while (result === END.NONE && used < stop) {
          // 自家ツモ
          const code = pools[base + used++];
          const t = code >> 1;
          vis[t]++;
          if (myRiichi) {
            if (n.isEff[t] === 1) { result = END.WIN; pts = myWin(t, true, code & 1) + 1000; break; }
            if (myDiscard(t, false, code & 1)) break;
          } else {
            // 打牌を決める
            let d = -1, next = null, declare = false;
            if (!folded && n.s === 1) {
              const list = keepOptions(n, t);
              if (n.isEff[t] === 1) {
                // ツモでテンパイが取れる: 閾値をかけずにテンパイを取る（§11.4 方策1・2）。
                // テンパイ打牌が複数なら 非フリテン → 待ち枚数 → dealIn 小 → kind 小
                let bd = -1, bn = null, bf = true, bu = -1, bv = 2;
                for (let q = 0; q < list.length; q++) {
                  const [dd, m] = list[q];
                  if (m.s !== 0) continue;
                  const f = isFuriten(m, river, dd), u = remainingCount(m, vis), v = danger(dd);
                  if (bn === null || (bf && !f) || (bf === f && (u > bu || (u === bu && v < bv)))) {
                    bd = dd; bn = m; bf = f; bu = u; bv = v;
                  }
                }
                d = bd; next = bn; declare = true;
              } else {
                // テンパイが取れない: シャンテン数を保つ打牌のうち最も安全なものが閾値以下なら押す
                const th = remainingCount(n, vis) >= model.goodUkeire ? model.pushThresholdGood : model.pushThresholdBad;
                let safest = 2;
                for (let q = 0; q < list.length; q++) { const v = danger(list[q][0]); if (v < safest) safest = v; }
                if (safest > th) {
                  folded = true;
                } else {
                  // 閾値以下の打牌の中で受け入れ最大（同率は kind 小）
                  let bd = -1, bn = null, bu = -1;
                  for (let q = 0; q < list.length; q++) {
                    const [dd, m] = list[q];
                    if (danger(dd) > th) continue;
                    const u = remainingCount(m, vis);
                    if (u > bu) { bd = dd; bn = m; bu = u; }
                  }
                  d = bd; next = bn;
                }
              }
            } else if (!folded) {
              folded = true; // 2シャンテン以上は降りる
            }
            if (d < 0) {
              // 降り: 手の中で危険度最小（同率は kind 小）。降りた後は和了しないので、
              // 節点（有効牌の計算）を作らず枚数だけの疑似節点で持つ
              if (n.isEff !== null) { fold.counts.set(n.counts); n = fold; }
              const fc = fold.counts;
              fc[t]++;
              let best = -1, bv = 2;
              for (let k = 0; k < 34; k++) {
                if (fc[k] === 0) continue;
                const v = danger(k);
                if (v < bv) { bv = v; best = k; }
              }
              d = best;
              fc[d]--;
              next = fold;
            }
            // 赤: ツモが赤なら持つ。切る種類が最後の1枚なら赤も出る
            if (code & 1) redIn[t] = 1;
            let dRed = 0;
            if (next.counts[d] === 0) { dRed = redIn[d]; redIn[d] = 0; }
            n = next;
            if (myDiscard(d, declare, dRed)) break;
          }
          for (let s = 1; s <= 3 && used < stop; s++) {
            if (otherDiscard(s, used++)) break;
          }
        }
        if (result === END.NONE) pts = myRiichi ? -1000 : 0; // 流局・打ち切り
      }
      for (let q = 0; q < used; q++) vis[pools[base + q] >> 1]--;
      payoff[i] = pts;
      results[i] = result;
      if (result === END.WIN) agariN++;
      if (result === END.DEALIN) loseN++;
    }
    let sum = 0;
    for (let i = 0; i < trials; i++) sum += payoff[i];
    candidates.push({
      kind: d0, shanten: opt.shanten, ukeire: opt.ukeireCount, ukeireTiles: opt.ukeireTiles,
      dealIn: dealIn[d0], agariN, loseN, evSum: sum, payoff, results,
    });
  }
  candidates.sort((a, b) => b.evSum - a.evSum || a.dealIn - b.dealIn || a.kind - b.kind);
  return { trials, candidates, dealIn, info };
}

const r4 = (x) => Math.round(x * 10000) / 10000;

export function toOshihikiCandidateJson(c, trials) {
  return {
    tile: kindToStr(c.kind),
    shanten: c.shanten,
    ukeire: c.ukeire,
    ukeireTiles: c.ukeireTiles.map(kindToStr),
    dealIn: r4(c.dealIn),
    agari: r4(c.agariN / trials),
    lose: r4(c.loseN / trials),
    ev: Math.round(c.evSum / trials),
  };
}

// answerType（§11.5）: 候補 c が best だったときの分類
//   fold（優先） = シャンテン ≥ 2、または和了率 0（和了を見ない手順）
//   push         = dealIn > minD + 0.01
//   mawashi      = dealIn ≤ minD + 0.01 かつ シャンテン = minS
//   fold         = dealIn ≤ minD + 0.01 かつ シャンテン > minS
// c は生の候補（agariN）でも JSON の候補（agari）でもよい
export function candidateType(c, cands) {
  const agari = c.agariN !== undefined ? c.agariN : c.agari;
  if (c.shanten >= 2 || agari === 0) return "fold";
  const minD = Math.min(...cands.map((x) => x.dealIn));
  const minS = Math.min(...cands.map((x) => x.shanten));
  if (c.dealIn > minD + 0.01) return "push";
  return c.shanten === minS ? "mawashi" : "fold";
}
export function answerTypeOf(cands) {
  return candidateType(cands[0], cands);
}

export function evaluateOshihiki(state, { trials = 10000, seed = 1, model = OSHIHIKI_MODEL } = {}) {
  const raw = evaluateOshihikiRaw(state, { trials, seed, model });
  const candidates = raw.candidates.map((c) => toOshihikiCandidateJson(c, trials));
  return { candidates, best: candidates[0].tile, answerType: answerTypeOf(raw.candidates) };
}

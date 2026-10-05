// 押し引き（SPEC §11.3・§11.4）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTile, kindToStr, doraFromIndicator } from "../docs/js/engine/tiles.js";
import { createRng } from "../docs/js/engine/rng.js";
import { shanten } from "../docs/js/engine/shanten.js";
import { discardOptions } from "../docs/js/engine/ukeire.js";
import { scoreHand } from "../docs/js/engine/score.js";
import {
  OSHIHIKI_MODEL, END, prepareOshihiki, prepareTrials, sampleRiichiHand, isRyanmenLike, waitsOf,
  evaluateOshihikiRaw, evaluateOshihiki,
} from "../docs/js/engine/oshihiki.js";

const K = (s) => parseTile(s).kind;
// "123m45p" → ["1m","2m","3m","4p","5p"]
function h(str) {
  const out = [];
  let digits = [];
  for (const ch of str) {
    if (/[0-9]/.test(ch)) digits.push(ch);
    else { for (const d of digits) out.push(d + ch); digits = []; }
  }
  return out;
}

// 基本の局面: 対面が7打目でリーチ（index 6）、9巡目
const base = {
  hand: h("234m67m345p678s11z"), draw: "9p",
  doraIndicator: "3z", turn: 9, draws: 9,
  rivers: {
    self: h("9m1p9s1s8p") .concat(h("27z4z")),
    shimo: h("1m8m2p9p7p").concat(h("36z5z")),
    toimen: h("9p1s2s8m1m").concat(h("4z5z3z")),
    kami: h("8p3m").concat(h("7z4z2z1s6z5z")),
  },
  riichi: { seat: "toimen", index: 6 },
};

// ---------------- サンプラー ----------------
test("sampler: 棄却条件（フリテン・宣言後の通過牌）を守る・テンパイ形・プールを超えない", () => {
  const info = prepareOshihiki(base);
  const cnt = new Array(34).fill(0);
  for (const c of info.unknown) cnt[c >> 1]++;
  const rng = createRng(5);
  let ry = 0;
  for (let i = 0; i < 2000; i++) {
    const { hand, waits } = sampleRiichiHand(cnt, info, rng);
    assert.equal(hand.reduce((a, b) => a + b), 13);
    assert.equal(shanten(hand), 0);
    assert.deepEqual(waits, waitsOf(hand.slice()));
    for (let k = 0; k < 34; k++) assert.ok(hand[k] <= cnt[k], "プールの残り枚数を超えた");
    for (const k of waits) {
      assert.equal(info.riichiRiver[k], 0, `フリテン ${kindToStr(k)}`);
      assert.equal(info.postRiichi[k], 0, `宣言後の通過牌 ${kindToStr(k)}`);
    }
    if (isRyanmenLike(waits)) ry++;
  }
  assert.ok(ry > 1000, `両面系 ${ry}`);
  // nonRyanmenAccept = 0 なら全部両面系
  const rng2 = createRng(6);
  for (let i = 0; i < 300; i++) {
    const { waits } = sampleRiichiHand(cnt, info, rng2, { ...OSHIHIKI_MODEL, nonRyanmenAccept: 0 });
    assert.ok(isRyanmenLike(waits));
  }
});

test("sampler: 宣言の前後の判定（巡と手番の順）", () => {
  const info = prepareOshihiki(base);
  // 対面の宣言は巡6（toimen[6]）。手番は 自家→下家→対面→上家 なので、
  // 宣言後 = 上家[6]=6z、自家[7]=4z、下家[7]=5z、上家[7]=5z。宣言前 = 自家[6]=7z・下家[6]=6z など
  for (const s of ["6z", "4z", "5z"]) assert.equal(info.postRiichi[K(s)], 1, s);
  for (const s of ["7z", "2z", "9m", "8p"]) assert.equal(info.postRiichi[K(s)], 0, s);
});

test("dealIn: 現物・宣言後に通った牌は 0、スジ・壁で下がる", () => {
  const T = prepareTrials(base, prepareOshihiki(base), 4000, 3);
  for (const s of base.rivers.toimen) assert.equal(T.dealIn[K(s)], 0, `現物 ${s}`);
  assert.equal(T.dealIn[K("6z")], 0); // 宣言後に上家が通した
  assert.ok(T.dealIn.every((x) => x >= 0 && x <= 1));
});

test("dealIn: スジ（河の4m → 7m）と壁（8s 4枚見え → 9s）は危険度が下がる", () => {
  const st = {
    hand: h("2345p678p23s99m11z"), draw: "5z", doraIndicator: "8s", turn: 9, draws: 9,
    rivers: {
      self: h("9p1z2z8s8s"), shimo: h("1p3z9s8s5z"), toimen: h("4m6z7z1s4p"), kami: h("1s2p3p6z7z"),
    },
    riichi: { seat: "toimen", index: 4 },
  };
  const T = prepareTrials(st, prepareOshihiki(st), 20000, 9);
  const d = (s) => T.dealIn[K(s)];
  // スジ: 7m（河の 4m のスジ。56m の両面は 4m がフリテンになるので無い）< 3m（6m は河に無い＝無スジ）
  assert.ok(d("7m") < d("3m") - 0.01, `7m ${d("7m")} 3m ${d("3m")}`);
  // 壁: 8s が4枚見え（ドラ表示1・河3）→ 9s は 78s の両面・79s の嵌張で待てない
  assert.ok(d("9s") < d("9p") - 0.005, `9s ${d("9s")} 9p ${d("9p")}`);
});

// ---------------- 素朴な参照実装（キャッシュなし、SPEC §11.4 をそのまま） ----------------
function naive(state, trials, seed, model = OSHIHIKI_MODEL) {
  const info = prepareOshihiki(state);
  const T = prepareTrials(state, info, trials, seed, model);
  const r = info.r;
  const out = {};
  const c14 = info.counts14;
  const waitSet = (c13) => { // テンパイなら待ちの種類
    const w = [];
    for (let k = 0; k < 34; k++) { if (c13[k] >= 4) continue; c13[k]++; if (shanten(c13) === -1) w.push(k); c13[k]--; }
    return w;
  };
  const pts = (who, c13, k, tsumo, aka, ura) => {
    const c = c13.slice(); c[k]++;
    const res = scoreHand({
      counts14: c, winTile: k, tsumo, riichi: true, dealer: who === 0, doraKinds: info.doraKinds,
      akaCount: aka, uraKinds: [ura], seatWind: 27 + who, roundWind: 27,
    });
    return who === 0 ? res.points : (tsumo ? res.payments.dealer : res.points);
  };
  for (let d0 = 0; d0 < 34; d0++) {
    if (c14[d0] === 0) continue;
    const payoff = [], result = [];
    for (let i = 0; i < trials; i++) {
      const W = new Set(); for (let k = 0; k < 34; k++) if (T.waits[i * 34 + k]) W.add(k);
      const rh = Array.from(T.rHand.slice(i * 34, i * 34 + 34));
      const ura = T.ura[i];
      const pool = Array.from(T.pools.slice(i * T.len, (i + 1) * T.len));
      const hand = c14.slice(); hand[d0]--;
      const red = Array.from(info.myRed);
      if (hand[d0] === 0) red[d0] = 0;
      const aka = () => red[4] + red[13] + red[22];
      const vis = Array.from(info.visible);
      const river = Array.from(info.selfRiver);
      const safe = new Array(34).fill(0);
      const danger = (k) => (safe[k] ? 0 : T.dealIn[k]);
      let riichi = false, folded = false, res = END.NONE, p = 0;
      const discard = (k, declare, isRed) => {
        if (W.has(k)) { res = END.DEALIN; p = -pts(r, rh, k, false, T.rRed[i] + isRed, ura) - (riichi ? 1000 : 0); return true; }
        river[k] = 1; safe[k] = 1;
        if (declare) riichi = true;
        return false;
      };
      const canRon = (x) => {
        if (!riichi) return false;
        const w = waitSet(hand);
        return w.includes(x) && !w.some((k) => river[k]);
      };
      const other = (s, j) => {
        const code = pool[j], x = code >> 1;
        vis[x]++;
        if (s === r) {
          if (W.has(x)) { res = END.RTSUMO; p = -pts(r, rh, x, true, T.rRed[i] + (code & 1), ura) - (riichi ? 1000 : 0); return true; }
          safe[x] = 1;
          if (canRon(x)) { res = END.WIN; p = pts(0, hand, x, false, aka() + (code & 1), ura) + 1000; return true; }
          return false;
        }
        for (let q = 1; q <= 3; q++) {
          const t = (s + q) % 4;
          if (t === r && W.has(x)) {
            if (T.otherOk[i * T.len + j]) { res = END.OTHER; p = riichi ? -1000 : 0; return true; }
            return false; // 抱えた: 通過牌にならず、自家のロンも無い
          }
          if (t === 0 && T.ronOk[i * T.len + j] && canRon(x)) { res = END.WIN; p = pts(0, hand, x, false, aka() + (code & 1), ura) + 1000; return true; }
        }
        safe[x] = 1;
        return false;
      };
      let used = 0;
      if (!discard(d0, shanten(hand) === 0, info.myRed[d0] && hand[d0] === 0 ? 1 : 0)) {
        const stop = Math.min(T.len, 3 + 4 * T.endRound[i]);
        for (let s = 1; s <= 3 && used < stop; s++) if (other(s, used++)) break;
        while (res === END.NONE && used < stop) {
          const code = pool[used++], t = code >> 1;
          vis[t]++;
          if (riichi) {
            hand[t]++;
            if (shanten(hand) === -1) { hand[t]--; res = END.WIN; p = pts(0, hand, t, true, aka() + (code & 1), ura) + 1000; break; }
            hand[t]--;
            if (discard(t, false, code & 1)) break;
          } else {
            // SPEC §11.4 の方策を文言どおりに書いたもの（本体とは独立に実装）
            const s13 = shanten(hand); // ツモ前の13枚のシャンテン数
            hand[t]++;
            if (code & 1) red[t] = 1;
            const opts = discardOptions(hand, vis); // 14枚から各種類を1枚切った場合
            let choice = -1, declare = false;
            if (!folded && s13 === 1) {
              const tenpaiOpts = opts.filter((o) => o.shanten === 0);
              if (tenpaiOpts.length > 0) {
                // ツモでテンパイが取れる → 閾値なしでテンパイを取ってリーチ。非フリテン → 待ち枚数 → dealIn 小
                const furi = (o) => { const c = hand.slice(); c[o.kind]--; return waitSet(c).some((k) => river[k] || k === o.kind) ? 1 : 0; };
                tenpaiOpts.sort((a, b) => furi(a) - furi(b) || b.ukeireCount - a.ukeireCount || danger(a.kind) - danger(b.kind) || a.kind - b.kind);
                choice = tenpaiOpts[0].kind;
                declare = true;
              } else {
                // シャンテン数を保つ打牌のうち最も安全なものの dealIn が閾値以下なら押す
                const h13 = hand.slice(); h13[t]--;
                const ukeire13 = (() => { let u = 0; for (let k = 0; k < 34; k++) { if (h13[k] >= 4) continue; h13[k]++; if (shanten(h13) === 0) u += 4 - vis[k]; h13[k]--; } return u; })();
                const th = ukeire13 >= model.goodUkeire ? model.pushThresholdGood : model.pushThresholdBad;
                const keep = opts.filter((o) => o.shanten === 1);
                if (Math.min(...keep.map((o) => danger(o.kind))) <= th) {
                  const ok = keep.filter((o) => danger(o.kind) <= th);
                  ok.sort((a, b) => b.ukeireCount - a.ukeireCount || a.kind - b.kind);
                  choice = ok[0].kind;
                } else folded = true;
              }
            } else folded = true;
            if (choice < 0) {
              // 降り: dealIn 最小（同率は kind 小）
              let bv = 2;
              for (let k = 0; k < 34; k++) if (hand[k] > 0 && danger(k) < bv) { bv = danger(k); choice = k; }
            }
            hand[choice]--;
            let isRed = 0;
            if (hand[choice] === 0) { isRed = red[choice]; red[choice] = 0; }
            if (discard(choice, declare, isRed)) break;
          }
          for (let s = 1; s <= 3 && used < stop; s++) if (other(s, used++)) break;
        }
        if (res === END.NONE) p = riichi ? -1000 : 0;
      }
      payoff.push(p); result.push(res);
    }
    out[d0] = { payoff, result };
  }
  return out;
}

function randomOshiState(rng) {
  // 自家の手: 和了形から 1〜2枚入れ替え（テンパイ〜1シャンテン中心）。河は未知牌から配る
  for (;;) {
    const pool = [];
    for (let k = 0; k < 34; k++) for (let i = 0; i < 4; i++) pool.push(k);
    for (let a = pool.length - 1; a > 0; a--) { const b = Math.floor(rng() * (a + 1)); [pool[a], pool[b]] = [pool[b], pool[a]]; }
    const c = new Array(34).fill(0);
    const take = (k) => { const idx = pool.indexOf(k); if (idx < 0) return false; pool.splice(idx, 1); c[k]++; return true; };
    let ok = true;
    for (let m = 0; m < 4 && ok; m++) {
      const s = Math.floor(rng() * 3), n = Math.floor(rng() * 7), k = s * 9 + n;
      ok = take(k) && take(k + 1) && take(k + 2);
    }
    const pk = Math.floor(rng() * 34);
    ok = ok && take(pk) && take(pk);
    if (!ok) continue;
    const swaps = 1 + Math.floor(rng() * 2);
    const tiles = [];
    for (let k = 0; k < 34; k++) for (let i = 0; i < c[k]; i++) tiles.push(k);
    for (let i = 0; i < swaps; i++) { const j = Math.floor(rng() * tiles.length); pool.push(tiles[j]); tiles[j] = pool.shift(); }
    const cc = new Array(34).fill(0); for (const k of tiles) cc[k]++;
    if (cc.some((x) => x > 4) || shanten(cc) < 0) continue;
    const dora = pool.shift();
    const nR = 6 + Math.floor(rng() * 3);
    const rivers = { self: [], shimo: [], toimen: [], kami: [] };
    for (let j = 0; j < nR; j++) for (const key of ["self", "shimo", "toimen", "kami"]) rivers[key].push(kindToStr(pool.shift()));
    const strs = tiles.map(kindToStr);
    // 手の5を赤にする（赤の扱いも突き合わせる）
    for (const suit of "mps") { const i = strs.indexOf("5" + suit); if (i >= 0 && rng() < 0.7) strs[i] = "0" + suit; }
    const seat = ["shimo", "toimen", "kami"][Math.floor(rng() * 3)];
    return {
      hand: strs.slice(0, 13), draw: strs[13], doraIndicator: kindToStr(dora), turn: nR + 1, draws: 18 - nR - 1,
      rivers, riichi: { seat, index: 3 + Math.floor(rng() * (nR - 4)) },
    };
  }
}

test("simulate: 素朴な参照実装と試行ごとに収支・結果が一致", () => {
  const rng = createRng(4242);
  const states = [base];
  for (let i = 0; i < 4; i++) states.push(randomOshiState(rng));
  const seen = new Set();
  const models = [OSHIHIKI_MODEL, { ...OSHIHIKI_MODEL, pushThresholdGood: 0.15, pushThresholdBad: 0.05 }];
  for (const [si, st] of states.entries()) {
    const model = models[si % 2];
    const fast = evaluateOshihikiRaw(st, { trials: 40, seed: 7, model });
    const ref = naive(st, 40, 7, model);
    for (const c of fast.candidates) {
      const rr = ref[c.kind];
      for (let i = 0; i < 40; i++) {
        assert.equal(c.results[i], rr.result[i], `${st.hand.join("")} cut ${kindToStr(c.kind)} trial ${i} result`);
        assert.equal(c.payoff[i], rr.payoff[i], `${st.hand.join("")} cut ${kindToStr(c.kind)} trial ${i} payoff`);
        seen.add(c.results[i]);
      }
    }
  }
  // 結果の種類を一通り通っていること
  for (const e of [END.NONE, END.WIN, END.DEALIN, END.RTSUMO, END.OTHER]) assert.ok(seen.has(e), `結果 ${e} が出ていない`);
});

test("収支の符号と金額（放銃・リーチ者ツモ・供託・自分のリーチ棒）", () => {
  const raw = evaluateOshihikiRaw(base, { trials: 3000, seed: 1 });
  let n = 0;
  for (const c of raw.candidates) {
    for (let i = 0; i < raw.trials; i++) {
      const p = c.payoff[i];
      switch (c.results[i]) {
        case END.WIN: assert.ok(p >= 1500 + 1000, `和了 ${p}`); n++; break; // 親の最低 1500 ＋ リーチ者の供託
        case END.DEALIN: assert.ok(p <= -1000, `放銃 ${p}`); break;
        case END.RTSUMO: assert.ok(p <= -500, `リーチ者ツモ ${p}`); break;
        case END.OTHER: case END.NONE: assert.ok(p === 0 || p === -1000, `${p}`); break;
      }
    }
  }
  assert.ok(n > 0);
  // テンパイを取る 9p 切り（現物）はリーチ棒を出す: 流局なら −1000 になる試行がある
  const c9 = raw.candidates.find((c) => c.kind === K("9p"));
  assert.ok(Array.from(c9.results).some((r, i) => r === END.NONE && c9.payoff[i] === -1000));
  // ev = 収支の平均
  const j = evaluateOshihiki(base, { trials: 3000, seed: 1 });
  for (const c of raw.candidates) {
    const jj = j.candidates.find((x) => x.tile === kindToStr(c.kind));
    assert.equal(jj.ev, Math.round(c.payoff.reduce((a, b) => a + b, 0) / raw.trials));
  }
});

test("ベタオリ（現物が十分ある2シャンテン以上）は放銃率がほぼ0", () => {
  // 対面の河の牌（現物）を手に多く持つ形
  const st = {
    hand: h("19m19p19s1234z") .concat(["2m", "5p", "8s"]), draw: "6z", doraIndicator: "7z", turn: 9, draws: 9,
    rivers: {
      self: h("3m4p7s8m6s5z2p6m"), shimo: h("7m2s5m3s4s6p7p8p"),
      toimen: h("1m9m1p9p1s9s").concat(h("12z")), kami: h("3p4m3z4z5z6z7z5s"),
    },
    riichi: { seat: "toimen", index: 4 },
  };
  const r = evaluateOshihiki(st, { trials: 4000, seed: 2 });
  assert.equal(r.answerType, "fold");
  const best = r.candidates[0];
  assert.ok(best.lose < 0.01, `lose ${best.lose}`);
  assert.equal(best.dealIn, 0);
});

test("evaluateOshihiki: 同じ seed で同じ結果・候補数・ev 降順", () => {
  const a = evaluateOshihiki(base, { trials: 300, seed: 3 });
  const b = evaluateOshihiki(base, { trials: 300, seed: 3 });
  assert.deepEqual(a, b);
  const kinds = new Set([...base.hand, base.draw].map(K));
  assert.equal(a.candidates.length, kinds.size);
  for (let i = 1; i < a.candidates.length; i++) assert.ok(a.candidates[i - 1].ev >= a.candidates[i].ev);
  for (const c of a.candidates) {
    assert.ok(c.agari >= 0 && c.agari <= 1 && c.lose >= 0 && c.lose <= 1);
    assert.ok(c.lose >= c.dealIn - 0.1); // 局全体の放銃率は即放銃率を（誤差を除き）下回らない
  }
  assert.ok(["push", "fold", "mawashi"].includes(a.answerType));
});

test("answerType の3分類（push / fold / mawashi）", async () => {
  const { candidateType, answerTypeOf } = await import("../docs/js/engine/oshihiki.js");
  const cs = [
    { dealIn: 0.12, shanten: 1 }, // 危険を承知で押す
    { dealIn: 0.005, shanten: 1 }, // 安全で手も保つ → 回し打ち
    { dealIn: 0, shanten: 2 },     // 手を崩す → 降り
  ];
  assert.equal(candidateType(cs[0], cs), "push");
  assert.equal(candidateType(cs[1], cs), "mawashi");
  assert.equal(candidateType(cs[2], cs), "fold");
  assert.equal(answerTypeOf(cs), "push");
  // 優先の fold: best が2シャンテン以上、または和了率 0
  assert.equal(candidateType({ dealIn: 0.2, shanten: 2, agari: 0.1 }, cs), "fold");
  assert.equal(candidateType({ dealIn: 0.2, shanten: 1, agari: 0 }, cs), "fold");
  const { createOshiSelector } = await import("../scripts/generate-oshihiki.mjs");
  const sel = createOshiSelector(10); // push 4・fold 4・mawashi 2
  const mk = (t) => ({ ok: true, stat: { answerType: t, genbutsu: false } });
  for (let i = 0; i < 2; i++) assert.equal(sel.offer(mk("mawashi")), "ok");
  assert.equal(sel.offer(mk("mawashi")), "mawashiQuota");
  for (let i = 0; i < 4; i++) assert.equal(sel.offer(mk("push")), "ok");
  assert.equal(sel.offer(mk("push")), "pushQuota");
});

// 定説チェック（閾値 pushThresholdGood/Bad と otherDealInRate はこの局面群で決めた。SPEC §11.4）
test("定説チェック: 降り・押し・良形/愚形1シャンテン・危険牌の先切り", () => {
  const rivers = {
    self: h("9m7z6z9p1s4z3z5z"), shimo: h("1m8m2p9p7p365z"), toimen: h("9p1s2s8m1m453z"), kami: h("8p3m742z1s65z"),
  };
  const ev = (hand, draw) => {
    const st = { hand: h(hand), draw, doraIndicator: "3z", turn: 9, draws: 9, rivers, riichi: { seat: "toimen", index: 6 } };
    const r = evaluateOshihiki(st, { trials: 6000, seed: 1 });
    return { r, by: Object.fromEntries(r.candidates.map((c) => [c.tile, c])) };
  };
  // 1. 2シャンテン・現物あり → 現物を切って降り
  const c1 = ev("234m57p34s68s99m1m4z", "8m");
  assert.equal(c1.r.answerType, "fold");
  assert.equal(c1.r.candidates[0].dealIn, 0);
  // 2. 良形テンパイ・無スジ → テンパイを取って押す
  const c2 = ev("234m567p345s67s11z", "5m");
  assert.equal(c2.r.answerType, "push");
  assert.equal(c2.r.candidates[0].shanten, 0);
  // 3. 愚形1シャンテン（46p 79s）・浮きは無スジ・現物は面子の中 → 降りが勝つ
  const c3 = ev("123m46p79s456s22z6m", "3s");
  assert.equal(c3.r.best, "1m");
  assert.ok(c3.by["1m"].ev > c3.by["9s"].ev && c3.by["1m"].ev > c3.by["6m"].ev);
  // 4. 良形1シャンテン（23p 67s）・同じ条件 → 無スジを1枚押すのが勝つ
  const c4 = ev("123m23p67s456s22z6m", "3s");
  assert.equal(c4.r.answerType, "push");
  assert.ok(c4.by["6m"].ev > c4.by["1m"].ev);
  // 5. 危険牌の先切りと現物残し: 無スジ中張（6m）の先切りより、現物（1m）を切って 6m を抱える方が良い
  const c5 = ev("789m23p67s456s22z6m", "1m");
  assert.ok(c5.by["1m"].ev > c5.by["6m"].ev);
});

// エンジン（tiles / rng / shanten / ukeire / simulate）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTile, kindToStr, tileToStr, toCounts, sortTiles, tileLabel, doraFromIndicator,
} from "../docs/js/engine/tiles.js";
import { createRng, hashString, shuffleInPlace } from "../docs/js/engine/rng.js";
import { shanten, shantenNormal, shantenChiitoi, shantenKokushi } from "../docs/js/engine/shanten.js";
import { ukeire, discardOptions } from "../docs/js/engine/ukeire.js";
import { evaluate } from "../docs/js/engine/simulate.js";

// "123m456p77z" 形式 → counts
function h(str) {
  const out = [];
  let digits = [];
  for (const ch of str) {
    if (/[0-9]/.test(ch)) digits.push(ch);
    else { for (const d of digits) out.push(d + ch); digits = []; }
  }
  return out;
}
const C = (str) => toCounts(h(str));

// 参照実装（真の定義・和了形の全列挙）は tests/ref-shanten.mjs
import { refShanten, refNormal } from "./ref-shanten.mjs";

// ランダム手牌（偏りあり）
function randomHand(rng, size) {
  const mode = Math.floor(rng() * 6);
  let pool = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < 4; i++) pool.push(k);
  if (mode === 1) { // 一色手（＋字牌少し）
    const s = Math.floor(rng() * 3);
    pool = pool.filter((k) => Math.floor(k / 9) === s || (k >= 27 && rng() < 0.15));
  } else if (mode === 2) { // 字牌多め
    pool = pool.filter((k) => k >= 27 || rng() < 0.3);
  } else if (mode === 3) { // 対子多め: 種類を絞る
    const kinds = new Set();
    while (kinds.size < 8) kinds.add(Math.floor(rng() * 34));
    pool = pool.filter((k) => kinds.has(k));
  } else if (mode === 4) { // 完全な一色（チンイツ）
    const s = Math.floor(rng() * 3);
    pool = pool.filter((k) => Math.floor(k / 9) === s);
  }
  const c = new Array(34).fill(0);
  let n = 0;
  if (mode === 5) { // 4枚持ちを1〜3種類（「4枚使っている牌は待てない」の確認用）
    const s = Math.floor(rng() * 4);
    const kinds = s < 3 ? 9 : 7;
    const q = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < q; i++) {
      const k = s * 9 + Math.floor(rng() * kinds);
      if (c[k] === 0) { c[k] = 4; n += 4; }
    }
    pool = pool.filter((k) => c[k] === 0 && (Math.floor(k / 9) === s || rng() < 0.2));
  }
  shuffleInPlace(pool, rng);
  for (let i = 0; n < size; i++, n++) c[pool[i]]++;
  return c;
}

// ---------------- tiles / rng ----------------
test("tiles: parse / 文字列化 / 並び順 / ラベル", () => {
  assert.deepEqual(parseTile("0p"), { kind: 13, red: true });
  assert.deepEqual(parseTile("1z"), { kind: 27, red: false });
  assert.deepEqual(parseTile("9s"), { kind: 26, red: false });
  assert.throws(() => parseTile("8z"));
  assert.throws(() => parseTile("0z"));
  assert.throws(() => parseTile("5x"));
  assert.equal(kindToStr(13), "5p");
  assert.equal(kindToStr(33), "7z");
  assert.equal(tileToStr({ kind: 22, red: true }), "0s");
  for (let k = 0; k < 34; k++) assert.equal(parseTile(kindToStr(k)).kind, k);
  const counts = toCounts(["0m", "5m", "1z"]);
  assert.equal(counts[4], 2); assert.equal(counts[27], 1);
  assert.deepEqual(sortTiles(["1z", "0p", "5p", "3m", "9s"]), ["3m", "5p", "0p", "9s", "1z"]);
  assert.equal(tileLabel("0p"), "5筒(赤)");
  assert.equal(tileLabel("1z"), "東");
  assert.equal(tileLabel("3m"), "三萬");
  assert.equal(doraFromIndicator("9m"), 0);
  assert.equal(doraFromIndicator("4z"), 27);
  assert.equal(doraFromIndicator("7z"), 31);
});

test("rng: 同じシードで同じ列・範囲・シャッフル", () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(createRng(1)(), createRng(2)());
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  const arr = [...Array(50).keys()];
  const s1 = shuffleInPlace(arr.slice(), createRng(7));
  const s2 = shuffleInPlace(arr.slice(), createRng(7));
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort((x, y) => x - y), arr);
});

// ---------------- shanten ----------------
test("shanten: 真の定義の参照実装とランダム手牌で全件一致（13枚・14枚、七対子・国士込み）", () => {
  const rng = createRng(20261003);
  let n = 0;
  for (const size of [13, 14]) {
    for (let i = 0; i < 3000; i++) {
      const c = randomHand(rng, size);
      const fast = shanten(c), ref = refShanten(c);
      if (fast !== ref) assert.fail(`不一致 size=${size} counts=${c.join("")} engine=${fast} ref=${ref}`);
      const fn = shantenNormal(c), rn = refNormal(c);
      if (fn !== rn) assert.fail(`通常手で不一致 counts=${c.join("")} engine=${fn} ref=${rn}`);
      n++;
    }
  }
  assert.equal(n, 6000);
});

// 一色の全列挙は参照実装が遅い（1手あたり約0.6ms）ので、字牌のみは全列挙、
// 萬子のみは「4枚持ちを含む13枚手」から抽出する（レビューで不一致が出た領域）。
// 萬子・字牌の13/14枚の完全な全列挙（228,410手）は開発時に一度回して不一致0件を確認済み（約2分）
function enumerateSuit(off, n, size, filter, fn) {
  const v = new Array(n).fill(0);
  (function rec(i, left) {
    if (i === n) {
      if (left !== 0) return;
      const c = new Array(34).fill(0);
      for (let k = 0; k < n; k++) c[off + k] = v[k];
      if (filter(c)) fn(c);
      return;
    }
    for (let x = 0; x <= Math.min(4, left); x++) { v[i] = x; rec(i + 1, left - x); }
  })(0, size);
}

test("shanten: 字牌のみの全列挙（13枚・14枚）で参照実装と全件一致", () => {
  let n = 0;
  for (const size of [13, 14]) {
    enumerateSuit(27, 7, size, () => true, (c) => {
      const a = shanten(c), b = refShanten(c);
      if (a !== b) assert.fail(`不一致 ${c.slice(27).join("")} engine=${a} ref=${b}`);
      n++;
    });
  }
  assert.ok(n > 1000, `${n}`);
});

test("shanten: 萬子のみ・4枚持ちを含む13枚手（全列挙から決定的に1/6抽出）で参照実装と全件一致", () => {
  let n = 0, idx = 0;
  enumerateSuit(0, 9, 13, (c) => c.slice(0, 9).some((x) => x === 4) && idx++ % 6 === 0, (c) => {
    const a = shanten(c), b = refShanten(c);
    if (a !== b) assert.fail(`不一致 ${c.slice(0, 9).join("")} engine=${a} ref=${b}`);
    n++;
  });
  assert.ok(n > 5000, `${n}`);
});

test("shanten: 既知ケース", () => {
  // 国士13面待ち
  assert.equal(shantenKokushi(C("19m19p19s1234567z")), 0);
  assert.equal(shanten(C("19m19p19s1234567z")), 0);
  // 国士和了
  assert.equal(shanten(C("19m19p19s11234567z")), -1);
  // 七対子テンパイ
  assert.equal(shantenChiitoi(C("1122m3344p5566s7z")), 0);
  assert.equal(shanten(C("1122m3344p5566s7z")), 0);
  // 七対子和了
  assert.equal(shanten(C("1122m3344p5566s77z")), -1);
  // 4枚持ちを含む七対子: 1111m は1対子扱い → 対子5（1m,2m...）
  // 1111m 22m 33p 44p 55s 6z = 13枚: 対子 1m,2m,3p,4p,5s = 5, 種類 6 → 6-5+1 = 2
  assert.equal(shantenChiitoi(C("111122m3344p55s6z")), 2);
  // 九蓮宝燈（純正）9面待ちテンパイ
  assert.equal(shanten(C("1112345678999m")), 0);
  assert.equal(shanten(C("11112345678999m")), -1);
  // 通常和了
  assert.equal(shanten(C("123m456p789s11122z")), -1);
  // 4枚使っている牌は待てない（レビュー指摘の例）
  assert.equal(shanten(C("666m6666p111z444z")), 1);
  const fake = C("1112344569999s1z");
  assert.equal(shanten(fake), 0); // 14枚: 9s を1枚切れば 4s 単騎のテンパイ
  fake[27]--;
  assert.equal(shanten(fake), 1); // 1z を切った13枚は、9s を4枚使っているので 9s 待ちにならず1シャンテン
  // 一般的な1シャンテン
  assert.equal(shanten(C("123m456p78s99m11z5z")), 1);
  assert.equal(shanten(C("123456m24p3367s1z")), 1);
  // テンパイ（両面）
  assert.equal(shanten(C("123m456p789s23m11z")), 0);
  // バラバラ
  assert.equal(shanten(C("147m258p369s1234z")), 6);
  // 14枚の一般形
  assert.equal(shanten(C("123m456p789s23m115z")), 0);
});

// ---------------- ukeire ----------------
const zeroVis = () => new Array(34).fill(0);
function visOf(str, extra = []) {
  const v = C(str);
  for (const k of extra) v[k]++;
  return v;
}

test("ukeire: 基本の待ち", () => {
  // 23m の両面（シャンテン数は13/14枚が前提なので、23m 以外を完成させた13枚で確認）:
  // 456m 456p 789s 11z + 23m → 1m,4m（4m は手に1枚あるので残り3）
  const hu = "23456m456p789s11z";
  const u = ukeire(C(hu), visOf(hu));
  assert.deepEqual(u.tiles.map(kindToStr), ["1m", "4m", "7m"]);
  assert.equal(u.count, 4 + 3 + 4);
  // 両面テンパイ: 123m456p789s23m11z → 1m(残り3), 4m(残り4)
  const hand = "123m456p789s23m11z";
  const u2 = ukeire(C(hand), visOf(hand));
  assert.equal(u2.shanten, 0);
  assert.deepEqual(u2.tiles.map(kindToStr), ["1m", "4m"]);
  assert.equal(u2.count, 3 + 4);
  // ドラ表示牌が4m なら 4m の残りが1減る
  const u3 = ukeire(C(hand), visOf(hand, [3]));
  assert.equal(u3.count, 3 + 3);
  // 九蓮宝燈 9面待ち: 手に 1m*3, 2-8m*1, 9m*3 → 1m:1, 2-8m:3*7, 9m:1 = 23
  const ch = "1112345678999m";
  const u4 = ukeire(C(ch), visOf(ch));
  assert.equal(u4.tiles.length, 9);
  assert.equal(u4.count, 1 + 21 + 1);
  // 国士13面待ち: 各3枚残り → 39
  const ks = "19m19p19s1234567z";
  const u5 = ukeire(C(ks), visOf(ks));
  assert.equal(u5.tiles.length, 13);
  assert.equal(u5.count, 39);
  // 単騎: 123m456p789s123s5z → 5z 残り3
  const tk = "123m456p789s123s5z";
  const u6 = ukeire(C(tk), visOf(tk));
  assert.deepEqual(u6.tiles.map(kindToStr), ["5z"]);
  assert.equal(u6.count, 3);
  // 残り0枚の種類は含めない: 単騎の牌が全部見えている
  const v7 = visOf(tk); v7[31] = 4;
  assert.deepEqual(ukeire(C(tk), v7).tiles, []);
});

test("discardOptions: 種類ごとに1件", () => {
  const hand = "123m456p789s23m115z";
  const opts = discardOptions(C(hand), visOf(hand));
  assert.equal(opts.length, 11);
  const o5z = opts.find((o) => kindToStr(o.kind) === "5z");
  assert.equal(o5z.shanten, 0);
  assert.equal(o5z.ukeireCount, 7);
});

// ---------------- simulate ----------------
import { evaluateRaw, prepareState, buildPools, buildEvents, endHazard, DEFAULT_MODEL } from "../docs/js/engine/simulate.js";
// 打ち切りなし・全打牌ロン可（v1 相当）。理論値との比較用
const NO_END = { hazardStart: 99, hazardSlope: 0, hazardMax: 0, ronRate: 1 };

const prob = {
  hand: ["2m", "3m", "4m", "0p", "6p", "7p", "3s", "4s", "8s", "8s", "1z", "1z", "6z"],
  draw: "5s", doraIndicator: "9p", turn: 6, draws: 12,
  rivers: { self: ["9m", "2z", "1p", "7z", "9s"], shimo: ["1m", "3z", "8m", "6s", "2p"], toimen: ["4z", "9p", "1s", "5z", "3z"], kami: ["7z", "4z", "8p", "2z", "1s"] },
};

test("simulate: 同じ seed で同じ結果・候補数・agari ≤ tenpai・furiten の型", () => {
  const a = evaluate(prob, { trials: 400, seed: 99 });
  const b = evaluate(prob, { trials: 400, seed: 99 });
  assert.deepEqual(a, b);
  const kinds = new Set([...prob.hand, prob.draw].map((s) => parseTile(s).kind));
  assert.equal(a.candidates.length, kinds.size);
  for (const c of a.candidates) {
    assert.ok(c.agari <= c.tenpai, `${c.tile}`);
    assert.ok(c.agari >= 0 && c.tenpai <= 1);
    assert.equal(typeof c.furiten, "boolean");
  }
  for (let i = 1; i < a.candidates.length; i++) assert.ok(a.candidates[i - 1].agari >= a.candidates[i].agari);
  assert.equal(a.best, a.candidates[0].tile);
  assert.ok(a.candidates.some((c) => c.tile === "5p"));
  assert.ok(!a.candidates.some((c) => c.tile.startsWith("0")));
});

const EMPTY_RIVERS = { self: [], shimo: [], toimen: [], kami: [] };
// 14枚: 123m 2345m 456p 789s + 7z。7z 切りは 2m・5m のノベタン、5m 切りは 7z 単騎
const nobetan = {
  hand: ["1m", "2m", "3m", "2m", "3m", "4m", "5m", "4p", "5p", "6p", "7s", "8s", "9s"],
  draw: "7z", doraIndicator: "1z", turn: 5, draws: 13,
};

test("simulate: 多面待ちは単騎より和了率が高い・テンパイ維持は tenpai=1", () => {
  const r = evaluate({ ...nobetan, rivers: EMPTY_RIVERS }, { trials: 2000, seed: 5 });
  const byTile = Object.fromEntries(r.candidates.map((c) => [c.tile, c]));
  assert.equal(byTile["7z"].shanten, 0);
  assert.equal(byTile["7z"].tenpai, 1);
  assert.equal(byTile["7z"].furiten, false);
  assert.ok(byTile["7z"].agari > byTile["5m"].agari, `7z ${byTile["7z"].agari} 5m ${byTile["5m"].agari}`);
  assert.equal(r.best, "7z");
});

test("simulate: 自分の河に待ちがあると furiten=true になり、和了率が下がる", () => {
  const ok = evaluate({ ...nobetan, draws: 10, rivers: { ...EMPTY_RIVERS, self: ["9p"] } }, { trials: 3000, seed: 8 });
  const fu = evaluate({ ...nobetan, draws: 10, rivers: { ...EMPTY_RIVERS, self: ["5m"] } }, { trials: 3000, seed: 8 });
  const a = ok.candidates.find((c) => c.tile === "7z"), b = fu.candidates.find((c) => c.tile === "7z");
  assert.equal(a.furiten, false);
  assert.equal(b.furiten, true);
  assert.ok(b.agari < a.agari, `${b.agari} < ${a.agari}`);
  // 5m 切りは 7z 単騎。河の 5m は待ちでないのでフリテンではない
  assert.equal(fu.candidates.find((x) => x.tile === "5m").furiten, false);
  // テンパイでない候補は false
  assert.equal(ok.candidates.find((x) => x.tile === "1m").furiten, false);
});

test("simulate: 切った牌が待ちに含まれるとフリテン", () => {
  // 23456m + 456p 789s 11z + 7m ツモ: 7m を切ると 23456m の 1-4-7m 待ちで、7m は自分の河 → フリテン
  const p = {
    hand: ["2m", "3m", "4m", "5m", "6m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z"],
    draw: "7m", doraIndicator: "3z", turn: 4, draws: 8, rivers: EMPTY_RIVERS,
  };
  const r = evaluate(p, { trials: 200, seed: 1 });
  const c7 = r.candidates.find((c) => c.tile === "7m");
  assert.equal(c7.shanten, 0);
  assert.equal(c7.furiten, true);
  // 1z を切ると 234m 567m の 1z 単騎。切った 1z が待ちなのでこれもフリテン
  assert.equal(r.candidates.find((c) => c.tile === "1z").furiten, true);
  // 4p を切ると 56p の 4p-7p 待ちで、切った 4p が待ち → フリテン
  assert.equal(r.candidates.find((c) => c.tile === "4p").furiten, true);
  // この形はどれを切ってテンパイにしても切った牌が待ちに入る（2m 切り → 2m-5m-8m 待ち など）
  for (const c of r.candidates) if (c.shanten === 0) assert.equal(c.furiten, true, c.tile);
  for (const c of r.candidates) if (c.shanten > 0) assert.equal(c.furiten, false, c.tile);
});

test("simulate: プールの長さ = 136 − 15 − 河の枚数", () => {
  const { visible } = prepareState(prob);
  const rv = Object.values(prob.rivers).reduce((s, r) => s + r.length, 0);
  const { len } = buildPools(visible, 100, 2, 1);
  assert.equal(len, 136 - 15 - rv);
  const { len: len2 } = buildPools(visible, 3, 2, 1);
  assert.equal(len2, 15); // 先頭の他家3枚 ＋ 1巡（自家ツモ＋他家3枚）× 3
  assert.throws(() => prepareState({ ...prob, rivers: { ...EMPTY_RIVERS, self: ["1z", "1z", "1z"] } }));
});

test("simulate: draws=1 の理論値（国士13面: 他家3枚 → 自家ツモ → 他家3枚。ロン込み／フリテンならツモのみ）", () => {
  const hand = ["1m", "9m", "1p", "9p", "1s", "9s", "1z", "2z", "3z", "4z", "5z", "6z", "7z"];
  const trials = 40000;
  const C2 = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
  // プール N 枚・待ち W 枚。自家ツモ（4枚目）が外れ、他家6枚のうち w 枚が待ちである確率
  const pMiss = (N, W, w) => ((N - W) / N) * C2(W, w) * C2(N - 1 - W, 6 - w) / C2(N - 1, 6);
  // P(和了) = 1 − Σ_w pMiss(w) × (1 − ronRate)^w
  const theory = (N, W, rr) => 1 - [0, 1, 2, 3, 4, 5, 6].reduce((s, w) => s + pMiss(N, W, w) * Math.pow(1 - rr, w), 0);
  const run = (rivers, model) => {
    const r = evaluateRaw({ hand, draw: "5m", doraIndicator: "5p", turn: 17, draws: 1, rivers }, { trials, seed: 11, model });
    return r.candidates.find((c) => c.kind === 4);
  };
  const near = (c, th) => {
    const a = c.agariN / trials;
    assert.ok(Math.abs(a - th) < 4 * Math.sqrt(th * (1 - th) / trials), `${a} vs ${th}`);
  };
  // 非フリテン・全打牌ロン可: 7枚のどれかが待ち。プール 121 枚、待ち 39 枚
  const c1 = run(EMPTY_RIVERS, NO_END);
  assert.equal(c1.furiten, false);
  near(c1, theory(121, 39, 1));
  // フリテン（自分の河に 1m）: 自家ツモ1枚だけ。プール 120 枚、待ち 38 枚
  const c2 = run({ ...EMPTY_RIVERS, self: ["1m"] }, NO_END);
  assert.equal(c2.furiten, true);
  near(c2, 38 / 120);
  // ronRate = 0 ならツモ分だけ
  near(run(EMPTY_RIVERS, { ...NO_END, ronRate: 0 }), 39 / 121);
  // ronRate = 0.4
  near(run(EMPTY_RIVERS, { ...NO_END, ronRate: 0.4 }), theory(121, 39, 0.4));
  // 打ち切りで自家ツモまで行かなくても、先頭の他家3枚のロンはある（ronRate 1・必ず打ち切り）
  const always = { hazardStart: 0, hazardSlope: 1, hazardMax: 1, ronRate: 1 };
  const c5 = run(EMPTY_RIVERS, always);
  near(c5, 1 - (82 * 81 * 80) / (121 * 120 * 119));
});

test("simulate: 局の打ち切り（endHazard）", () => {
  assert.equal(endHazard(5, DEFAULT_MODEL), 0);
  assert.ok(endHazard(10, DEFAULT_MODEL) > endHazard(7, DEFAULT_MODEL));
  assert.ok(endHazard(18, DEFAULT_MODEL) <= DEFAULT_MODEL.hazardMax);
  // 巡目に関係なく必ず打ち切り・ロンなし → 和了 0、テンパイ率は開始時点のテンパイだけ
  const always = { hazardStart: 0, hazardSlope: 1, hazardMax: 1, ronRate: 0 };
  const r = evaluate({ ...nobetan, rivers: EMPTY_RIVERS }, { trials: 300, seed: 2, model: always });
  for (const c of r.candidates) {
    assert.equal(c.agari, 0);
    assert.equal(c.tenpai, c.shanten === 0 ? 1 : 0);
  }
  // 打ち切り巡の分布: 1巡ごとのハザード h で、最初の巡で終わる割合 ≈ h
  const m = { hazardStart: 0, hazardSlope: 0, hazardMax: 0, ronRate: 0.5 };
  const h = 0.3;
  const { endRound, ronOk } = buildEvents(20000, 40, 5, 9, { ...m, hazardSlope: h, hazardMax: h });
  const first = endRound.filter((x) => x === 0).length / 20000;
  assert.ok(Math.abs(first - h) < 0.02, `${first}`);
  // ロン可否は他家の位置（先頭3枚と、各巡の2〜4枚目）だけに立ち、割合 ≈ ronRate
  let on = 0, tot = 0;
  for (let j = 0; j < ronOk.length; j++) {
    const self = (j % 40) >= 3 && ((j % 40) - 3) % 4 === 0;
    if (self) assert.equal(ronOk[j], 0); else { tot++; on += ronOk[j]; }
  }
  assert.ok(Math.abs(on / tot - 0.5) < 0.01);
  // 同じ seed なら同じ
  assert.deepEqual(buildEvents(50, 40, 5, 9).endRound, buildEvents(50, 40, 5, 9).endRound);
});

test("simulate: seed が違えば結果も（通常は）変わる", () => {
  const a = evaluate(prob, { trials: 300, seed: 1 });
  const b = evaluate(prob, { trials: 300, seed: 2 });
  assert.notDeepEqual(a.candidates.map((c) => c.agari), b.candidates.map((c) => c.agari));
});

// ---- キャッシュなしの素朴な実装（SPEC §5 をそのまま書いたもの） ----
function waitsOf(h13) {
  const w = [];
  for (let k = 0; k < 34; k++) {
    if (h13[k] >= 4) continue;
    h13[k]++;
    if (shanten(h13) === -1) w.push(k);
    h13[k]--;
  }
  return w;
}
// 手 h14 から d を切ったときのフリテン（待ちが河にある、または d 自身が待ち）
function furitenAfter(h14, d, river) {
  h14[d]--;
  const w = waitsOf(h14);
  h14[d]++;
  return w.some((k) => river[k] || k === d);
}
function naiveSimulate(p, trials, seed, log, model = DEFAULT_MODEL) {
  const { counts14, visible, selfRiver } = prepareState(p);
  const { pools, len } = buildPools(visible, p.draws, trials, seed);
  const { endRound, ronOk } = buildEvents(trials, len, p.turn, seed, model);
  const out = {};
  for (let d0 = 0; d0 < 34; d0++) {
    if (counts14[d0] === 0) continue;
    let agari = 0, tenpai = 0;
    for (let i = 0; i < trials; i++) {
      const hand = counts14.slice(); hand[d0]--;
      const vis = visible.slice();
      const river = Array.from(selfRiver); river[d0] = 1;
      let s = shanten(hand), tp = s <= 0, ag = false;
      let used = 0;
      const stop = Math.min(len, 3 + 4 * endRound[i]);
      const othersDiscard = () => { // 他家3人の打牌。ロンなら true
        for (let q = 0; q < 3 && used < stop; q++) {
          const x = pools[i * len + used++];
          vis[x]++;
          if (s === 0 && ronOk[i * len + used - 1]) {
            const w = waitsOf(hand);
            if (w.includes(x)) {
              if (w.some((k) => river[k])) { if (log) log.furitenMiss++; }
              else { if (log) log.ron++; return true; }
            }
          }
        }
        return false;
      };
      ag = othersDiscard(); // 出題局面で切った直後
      while (used < stop && !ag) {
        const t = pools[i * len + used++];
        vis[t]++; hand[t]++;
        if (shanten(hand) === -1) { ag = true; break; } // ツモ和了
        const opts = discardOptions(hand, vis);
        const lower = opts.filter((o) => o.shanten < s);
        let d = t;
        if (lower.length > 0) {
          let best = null, bf = true;
          for (const o of lower) {
            const f = o.shanten === 0 ? furitenAfter(hand, o.kind, river) : false;
            if (best === null || (bf && !f) || (bf === f && o.ukeireCount > best.ukeireCount)) { best = o; bf = f; }
          }
          d = best.kind;
        } else if (s === 0) {
          // 待ち替え: ツモ切りより真に良い（非フリテン優先 → 待ち枚数）なら替える
          let bf = furitenAfter(hand, t, river);
          let bu = opts.find((o) => o.kind === t).ukeireCount;
          for (const o of opts) {
            if (o.kind === t || o.shanten !== 0) continue;
            const f = furitenAfter(hand, o.kind, river);
            if ((bf && !f) || (bf === f && o.ukeireCount > bu)) { d = o.kind; bf = f; bu = o.ukeireCount; }
          }
          if (log && d !== t) log.swap++;
        }
        hand[d]--; river[d] = 1;
        s = shanten(hand);
        if (s <= 0) tp = true;
        ag = othersDiscard();
      }
      if (ag) agari++;
      if (tp) tenpai++;
    }
    out[kindToStr(d0)] = { agari, tenpai };
  }
  return out;
}

// テンパイ前後の局面: 和了形から2枚を入れ替え、4家の河を配る。自分の河には外した牌（待ちになりやすい）を入れやすくする
function randomNearTenpai(rng) {
  for (;;) {
    const c = new Array(34).fill(0);
    const melds = [];
    for (let m = 0; m < 4; m++) {
      if (rng() < 0.6) { const s = Math.floor(rng() * 3), n = Math.floor(rng() * 7); melds.push([s * 9 + n, s * 9 + n + 1, s * 9 + n + 2]); }
      else { const k = Math.floor(rng() * 34); melds.push([k, k, k]); }
    }
    const pk = Math.floor(rng() * 34);
    melds.push([pk, pk]);
    for (const m of melds) for (const k of m) c[k]++;
    if (c.some((x) => x > 4)) continue;
    const tiles = [];
    for (let k = 0; k < 34; k++) for (let i = 0; i < c[k]; i++) tiles.push(k);
    shuffleInPlace(tiles, rng);
    const removed = tiles.splice(0, rng() < 0.5 ? 1 : 2);
    const rest = [];
    for (let k = 0; k < 34; k++) for (let i = c[k]; i < 4; i++) rest.push(k);
    for (const k of removed) rest.push(k);
    shuffleInPlace(rest, rng);
    while (tiles.length < 14) tiles.push(rest.pop());
    const cnt = new Array(34).fill(0);
    for (const k of tiles) cnt[k]++;
    if (cnt.some((x) => x > 4) || shanten(cnt) === -1) continue;
    const dora = rest.pop();
    const seen = cnt.slice(); seen[dora]++;
    const take = (pref) => {
      if (pref !== undefined && seen[pref] < 4 && rng() < 0.5) { seen[pref]++; return pref; }
      for (;;) { const k = rest.pop(); if (seen[k] < 4) { seen[k]++; return k; } }
    };
    const rv = { self: [], shimo: [], toimen: [], kami: [] };
    const nRiver = 3 + Math.floor(rng() * 6);
    for (let r = 0; r < nRiver; r++) {
      rv.self.push(kindToStr(take(removed[r % removed.length])));
      rv.shimo.push(kindToStr(take())); rv.toimen.push(kindToStr(take())); rv.kami.push(kindToStr(take()));
    }
    const strs = tiles.map(kindToStr);
    return { hand: strs.slice(0, 13), draw: strs[13], doraIndicator: kindToStr(dora), turn: nRiver + 1, draws: 18 - nRiver - 1, rivers: rv };
  }
}

test("simulate: キャッシュなしの素朴な実装と試行ごとに一致（河・フリテン・待ち替え・ロンを含む）", () => {
  const rng = createRng(777);
  const ps = [prob];
  for (let n = 0; n < 6; n++) ps.push(randomNearTenpai(rng));
  const log = { swap: 0, ron: 0, furitenMiss: 0 };
  let furitenCand = 0;
  const models = [DEFAULT_MODEL, NO_END, { hazardStart: 1, hazardSlope: 0.05, hazardMax: 0.5, ronRate: 0.6 }];
  for (const [pi, p] of ps.entries()) {
    const model = models[pi % models.length];
    const raw = evaluateRaw(p, { trials: 20, seed: 3, model });
    const ref = naiveSimulate(p, 20, 3, log, model);
    for (const c of raw.candidates) {
      const r = ref[kindToStr(c.kind)];
      const where = `${p.hand.join("")}+${p.draw} 河${p.rivers.self.join("")} cut ${kindToStr(c.kind)}`;
      assert.equal(c.agariN, r.agari, `${where} agari`);
      assert.equal(c.tenpaiN, r.tenpai, `${where} tenpai`);
      if (c.furiten) furitenCand++;
    }
  }
  // 局面が待ち替え・ロン・フリテンでのロン見送りの各経路を実際に通っていること
  assert.ok(log.swap > 0, JSON.stringify(log));
  assert.ok(log.ron > 0, JSON.stringify(log));
  assert.ok(log.furitenMiss > 0, JSON.stringify(log));
  assert.ok(furitenCand > 0, "出題時フリテンの候補が無い");
});

// ---------------- 生成スクリプトの選別ロジック ----------------
import { isIsolated, turnQuotas, createSelector } from "../scripts/generate.mjs";

test("generate: 孤立牌の判定", () => {
  const c = C("1m4m7m19p5s99s123z");
  assert.ok(isIsolated(c, 0));             // 1m: 2m,3m なし
  assert.ok(isIsolated(c, 3));             // 4m: 2,3,5,6m なし
  assert.ok(isIsolated(c, parseTile("5s").kind));
  assert.ok(!isIsolated(c, parseTile("9s").kind)); // 2枚
  assert.ok(isIsolated(c, 27));            // 東1枚
  const d = C("13m9p1s");
  assert.ok(!isIsolated(d, 0));            // 1m は 3m と嵌張
  assert.ok(isIsolated(d, 17));            // 9p（1s は別スート）
  assert.ok(isIsolated(d, 18));
});

test("generate: 巡目の枠と易問の上限（採用順で決定的）", () => {
  const q = turnQuotas(60);
  assert.deepEqual(Object.values(q), [7, 7, 7, 7, 7, 7, 6, 6, 6]);
  assert.equal(Object.values(turnQuotas(1500)).reduce((a, b) => a + b), 1500);
  const sel = createSelector(20, 0.1); // 易問は2問まで、巡目枠は 3,3,2,...
  const mk = (turn, isolated) => ({ ok: true, problem: { turn }, stat: { isolated } });
  assert.equal(sel.offer({ ok: false, reason: "qHigh" }), "qHigh");
  assert.equal(sel.offer(mk(3, true)), "ok");
  assert.equal(sel.offer(mk(3, true)), "ok");
  assert.equal(sel.offer(mk(4, true)), "easyQuota");
  assert.equal(sel.offer(mk(3, false)), "ok");
  assert.equal(sel.offer(mk(3, false)), "turnQuota");
  assert.deepEqual(sel.fullTurns(), [3]);
  assert.equal(sel.total, 3);
});

test("generate: ツモ切り best の上限（15%）", () => {
  const sel = createSelector(20); // 孤立牌 2問・ツモ切り 3問まで
  const mk = (turn, tsumogiri) => ({ ok: true, problem: { turn }, stat: { isolated: false, tsumogiri } });
  for (let i = 0; i < 3; i++) assert.equal(sel.offer(mk(3 + i, true)), "ok");
  assert.equal(sel.offer(mk(6, true)), "tsumogiriQuota");
  assert.equal(sel.offer(mk(6, false)), "ok");
});

// 和了点の計算（score.js / SPEC.md §11.6）のテスト
// 既定: 子は南家（seatWind 28）、場風は東（27）。親は東家（seatWind 27）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreHand, calcPoints } from "../docs/js/engine/score.js";
import { toCounts, parseTile } from "../docs/js/engine/tiles.js";

// "123m456p77z" 形式 → counts
function h(str) {
  const out = [];
  let digits = [];
  for (const ch of str) {
    if (/[0-9]/.test(ch)) digits.push(ch);
    else { for (const d of digits) out.push(d + ch); digits = []; }
  }
  return toCounts(out);
}
const K = (s) => parseTile(s).kind;

function score(hand, win, opts = {}) {
  return scoreHand({
    counts14: h(hand), winTile: win, tsumo: false, riichi: false, dealer: false,
    doraKinds: [], akaCount: 0, uraKinds: [],
    seatWind: opts.dealer ? 27 : 28, roundWind: 27, ...opts,
  });
}

// ---------- 点数表（標準の早見表と照合） ----------
test("点数表: 子のロン", () => {
  assert.equal(calcPoints(1, 30, false, false).points, 1000);  // 30符1翻 240×4=960→1000
  assert.equal(calcPoints(4, 30, false, false).points, 7700);  // 30符4翻 1920×4=7680→7700（切り上げ満貫なし）
  assert.equal(calcPoints(2, 25, false, false).points, 1600);  // 25符2翻 400×4
  assert.equal(calcPoints(4, 25, false, false).points, 6400);  // 25符4翻 1600×4
  assert.equal(calcPoints(2, 40, false, false).points, 2600);  // 40符2翻 640×4=2560→2600
  assert.equal(calcPoints(2, 70, false, false).points, 4500);  // 70符2翻 1120×4=4480→4500
  assert.equal(calcPoints(1, 110, false, false).points, 3600); // 110符1翻 880×4=3520→3600
  assert.equal(calcPoints(3, 60, false, false).points, 7700);  // 60符3翻 1920×4=7680→7700
  assert.equal(calcPoints(3, 70, false, false).points, 8000);  // 70符3翻 2240>2000 → 満貫
  assert.equal(calcPoints(4, 40, false, false).points, 8000);  // 40符4翻 2560>2000 → 満貫
});

test("点数表: 親のロン", () => {
  assert.equal(calcPoints(3, 40, true, false).points, 7700);   // 40符3翻 1280×6=7680→7700
  assert.equal(calcPoints(2, 30, true, false).points, 2900);   // 30符2翻 480×6=2880→2900
  assert.equal(calcPoints(4, 30, true, false).points, 11600);  // 30符4翻 1920×6=11520→11600
  assert.equal(calcPoints(1, 30, true, false).points, 1500);   // 30符1翻 240×6=1440→1500
});

test("点数表: ツモの支払い内訳", () => {
  // 親20符2翻ツモ: 基本320 ×2=640→700オール
  assert.deepEqual(calcPoints(2, 20, true, true), { points: 2100, payments: { each: 700 }, limit: "" });
  // 子30符1翻ツモ: 基本240 → 親500・子300
  assert.deepEqual(calcPoints(1, 30, false, true).payments, { dealer: 500, nonDealer: 300 });
  // 子40符1翻ツモ: 基本320 → 親700・子400、合計1500
  assert.equal(calcPoints(1, 40, false, true).points, 1500);
  // 子30符3翻ツモ: 基本960 → 親2000・子1000
  assert.deepEqual(calcPoints(3, 30, false, true).payments, { dealer: 2000, nonDealer: 1000 });
});

test("点数表: 満貫以上", () => {
  assert.equal(calcPoints(5, 30, false, false).points, 8000);
  assert.equal(calcPoints(5, 30, true, false).points, 12000);
  assert.equal(calcPoints(6, 30, false, false).points, 12000);    // 跳満
  assert.equal(calcPoints(7, 30, true, false).points, 18000);
  assert.equal(calcPoints(8, 30, false, false).points, 16000);    // 倍満
  assert.equal(calcPoints(10, 30, true, false).points, 24000);
  assert.equal(calcPoints(11, 30, false, false).points, 24000);   // 三倍満
  assert.equal(calcPoints(13, 30, false, false).points, 24000);   // 数え役満なし → 三倍満止まり
  assert.equal(calcPoints(13, 0, false, false, true).points, 32000); // 役満
  assert.equal(calcPoints(13, 0, true, false, true).points, 48000);
  assert.deepEqual(calcPoints(5, 30, false, true).payments, { dealer: 4000, nonDealer: 2000 });
  assert.deepEqual(calcPoints(5, 30, true, true).payments, { each: 4000 });
});

// ---------- 平和・符 ----------
// 123m 789m 234p 567s 99p、56s 待ち（両面）で 7s
const PINFU = "123789m23499p567s";

test("平和ツモは20符（子 400/700）", () => {
  const r = score(PINFU, "7s", { tsumo: true });
  assert.equal(r.fu, 20);
  assert.equal(r.han, 2); // 門前清自摸和+平和
  assert.deepEqual(r.yaku.sort(), ["平和", "門前清自摸和"].sort());
  assert.equal(r.points, 1500);
  assert.deepEqual(r.payments, { dealer: 700, nonDealer: 400 });
});

test("平和ツモ（親）は700オール", () => {
  const r = score(PINFU, "7s", { tsumo: true, dealer: true });
  assert.equal(r.points, 2100);
  assert.deepEqual(r.payments, { each: 700 });
});

test("平和ロンは30符1翻（子1000・親1500）", () => {
  const r = score(PINFU, "7s");
  assert.equal(r.fu, 30);
  assert.deepEqual(r.yaku, ["平和"]);
  assert.equal(r.points, 1000);
  assert.equal(r.payments, null);
  assert.equal(score(PINFU, "7s", { dealer: true }).points, 1500);
});

test("嵌張は+2符: 立直のみ 20+10+2=32→40符 1300", () => {
  // 57s 待ちで 6s
  const r = score("123789m23499p567s", "6s", { riichi: true });
  assert.equal(r.fu, 40);
  assert.deepEqual(r.yaku, ["立直"]);
  assert.equal(r.points, 1300);
});

test("単騎は+2符: 20+10+2=32→40符", () => {
  const r = score("123m456p789s234s55m", "5m", { riichi: true });
  assert.equal(r.fu, 40);
  assert.equal(r.points, 1300);
});

test("シャンポンのロンは明刻: 断幺九+立直 20+10+明刻中張2=32→40符 2600", () => {
  // 234m 678m 345p 22p 88s、22p/88s のシャンポンで 8s ロン
  const r = score("234678m22345p888s", "8s", { riichi: true });
  assert.equal(r.fu, 40);
  assert.equal(r.han, 2);
  assert.equal(r.points, 2600);
});

test("同じ手をツモれば暗刻: 20+2+暗刻中張4=26→30符 3翻 1000/2000", () => {
  const r = score("234678m22345p888s", "8s", { riichi: true, tsumo: true });
  assert.equal(r.fu, 30);
  assert.equal(r.han, 3);
  assert.equal(r.points, 4000);
  assert.deepEqual(r.payments, { dealer: 2000, nonDealer: 1000 });
});

test("連風牌の雀頭は+4符（親・東場の東）、ただの場風は+2符", () => {
  // 111m(暗刻么九8) 456p 678s 234s 11z。6p ロン（456p の両面）
  // 親: 20+10+8+4=42→50符 立直1翻 → 400×6=2400
  const d = score("111m456p234678s11z", "6p", { riichi: true, dealer: true });
  assert.equal(d.fu, 50);
  assert.equal(d.points, 2400);
  // 子（南家）: 東は場風のみ +2 → 40符 1300
  const c = score("111m456p234678s11z", "6p", { riichi: true });
  assert.equal(c.fu, 40);
  assert.equal(c.points, 1300);
});

// ---------- 役 ----------
test("役牌 白: 暗刻么九8 → 20+10+8=38→40符 1300", () => {
  const r = score("123m456p789s22p555z", "6p");
  assert.deepEqual(r.yaku, ["役牌 白"]);
  assert.equal(r.fu, 40);
  assert.equal(r.points, 1300);
});

test("ダブ東（親・東場の東刻子）は2翻", () => {
  const r = score("123m456p789s22p111z", "6p", { dealer: true });
  assert.equal(r.han, 2);
  assert.deepEqual(r.yaku.sort(), ["場風 東", "自風 東"].sort());
  // 20+10+8=38→40符2翻 640×6=3840→3900
  assert.equal(r.points, 3900);
});

test("高目安目: 一気通貫（9m で 4翻 7700 / 6m で 2翻 2000）", () => {
  // 123m 456m 78m 234p 55s、78m の両面
  const hi = score("123456789m234p55s", "9m", { riichi: true });
  assert.deepEqual(hi.yaku.sort(), ["一気通貫", "平和", "立直"].sort());
  assert.equal(hi.points, 7700); // 30符4翻
  const lo = score("123456678m234p55s", "6m", { riichi: true });
  assert.equal(lo.han, 2);
  assert.equal(lo.points, 2000); // 30符2翻
});

test("高目安目: 三色同順（4s で 断幺九+平和+三色 7700 / 1s で 平和のみ 1000）", () => {
  const hi = score("234m23455p234678s", "4s");
  assert.deepEqual(hi.yaku.sort(), ["三色同順", "平和", "断幺九"].sort());
  assert.equal(hi.points, 7700);
  const lo = score("234m23455p123678s", "1s");
  assert.deepEqual(lo.yaku, ["平和"]);
  assert.equal(lo.points, 1000);
});

test("七対子は25符（立直で 3翻 3200、ダマで 2翻 1600）", () => {
  const r = score("114477m2255p88s33z", "3z", { riichi: true });
  assert.equal(r.fu, 25);
  assert.deepEqual(r.yaku.sort(), ["七対子", "立直"].sort());
  assert.equal(r.points, 3200);
  assert.equal(score("114477m2255p88s33z", "3z").points, 1600);
});

test("七対子ツモ: 25符3翻 子 800/1600", () => {
  const r = score("114477m2255p88s33z", "3z", { tsumo: true });
  assert.deepEqual(r.payments, { dealer: 1600, nonDealer: 800 });
});

test("一盃口形は七対子と比べて高い方（4m 両面なら一般形、8s 単騎なら七対子）", () => {
  const r = score("223344m556677p88s", "4m", { riichi: true });
  assert.ok(r.yaku.includes("一盃口") && r.yaku.includes("平和"));
  assert.equal(r.points, 7700);
  // 8s 単騎なら 一般形（平和なし）立直断幺一盃口 40符3翻 5200 < 七対子 立直断幺七対 25符4翻 6400
  const t = score("223344m556677p88s", "8s", { riichi: true });
  assert.equal(t.fu, 25);
  assert.ok(t.yaku.includes("七対子"));
  assert.equal(t.points, 6400);
});

test("混全帯么九: 暗刻999s8+中雀頭2+辺張2 → 20+10+12=42→50符2翻 3200", () => {
  const r = score("123m789p123999s77z", "3s");
  assert.deepEqual(r.yaku, ["混全帯么九"]);
  assert.equal(r.fu, 50);
  assert.equal(r.points, 3200);
});

test("純全帯么九: 辺張 7s → 40符3翻 5200", () => {
  const r = score("123789m123p11789s", "7s");
  assert.deepEqual(r.yaku, ["純全帯么九"]);
  assert.equal(r.fu, 40);
  assert.equal(r.points, 5200);
});

test("混一色+役牌: 4翻40符 → 満貫 8000", () => {
  // 123m 345m 678m 99m 555z、9m 単騎: 20+10+8+2=40
  const r = score("12334567899m555z", "9m");
  assert.deepEqual(r.yaku.sort(), ["役牌 白", "混一色"].sort());
  assert.equal(r.limit, "満貫");
  assert.equal(r.points, 8000);
});

test("清一色のみで跳満（子12000・親18000）", () => {
  const r = score("11123456788899m", "9m");
  assert.deepEqual(r.yaku, ["清一色"]);
  assert.equal(r.han, 6);
  assert.equal(r.points, 12000);
  assert.equal(score("11123456788899m", "9m", { dealer: true }).points, 18000);
});

test("清一色+立直+ツモで倍満（子ツモ 4000/8000）", () => {
  const r = score("11123456788899m", "9m", { riichi: true, tsumo: true });
  assert.equal(r.han, 8);
  assert.equal(r.limit, "倍満");
  assert.deepEqual(r.payments, { dealer: 8000, nonDealer: 4000 });
});

test("三倍満: 立直ツモ清一色一気通貫一盃口=11翻 → 子ツモ 6000/12000", () => {
  const r = score("11223345556789m", "5m", { riichi: true, tsumo: true });
  assert.ok(r.han >= 11);
  assert.equal(r.limit, "三倍満");
  assert.deepEqual(r.payments, { dealer: 12000, nonDealer: 6000 });
});

test("シャンポンのロンは三暗刻+対々和、単騎なら四暗刻", () => {
  // 111m 333p 555s 777s 99p
  const s = score("111m33399p555777s", "7s");
  assert.deepEqual(s.yaku.sort(), ["三暗刻", "対々和"].sort());
  // 20+10+8+4+4+明刻2=48→50符4翻 → 満貫
  assert.equal(s.fu, 50);
  assert.equal(s.points, 8000);
  const t = score("111m33399p555777s", "9p");
  assert.deepEqual(t.yaku, ["四暗刻"]);
  assert.equal(t.points, 32000);
});

test("四暗刻ツモ（子 8000/16000）、ドラは数えない", () => {
  const r = score("111m33399p555777s", "7s", { tsumo: true, doraKinds: [0] });
  assert.equal(r.yakuman, true);
  assert.equal(r.points, 32000);
  assert.deepEqual(r.payments, { dealer: 16000, nonDealer: 8000 });
});

test("国士無双（子ロン32000・親ロン48000）", () => {
  const hand = "119m19p19s1234567z";
  assert.equal(score(hand, "1m").points, 32000);
  assert.equal(score(hand, "5z", { dealer: true }).points, 48000);
  assert.deepEqual(score(hand, "1m").yaku, ["国士無双"]);
});

test("ドラ・赤・裏: 立直平和+ドラ2+裏1=5翻 満貫、立直なしなら裏は数えない", () => {
  const r = score(PINFU, "7s", { riichi: true, doraKinds: [K("9p")], uraKinds: [K("1m")] });
  assert.equal(r.han, 5);
  assert.equal(r.points, 8000);
  assert.ok(r.yaku.includes("ドラ2") && r.yaku.includes("裏ドラ1"));
  const d = score(PINFU, "7s", { doraKinds: [K("9p")], akaCount: 1, uraKinds: [K("1m")] });
  assert.equal(d.han, 4); // 平和1+ドラ2+赤1
  assert.equal(d.ura, 0);
  assert.equal(d.points, 7700);
});

test("役なしは和了できない（ドラだけでは不可）", () => {
  assert.equal(score("123789m23499p567s", "6s"), null);
  assert.equal(score("123789m23499p567s", "6s", { doraKinds: [K("6s")], akaCount: 1 }), null);
  // 同じ手でもツモなら門前清自摸和
  assert.ok(score("123789m23499p567s", "6s", { tsumo: true }));
});

test("和了形でない／不正な入力は null", () => {
  assert.equal(score("123789m23499p568s", "8s", { riichi: true }), null);
  assert.equal(score("123789m2349p567s", "7s", { riichi: true }), null); // 13枚
  assert.equal(score(PINFU, "1z", { riichi: true }), null);            // 和了牌が手に無い
});

test("性能: 1回 1ms 未満", () => {
  const hands = [["11223345556789m", "5m"], ["223344m556677p88s", "4m"], [PINFU, "7s"], ["111m33399p555777s", "7s"]];
  const N = 4000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const [hand, w] = hands[i % hands.length];
    score(hand, w, { riichi: true });
  }
  const per = (performance.now() - t0) / N;
  assert.ok(per < 1, `1回 ${per.toFixed(3)}ms`);
});

// 牌 SVG が全種類で描けること、問題データの形が SPEC §3 どおりであることの確認
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tileSvg } from "../docs/js/ui/tileSvg.js";
import { kindToStr, parseTile, sortTiles } from "../docs/js/engine/tiles.js";
import { scoreAnswer } from "../docs/js/game/scoring.js";

test("全37種の牌 SVG を描ける", () => {
  const all = [];
  for (let k = 0; k < 34; k++) all.push(kindToStr(k));
  all.push("0m", "0p", "0s");
  for (const t of all) {
    const svg = tileSvg(t);
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
    assert.ok(svg.length > 200, t);
  }
});

test("problems.json の形式と、全候補を採点できること", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/data/problems.json", import.meta.url), "utf8"));
  assert.equal(data.version, 2);
  assert.ok(data.problems.length >= 1);
  for (const p of data.problems) {
    assert.equal(p.hand.length, 13);
    assert.deepEqual(p.hand, sortTiles(p.hand));
    parseTile(p.draw); parseTile(p.doraIndicator);
    const kinds = new Set([...p.hand, p.draw].map((t) => parseTile(t).kind));
    assert.equal(p.candidates.length, kinds.size, p.id);
    for (const c of p.candidates) assert.equal(typeof c.furiten, "boolean", `${p.id} furiten`);
    for (let i = 1; i < p.candidates.length; i++) assert.ok(p.candidates[i - 1].agari >= p.candidates[i].agari);
    assert.equal(p.candidates[0].tile, kindToStr(parseTile(p.best).kind));
    for (const t of [...p.hand, p.draw]) {
      const r = scoreAnswer({ problem: p, tile: t, remainingMs: 5000, limitMs: 15000 });
      assert.ok(r.points >= 0 && r.points <= 150);
    }
  }
});

// 牌 SVG の図柄が数字と合っていること（筒子の円・索子の棒の数、色）
const count = (svg, re) => (svg.match(re) || []).length;

test("筒子の円の数は n（1筒は同心円5つ、2〜9筒は1つにつき3円）", () => {
  assert.equal(count(tileSvg("1p"), /<circle/g), 5);
  for (let n = 2; n <= 9; n++) assert.equal(count(tileSvg(`${n}p`), /<circle/g), 3 * n, `${n}p`);
});

test("索子の棒の数は n（棒1本は rect 3枚、牌の枠が rect 2枚）", () => {
  for (let n = 2; n <= 9; n++) assert.equal(count(tileSvg(`${n}s`), /<rect/g), 2 + 3 * n, `${n}s`);
  assert.match(tileSvg("1s"), /<ellipse/); // 1索は鳥
});

test("萬子は漢数字＋萬、字牌は漢字、三元牌の色", () => {
  const K = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  for (let n = 1; n <= 9; n++) {
    const svg = tileSvg(`${n}m`);
    assert.ok(svg.includes(`>${K[n - 1]}</text>`) && svg.includes(">萬</text>"), `${n}m`);
  }
  ["東", "南", "西", "北", "發", "中"].forEach((c, i) => {
    const svg = tileSvg(`${[1, 2, 3, 4, 6, 7][i]}z`);
    assert.ok(svg.includes(`>${c}</text>`), c);
  });
  assert.ok(tileSvg("6z").includes("#1b7a3e"));   // 發は緑
  assert.ok(tileSvg("7z").includes('fill="#d0262e">中')); // 中は赤
  assert.ok(!tileSvg("5z").includes("<text"));    // 白は枠だけ
});

test("赤5は図柄が赤、通常5は赤くない（筒子・索子）", () => {
  const colors = (svg) => new Set(svg.match(/fill="#(?:1b7a3e|1c4f9c|d0262e)"/g));
  assert.deepEqual([...colors(tileSvg("0p"))], ['fill="#d0262e"']);
  assert.deepEqual([...colors(tileSvg("0s"))], ['fill="#d0262e"']);
  assert.ok(colors(tileSvg("5p")).size > 1);
  assert.ok(colors(tileSvg("5s")).size > 1);
  assert.ok(tileSvg("0m").includes('fill="#d0262e">五'));
  assert.ok(tileSvg("5m").includes('fill="#1d1d1b">五'));
});

test("rivers: 各家 turn-1 枚、妥当な牌、手牌＋ドラ表示＋河で各種類4枚以下", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/data/problems.json", import.meta.url), "utf8"));
  for (const p of data.problems) {
    const counts = new Array(34).fill(0);
    for (const t of [...p.hand, p.draw, p.doraIndicator]) counts[parseTile(t).kind]++;
    for (const seat of ["self", "shimo", "toimen", "kami"]) {
      const r = p.rivers[seat];
      assert.ok(Array.isArray(r), `${p.id} ${seat}`);
      assert.equal(r.length, p.turn - 1, `${p.id} ${seat} の枚数`);
      for (const t of r) counts[parseTile(t).kind]++;
    }
    counts.forEach((n, k) => assert.ok(n <= 4, `${p.id}: ${kindToStr(k)} が ${n} 枚`));
  }
});

// 押し引き問題（本物があれば本物、なければ sample）
test("押し引き問題の形式（SPEC §11.2）", () => {
  // 本番の problems-oshihiki.json は必須（無ければ readFileSync が例外を投げて fail する）。
  // fixture（ダミー）は形式の回帰用に併せて検査する
  checkOshi(new URL("../docs/data/problems-oshihiki.json", import.meta.url));
  checkOshi(new URL("./fixtures/problems-oshihiki.sample.json", import.meta.url));
});

function checkOshi(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(data.version, 1);
  assert.equal(data.kind, "oshihiki");
  assert.ok(data.problems.length >= 1);
  for (const p0 of data.problems) {
    const p = { ...p0, kind: "oshihiki" }; // main.js と同じく、読み込み時に kind を付ける
    assert.equal(p.hand.length, 13);
    assert.deepEqual(p.hand, sortTiles(p.hand));
    assert.ok(["push", "fold", "mawashi"].includes(p.answerType), p.id);
    assert.ok(["shimo", "toimen", "kami"].includes(p.riichi.seat), p.id);
    const river = p.rivers[p.riichi.seat];
    assert.ok(p.riichi.index >= 0 && p.riichi.index < river.length, `${p.id} 宣言牌の位置`);
    const kinds = new Set([...p.hand, p.draw].map((t) => parseTile(t).kind));
    assert.equal(p.candidates.length, kinds.size, p.id);
    for (const c of p.candidates) {
      for (const k of ["dealIn", "agari", "lose"]) assert.ok(c[k] >= 0 && c[k] <= 1, `${p.id} ${k}`);
      assert.ok(Number.isInteger(c.ev), `${p.id} ev`);
    }
    assert.equal(p.candidates.reduce((m, c) => (c.ev > m.ev ? c : m)).ev, p.candidates.find((c) => c.tile === kindToStr(parseTile(p.best).kind)).ev);
    for (const t of [...p.hand, p.draw]) {
      const r = scoreAnswer({ problem: p, tile: t, remainingMs: 5000, limitMs: 20000 });
      assert.ok(r.points >= 0 && r.points <= 150);
    }
  }
}

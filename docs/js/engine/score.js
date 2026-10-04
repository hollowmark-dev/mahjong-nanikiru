// 和了点の計算（SPEC.md §11.6）。ブラウザと Node の両方から読む純粋な ESM。
//
// scoreHand({ counts14, winTile, tsumo, riichi, dealer, doraKinds, akaCount, uraKinds, seatWind, roundWind })
//   counts14  : 和了形の14枚（winTile を含む）の種類別枚数（長さ34）
//   winTile   : 和了牌。種類（0〜33）または牌の文字列（"5m" "0p" など。赤かどうかは akaCount で渡す）
//   tsumo     : true ならツモ和了、false ならロン和了
//   riichi    : 立直しているか（裏ドラは立直時のみ数える）
//   dealer    : 和了者が親か
//   doraKinds : ドラの「種類」の配列（表示牌ではなく doraFromIndicator 済みの値）。重複はその回数だけ数える
//   akaCount  : 手の中の赤5の枚数
//   uraKinds  : 裏ドラの種類の配列（doraKinds と同じ形）
//   seatWind / roundWind : 自風・場風。種類（27〜30）または "1z"〜"4z"。省略時は 東(27)
//
// → null（和了形でない／役が無い）または
//   { han, fu, points, yaku: [...], yakuman, limit, payments, dora, aka, ura }
//   points   : 和了者が受け取る合計（親子・ロンツモとも）。供託・本場は含まない
//   payments : ロンなら null。親ツモなら { each }（子3人がそれぞれ払う額）、
//              子ツモなら { dealer, nonDealer }（親が払う額・子1人が払う額）
//   limit    : "" | "満貫" | "跳満" | "倍満" | "三倍満" | "役満"
//
// 方針（README 用）:
//   - 対象の役は門前のみ: 立直、門前清自摸和、断幺九、平和、役牌（三元牌・自風・場風。連風は2翻）、一盃口、七対子、
//     三色同順、一気通貫、混全帯么九、純全帯么九、対々和、三暗刻、混一色、清一色、国士無双、四暗刻。
//     それ以外（二盃口・混老頭・小三元・一発・海底・嶺上・槓子・大三元などの他の役満・ダブル役満）は扱わない。
//     二盃口の形は七対子（2翻25符）と一般形（一盃口として数える）の高い方になる。
//   - 数え役満なし。13翻以上も三倍満（基本点6000）で止める。役満は国士無双・四暗刻の1倍のみ
//     （四暗刻単騎・国士十三面のダブル役満は扱わない）。役満のときドラは数えない。
//   - 切り上げ満貫なし（子30符4翻 7700、親30符4翻 11600）。
//   - ドラ・赤・裏だけでは和了できない（役が無ければ null）。
//   - 槓子は扱わない（14枚の門前手のみ）。刻子は全部暗刻扱い。ただしロンで完成したシャンポンの刻子は明刻。
//   - 混全帯么九・純全帯么九は順子を1つ以上含むときだけ成立（全部刻子なら混老頭になるが、それは扱わない）。
//   - 面子分解×待ちの解釈（両面・嵌張・辺張・単騎・シャンポン）を全部試し、点数が最大のもの
//     （同点なら翻数が大きいもの、さらに同じなら符が大きいもの）を採る。
import { parseTile } from "./tiles.js";

const WIND_NAMES = ["東", "南", "西", "北"];
const DRAGON_NAMES = ["白", "發", "中"];

function toKind(v, fallback) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number") return v;
  return parseTile(v).kind;
}

const isHonor = (k) => k >= 27;
const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
const isYaochu = (k) => isHonor(k) || isTerminal(k);
const KOKUSHI = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

const ceil100 = (x) => Math.ceil(x / 100) * 100;

// 基本点と支払い
export function calcPoints(han, fu, dealer, tsumo, yakuman = false) {
  let base, limit;
  if (yakuman) { base = 8000; limit = "役満"; }
  else if (han >= 11) { base = 6000; limit = "三倍満"; }
  else if (han >= 8) { base = 4000; limit = "倍満"; }
  else if (han >= 6) { base = 3000; limit = "跳満"; }
  else {
    base = fu * 2 ** (han + 2);
    limit = "";
    if (han >= 5 || base > 2000) { base = 2000; limit = "満貫"; }
  }
  if (!tsumo) {
    return { points: ceil100(base * (dealer ? 6 : 4)), payments: null, limit };
  }
  if (dealer) {
    const each = ceil100(base * 2);
    return { points: each * 3, payments: { each }, limit };
  }
  const d = ceil100(base * 2), n = ceil100(base);
  return { points: d + 2 * n, payments: { dealer: d, nonDealer: n }, limit };
}

// 面子分解の列挙。melds: [type, kind] の配列（type 0 = 順子（kind は先頭）, 1 = 刻子）
function enumerate(c, i, melds, pair, out) {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) { out.push({ pair, melds: melds.slice() }); return; }
  if (c[i] >= 3) {
    c[i] -= 3; melds.push([1, i]);
    enumerate(c, i, melds, pair, out);
    melds.pop(); c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--; melds.push([0, i]);
    enumerate(c, i, melds, pair, out);
    melds.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

function decompositions(counts) {
  const c = counts.slice();
  const out = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    enumerate(c, 0, [], p, out);
    c[p] += 2;
  }
  return out.filter((d) => d.melds.length === 4);
}

function better(a, b) {
  if (!b) return true;
  if (a.points !== b.points) return a.points > b.points;
  if (a.han !== b.han) return a.han > b.han;
  return a.fu > b.fu;
}

export function scoreHand({
  counts14, winTile, tsumo = false, riichi = false, dealer = false,
  doraKinds = [], akaCount = 0, uraKinds = [], seatWind, roundWind,
}) {
  if (!counts14 || counts14.length !== 34) return null;
  let total = 0;
  for (let k = 0; k < 34; k++) {
    if (counts14[k] < 0 || counts14[k] > 4) return null;
    total += counts14[k];
  }
  if (total !== 14) return null;
  const win = toKind(winTile, -1);
  if (!(win >= 0 && win < 34) || counts14[win] === 0) return null;
  const seat = toKind(seatWind, 27), round = toKind(roundWind, 27);

  // 手全体で決まる役（数え方は形によらない）
  let allSimple = true, hasHonor = false, suitMask = 0;
  for (let k = 0; k < 34; k++) {
    if (!counts14[k]) continue;
    if (isYaochu(k)) allSimple = false;
    if (isHonor(k)) hasHonor = true; else suitMask |= 1 << Math.floor(k / 9);
  }
  const oneSuit = suitMask === 1 || suitMask === 2 || suitMask === 4;
  const baseYaku = []; let baseHan = 0;
  if (riichi) { baseYaku.push("立直"); baseHan += 1; }
  if (tsumo) { baseYaku.push("門前清自摸和"); baseHan += 1; }
  if (allSimple) { baseYaku.push("断幺九"); baseHan += 1; }
  if (oneSuit && hasHonor) { baseYaku.push("混一色"); baseHan += 3; }
  if (oneSuit && !hasHonor) { baseYaku.push("清一色"); baseHan += 6; }

  let dora = 0, ura = 0;
  for (const k of doraKinds) dora += counts14[toKind(k)];
  if (riichi) for (const k of uraKinds) ura += counts14[toKind(k)];
  const aka = akaCount | 0;
  const doraHan = dora + aka + ura;
  const doraYaku = [];
  if (dora) doraYaku.push(`ドラ${dora}`);
  if (aka) doraYaku.push(`赤ドラ${aka}`);
  if (ura) doraYaku.push(`裏ドラ${ura}`);

  const finish = (yaku, han, fu, yakuman) => {
    if (yakuman) {
      const p = calcPoints(13, 0, dealer, tsumo, true);
      return { han: 13, fu: 0, ...p, yaku, yakuman: true, dora: 0, aka: 0, ura: 0 };
    }
    const allHan = han + doraHan;
    const p = calcPoints(allHan, fu, dealer, tsumo, false);
    return { han: allHan, fu, ...p, yaku: yaku.concat(doraYaku), yakuman: false, dora, aka, ura };
  };

  // 国士無双
  let kokushi = true;
  for (let k = 0; k < 34; k++) {
    if (counts14[k] && !isYaochu(k)) { kokushi = false; break; }
  }
  if (kokushi) for (const k of KOKUSHI) if (!counts14[k]) { kokushi = false; break; }
  if (kokushi) return finish(["国士無双"], 0, 0, true);

  let best = null;

  // 七対子（同じ種類4枚は2組と数えない）
  let pairs = 0;
  for (let k = 0; k < 34; k++) if (counts14[k] === 2) pairs++;
  if (pairs === 7) {
    best = finish(baseYaku.concat(["七対子"]), baseHan + 2, 25, false);
  }

  // 一般形
  const yakuhaiValue = (k) => (k >= 31 ? 1 : 0) + (k === seat ? 1 : 0) + (k === round ? 1 : 0);
  for (const d of decompositions(counts14)) {
    const { pair, melds } = d;
    // 形で決まる役（待ちの解釈によらない）
    const shapeYaku = []; let shapeHan = 0;
    let seqCount = 0, tripCount = 0;
    const seqStarts = [];
    for (const [t, k] of melds) {
      if (t === 0) { seqCount++; seqStarts.push(k); } else tripCount++;
    }
    // 役牌
    for (const [t, k] of melds) {
      if (t !== 1 || k < 27) continue;
      if (k >= 31) { shapeYaku.push(`役牌 ${DRAGON_NAMES[k - 31]}`); shapeHan += 1; }
      if (k === seat) { shapeYaku.push(`自風 ${WIND_NAMES[k - 27]}`); shapeHan += 1; }
      if (k === round) { shapeYaku.push(`場風 ${WIND_NAMES[k - 27]}`); shapeHan += 1; }
    }
    // 一盃口（二盃口は扱わないので1翻のみ）
    seqStarts.sort((a, b) => a - b);
    for (let i = 1; i < seqStarts.length; i++) {
      if (seqStarts[i] === seqStarts[i - 1]) { shapeYaku.push("一盃口"); shapeHan += 1; break; }
    }
    // 三色同順
    for (let n = 0; n < 7; n++) {
      if (seqStarts.includes(n) && seqStarts.includes(n + 9) && seqStarts.includes(n + 18)) {
        shapeYaku.push("三色同順"); shapeHan += 2; break;
      }
    }
    // 一気通貫
    for (let s = 0; s < 27; s += 9) {
      if (seqStarts.includes(s) && seqStarts.includes(s + 3) && seqStarts.includes(s + 6)) {
        shapeYaku.push("一気通貫"); shapeHan += 2; break;
      }
    }
    // 混全帯么九・純全帯么九
    if (seqCount > 0 && isYaochu(pair)) {
      let ok = true;
      for (const [t, k] of melds) {
        if (t === 0 ? !(k % 9 === 0 || k % 9 === 6) : !isYaochu(k)) { ok = false; break; }
      }
      if (ok) {
        if (hasHonor) { shapeYaku.push("混全帯么九"); shapeHan += 2; }
        else { shapeYaku.push("純全帯么九"); shapeHan += 3; }
      }
    }
    if (tripCount === 4) { shapeYaku.push("対々和"); shapeHan += 2; }

    // 待ちの解釈: -1 = 雀頭（単騎）, 0..3 = その面子
    const slots = [];
    if (pair === win) slots.push(-1);
    for (let i = 0; i < 4; i++) {
      const [t, k] = melds[i];
      if (t === 1 ? k === win : win >= k && win <= k + 2) slots.push(i);
    }
    for (const slot of slots) {
      let wait; // "ryanmen" | "kanchan" | "penchan" | "tanki" | "shanpon"
      if (slot === -1) wait = "tanki";
      else {
        const [t, k] = melds[slot];
        if (t === 1) wait = "shanpon";
        else if (win === k + 1) wait = "kanchan";
        else if ((win === k + 2 && k % 9 === 0) || (win === k && k % 9 === 6)) wait = "penchan";
        else wait = "ryanmen";
      }

      // 暗刻の数と符
      let ankou = 0;
      let fu = 20;
      for (let i = 0; i < 4; i++) {
        const [t, k] = melds[i];
        if (t !== 1) continue;
        const open = !tsumo && slot === i; // ロンで完成したシャンポンは明刻
        if (!open) ankou++;
        fu += (isYaochu(k) ? 4 : 2) * (open ? 1 : 2);
      }
      fu += 2 * yakuhaiValue(pair);
      if (wait === "kanchan" || wait === "penchan" || wait === "tanki") fu += 2;

      if (ankou === 4) {
        const r = finish(["四暗刻"], 0, 0, true);
        if (better(r, best)) best = r;
        continue;
      }

      const yaku = baseYaku.concat(shapeYaku);
      let han = baseHan + shapeHan;
      const pinfu = seqCount === 4 && yakuhaiValue(pair) === 0 && wait === "ryanmen";
      if (pinfu) { yaku.push("平和"); han += 1; }
      if (ankou === 3) { yaku.push("三暗刻"); han += 2; }
      if (han === 0) continue; // 役なし

      if (pinfu) fu = tsumo ? 20 : 30;
      else {
        if (tsumo) fu += 2;
        else fu += 10; // 門前ロン
        fu = Math.ceil(fu / 10) * 10;
      }
      const r = finish(yaku, han, fu, false);
      if (better(r, best)) best = r;
    }
  }
  return best;
}

/**
 * 何切る道場 共有ランキング（SPEC §9）
 * スプレッドシートに紐づくスクリプト。ウェブアプリ（自分として実行／全員）として公開する。
 *
 * シート "scores" の列:
 *   receivedAt(ISO) | date(YYYY-MM-DD, テキスト) | clientId | name | score | totalTimeMs | bestCount | answersJson
 *
 * clientId はそのまま返さず、hashClientId_ の値（SHA-256 の16進先頭12文字）を cid として返す。
 * クライアント（docs/js/ranking.js の hashClientId）と完全に同じ方式。
 */

var SHEET_NAME = "scores";
var HEADERS = ["receivedAt", "date", "clientId", "name", "score", "totalTimeMs", "bestCount", "answersJson"];
var TZ = "Asia/Tokyo";
var MAX_ROWS_OUT = 50;
var ANSWER_COUNT = 10;
var MAX_SCORE = 1500;
var FORMULA_CHARS_ = "=+-@" + String.fromCharCode(65309, 65291, 65293, 65312); // 全角の＝＋－＠も
var MAX_TOTAL_TIME_MS = 10 * 60 * 1000;

// ---------- 純粋関数（selfTest と Node テストの対象） ----------

/** JST の今日 "YYYY-MM-DD" */
function jstDate_(now) {
  return Utilities.formatDate(now || new Date(), TZ, "yyyy-MM-dd");
}

function isDateStr_(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split("-");
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.getUTCFullYear() === +p[0] && d.getUTCMonth() === +p[1] - 1 && d.getUTCDate() === +p[2];
}

/** 日付文字列に n 日足す（UTC 演算なので月またぎ・うるう年も正しい。TZ 非依存） */
function addDays_(s, n) {
  var p = s.split("-");
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

/** セルの値を "YYYY-MM-DD" に戻す（Date 型に自動変換されていた場合の防御） */
function normDate_(v, tz) {
  if (v instanceof Date || (v && typeof v.getTime === "function")) {
    return Utilities.formatDate(v, tz || TZ, "yyyy-MM-dd");
  }
  return String(v === null || v === undefined ? "" : v).trim();
}

/** 制御文字・不可視の書式文字（ゼロ幅・方向制御・行区切り・BOM）を除く */
function stripInvisible_(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var bad = c < 32 || (c >= 127 && c <= 159) || c === 8232 || c === 8233 ||
      (c >= 8203 && c <= 8207) || (c >= 8234 && c <= 8238) || (c >= 8294 && c <= 8297) || c === 65279;
    if (!bad) out += s.charAt(i);
  }
  return out;
}

/** 制御文字除去・前後空白除去。1〜12文字でなければ null */
function sanitizeName_(raw) {
  if (typeof raw !== "string") return null;
  var s = stripInvisible_(raw);
  s = s.replace(/^\s+|\s+$/g, "");
  // スプレッドシートの数式として解釈される先頭文字（= + - @ と全角）を除去する
  while (s.length > 0 && FORMULA_CHARS_.indexOf(s.charAt(0)) >= 0) {
    s = s.slice(1).replace(/^\s+/, "");
  }
  var len = Array.from(s).length; // サロゲートペアは1文字
  if (len < 1 || len > 12) return null;
  return s;
}

function isInt_(v, min, max) {
  return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= min && v <= max;
}

/** clientId → SHA-256 の16進先頭12文字 */
function hashClientId_(clientId) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(clientId), Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < bytes.length && hex.length < 12; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex.slice(0, 12);
}

/**
 * 提出内容の検証。{ok:true, value:{...}} か {ok:false, error}
 * today は JST の今日。date は今日か昨日のみ。
 */
function validateSubmission_(p, today) {
  if (!p || typeof p !== "object") return { ok: false, error: "bad request" };
  if (!isDateStr_(p.date)) return { ok: false, error: "bad date" };
  if (p.date !== today && p.date !== addDays_(today, -1)) return { ok: false, error: "date out of range" };
  if (typeof p.clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(p.clientId)) {
    return { ok: false, error: "bad clientId" };
  }
  var name = sanitizeName_(p.name);
  if (name === null) return { ok: false, error: "bad name" };
  if (!isInt_(p.score, 0, MAX_SCORE)) return { ok: false, error: "bad score" };
  if (!isInt_(p.totalTimeMs, 0, MAX_TOTAL_TIME_MS)) return { ok: false, error: "bad totalTimeMs" };
  if (!isInt_(p.bestCount, 0, ANSWER_COUNT)) return { ok: false, error: "bad bestCount" };
  if (!Array.isArray(p.answers) || p.answers.length !== ANSWER_COUNT) return { ok: false, error: "bad answers" };
  var answers = [];
  for (var i = 0; i < p.answers.length; i++) {
    var a = p.answers[i];
    if (!a || typeof a !== "object") return { ok: false, error: "bad answers" };
    if (typeof a.id !== "string" || a.id.length > 20) return { ok: false, error: "bad answers" };
    if (typeof a.tile !== "string" || a.tile.length > 4) return { ok: false, error: "bad answers" };
    if (!isInt_(a.timeMs, 0, 60 * 1000)) return { ok: false, error: "bad answers" };
    if (!isInt_(a.points, 0, 150)) return { ok: false, error: "bad answers" };
    answers.push({ id: a.id, tile: a.tile, timeMs: a.timeMs, points: a.points });
  }
  return {
    ok: true,
    value: {
      date: p.date, clientId: p.clientId, name: name, score: p.score,
      totalTimeMs: p.totalTimeMs, bestCount: p.bestCount, answers: answers,
    },
  };
}

/** 得点降順、同点は totalTimeMs 昇順（さらに同じなら先着＝元の順） */
function compareRows_(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
  return (a.seq || 0) - (b.seq || 0);
}

/** その日の行だけ抜き出して順位順に並べる */
function dailyRows_(rows, date) {
  return rows.filter(function (r) { return r.date === date; }).sort(compareRows_);
}

/** clientId ごとに end-6〜end の合計。名前は最新（seq 最大）のもの。 */
function weeklyRows_(rows, end) {
  var start = addDays_(end, -6);
  var by = {};
  rows.forEach(function (r) {
    if (r.date < start || r.date > end) return; // YYYY-MM-DD は文字列比較で日付順
    var e = by[r.clientId];
    if (!e) {
      e = by[r.clientId] = { clientId: r.clientId, name: r.name, score: 0, days: 0, totalTimeMs: 0, seq: r.seq || 0 };
    }
    e.score += r.score;
    e.days += 1;
    e.totalTimeMs += r.totalTimeMs;
    if ((r.seq || 0) >= e.seq) { e.seq = r.seq || 0; e.name = r.name; }
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(compareRows_);
}

/** clientId の順位（1始まり）。いなければ 0 */
function rankOf_(sortedRows, clientId) {
  for (var i = 0; i < sortedRows.length; i++) {
    if (sortedRows[i].clientId === clientId) return i + 1;
  }
  return 0;
}

// ---------- シート入出力 ----------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    // 全列（A〜H）を先にテキスト書式にしてから書く（日付・数値・真偽値・数式への自動変換を防ぐ）
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat("@");
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 全行を1回で読む（ヘッダ除く）。seq は行番号順。 */
function readRows_(sh) {
  var values = sh.getDataRange().getValues();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    if (!v[1] || !v[2]) continue;
    out.push({
      seq: i,
      date: normDate_(v[1], tz),
      clientId: String(v[2]),
      name: String(v[3]), // 全列まず String 化し、数値列だけ Number にする
      score: Number(v[4]) || 0,
      totalTimeMs: Number(v[5]) || 0,
      bestCount: Number(v[6]) || 0,
    });
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function publicRow_(r) {
  return { name: r.name, score: r.score, totalTimeMs: r.totalTimeMs, bestCount: r.bestCount, cid: hashClientId_(r.clientId) };
}

// ---------- エンドポイント ----------

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: "busy" });
  }
  try {
    var p;
    try {
      p = JSON.parse(e && e.postData && e.postData.contents);
    } catch (err2) {
      return json_({ ok: false, error: "bad json" });
    }
    if (!p || p.action !== "submit") return json_({ ok: false, error: "bad action" });
    var v = validateSubmission_(p, jstDate_());
    if (!v.ok) return json_({ ok: false, error: v.error });
    var d = v.value;

    var sh = getSheet_();
    var rows = readRows_(sh);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].date === d.date && rows[i].clientId === d.clientId) {
        return json_({ ok: false, error: "already" });
      }
    }
    // 追記する行だけ先に書式 @ にする（書式が無い既存シートへの二重の防御）
    // 最終行まで埋まっていたら行を足す（足りないと範囲外例外になる）。追記行にだけ書式を付ける方式なので足した行の書式は不要
    var newRow = sh.getLastRow() + 1;
    if (newRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    var target = sh.getRange(newRow, 1, 1, HEADERS.length);
    target.setNumberFormat("@");
    target.setValues([[new Date().toISOString(), d.date, d.clientId, d.name, String(d.score), String(d.totalTimeMs), String(d.bestCount), JSON.stringify(d.answers)]]);
    // seq は readRows_ と同じ基準（values の添字＝行番号-1）
    rows.push({ seq: newRow - 1, date: d.date, clientId: d.clientId, name: d.name, score: d.score, totalTimeMs: d.totalTimeMs, bestCount: d.bestCount });
    var rank = rankOf_(dailyRows_(rows, d.date), d.clientId);
    return json_({ ok: true, rank: rank });
  } catch (err3) {
    return json_({ ok: false, error: "server error" });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var q = (e && e.parameter) || {};
    var sh = getSheet_();
    var rows = readRows_(sh);
    if (q.action === "daily") {
      if (!isDateStr_(q.date)) return json_({ ok: false, error: "bad date" });
      var d = dailyRows_(rows, q.date).slice(0, MAX_ROWS_OUT).map(publicRow_);
      return json_({ ok: true, rows: d });
    }
    if (q.action === "weekly") {
      if (!isDateStr_(q.end)) return json_({ ok: false, error: "bad end" });
      var w = weeklyRows_(rows, q.end).slice(0, MAX_ROWS_OUT).map(function (r) {
        return { name: r.name, score: r.score, days: r.days, cid: hashClientId_(r.clientId) };
      });
      return json_({ ok: true, rows: w });
    }
    return json_({ ok: false, error: "bad action" });
  } catch (err) {
    return json_({ ok: false, error: "server error" });
  }
}

// ---------- GAS エディタから実行する自己テスト（シートは触らない） ----------

function selfTest() {
  var fails = [];
  function eq(label, got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(label + ": got " + JSON.stringify(got) + " want " + JSON.stringify(want));
  }
  eq("addDays 月またぎ", addDays_("2026-10-01", -1), "2026-09-30");
  eq("addDays 年またぎ", addDays_("2026-12-31", 1), "2027-01-01");
  eq("addDays うるう年", addDays_("2028-03-01", -1), "2028-02-29");
  eq("isDateStr", [isDateStr_("2026-02-30"), isDateStr_("2026-10-03")], [false, true]);
  eq("sanitizeName", [sanitizeName_("  たろう\n "), sanitizeName_(""), sanitizeName_("あいうえおかきくけこさしす")], ["たろう", null, null]);
  eq("jstDate_", jstDate_(new Date("2026-10-02T16:00:00Z")), "2026-10-03");
  eq("hash 長さ", hashClientId_("abc").length, 12);
  eq("hash 既知値", hashClientId_("abc"), "ba7816bf8f01"); // SHA-256("abc") の先頭
  var ans = [];
  for (var i = 0; i < 10; i++) ans.push({ id: "q" + i, tile: "1m", timeMs: 1000, points: 100 });
  var ok = validateSubmission_({ date: "2026-10-03", clientId: "client-12345", name: "A", score: 1000, totalTimeMs: 50000, bestCount: 5, answers: ans }, "2026-10-03");
  eq("validate ok", ok.ok, true);
  var ng = validateSubmission_({ date: "2026-10-03", clientId: "client-12345", name: "A", score: 1501, totalTimeMs: 50000, bestCount: 5, answers: ans }, "2026-10-03");
  eq("validate score", ng.error, "bad score");
  var rows = [
    { seq: 1, date: "2026-10-03", clientId: "a", name: "A", score: 900, totalTimeMs: 100 },
    { seq: 2, date: "2026-10-03", clientId: "b", name: "B", score: 900, totalTimeMs: 50 },
  ];
  eq("rank", rankOf_(dailyRows_(rows, "2026-10-03"), "b"), 1);
  if (fails.length) {
    Logger.log("NG:\n" + fails.join("\n"));
    throw new Error("selfTest failed: " + fails.length + " 件");
  }
  Logger.log("selfTest OK");
}

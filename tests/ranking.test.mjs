import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Code.gs を GAS グローバルのモックつきで読み込む ----------
function loadGas(extra = {}) {
  const Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_alg, str) {
      // GAS は符号付きバイト列（-128〜127）を返す
      return Array.from(crypto.createHash("sha256").update(str, "utf8").digest(), (b) => (b > 127 ? b - 256 : b));
    },
    formatDate(date, tz, fmt) {
      assert.equal(fmt, "yyyy-MM-dd");
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(date);
      return parts;
    },
  };
  const ctx = vm.createContext({ Utilities, Logger: { log() {} }, Array, Date, JSON, Object, Math, Number, String, isFinite, ...extra });
  vm.runInContext(fs.readFileSync(path.join(root, "gas", "Code.gs"), "utf8"), ctx, { filename: "Code.gs" });
  return ctx;
}
const gas = loadGas();
// vm 内の配列/オブジェクトはレルムが違うので JSON 経由で比較する
const plain = (x) => JSON.parse(JSON.stringify(x));

const answers = () => Array.from({ length: 10 }, (_, i) => ({ id: "q" + i, tile: "1m", timeMs: 1000, points: 100 }));
const good = () => ({
  action: "submit", date: "2026-10-03", clientId: "client-12345678", name: "たろう",
  score: 1000, totalTimeMs: 50000, bestCount: 5, answers: answers(),
});

test("日付計算: 月またぎ・年またぎ・うるう年", () => {
  assert.equal(gas.addDays_("2026-10-01", -1), "2026-09-30");
  assert.equal(gas.addDays_("2026-12-31", 1), "2027-01-01");
  assert.equal(gas.addDays_("2028-03-01", -1), "2028-02-29");
  assert.equal(gas.addDays_("2026-03-03", -6), "2026-02-25");
});

test("JST の今日: UTC 15:00 で日付が進む", () => {
  assert.equal(gas.jstDate_(new Date("2026-10-02T14:59:59Z")), "2026-10-02");
  assert.equal(gas.jstDate_(new Date("2026-10-02T15:00:00Z")), "2026-10-03");
});

test("日付文字列の判定と Date 型の防御", () => {
  assert.equal(gas.isDateStr_("2026-02-30"), false);
  assert.equal(gas.isDateStr_("2026-2-3"), false);
  assert.equal(gas.isDateStr_("2026-10-03"), true);
  assert.equal(gas.normDate_("2026-10-03", "Asia/Tokyo"), "2026-10-03");
  // JST 0時の Date が来ても同じ日に戻る
  assert.equal(gas.normDate_(new Date("2026-10-02T15:00:00Z"), "Asia/Tokyo"), "2026-10-03");
});

test("名前のサニタイズ", () => {
  assert.equal(gas.sanitizeName_("  たろう\n"), "たろう");
  assert.equal(gas.sanitizeName_("a\u0000b​c"), "abc");
  assert.equal(gas.sanitizeName_(""), null);
  assert.equal(gas.sanitizeName_("   "), null);
  assert.equal(gas.sanitizeName_("あいうえおかきくけこさし"), "あいうえおかきくけこさし"); // 12文字
  assert.equal(gas.sanitizeName_("あいうえおかきくけこさしす"), null); // 13文字
  assert.equal(gas.sanitizeName_("😀".repeat(12)), "😀".repeat(12)); // サロゲートペアは1文字
  assert.equal(gas.sanitizeName_(123), null);
});

test("検証: 正常系と各種エラー", () => {
  const today = "2026-10-03";
  const v = gas.validateSubmission_(good(), today);
  assert.equal(v.ok, true);
  assert.equal(v.value.name, "たろう");
  assert.equal(v.value.answers.length, 10);

  const err = (mut, want) => {
    const p = good(); mut(p);
    assert.equal(gas.validateSubmission_(p, today).error, want);
  };
  err((p) => { p.date = "2026-10-02"; }, undefined); // 昨日は OK なので error なし
  err((p) => { p.date = "2026-10-01"; }, "date out of range");
  err((p) => { p.date = "2026-10-04"; }, "date out of range");
  err((p) => { p.date = "bad"; }, "bad date");
  err((p) => { p.clientId = "x"; }, "bad clientId");
  err((p) => { p.name = ""; }, "bad name");
  err((p) => { p.score = 1501; }, "bad score");
  err((p) => { p.score = -1; }, "bad score");
  err((p) => { p.score = 10.5; }, "bad score");
  err((p) => { p.score = "100"; }, "bad score");
  err((p) => { p.totalTimeMs = 10 * 60 * 1000 + 1; }, "bad totalTimeMs");
  err((p) => { p.bestCount = 11; }, "bad bestCount");
  err((p) => { p.answers.pop(); }, "bad answers");
  err((p) => { p.answers[3].points = 151; }, "bad answers");
  err((p) => { p.answers[3] = null; }, "bad answers");
  assert.equal(gas.validateSubmission_(null, today).error, "bad request");
});

test("ハッシュ: SHA-256 の16進先頭12文字（符号付きバイトでも正しい）", () => {
  const expect = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
  for (const s of ["abc", "client-12345678", "日本語ID", "0".repeat(36)]) {
    assert.equal(gas.hashClientId_(s), expect(s));
  }
  assert.equal(gas.hashClientId_("abc"), "ba7816bf8f01");
});

test("並べ替え: 得点降順→時間昇順→先着", () => {
  const rows = [
    { seq: 1, date: "d", clientId: "a", score: 900, totalTimeMs: 100 },
    { seq: 2, date: "d", clientId: "b", score: 900, totalTimeMs: 50 },
    { seq: 3, date: "d", clientId: "c", score: 1000, totalTimeMs: 999 },
    { seq: 4, date: "d", clientId: "d", score: 900, totalTimeMs: 50 },
    { seq: 5, date: "x", clientId: "z", score: 1500, totalTimeMs: 1 },
  ];
  const s = gas.dailyRows_(rows, "d");
  assert.deepEqual(plain(s.map((r) => r.clientId)), ["c", "b", "d", "a"]);
  assert.equal(gas.rankOf_(s, "d"), 3);
  assert.equal(gas.rankOf_(s, "nobody"), 0);
});

test("週集計: end を含む7日・月またぎ・最新の名前", () => {
  const mk = (seq, date, clientId, name, score, t = 100) => ({ seq, date, clientId, name, score, totalTimeMs: t });
  const rows = [
    mk(1, "2026-09-26", "a", "旧", 500), // end=10-02 の範囲外（start=09-26 なので含まれる）
    mk(2, "2026-09-25", "a", "範囲外", 999), // 範囲外
    mk(3, "2026-09-30", "a", "新", 600),
    mk(4, "2026-10-02", "b", "B", 1000),
    mk(5, "2026-10-03", "b", "B", 1500), // end より後
  ];
  const w = gas.weeklyRows_(rows, "2026-10-02");
  assert.deepEqual(plain(w.map((r) => [r.clientId, r.score, r.days, r.name])), [
    ["a", 1100, 2, "新"],
    ["b", 1000, 1, "B"],
  ]);
  assert.equal(gas.weeklyRows_(rows, "2026-10-03").find((r) => r.clientId === "b").score, 2500);
});

test("selfTest が通る", () => {
  gas.selfTest();
});

// ---------- ranking.js ----------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

async function freshRanking() {
  // モジュールをテストごとに読み直して内部状態（memoryClientId）を初期化
  return import(`../docs/js/ranking.js?${Math.random()}`);
}

const jsonRes = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj });

test("ranking: 無効時は何も送らない", async () => {
  const r = await freshRanking();
  let called = false;
  globalThis.fetch = async () => { called = true; };
  assert.equal(r.isRankingEnabled(), false);
  assert.deepEqual(await r.fetchDaily("2026-10-03"), []);
  assert.deepEqual(await r.submitScore({}), { ok: false, error: "disabled" });
  assert.equal(called, false);
});

test("ranking: getClientId は保存・再利用、localStorage 不可でも例外なし", async () => {
  const st = memStorage();
  Object.defineProperty(globalThis, "localStorage", { value: st, configurable: true, writable: true });
  let r = await freshRanking();
  const id = r.getClientId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(st._m.get("nanikiru.clientId"), id);
  r = await freshRanking(); // 別インスタンスでも保存値を読む
  assert.equal(r.getClientId(), id);

  // setItem/getItem が投げる環境
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } },
    configurable: true, writable: true,
  });
  r = await freshRanking();
  const a = r.getClientId();
  assert.equal(r.getClientId(), a); // セッション内では安定
  // アクセサ自体が投げる環境
  Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("denied"); }, configurable: true });
  r = await freshRanking();
  assert.ok(r.getClientId().length >= 16);
  delete globalThis.localStorage;
});

test("ranking: submitScore は text/plain の JSON を POST し、結果を返す", async () => {
  Object.defineProperty(globalThis, "localStorage", { value: memStorage(), configurable: true, writable: true });
  const r = await freshRanking();
  r.configureRanking({ endpoint: "https://example.test/exec", timeoutMs: 500 });
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return jsonRes({ ok: true, rank: 3 }); };
  const payload = { date: "2026-10-03", name: "A", clientId: "cid-123456", score: 1, totalTimeMs: 2, bestCount: 3, answers: [] };
  assert.deepEqual(await r.submitScore(payload), { ok: true, rank: 3 });
  assert.equal(seen.url, "https://example.test/exec");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.redirect, "follow");
  assert.equal(seen.init.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(JSON.parse(seen.init.body), { action: "submit", ...payload });

  globalThis.fetch = async () => jsonRes({ ok: false, error: "already" });
  assert.deepEqual(await r.submitScore(payload), { ok: false, error: "already" });
  globalThis.fetch = async () => jsonRes({}, false, 500);
  assert.deepEqual(await r.submitScore(payload), { ok: false, error: "http 500" });
  globalThis.fetch = async () => { throw new TypeError("fail"); };
  assert.deepEqual(await r.submitScore(payload), { ok: false, error: "network" });
});

test("ranking: タイムアウトで中断し、例外を投げない", async () => {
  const r = await freshRanking();
  r.configureRanking({ endpoint: "https://example.test/exec", timeoutMs: 30 });
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  assert.deepEqual(await r.submitScore({}), { ok: false, error: "timeout" });
  assert.deepEqual(await r.fetchDaily("2026-10-03"), null);
  assert.deepEqual(await r.fetchWeekly("2026-10-03"), null);
});

test("ranking: fetchDaily / fetchWeekly は自分の行に me:true、cid は消える", async () => {
  Object.defineProperty(globalThis, "localStorage", { value: memStorage(), configurable: true, writable: true });
  const r = await freshRanking();
  r.configureRanking({ endpoint: "https://example.test/exec", timeoutMs: 500 });
  const mine = await r.hashClientId(r.getClientId());
  assert.match(mine, /^[0-9a-f]{12}$/);
  let url;
  globalThis.fetch = async (u) => {
    url = u;
    return jsonRes({ ok: true, rows: [
      { name: "他人", score: 900, totalTimeMs: 1, bestCount: 4, cid: "ffffffffffff" },
      { name: "自分", score: 800, totalTimeMs: 2, bestCount: 3, cid: mine },
    ] });
  };
  const rows = await r.fetchDaily("2026-10-03");
  assert.equal(url, "https://example.test/exec?action=daily&date=2026-10-03");
  assert.deepEqual(rows, [
    { name: "他人", score: 900, totalTimeMs: 1, bestCount: 4 },
    { name: "自分", score: 800, totalTimeMs: 2, bestCount: 3, me: true },
  ]);
  const w = await r.fetchWeekly("2026-10-03");
  assert.equal(url, "https://example.test/exec?action=weekly&end=2026-10-03");
  assert.equal(w[1].me, true);
  assert.equal("cid" in w[1], false);

  globalThis.fetch = async () => jsonRes({ ok: false, error: "bad date" });
  assert.deepEqual(await r.fetchDaily("x"), null);
});

test("ranking: クライアントのハッシュは GAS 側と同じ値", async () => {
  const r = await freshRanking();
  for (const id of ["abc", "client-12345678", "日本語ID"]) {
    assert.equal(await r.hashClientId(id), gas.hashClientId_(id));
  }
});

// ---------- 数式インジェクション対策 ----------
test("名前: 数式として解釈される先頭文字を除去する", () => {
  const f = (s) => gas.sanitizeName_(s);
  assert.equal(f("=C2"), "C2");
  assert.equal(f("+1"), "1");
  assert.equal(f("-1"), "1");
  assert.equal(f("@SUM(A1)"), "SUM(A1)");
  assert.equal(f("＝C2"), "C2");
  assert.equal(f("＋＠－x"), "x");
  assert.equal(f("==  =a"), "a");
  assert.equal(f("\t=A1"), "A1");
  assert.equal(f("=+-@"), null); // 除去後に空
  assert.equal(f("a=b"), "a=b"); // 先頭以外は残す
});

// ---------- doPost / doGet の通しテスト（シート・ロックのモック） ----------
function makeEnv({ today = "2026-10-03", autoConvert = true, initialMaxRows = 1000 } = {}) {
  // grid[r][c] は0始まり。formats は "r,c" の集合（書式 @ のセル）
  const grid = [];
  const formats = new Set();
  const lockLog = [];
  let maxRows = initialMaxRows;
  // 書式 @ でないセルへの書き込みは、Sheets の自動型変換を再現して壊す
  const convert = (r, c, v) => {
    if (formats.has(`${r},${c}`) || !autoConvert) return v;
    if (typeof v === "string") {
      if (v.startsWith("=")) return { formula: v };
      if (/^\d+$/.test(v)) return Number(v);
      if (v === "TRUE" || v === "FALSE") return v === "TRUE";
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00+09:00");
    }
    return v;
  };
  const sheet = {
    getLastRow: () => grid.length,
    getMaxRows: () => maxRows,
    setFrozenRows() {},
    insertRowsAfter(after, n) { assert.equal(after, maxRows); maxRows += n; },
    getRange(r, c, nr, nc) {
      if (r + nr - 1 > maxRows) throw new Error("範囲外: シートの行数を超えた");
      return {
        setNumberFormat(f) {
          assert.equal(f, "@");
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) formats.add(`${r - 1 + i},${c - 1 + j}`);
        },
        setValues(vals) {
          vals.forEach((row, i) => row.forEach((v, j) => {
            const rr = r - 1 + i, cc = c - 1 + j;
            if (!grid[rr]) grid[rr] = [];
            grid[rr][cc] = convert(rr, cc, v);
          }));
        },
      };
    },
    getDataRange: () => ({
      getValues: () => grid.map((row) => Array.from({ length: 8 }, (_, j) => (row[j] === undefined ? "" : row[j]))),
    }),
  };
  let sheetExists = false;
  const ss = {
    getSheetByName: () => (sheetExists ? sheet : null),
    insertSheet: () => { sheetExists = true; return sheet; },
    getSpreadsheetTimeZone: () => "Asia/Tokyo",
  };
  const ContentService = {
    MimeType: { JSON: "JSON" },
    createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }),
  };
  const LockService = {
    getScriptLock: () => ({
      waitLock() { lockLog.push("wait"); },
      releaseLock() { lockLog.push("release"); },
    }),
  };
  const g = loadGas({ SpreadsheetApp: { getActiveSpreadsheet: () => ss }, ContentService, LockService });
  g.jstDate_ = () => today; // 「今日」を固定
  const post = (obj) => JSON.parse(g.doPost({ postData: { contents: typeof obj === "string" ? obj : JSON.stringify(obj) } }).getContent());
  const get = (parameter) => JSON.parse(g.doGet({ parameter }).getContent());
  return { g, grid, lockLog, post, get, formats };
}
const sub = (o = {}) => ({ ...good(), ...o });

test("doPost: 成功で rank、ヘッダ自動作成、行の中身は全部文字列", () => {
  const env = makeEnv();
  const r = env.post(sub({ clientId: "aaaaaaaa-1", name: "=C2", score: 800 }));
  assert.deepEqual(r, { ok: true, rank: 1 });
  assert.deepEqual(plain(env.grid[0]), ["receivedAt", "date", "clientId", "name", "score", "totalTimeMs", "bestCount", "answersJson"]);
  const row = env.grid[1];
  assert.equal(row.length, 8);
  for (const c of row) assert.equal(typeof c, "string");
  assert.equal(row[1], "2026-10-03");
  assert.equal(row[3], "C2"); // 数式文字は除去済み
  assert.equal(row[4], "800");
  assert.equal(JSON.parse(row[7]).length, 10);
  assert.deepEqual(env.lockLog, ["wait", "release"]);
});

test("doPost: 同じ (date, clientId) は already、別日は可、順位は点数順", () => {
  const env = makeEnv();
  assert.equal(env.post(sub({ clientId: "aaaaaaaa-1", score: 500 })).rank, 1);
  assert.deepEqual(env.post(sub({ clientId: "aaaaaaaa-1", score: 900 })), { ok: false, error: "already" });
  assert.equal(env.post(sub({ clientId: "bbbbbbbb-2", score: 900 })).rank, 1);
  assert.equal(env.post(sub({ clientId: "cccccccc-3", score: 700 })).rank, 2);
  assert.deepEqual(env.post(sub({ clientId: "aaaaaaaa-1", date: "2026-10-02", score: 100 })), { ok: true, rank: 1 });
  assert.equal(env.grid.length, 1 + 4);
  assert.equal(env.lockLog.filter((x) => x === "release").length, 5); // already でも解放される
});

test("doPost: 検証エラー・不正 JSON は書き込まずロックを解放", () => {
  const env = makeEnv();
  assert.deepEqual(env.post(sub({ score: 99999 })), { ok: false, error: "bad score" });
  assert.deepEqual(env.post("{not json"), { ok: false, error: "bad json" });
  assert.deepEqual(env.post({ action: "x" }), { ok: false, error: "bad action" });
  assert.deepEqual(env.post(sub({ date: "2026-09-01" })), { ok: false, error: "date out of range" });
  assert.equal(env.grid.length, 0);
  assert.deepEqual(env.lockLog, ["wait", "release", "wait", "release", "wait", "release", "wait", "release"]);
});

test("doPost: 例外が起きてもロックは finally で解放される", () => {
  const env = makeEnv();
  env.g.getSheet_ = () => { throw new Error("boom"); };
  assert.deepEqual(env.post(sub()), { ok: false, error: "server error" });
  assert.deepEqual(env.lockLog, ["wait", "release"]);
});

test("自動型変換の防御: 数字だけ・TRUE・日付風・数式の名前が壊れない", () => {
  const env = makeEnv(); // 書式 @ が効いていなければモックが型変換する
  env.post(sub({ clientId: "00120012-a", name: "0012", score: 1000 }));
  env.post(sub({ clientId: "bbbbbbbb-2", name: "TRUE", score: 900 }));
  env.post(sub({ clientId: "cccccccc-3", name: "2026-10-01", score: 800 }));
  env.post(sub({ clientId: "dddddddd-4", name: "=HYPERLINK(1)", score: 700 }));
  for (const row of env.grid.slice(1)) for (const c of row) assert.equal(typeof c, "string");
  const d = env.get({ action: "daily", date: "2026-10-03" });
  assert.deepEqual(plain(d.rows.map((r) => r.name)), ["0012", "TRUE", "2026-10-01", "HYPERLINK(1)"]);
  assert.equal(typeof d.rows[0].score, "number");
});

test("読み出し: Date 型・数値型に変換されたセルも戻して読む", () => {
  const env = makeEnv({ autoConvert: false });
  env.post(sub({ clientId: "aaaaaaaa-1", score: 500 }));
  env.grid[1][1] = new Date("2026-10-02T15:00:00Z"); // JST 2026-10-03
  env.grid[1][4] = 500;
  const d = env.get({ action: "daily", date: "2026-10-03" });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].score, 500);
});

test("doGet: daily の並びと cid、weekly の集計、エラー", () => {
  const env = makeEnv();
  env.post(sub({ clientId: "aaaaaaaa-1", name: "A", score: 900, totalTimeMs: 100 }));
  env.post(sub({ clientId: "bbbbbbbb-2", name: "B", score: 900, totalTimeMs: 50 }));
  env.post(sub({ clientId: "cccccccc-3", name: "C", score: 1200, totalTimeMs: 999 }));
  env.post(sub({ clientId: "aaaaaaaa-1", name: "A2", date: "2026-10-02", score: 400 }));
  const d = env.get({ action: "daily", date: "2026-10-03" });
  assert.equal(d.ok, true);
  assert.deepEqual(plain(d.rows.map((r) => r.name)), ["C", "B", "A"]);
  assert.equal(d.rows[0].cid, env.g.hashClientId_("cccccccc-3"));
  assert.equal(JSON.stringify(d).includes("cccccccc-3"), false); // clientId 本体は出ない
  const w = env.get({ action: "weekly", end: "2026-10-03" });
  assert.deepEqual(plain(w.rows.map((r) => [r.name, r.score, r.days])), [["A2", 1300, 2], ["C", 1200, 1], ["B", 900, 1]]);
  assert.equal(JSON.stringify(w).includes("aaaaaaaa-1"), false);
  assert.deepEqual(env.get({ action: "daily", date: "bad" }), { ok: false, error: "bad date" });
  assert.deepEqual(env.get({ action: "weekly" }), { ok: false, error: "bad end" });
  assert.deepEqual(env.get({ action: "zzz" }), { ok: false, error: "bad action" });
});

test("doPost: シートが満杯でも行を足して追記できる", () => {
  const env = makeEnv({ initialMaxRows: 3 }); // ヘッダ＋2行で満杯
  assert.equal(env.post(sub({ clientId: "aaaaaaaa-1", score: 100 })).ok, true);
  assert.equal(env.post(sub({ clientId: "bbbbbbbb-2", score: 200 })).ok, true);
  const r = env.post(sub({ clientId: "cccccccc-3", score: 300 })); // 4行目 > maxRows(3)
  assert.deepEqual(r, { ok: true, rank: 1 });
  assert.equal(env.grid.length, 4);
  for (const c of env.grid[3]) assert.equal(typeof c, "string");
});

test("doPost: 空行があっても同点は先着順で順位が付く", () => {
  const env = makeEnv();
  env.post(sub({ clientId: "aaaaaaaa-1", score: 500 }));
  env.grid.push([], [], []); // 手で消された空行
  assert.equal(env.post(sub({ clientId: "bbbbbbbb-2", score: 900 })).rank, 1);
  const r = env.post(sub({ clientId: "cccccccc-3", score: 900 })); // B と同点・同時間
  assert.equal(r.rank, 2);
});

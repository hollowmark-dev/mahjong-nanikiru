// 共有ランキングのクライアント（SPEC §9）。依存は config.js のみ。
//
// clientId のハッシュ方式（GAS 側 gas/Code.gs の hashClientId_ と完全一致させること）:
//   SHA-256( UTF-8 の clientId ) を16進小文字にして先頭 12 文字。
// GAS は clientId そのものではこのハッシュ（cid）だけを返す。自分の行かどうかは
// クライアントが同じハッシュを計算して cid と照合する（他人の clientId を晒さない）。

import { RANKING_ENDPOINT } from "./config.js";

const CLIENT_ID_KEY = "nanikiru.clientId";
const TIMEOUT_MS_DEFAULT = 8000;

let endpoint = RANKING_ENDPOINT;
let timeoutMs = TIMEOUT_MS_DEFAULT;
let memoryClientId = null; // localStorage が使えない環境用（そのセッションだけ）

/** テスト用: エンドポイントとタイムアウトを差し替える。本番コードでは呼ばない。 */
export function configureRanking(opts = {}) {
  if (opts.endpoint !== undefined) endpoint = opts.endpoint;
  if (opts.timeoutMs !== undefined) timeoutMs = opts.timeoutMs;
}

export function isRankingEnabled() {
  return typeof endpoint === "string" && endpoint.length > 0;
}

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function randomId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 端末ごとの UUID。localStorage が使えなければそのセッションだけの ID。 */
export function getClientId() {
  if (memoryClientId) return memoryClientId;
  const st = storage();
  try {
    const saved = st && st.getItem(CLIENT_ID_KEY);
    if (saved) {
      memoryClientId = saved;
      return saved;
    }
  } catch { /* 無視 */ }
  const id = randomId();
  memoryClientId = id;
  try {
    if (st) st.setItem(CLIENT_ID_KEY, id);
  } catch { /* 無視 */ }
  return id;
}

/** clientId → SHA-256 の16進先頭12文字。subtle が無ければ null。 */
export async function hashClientId(clientId) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(clientId)));
  const hex = Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

async function request(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const json = await res.json();
    if (!json || typeof json !== "object") return { ok: false, error: "bad response" };
    return json;
  } catch (e) {
    return { ok: false, error: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function submitScore({ date, name, clientId, score, totalTimeMs, bestCount, answers }) {
  if (!isRankingEnabled()) return { ok: false, error: "disabled" };
  const body = JSON.stringify({
    action: "submit", date, name, clientId, score, totalTimeMs, bestCount, answers,
  });
  const r = await request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
  });
  if (r.ok) return { ok: true, rank: r.rank };
  return { ok: false, error: r.error || "error" };
}

async function markMe(rows) {
  const mine = await hashClientId(getClientId());
  return rows.map((row) => {
    const { cid, ...rest } = row;
    return mine && cid === mine ? { ...rest, me: true } : rest;
  });
}

async function fetchList(query) {
  if (!isRankingEnabled()) return [];
  const sep = endpoint.includes("?") ? "&" : "?";
  const r = await request(endpoint + sep + query, { method: "GET" });
  // 通信失敗は null（「記録がまだない」の空配列と区別するため）
  if (!r.ok || !Array.isArray(r.rows)) return null;
  return markMe(r.rows);
}

export function fetchDaily(date) {
  return fetchList("action=daily&date=" + encodeURIComponent(date));
}

export function fetchWeekly(endDate) {
  return fetchList("action=weekly&end=" + encodeURIComponent(endDate));
}

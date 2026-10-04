// localStorage の読み書き（すべて try/catch。使えなくても動く）
const P = "nanikiru.";

function get(key) {
  try { return localStorage.getItem(P + key); } catch { return null; }
}
function set(key, value) {
  try { localStorage.setItem(P + key, value); return true; } catch { return false; }
}

export function validName(s) {
  const n = Array.from((s || "").trim()).length;
  return n >= 1 && n <= 12;
}
export function getName() {
  return get("name") || "";
}
export function setName(s) {
  const v = (s || "").trim();
  if (!validName(v)) return false;
  set("name", v);
  return true;
}

export const PRACTICE_SECS = [15, 20, 30];
export const DEFAULT_PRACTICE_SEC = 20;

// 保存済みの旧い秒数（10 など）は 15/20/30 のうち近い大きい側に丸める。未保存・不正は既定の20
export function normalizePracticeSec(n) {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PRACTICE_SEC;
  return PRACTICE_SECS.find((s) => s >= n) ?? PRACTICE_SECS[PRACTICE_SECS.length - 1];
}
export function getPracticeSec() {
  const raw = get("practiceSec");
  return raw == null ? DEFAULT_PRACTICE_SEC : normalizePracticeSec(Number(raw));
}
export function setPracticeSec(n) {
  set("practiceSec", String(n));
}

export function loadDaily(date) {
  const raw = get("daily." + date);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return r && Array.isArray(r.answers) ? r : null;
  } catch { return null; }
}
export function saveDaily(record) {
  return set("daily." + record.date, JSON.stringify(record));
}

// StockFit AI — 과제 기록 + 과제 직후 설문 자동 저장 / 조회 / 초기화 (Netlify Blobs)
// 저장 위치: Netlify Blobs 저장소 "stockfit-logs"
//   과제 기록: <링크>/<참가자번호>_<순서>_<저장시각>   예) s5/P01_1_1730350000000
//   사전 설문: pre/<참가자번호>_<저장시각>            예) pre/P01_1730340000000
//   사후 설문: post/<참가자번호>_<저장시각>           예) post/P01_1730360000000
// POST   /api/log                     {pid, group, order, link, text, survey}
// GET    /api/log?key=…               전체 기록 (Netlify 환경변수 RESULTS_KEY 와 일치해야 함)
// DELETE /api/log?key=…&link=s5 (사전 설문은 link=pre) | &pid=P01 | &target=<기록 이름> | &all=1
// PATCH  /api/log?key=…  {target, pid, order}   잘못 입력된 참가자 번호·순서 수정
import { getStore } from "@netlify/blobs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const LINKS = ["s1", "s3", "s5", "s6", "s7", "s8", "s9", "s10"];

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore({ name: "stockfit-logs", consistency: "strong" });

  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    let pid = String(b.pid || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    const pm = pid.match(/^P([0-9O]{1,3})$/);
    if (pm) { const d = pm[1].replace(/O/g, "0"); pid = "P" + (d.length < 2 ? "0" + d : d); }   // PO1·P1 → P01

    // 사전·사후 설문: pre/<참가자번호>_<저장시각>, post/<참가자번호>_<저장시각>
    if (b.kind === "pre" || b.kind === "post") {
      const answers = b.answers && typeof b.answers === "object" && JSON.stringify(b.answers).length < 20000 ? b.answers : null;
      if (!pid || !answers) return json({ error: "bad_data" }, 400);
      const key = `${b.kind}/${pid}_${Date.now()}`;
      await store.setJSON(key, { type: b.kind, pid, answers, savedAt: new Date().toISOString() });
      return json({ ok: true, key });
    }

    const link = String(b.link || "").toLowerCase();
    const text = String(b.text || "");
    if (!pid || !LINKS.includes(link) || !text || text.length > 300000) return json({ error: "bad_data" }, 400);
    const survey = b.survey && typeof b.survey === "object" && JSON.stringify(b.survey).length < 20000 ? b.survey : null;
    const order = Number(b.order) || 0;
    const key = `${link}/${pid}_${order}_${Date.now()}`;
    await store.setJSON(key, { pid, group: String(b.group || "").slice(0, 4), order, link, text, survey, savedAt: new Date().toISOString() });
    return json({ ok: true, key });
  }

  const secret = process.env.RESULTS_KEY;
  if (!secret || url.searchParams.get("key") !== secret) return json({ error: "unauthorized" }, 401);
  const { blobs } = await store.list();

  if (req.method === "GET") {
    const items = [];
    for (const bl of blobs) {
      const v = await store.get(bl.key, { type: "json" });
      if (v && (v.type === "pre" || v.type === "post")) items.push({ key: bl.key, ...v });
      else if (v && v.link) items.push({ key: bl.key, type: "task", ...v });
    }
    items.sort((a, b) => LINKS.indexOf(a.link) - LINKS.indexOf(b.link) || String(a.pid).localeCompare(String(b.pid), "ko", { numeric: true }));
    return json({ items });
  }

  if (req.method === "DELETE") {
    const target = url.searchParams.get("target"), link = url.searchParams.get("link"),
          pid = url.searchParams.get("pid"), all = url.searchParams.get("all") === "1";
    if (!target && !link && !pid && !all) return json({ error: "no_target" }, 400);
    let deleted = 0;
    for (const bl of blobs) {
      const [lk, rest = ""] = bl.key.split("/");
      const hit = all || (target && bl.key === target) || (link && lk === link) || (pid && rest.startsWith(pid + "_"));
      if (hit) { await store.delete(bl.key); deleted++; }
    }
    return json({ ok: true, deleted });
  }

  // 수정: PATCH /api/log?key=…  {target:<기록 이름>, pid, order}  → 참가자 번호·순서를 고쳐 새 이름으로 저장
  if (req.method === "PATCH") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const target = String(b.target || "");
    const v = target ? await store.get(target, { type: "json" }) : null;
    if (!v) return json({ error: "not_found" }, 404);
    let pid = String(b.pid || v.pid || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    const pm = pid.match(/^P([0-9O]{1,3})$/);
    if (pm) { const d = pm[1].replace(/O/g, "0"); pid = "P" + (d.length < 2 ? "0" + d : d); }
    if (!pid) return json({ error: "bad_data" }, 400);
    const [lk, rest = ""] = target.split("/");
    const stamp = rest.split("_").pop();
    const isSv = v.type === "pre" || v.type === "post";
    const order = isSv ? undefined : (b.order === undefined || b.order === "" ? (Number(v.order) || 0) : (Number(b.order) || 0));
    const nkey = isSv ? `${v.type}/${pid}_${stamp}` : `${lk}/${pid}_${order}_${stamp}`;
    const nv = { ...v, pid, editedAt: new Date().toISOString(), editedFrom: { pid: v.pid, order: v.order } };
    if (!isSv) nv.order = order;
    await store.setJSON(nkey, nv);
    if (nkey !== target) await store.delete(target);
    return json({ ok: true, key: nkey });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/log" };

// StockFit AI — 과제 기록 + 과제 직후 설문 자동 저장 / 조회 / 초기화 (Netlify Blobs)
// 저장 위치: Netlify Blobs 저장소 "stockfit-logs"
//   기록 이름: <링크>/<참가자번호>_<순서>_<저장시각>   예) s5/P01_1_1730350000000
// POST   /api/log                     {pid, group, order, link, text, survey}
// GET    /api/log?key=…               전체 기록 (Netlify 환경변수 RESULTS_KEY 와 일치해야 함)
// DELETE /api/log?key=…&link=s5 | &pid=P01 | &target=<기록 이름> | &all=1
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
    const pid = String(b.pid || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
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
      if (v && v.link) items.push({ key: bl.key, type: "task", ...v });
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

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/log" };

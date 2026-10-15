// StockFit AI — 생성 답변 프록시
// API 키는 Netlify 환경변수 ANTHROPIC_API_KEY 에만 저장 (참가자 기기로 전달되지 않음)
const MODEL = "claude-haiku-4-5-20251001";
const MAX_PROMPT_CHARS = 30000;

const json = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 같은 사이트의 페이지에서 온 요청만 허용
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "forbidden" }, 403);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "no_key" }, 500);

  let prompt = "";
  try {
    const body = await req.json();
    prompt = typeof body.prompt === "string" ? body.prompt : "";
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return json({ error: "bad_prompt" }, 400);

  try {
    const headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    // 여러 워크스페이스용 키라면 Netlify 환경변수 ANTHROPIC_WORKSPACE_ID 도 설정
    if (process.env.ANTHROPIC_WORKSPACE_ID) headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (j.error && j.error.type) || "http_" + r.status }, 502);
    const text = (j.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (!text) return json({ error: "empty" }, 502);
    return json({ text }, 200);
  } catch {
    return json({ error: "network" }, 502);
  }
};

export const config = { path: "/api/chat" };

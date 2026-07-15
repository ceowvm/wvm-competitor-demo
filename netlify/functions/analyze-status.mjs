const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function extractOutputText(apiResponse) {
  for (const item of apiResponse.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function normalizeCompanies(items, limit = 10) {
  const seen = new Set();
  const result = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = cleanText(item?.name, 200);
    const website = cleanText(item?.website, 500);
    const phone = cleanText(item?.phone, 100) || "Не найден";

    if (!name || !website) continue;

    const key = website
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");

    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, website, phone });
    if (result.length >= limit) break;
  }

  return result;
}

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Разрешён только POST-запрос." }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "На сервере не задан OPENAI_API_KEY." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Некорректный формат запроса." }, 400);
  }

  const responseId = cleanText(body?.responseId, 200);
  const requestedCount = Math.min(10, Math.max(1, Number.parseInt(body?.requestedCount, 10) || 10));

  if (!/^resp_[A-Za-z0-9_-]+$/.test(responseId)) {
    return jsonResponse({ error: "Некорректный идентификатор анализа." }, 400);
  }

  try {
    const apiResponse = await fetch(
      `https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      }
    );

    const raw = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error("OpenAI status error:", raw);
      return jsonResponse({ error: raw?.error?.message || "Не удалось проверить статус анализа." }, 502);
    }

    if (raw.status === "queued" || raw.status === "in_progress") {
      return jsonResponse({ status: raw.status, responseId });
    }

    if (raw.status !== "completed") {
      const reason = raw?.error?.message || raw?.incomplete_details?.reason || `Задача завершилась со статусом ${raw.status}.`;
      return jsonResponse({ status: raw.status || "failed", error: reason }, 502);
    }

    const outputText = extractOutputText(raw);
    if (!outputText) {
      return jsonResponse({ error: "Анализ завершён, но результат не найден." }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      console.error("Invalid JSON output:", outputText);
      return jsonResponse({ error: "Не удалось обработать готовый результат." }, 502);
    }

    const companies = normalizeCompanies(parsed.companies, requestedCount);
    return jsonResponse({
      status: "completed",
      companies,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Сервер не смог проверить состояние анализа." }, 500);
  }
};

export const config = {
  path: "/api/analyze/status",
  method: "POST",
};

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

  const niche = cleanText(body?.niche, 120);
  const region = cleanText(body?.region, 120);
  const count = Math.min(10, Math.max(1, Number.parseInt(body?.count, 10) || 5));

  if (!niche || !region) {
    return jsonResponse({ error: "Заполните нишу и регион." }, 400);
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      companies: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            website: { type: "string" },
            phone: { type: "string" },
          },
          required: ["name", "website", "phone"],
        },
      },
    },
    required: ["companies"],
  };

  const prompt = `
Найди до ${count} действующих компаний-конкурентов.

Ниша: ${niche}
Регион: ${region}

Правила:
1. Используй веб-поиск и проверяй актуальные страницы.
2. Включай только компании, которые действительно работают в указанной нише и регионе.
3. website должен содержать официальный сайт. Не используй каталоги, карты, агрегаторы и соцсети вместо сайта.
4. Телефон бери только с официального сайта: со страницы контактов, из шапки или подвала.
5. Если официальный сайт найден, но телефон подтвердить не удалось, укажи «Не найден».
6. Не придумывай названия, сайты или телефоны.
7. Удали дубли и разные филиалы одной компании, если у них один сайт.
8. Лучше вернуть меньше компаний, чем добавить неподтверждённые сведения.
`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        background: true,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: "Ты аккуратный аналитик рынка. Собирай только проверяемые контактные данные и не заполняй пробелы догадками.",
            }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "competitor_contacts",
            strict: true,
            schema,
          },
        },
        max_output_tokens: 1800,
      }),
    });

    const raw = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error("OpenAI start error:", raw);
      return jsonResponse({ error: raw?.error?.message || "Не удалось запустить анализ." }, 502);
    }

    if (!raw?.id) {
      return jsonResponse({ error: "OpenAI не вернул идентификатор задачи." }, 502);
    }

    return jsonResponse({
      responseId: raw.id,
      status: raw.status || "queued",
      meta: { niche, region, requestedCount: count },
    });
  } catch (error) {
    console.error(error);
    if (error?.name === "AbortError") {
      return jsonResponse({ error: "Запуск анализа занял слишком много времени. Повторите запрос." }, 504);
    }
    return jsonResponse({ error: "Не удалось запустить анализ." }, 500);
  } finally {
    clearTimeout(timeout);
  }
};

export const config = {
  path: "/api/analyze/start",
  method: "POST",
};

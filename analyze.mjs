const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function extractOutputText(apiResponse) {
  for (const item of apiResponse.output ?? []) {
    if (item.type !== "message") continue;

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }

  return "";
}

function normalizeCompanies(items, limit) {
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
    return jsonResponse(
      {
        error:
          "На сервере не задан OPENAI_API_KEY. Добавьте ключ в Netlify: Project configuration → Environment variables.",
      },
      500
    );
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
            name: {
              type: "string",
              description: "Официальное название компании или бренда.",
            },
            website: {
              type: "string",
              description: "Полный URL официального сайта компании.",
            },
            phone: {
              type: "string",
              description:
                "Телефон, подтверждённый на официальном сайте, или строка 'Не найден'.",
            },
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

Обязательные правила:
1. Используй веб-поиск и проверяй актуальные страницы.
2. Включай только компании, которые действительно работают в указанной нише и регионе.
3. Поле website должно содержать официальный сайт компании. Не используй каталоги, карты, агрегаторы, социальные сети и рекламные карточки вместо официального сайта.
4. Телефон бери только с официального сайта: со страницы контактов, шапки или подвала.
5. Если официальный сайт найден, но телефон на нём подтвердить не удалось, укажи «Не найден».
6. Не придумывай названия, сайты или телефоны.
7. Удали дубли и разные филиалы одной и той же компании, если у них один сайт.
8. Старайся вернуть ровно ${count} компаний, но лучше вернуть меньше, чем добавить неподтверждённые данные.
9. Названия оставляй на языке официального сайта.
`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6",
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Ты — аккуратный аналитик рынка. Твоя задача — собирать только проверяемые контактные данные компаний и не заполнять пробелы догадками.",
              },
            ],
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
        max_output_tokens: 2200,
      }),
    });

    const raw = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error("OpenAI API error:", raw);
      const apiMessage = raw?.error?.message || "Неизвестная ошибка OpenAI API.";
      return jsonResponse({ error: `Ошибка OpenAI API: ${apiMessage}` }, 502);
    }

    const outputText = extractOutputText(raw);

    if (!outputText) {
      console.error("No output text:", raw);
      return jsonResponse(
        { error: "Сервис поиска не вернул структурированный результат." },
        502
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(outputText);
    } catch {
      console.error("Invalid JSON output:", outputText);
      return jsonResponse(
        { error: "Не удалось обработать ответ сервиса поиска." },
        502
      );
    }

    const companies = normalizeCompanies(parsed.companies, count);

    return jsonResponse({
      companies,
      meta: {
        niche,
        region,
        requestedCount: count,
        returnedCount: companies.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    if (error?.name === "AbortError") {
      return jsonResponse(
        {
          error:
            "Поиск занял больше 55 секунд и был остановлен. Уменьшите количество компаний или повторите запрос.",
        },
        504
      );
    }

    return jsonResponse(
      { error: "Сервер не смог выполнить запрос. Проверьте журнал функций Netlify." },
      500
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const config = {
  path: "/api/analyze",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 3600,
    windowLimit: 10,
  },
};

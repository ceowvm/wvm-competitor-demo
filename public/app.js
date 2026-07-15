const form = document.querySelector("#analysis-form");
const nicheInput = document.querySelector("#niche");
const regionInput = document.querySelector("#region");
const countInput = document.querySelector("#count");
const decreaseButton = document.querySelector("#decrease");
const increaseButton = document.querySelector("#increase");
const submitButton = document.querySelector("#submit-button");

const statusPanel = document.querySelector("#status-panel");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const statusPercent = document.querySelector("#status-percent");
const progressBar = document.querySelector("#progress-bar");

const resultsSection = document.querySelector("#results-section");
const resultsBody = document.querySelector("#results-body");
const resultsMeta = document.querySelector("#results-meta");
const downloadButton = document.querySelector("#download-csv");

const errorPanel = document.querySelector("#error-panel");
const errorMessage = document.querySelector("#error-message");

let currentCompanies = [];
let currentQuery = { niche: "", region: "", count: 0 };
let progressTimer = null;
let activeRunToken = 0;

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 5;
  return Math.min(10, Math.max(1, parsed));
}

function updateCount(delta) {
  countInput.value = clampCount(Number(countInput.value) + delta);
}

decreaseButton.addEventListener("click", () => updateCount(-1));
increaseButton.addEventListener("click", () => updateCount(1));
countInput.addEventListener("change", () => {
  countInput.value = clampCount(countInput.value);
});

function setProgress(percent, title, description) {
  statusPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  statusTitle.textContent = title;
  statusDescription.textContent = description;
}

function showStatus() {
  clearInterval(progressTimer);
  statusPanel.classList.remove("is-hidden");
  resultsSection.classList.add("is-hidden");
  errorPanel.classList.add("is-hidden");

  let percent = 8;
  setProgress(percent, "Запускаем исследование", "Создаём фоновую задачу.");

  progressTimer = setInterval(() => {
    percent = Math.min(88, percent + (percent < 55 ? 5 : 2));

    if (percent < 35) {
      setProgress(percent, "Ищем подходящие компании", "Формируем поисковые запросы по нише и региону.");
    } else if (percent < 65) {
      setProgress(percent, "Проверяем официальные сайты", "Отсеиваем каталоги, агрегаторы и нерелевантные страницы.");
    } else {
      setProgress(percent, "Собираем контактные данные", "Проверяем сайты, телефоны и удаляем дубли.");
    }
  }, 3500);

  statusPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function finishStatus() {
  clearInterval(progressTimer);
  setProgress(100, "Анализ завершён", "Готовим таблицу к отображению.");
}

function resetButton() {
  submitButton.disabled = false;
  submitButton.querySelector("span:first-child").textContent = "НАЧАТЬ АНАЛИЗ";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!url || url === "Не найден") return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function renderResults(companies) {
  currentCompanies = companies;
  resultsBody.innerHTML = "";

  companies.forEach((company, index) => {
    const website = normalizeUrl(company.website);
    const websiteCell = website
      ? `<a class="site-link" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(company.website)}</a>`
      : "Не найден";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(company.name)}</strong></td>
      <td>${websiteCell}</td>
      <td>${escapeHtml(company.phone || "Не найден")}</td>
    `;
    resultsBody.appendChild(row);
  });

  resultsMeta.textContent =
    `Найдено ${companies.length} из ${currentQuery.count}. ` +
    `Ниша: ${currentQuery.niche}. Регион: ${currentQuery.region}.`;

  resultsSection.classList.remove("is-hidden");
  window.setTimeout(() => {
    statusPanel.classList.add("is-hidden");
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 550);
}

function showError(message) {
  clearInterval(progressTimer);
  statusPanel.classList.add("is-hidden");
  resultsSection.classList.add("is-hidden");
  errorMessage.textContent = message;
  errorPanel.classList.remove("is-hidden");
  errorPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка сервера: ${response.status}`);
  return data;
}

async function waitForCompletion(responseId, requestedCount, runToken) {
  const startedAt = Date.now();
  const maxWaitMs = 5 * 60 * 1000;

  while (Date.now() - startedAt < maxWaitMs) {
    if (runToken !== activeRunToken) throw new Error("Анализ был остановлен новым запросом.");

    await sleep(3000);
    const data = await postJson("/api/analyze/status", { responseId, requestedCount });

    if (data.status === "completed") return data.companies || [];
    if (data.status !== "queued" && data.status !== "in_progress") {
      throw new Error(data.error || `Анализ завершился со статусом ${data.status}.`);
    }
  }

  throw new Error("Анализ выполняется дольше пяти минут. Попробуйте уменьшить количество компаний.");
}

function csvEscape(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function downloadCsv() {
  if (!currentCompanies.length) return;

  const rows = [
    ["Название", "Сайт", "Телефон"],
    ...currentCompanies.map((company) => [company.name || "", company.website || "", company.phone || ""]),
  ];

  const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeNiche = currentQuery.niche
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  link.href = url;
  link.download = `competitors-${safeNiche || "research"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

downloadButton.addEventListener("click", downloadCsv);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const niche = nicheInput.value.trim();
  const region = regionInput.value.trim();
  const count = clampCount(countInput.value);
  if (!niche || !region) return;

  currentQuery = { niche, region, count };
  activeRunToken += 1;
  const runToken = activeRunToken;

  submitButton.disabled = true;
  submitButton.querySelector("span:first-child").textContent = "АНАЛИЗИРУЕМ…";
  showStatus();

  try {
    const started = await postJson("/api/analyze/start", { niche, region, count });
    if (!started.responseId) throw new Error("Сервер не вернул идентификатор анализа.");

    setProgress(18, "Исследование запущено", "Задача выполняется в фоне. Страницу можно оставить открытой.");

    const companies = await waitForCompletion(started.responseId, count, runToken);
    if (!companies.length) {
      throw new Error("По заданным параметрам не удалось найти компании с подтверждёнными официальными сайтами.");
    }

    finishStatus();
    renderResults(companies);
  } catch (error) {
    console.error(error);
    showError(error?.message || "Произошла непредвиденная ошибка. Повторите запрос.");
  } finally {
    if (runToken === activeRunToken) resetButton();
  }
});

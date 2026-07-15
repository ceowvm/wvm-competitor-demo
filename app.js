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
let currentQuery = { niche: "", region: "" };
let progressTimer = null;

const progressSteps = [
  { percent: 15, title: "Ищем подходящие компании", description: "Формируем поисковые запросы по нише и региону." },
  { percent: 38, title: "Проверяем официальные сайты", description: "Отсеиваем каталоги, агрегаторы и нерелевантные страницы." },
  { percent: 62, title: "Собираем контактные данные", description: "Ищем телефон на сайте каждой компании." },
  { percent: 82, title: "Проверяем результаты", description: "Удаляем дубли и готовим итоговую таблицу." },
];

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

function showStatus() {
  clearInterval(progressTimer);
  let index = 0;
  statusPanel.classList.remove("is-hidden");
  resultsSection.classList.add("is-hidden");
  errorPanel.classList.add("is-hidden");

  const renderStep = () => {
    const step = progressSteps[index];
    statusPercent.textContent = `${step.percent}%`;
    progressBar.style.width = `${step.percent}%`;
    statusTitle.textContent = step.title;
    statusDescription.textContent = step.description;
    if (index < progressSteps.length - 1) index += 1;
  };

  renderStep();
  progressTimer = setInterval(renderStep, 6500);
  statusPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function finishStatus() {
  clearInterval(progressTimer);
  statusPercent.textContent = "100%";
  progressBar.style.width = "100%";
  statusTitle.textContent = "Анализ завершён";
  statusDescription.textContent = "Готовим таблицу к отображению.";
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

function renderResults(companies, meta) {
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

  const requested = meta?.requestedCount ?? companies.length;
  resultsMeta.textContent = `Найдено ${companies.length} из ${requested}. Ниша: ${currentQuery.niche}. Регион: ${currentQuery.region}.`;
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

function csvEscape(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function downloadCsv() {
  if (!currentCompanies.length) return;

  const rows = [
    ["Название", "Сайт", "Телефон"],
    ...currentCompanies.map((company) => [
      company.name || "",
      company.website || "",
      company.phone || "",
    ]),
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

  currentQuery = { niche, region };
  submitButton.disabled = true;
  submitButton.querySelector("span:first-child").textContent = "АНАЛИЗИРУЕМ…";
  showStatus();

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche, region, count }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Ошибка сервера: ${response.status}`);
    }

    if (!Array.isArray(data.companies) || data.companies.length === 0) {
      throw new Error("По заданным параметрам не удалось найти компании с подтверждёнными сайтами.");
    }

    finishStatus();
    renderResults(data.companies, data.meta);
  } catch (error) {
    console.error(error);
    showError(
      error?.message ||
        "Произошла непредвиденная ошибка. Проверьте настройки API и повторите запрос."
    );
  } finally {
    resetButton();
  }
});

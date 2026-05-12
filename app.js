const STATUS = {
  decided: { icon: "✅", label: "Decided", className: "status-decided" },
  acquired: { icon: "💰", label: "Acquired", className: "status-acquired" },
  ordered: { icon: "📦", label: "Ordered", className: "status-ordered" },
  researching: { icon: "🔍", label: "Researching", className: "status-researching" },
  needed: { icon: "❌", label: "Needed", className: "status-needed" }
};

const STATUS_ORDER = ["decided", "acquired", "ordered", "researching", "needed"];
const GITHUB_API = "https://api.github.com";
const REPO = "opurtell/bike-build-tracker";
const FILE_PATH = "data.json";

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat("en-AU");

let dashboardData = null;
let dirtyPaths = new Set();
let activeEditor = null;

async function loadDashboard() {
  wireChrome();

  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load data.json (${response.status})`);
    dashboardData = await response.json();
    render(dashboardData);
    updateEditorVisibility();
  } catch (error) {
    document.querySelector("main").innerHTML = `
      <section class="panel">
        <h2>Dashboard could not load</h2>
        <p class="section-note">${escapeHtml(error.message)}</p>
      </section>
    `;
  }
}

function render(data) {
  const stats = getStats(data);
  const openCards = getOpenCards();

  document.title = data.meta.title;
  document.getElementById("page-title").textContent = `🚴 ${data.meta.title}`;
  document.getElementById("page-subtitle").textContent = data.meta.subtitle;
  document.getElementById("last-updated").textContent = `Last updated: ${formatDate(data.meta.lastUpdated)}`;
  renderLastSaved();

  renderSummary(data, stats);
  renderBudget(data, stats);
  renderWeight(data, stats);
  renderParts(data);
  renderDeals(data.deals || []);
  restoreOpenCards(openCards);
  updateDirtyUi();
  updateEditorVisibility();
}

function getStats(data) {
  const parts = data.categories.flatMap((category, categoryIndex) =>
    category.parts.map((part, partIndex) => ({ ...part, category: category.name, categoryIndex, partIndex }))
  );
  const totalParts = parts.length;
  const decisionParts = parts.filter(part => ["decided", "acquired", "ordered"].includes(part.status)).length;
  const acquiredParts = parts.filter(part => part.status === "acquired").length;
  const totalSpent = parts.reduce((sum, part) => sum + numeric(part.actualPrice), 0);
  const estimatedTotal = parts.reduce((sum, part) => sum + numeric(part.priceLow), 0);
  const estimatedWeight = data.categories.reduce(
    (sum, category) => sum + category.parts.reduce((partSum, part) => partSum + numeric(part.estimatedWeight), 0),
    0
  );
  const actualWeight = parts.reduce((sum, part) => sum + numeric(part.actualWeight), 0);
  const hasActualWeight = parts.some(part => Number.isFinite(part.actualWeight));
  const buildProgress = totalParts ? Math.round((decisionParts / totalParts) * 100) : 0;

  return {
    parts,
    totalParts,
    decisionParts,
    acquiredParts,
    totalSpent,
    estimatedTotal,
    budgetRemaining: Math.max(0, data.budget.totalHigh - estimatedTotal),
    estimatedWeight,
    actualWeight: hasActualWeight ? actualWeight : null,
    buildProgress
  };
}

function renderSummary(data, stats) {
  const weightDelta = stats.estimatedWeight - data.targetWeight.min;
  const weightPercent = clamp(((stats.estimatedWeight - data.targetWeight.min) / (data.targetWeight.max - data.targetWeight.min)) * 100, 0, 100);

  const cards = [
    {
      label: "Estimated Total",
      value: money(stats.estimatedTotal),
      sub: `${money(stats.totalSpent)} actually spent · ${money(stats.budgetRemaining)} buffer vs ${money(data.budget.totalHigh)} cap`,
      percent: clamp((stats.estimatedTotal / data.budget.totalHigh) * 100, 0, 100)
    },
    {
      label: "Estimated Weight",
      value: `${(stats.estimatedWeight / 1000).toFixed(2)} kg`,
      sub: `${numberFormatter.format(weightDelta)}g above 6.8kg UCI min`,
      percent: weightPercent
    },
    {
      label: "Parts Decided",
      value: `${stats.decisionParts} of ${stats.totalParts}`,
      sub: `${stats.totalParts - stats.decisionParts} still need a decision`,
      percent: totalPercent(stats.decisionParts, stats.totalParts)
    },
    {
      label: "Build Progress",
      value: `${stats.buildProgress}%`,
      sub: "Based on decided, ordered, or acquired parts",
      percent: stats.buildProgress
    }
  ];

  document.getElementById("summary").innerHTML = cards.map(card => `
    <article class="card">
      <p class="metric-label">${escapeHtml(card.label)}</p>
      <div class="metric-value">${escapeHtml(card.value)}</div>
      <p class="metric-sub">${escapeHtml(card.sub)}</p>
      <div class="progress-shell" aria-hidden="true">
        <div class="progress-fill" style="--value: ${clamp(card.percent, 0, 100).toFixed(1)}%"></div>
      </div>
    </article>
  `).join("");
}

function renderBudget(data, stats) {
  const maxHigh = Math.max(...data.categories.map(category => numeric(category.budgetHigh)), data.budget.totalHigh);
  const rows = data.categories.map(category => {
    const estimate = category.parts.reduce((sum, part) => sum + numeric(part.priceLow), 0);
    const actual = category.parts.reduce((sum, part) => sum + numeric(part.actualPrice), 0);
    return renderTrackerRow({
      name: category.name,
      meta: `${money(category.budgetLow)}–${money(category.budgetHigh)} budget · ${money(estimate)} estimated · ${money(actual)} spent`,
      rangePercent: (numeric(category.budgetHigh) / maxHigh) * 100,
      actualPercent: estimate ? (estimate / maxHigh) * 100 : null
    });
  });

  rows.push(renderTrackerRow({
    name: "Total",
    meta: `${money(data.budget.totalLow)}–${money(data.budget.totalHigh)} target · ${money(stats.estimatedTotal)} estimated · ${money(stats.totalSpent)} spent`,
    rangePercent: 100,
    actualPercent: (stats.estimatedTotal / data.budget.totalHigh) * 100,
    total: true
  }));

  document.getElementById("budget-note").textContent = `${money(stats.estimatedTotal)} estimated total · ${money(stats.totalSpent)} actually spent.`;
  document.getElementById("budget-tracker").innerHTML = rows.join("");
}

function renderWeight(data, stats) {
  const categoryWeights = data.categories.map(category => ({
    name: category.name,
    estimated: category.parts.reduce((sum, part) => sum + numeric(part.estimatedWeight), 0),
    actual: category.parts.some(part => Number.isFinite(part.actualWeight))
      ? category.parts.reduce((sum, part) => sum + numeric(part.actualWeight), 0)
      : null
  }));
  const maxEstimated = Math.max(...categoryWeights.map(row => row.estimated), stats.estimatedWeight);
  const rows = categoryWeights.map(row => renderTrackerRow({
    name: row.name,
    meta: `${grams(row.estimated)} est · ${row.actual === null ? "actual pending" : `${grams(row.actual)} actual`}`,
    rangePercent: (row.estimated / maxEstimated) * 100,
    actualPercent: row.actual === null ? null : (row.actual / maxEstimated) * 100
  }));

  rows.push(renderTrackerRow({
    name: "Total",
    meta: `${grams(stats.estimatedWeight)} estimated · target ${grams(data.targetWeight.min)}–${grams(data.targetWeight.max)}`,
    rangePercent: (stats.estimatedWeight / data.targetWeight.max) * 100,
    actualPercent: null,
    total: true
  }));

  document.getElementById("weight-note").textContent = `${(stats.estimatedWeight / 1000).toFixed(2)}kg estimated complete build.`;
  document.getElementById("weight-tracker").innerHTML = rows.join("");
}

function renderTrackerRow({ name, meta, rangePercent, actualPercent, total = false }) {
  return `
    <div class="tracker-row${total ? " tracker-total" : ""}">
      <div class="tracker-head">
        <span class="tracker-name">${escapeHtml(name)}</span>
        <span class="tracker-meta">${escapeHtml(meta)}</span>
      </div>
      <div class="range-bar" aria-hidden="true">
        <div class="range-fill" style="--range: ${clamp(rangePercent, 0, 100).toFixed(1)}%"></div>
        ${actualPercent === null ? "" : `<span class="actual-marker" style="--actual: ${clamp(actualPercent, 0, 100).toFixed(1)}%"></span>`}
      </div>
    </div>
  `;
}

function renderParts(data) {
  const categoryMarkup = data.categories.map((category, categoryIndex) => `
    <div class="category-group">
      <div class="category-header">
        <h3>${editable({ path: `categories.${categoryIndex}.name`, value: category.name, type: "text" })}</h3>
        <span class="category-meta">${category.parts.length} ${category.parts.length === 1 ? "part" : "parts"}</span>
      </div>
      ${category.parts.map((part, partIndex) => renderPart(part, categoryIndex, partIndex)).join("")}
      ${hasToken() ? `<button class="add-part-btn" type="button" data-category-index="${categoryIndex}">+ Add part to ${escapeHtml(category.name)}</button>` : ""}
    </div>
  `).join("");

  document.getElementById("parts-list").innerHTML = categoryMarkup;
}

function renderPart(part, categoryIndex, partIndex) {
  const basePath = `categories.${categoryIndex}.parts.${partIndex}`;
  const status = STATUS[part.status] || { icon: "•", label: part.status || "Unknown", className: "status-missing" };
  const notes = part.notes && part.notes.trim() ? part.notes : "No notes yet.";

  return `
    <details class="part-card" data-card-key="${basePath}">
      <summary class="part-summary">
        <span class="status-icon ${status.className}" title="${escapeHtml(status.label)}">${status.icon}</span>
        <span class="part-title">
          <strong>${editable({ path: `${basePath}.component`, value: part.component, type: "text" })}</strong>
          <span>${editable({ path: `${basePath}.product`, value: part.product, type: "text", fallback: "TBD" })}</span>
        </span>
        <span class="part-price">${formatPriceSummary(part)} <span class="chevron" aria-hidden="true"></span></span>
      </summary>
      <div class="part-details">
        <div class="detail-grid">
          ${detailBox("Status", editable({ path: `${basePath}.status`, value: part.status, type: "status" }))}
          ${detailBox("Estimated Weight", editable({ path: `${basePath}.estimatedWeight`, value: part.estimatedWeight, type: "number", suffix: "g" }))}
          ${detailBox("Actual Weight", editable({ path: `${basePath}.actualWeight`, value: part.actualWeight, type: "number", nullable: true, suffix: "g", fallback: "Pending" }))}
          ${detailBox("Price Low", editable({ path: `${basePath}.priceLow`, value: part.priceLow, type: "number", prefix: "$" }))}
          ${detailBox("Price High", editable({ path: `${basePath}.priceHigh`, value: part.priceHigh, type: "number", prefix: "$" }))}
          ${detailBox("Actual Price", editable({ path: `${basePath}.actualPrice`, value: part.actualPrice, type: "number", nullable: true, prefix: "$", fallback: "$0 spent" }))}
          ${detailBox("Source", editable({ path: `${basePath}.source`, value: part.source, type: "text", fallback: "TBD" }))}
        </div>
        <div>
          <span class="detail-label">Notes</span>
          <p class="notes">${editable({ path: `${basePath}.notes`, value: notes, type: "textarea", fallback: "No notes yet." })}</p>
        </div>
      </div>
    </details>
  `;
}

function detailBox(label, value) {
  return `
    <div class="detail-box">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${value}</span>
    </div>
  `;
}

function editable({ path, value, type, nullable = false, prefix = "", suffix = "", fallback = "—" }) {
  const rawValue = value ?? "";
  let display;

  if (type === "status") {
    const status = STATUS[value] || { icon: "•", label: value || "Unknown" };
    display = `${status.icon} ${status.label}`;
  } else if ((value === null || value === undefined || value === "") && nullable) {
    display = fallback;
  } else if (type === "number") {
    display = `${prefix}${numberFormatter.format(numeric(value))}${suffix}`;
  } else {
    display = value || fallback;
  }

  const classes = ["editable"];
  if (hasToken()) classes.push("can-edit");
  if (isDirtyPath(path)) classes.push("changed");

  return `<span class="${classes.join(" ")}" data-path="${escapeHtml(path)}" data-type="${escapeHtml(type)}" data-nullable="${nullable}" data-prefix="${escapeHtml(prefix)}" data-suffix="${escapeHtml(suffix)}" data-raw="${escapeHtml(rawValue)}">${escapeHtml(display)}</span>`;
}

function renderDeals(deals) {
  const container = document.getElementById("deal-history");
  if (!deals.length) {
    container.innerHTML = `
      <div class="empty-state">
        No deal history yet. The daily scanner can drop recent finds here when it starts writing to <strong>data.json</strong>.
      </div>
    `;
    return;
  }

  container.innerHTML = deals.map(deal => `
    <article class="tracker-row">
      <div class="tracker-head">
        <span class="tracker-name">${escapeHtml(deal.title || "Deal")}</span>
        <span class="tracker-meta">${escapeHtml(deal.date || "")}</span>
      </div>
      <p class="metric-sub">${escapeHtml(deal.notes || "")}</p>
    </article>
  `).join("");
}

function wireChrome() {
  document.addEventListener("click", event => {
    const editableEl = event.target.closest(".editable.can-edit");
    if (editableEl) {
      event.preventDefault();
      event.stopPropagation();
      beginInlineEdit(editableEl);
      return;
    }

    const addPartButton = event.target.closest(".add-part-btn");
    if (addPartButton) {
      openAddPartModal(Number(addPartButton.dataset.categoryIndex));
      return;
    }
  });

  document.getElementById("settings-button")?.addEventListener("click", openSettingsModal);
  document.getElementById("settings-close")?.addEventListener("click", closeSettingsModal);
  document.getElementById("settings-save")?.addEventListener("click", saveSettings);
  document.getElementById("token-toggle")?.addEventListener("click", toggleTokenVisibility);
  document.getElementById("save-button")?.addEventListener("click", saveToGitHub);
  document.getElementById("add-category-button")?.addEventListener("click", addCategory);
  document.getElementById("add-part-cancel")?.addEventListener("click", closeAddPartModal);
  document.getElementById("add-part-form")?.addEventListener("submit", handleAddPartSubmit);

  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) closeModals();
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModals();
  });
}

function beginInlineEdit(element) {
  if (activeEditor) commitInlineEdit(activeEditor);

  const { path, type, nullable, raw } = element.dataset;
  const currentValue = getByPath(dashboardData, path);
  let control;

  if (type === "status") {
    control = document.createElement("select");
    for (const key of STATUS_ORDER) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${STATUS[key].icon} ${STATUS[key].label}`;
      control.appendChild(option);
    }
    control.value = currentValue || "needed";
  } else if (type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
    control.value = currentValue || "";
  } else {
    control = document.createElement("input");
    control.type = type === "number" ? "number" : "text";
    if (type === "number") control.step = "any";
    control.value = currentValue ?? raw ?? "";
  }

  control.className = "inline-editor";
  control.dataset.path = path;
  control.dataset.type = type;
  control.dataset.nullable = nullable;

  element.replaceWith(control);
  activeEditor = control;
  control.focus();
  if (control.select) control.select();

  control.addEventListener("blur", () => commitInlineEdit(control));
  control.addEventListener("keydown", event => {
    if (event.key === "Enter" && type !== "textarea") {
      event.preventDefault();
      commitInlineEdit(control);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      activeEditor = null;
      render(dashboardData);
    }
  });
}

function commitInlineEdit(control) {
  if (!control || activeEditor !== control) return;
  const { path, type, nullable } = control.dataset;
  let value = control.value;

  if (type === "number") {
    value = value === "" && nullable === "true" ? null : Number(value);
    if (Number.isNaN(value)) value = null;
  }

  setByPath(dashboardData, path, value);
  dirtyPaths.add(path);
  activeEditor = null;
  render(dashboardData);
}

function openSettingsModal() {
  const tokenInput = document.getElementById("github-token-input");
  tokenInput.value = localStorage.getItem("github_token") || "";
  document.getElementById("settings-modal").hidden = false;
  tokenInput.focus();
}

function closeSettingsModal() {
  document.getElementById("settings-modal").hidden = true;
}

function saveSettings() {
  const token = document.getElementById("github-token-input").value.trim();
  if (token) localStorage.setItem("github_token", token);
  else localStorage.removeItem("github_token");
  closeSettingsModal();
  render(dashboardData);
  showToast(token ? "GitHub token saved locally" : "GitHub token removed");
}

function toggleTokenVisibility() {
  const input = document.getElementById("github-token-input");
  input.type = input.type === "password" ? "text" : "password";
  document.getElementById("token-toggle").textContent = input.type === "password" ? "Show" : "Hide";
}

function addCategory() {
  if (!hasToken()) return openSettingsModal();
  const name = prompt("New category name?");
  if (!name || !name.trim()) return;

  dashboardData.categories.push({
    name: name.trim(),
    budgetLow: 0,
    budgetHigh: 0,
    estimatedWeightTotal: 0,
    parts: []
  });
  dirtyPaths.add(`categories.${dashboardData.categories.length - 1}`);
  render(dashboardData);
}

function openAddPartModal(categoryIndex) {
  if (!hasToken()) return openSettingsModal();
  document.getElementById("add-part-category-index").value = String(categoryIndex);
  document.getElementById("add-part-title").textContent = `Add part to ${dashboardData.categories[categoryIndex].name}`;
  document.getElementById("add-part-form").reset();
  document.getElementById("add-part-status").value = "needed";
  document.getElementById("add-part-modal").hidden = false;
  document.getElementById("add-part-component").focus();
}

function closeAddPartModal() {
  document.getElementById("add-part-modal").hidden = true;
}

function handleAddPartSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const categoryIndex = Number(document.getElementById("add-part-category-index").value);
  const fields = form.elements;
  const part = {
    component: fields.component.value.trim(),
    product: fields.product.value.trim(),
    source: fields.source.value.trim(),
    estimatedWeight: nullableNumber(fields.estimatedWeight.value),
    actualWeight: nullableNumber(fields.actualWeight.value),
    priceLow: nullableNumber(fields.priceLow.value) ?? 0,
    priceHigh: nullableNumber(fields.priceHigh.value) ?? 0,
    actualPrice: nullableNumber(fields.actualPrice.value),
    status: fields.status.value,
    ordered: false,
    received: false,
    notes: fields.notes.value.trim()
  };

  if (!part.component) {
    showToast("Component name is required", true);
    return;
  }

  dashboardData.categories[categoryIndex].parts.push(part);
  dirtyPaths.add(`categories.${categoryIndex}.parts.${dashboardData.categories[categoryIndex].parts.length - 1}`);
  closeAddPartModal();
  render(dashboardData);
}

async function saveToGitHub() {
  const token = localStorage.getItem("github_token");
  if (!token) {
    openSettingsModal();
    return;
  }
  if (!dashboardData || dirtyPaths.size === 0) return;

  const button = document.getElementById("save-button");
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    dashboardData.meta.lastUpdated = new Date().toISOString().slice(0, 10);
    const fileRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (!fileRes.ok) throw new Error(`Could not read GitHub file (${fileRes.status})`);
    const fileData = await fileRes.json();

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(dashboardData, null, 2) + "\n")));
    const saveRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Update bike build data ${new Date().toISOString().slice(0, 10)}`,
        content,
        sha: fileData.sha
      })
    });

    if (!saveRes.ok) {
      const errorText = await saveRes.text();
      throw new Error(`GitHub save failed (${saveRes.status}) ${errorText}`);
    }

    dirtyPaths.clear();
    localStorage.setItem("bike_dashboard_last_saved", new Date().toISOString());
    render(dashboardData);
    showToast("✅ Saved");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Save Changes";
    updateDirtyUi();
  }
}

function updateDirtyUi() {
  const hasChanges = dirtyPaths.size > 0;
  document.body.classList.toggle("has-unsaved", hasChanges);
  const count = document.getElementById("dirty-count");
  if (count) count.textContent = `${dirtyPaths.size} change${dirtyPaths.size === 1 ? "" : "s"}`;
}

function updateEditorVisibility() {
  document.body.classList.toggle("token-set", hasToken());
  document.querySelectorAll(".requires-token").forEach(el => {
    el.hidden = !hasToken();
  });
}

function renderLastSaved() {
  const element = document.getElementById("last-saved");
  if (!element) return;
  const lastSaved = localStorage.getItem("bike_dashboard_last_saved");
  element.textContent = lastSaved
    ? `Last saved by you: ${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSaved))}`
    : "Last saved by you: —";
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, isError ? 6000 : 2400);
}

function closeModals() {
  closeSettingsModal();
  closeAddPartModal();
}

function getOpenCards() {
  return new Set([...document.querySelectorAll(".part-card[open]")].map(card => card.dataset.cardKey));
}

function restoreOpenCards(openCards) {
  openCards.forEach(key => {
    const card = document.querySelector(`.part-card[data-card-key="${cssEscape(key)}"]`);
    if (card) card.open = true;
  });
}

function getByPath(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function setByPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((current, key) => current[key], object);
  target[last] = value;
}

function isDirtyPath(path) {
  return [...dirtyPaths].some(dirtyPath => dirtyPath === path || path.startsWith(`${dirtyPath}.`) || dirtyPath.startsWith(`${path}.`));
}

function hasToken() {
  return Boolean(localStorage.getItem("github_token"));
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function totalPercent(value, total) {
  return total ? (value / total) * 100 : 0;
}

function formatPriceSummary(part) {
  if (numeric(part.priceLow) === 0 && numeric(part.priceHigh) === 0) return "Included";
  if (part.priceLow === part.priceHigh) return money(part.priceLow);
  return `${money(part.priceLow)}–${money(part.priceHigh)}`;
}

function money(value) {
  return currencyFormatter.format(numeric(value));
}

function grams(value) {
  return value === null || value === undefined ? "—" : `${numberFormatter.format(numeric(value))}g`;
}

function numeric(value) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadDashboard();

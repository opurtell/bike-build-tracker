const STATUS = {
  acquired: { icon: "✅", label: "Acquired", className: "status-acquired" },
  ordered: { icon: "📦", label: "Ordered", className: "status-ordered" },
  researching: { icon: "🔍", label: "Researching", className: "status-researching" },
  needed: { icon: "❌", label: "Needed", className: "status-needed" }
};

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat("en-AU");

async function loadDashboard() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load data.json (${response.status})`);
    const data = await response.json();
    render(data);
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

  document.title = data.meta.title;
  document.getElementById("page-title").textContent = `🚴 ${data.meta.title}`;
  document.getElementById("page-subtitle").textContent = data.meta.subtitle;
  document.getElementById("last-updated").textContent = `Last updated: ${formatDate(data.meta.lastUpdated)}`;

  renderSummary(data, stats);
  renderBudget(data, stats);
  renderWeight(data, stats);
  renderParts(data);
  renderDeals(data.deals || []);
}

function getStats(data) {
  const parts = data.categories.flatMap(category => category.parts.map(part => ({ ...part, category: category.name })));
  const totalParts = parts.length;
  const acquiredParts = parts.filter(part => part.status === "acquired").length;
  const totalSpent = parts.reduce((sum, part) => sum + numeric(part.actualPrice), 0);
  const estimatedWeight = data.categories.reduce((sum, category) => {
    if (Number.isFinite(category.estimatedWeightTotal)) return sum + category.estimatedWeightTotal;
    return sum + category.parts.reduce((partSum, part) => partSum + numeric(part.estimatedWeight), 0);
  }, 0);
  const actualWeight = parts.reduce((sum, part) => sum + numeric(part.actualWeight), 0);
  const hasActualWeight = parts.some(part => Number.isFinite(part.actualWeight));
  const buildProgress = totalParts ? Math.round((acquiredParts / totalParts) * 100) : 0;

  return {
    parts,
    totalParts,
    acquiredParts,
    totalSpent,
    budgetRemaining: Math.max(0, data.budget.totalHigh - totalSpent),
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
      label: "Total Spent",
      value: money(stats.totalSpent),
      sub: `${money(stats.budgetRemaining)} remaining vs ${money(data.budget.totalHigh)} cap`,
      percent: clamp((stats.totalSpent / data.budget.totalHigh) * 100, 0, 100)
    },
    {
      label: "Estimated Weight",
      value: `${(stats.estimatedWeight / 1000).toFixed(2)} kg`,
      sub: `${numberFormatter.format(weightDelta)}g above 6.8kg UCI min`,
      percent: weightPercent
    },
    {
      label: "Parts Acquired",
      value: `${stats.acquiredParts} of ${stats.totalParts}`,
      sub: `${stats.totalParts - stats.acquiredParts} still to source`,
      percent: (stats.acquiredParts / stats.totalParts) * 100
    },
    {
      label: "Build Progress",
      value: `${stats.buildProgress}%`,
      sub: "Based on acquired parts count",
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
    const actual = category.parts.reduce((sum, part) => sum + numeric(part.actualPrice), 0);
    return renderTrackerRow({
      name: category.name,
      meta: `${money(category.budgetLow)}–${money(category.budgetHigh)} est · ${actual ? `${money(actual)} spent` : "not bought"}`,
      rangePercent: (numeric(category.budgetHigh) / maxHigh) * 100,
      actualPercent: actual ? (actual / maxHigh) * 100 : null
    });
  });

  rows.push(renderTrackerRow({
    name: "Total",
    meta: `${money(data.budget.totalLow)}–${money(data.budget.totalHigh)} target · ${money(stats.totalSpent)} spent`,
    rangePercent: 100,
    actualPercent: (stats.totalSpent / data.budget.totalHigh) * 100,
    total: true
  }));

  document.getElementById("budget-note").textContent = `${money(stats.totalSpent)} spent so far · ${money(stats.budgetRemaining)} remaining.`;
  document.getElementById("budget-tracker").innerHTML = rows.join("");
}

function renderWeight(data, stats) {
  const categoryWeights = data.categories.map(category => ({
    name: category.name,
    estimated: Number.isFinite(category.estimatedWeightTotal)
      ? category.estimatedWeightTotal
      : category.parts.reduce((sum, part) => sum + numeric(part.estimatedWeight), 0),
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
  document.getElementById("parts-list").innerHTML = data.categories.map(category => `
    <div class="category-group">
      <div class="category-header">
        <h3>${escapeHtml(category.name)}</h3>
        <span class="category-meta">${category.parts.length} ${category.parts.length === 1 ? "part" : "parts"}</span>
      </div>
      ${category.parts.map(renderPart).join("")}
    </div>
  `).join("");
}

function renderPart(part) {
  const status = STATUS[part.status] || { icon: "•", label: part.status || "Unknown", className: "status-missing" };
  const notes = part.notes && part.notes.trim() ? part.notes : "No notes yet.";

  return `
    <details class="part-card">
      <summary class="part-summary">
        <span class="status-icon ${status.className}" title="${escapeHtml(status.label)}">${status.icon}</span>
        <span class="part-title">
          <strong>${escapeHtml(part.component)}</strong>
          <span>${escapeHtml(part.product)}</span>
        </span>
        <span class="part-price">${formatPriceSummary(part)} <span class="chevron" aria-hidden="true"></span></span>
      </summary>
      <div class="part-details">
        <div class="detail-grid">
          <div class="detail-box">
            <span class="detail-label">Status</span>
            <span class="detail-value">${status.icon} ${escapeHtml(status.label)}</span>
          </div>
          <div class="detail-box">
            <span class="detail-label">Weight</span>
            <span class="detail-value">${grams(part.estimatedWeight)} est${part.actualWeight === null ? "" : ` · ${grams(part.actualWeight)} actual`}</span>
          </div>
          <div class="detail-box">
            <span class="detail-label">Price</span>
            <span class="detail-value">${formatPriceDetail(part)}</span>
          </div>
          <div class="detail-box">
            <span class="detail-label">Source</span>
            <span class="detail-value">${escapeHtml(part.source || "TBD")}</span>
          </div>
        </div>
        <p class="notes">${escapeHtml(notes)}</p>
      </div>
    </details>
  `;
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

function formatPriceSummary(part) {
  if (Number.isFinite(part.actualPrice) && part.actualPrice > 0) return money(part.actualPrice);
  if (Number.isFinite(part.actualPrice) && part.actualPrice === 0) return "Included";
  if (numeric(part.priceLow) === 0 && numeric(part.priceHigh) === 0) return "Included";
  if (part.priceLow === part.priceHigh) return money(part.priceLow);
  return `${money(part.priceLow)}–${money(part.priceHigh)}`;
}

function formatPriceDetail(part) {
  const estimate = part.priceLow === part.priceHigh ? money(part.priceLow) : `${money(part.priceLow)}–${money(part.priceHigh)}`;
  if (Number.isFinite(part.actualPrice)) {
    return part.actualPrice === 0 ? `${estimate} · included` : `${estimate} est · ${money(part.actualPrice)} actual`;
  }
  return `${estimate} est`;
}

function money(value) {
  return currencyFormatter.format(numeric(value));
}

function grams(value) {
  return `${numberFormatter.format(numeric(value))}g`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadDashboard();

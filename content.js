// ABOUTME: Content script that injects projection, budget, and API cost estimate bars into Claude's usage page.
// ABOUTME: Calculates projected usage, elapsed time budget, and estimated API equivalent cost per model.

(function () {
  "use strict";

  const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 h session window
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;     // refresh every 1 h
  const INITIAL_DELAY_MS = 2000;                  // wait for page to render

  // -- API pricing per million tokens (USD) --

  const API_PRICING = {
    opus:   { input: 5,  output: 25 },
    sonnet: { input: 3,  output: 15 },
    haiku:  { input: 1,  output: 5 },
  };

  // -- Estimated token limits per period (community estimates, not official) --
  // These are rough approximations. Actual limits depend on message length,
  // system load, and Anthropic's dynamic allocation.

  const WEEKLY_TOKEN_ESTIMATES = {
    pro:   { opus: 300_000,     sonnet: 2_000_000,   haiku: 10_000_000 },
    max5:  { opus: 1_500_000,   sonnet: 10_000_000,  haiku: 50_000_000 },
    max20: { opus: 6_000_000,   sonnet: 40_000_000,  haiku: 200_000_000 },
  };

  const SESSION_TOKEN_ESTIMATES = {
    pro:   { opus: 50_000,      sonnet: 300_000,     haiku: 1_500_000 },
    max5:  { opus: 250_000,     sonnet: 1_500_000,   haiku: 7_500_000 },
    max20: { opus: 1_000_000,   sonnet: 6_000_000,   haiku: 30_000_000 },
  };

  const PLAN_LABELS = { pro: "Pro ($20/mo)", max5: "Max 5x ($100/mo)", max20: "Max 20x ($200/mo)" };
  const PLAN_MONTHLY = { pro: 20, max5: 100, max20: 200 };
  const DEFAULT_IO_RATIO = 0.6; // 60% input, 40% output

  // -- Settings persistence via localStorage --

  function getSettings() {
    try {
      const raw = localStorage.getItem("claude-usage-ext-settings");
      return raw ? JSON.parse(raw) : { tier: "pro", ioRatio: DEFAULT_IO_RATIO };
    } catch {
      return { tier: "pro", ioRatio: DEFAULT_IO_RATIO };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem("claude-usage-ext-settings", JSON.stringify(settings));
  }

  // -- Helpers --

  function findRow(bar) {
    let el = bar;
    for (let i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) return null;
      if (el.className && el.className.includes("flex flex-row gap-x-8"))
        return el;
    }
    return null;
  }

  function parseResetTime(text) {
    const rel = text.match(/Resets in\s+(?:(\d+)\s*hr\s*)?(\d+)\s*min/);
    if (rel) {
      const h = parseInt(rel[1] || "0", 10);
      const m = parseInt(rel[2], 10);
      return { remainingMs: (h * 60 + m) * 60_000, type: "session" };
    }

    const weekly = text.match(
      /Resets\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/
    );
    if (weekly) {
      const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const targetDay = dayMap[weekly[1]];
      let targetHour = parseInt(weekly[2], 10);
      const targetMin = parseInt(weekly[3], 10);
      if (weekly[4] === "PM" && targetHour !== 12) targetHour += 12;
      if (weekly[4] === "AM" && targetHour === 12) targetHour = 0;

      const now = new Date();
      const reset = new Date(now);
      let daysUntil = targetDay - now.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      reset.setDate(now.getDate() + daysUntil);
      reset.setHours(targetHour, targetMin, 0, 0);

      return {
        remainingMs: reset.getTime() - now.getTime(),
        totalPeriodMs: 7 * 24 * 60 * 60 * 1000,
        type: "weekly",
      };
    }

    return null;
  }

  function getResetText(row) {
    for (const p of row.querySelectorAll("p")) {
      if (p.textContent.trim().startsWith("Resets")) return p.textContent.trim();
    }
    return "";
  }

  function periodTimes(resetInfo) {
    const total =
      resetInfo.type === "session"
        ? SESSION_WINDOW_MS
        : resetInfo.totalPeriodMs;
    const elapsed = total - resetInfo.remainingMs;
    return { total, elapsed };
  }

  function detectModel(row) {
    const text = row.textContent.toLowerCase();
    if (text.includes("opus")) return "opus";
    if (text.includes("sonnet")) return "sonnet";
    if (text.includes("haiku")) return "haiku";
    return null;
  }

  function formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
    return n.toString();
  }

  function formatCost(usd) {
    if (usd < 0.01) return "<$0.01";
    return "$" + usd.toFixed(2);
  }

  function blendedCostPerMillion(model, ioRatio) {
    const p = API_PRICING[model];
    return ioRatio * p.input + (1 - ioRatio) * p.output;
  }

  function estimateCost(tokens, model, ioRatio) {
    return (tokens / 1_000_000) * blendedCostPerMillion(model, ioRatio);
  }

  // -- Safe DOM builders --
  // All interpolated values are numbers or internal constants (no user input),
  // but we use DOM methods to satisfy CSP and security linting.

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
        else if (k === "title") node.title = v;
        else if (k.startsWith("style_")) node.style[k.slice(6)] = v;
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  // -- Renderers --

  function renderSettingsPanel() {
    const settings = getSettings();
    let panel = document.getElementById("claude-ext-settings");
    if (panel) return;

    const bars = document.querySelectorAll('[role="progressbar"]');
    if (bars.length === 0) return;
    const firstRow = findRow(bars[0]);
    if (!firstRow) return;
    const container = firstRow.parentElement;

    panel = el("div", { id: "claude-ext-settings", className: "ce-settings-panel" });

    // Tier select
    const tierSelect = el("select", { id: "ce-tier-select", className: "ce-select" });
    for (const [k, v] of Object.entries(PLAN_LABELS)) {
      const opt = el("option", { value: k, textContent: v });
      if (k === settings.tier) opt.selected = true;
      tierSelect.appendChild(opt);
    }

    // I/O ratio select
    const ioSelect = el("select", { id: "ce-io-select", className: "ce-select" });
    const ioOptions = [
      { value: "0.8", label: "80/20 (long prompts)" },
      { value: "0.6", label: "60/40 (typical chat)" },
      { value: "0.5", label: "50/50 (balanced)" },
      { value: "0.3", label: "30/70 (long outputs)" },
    ];
    for (const opt of ioOptions) {
      const option = el("option", { value: opt.value, textContent: opt.label });
      if (parseFloat(opt.value) === settings.ioRatio) option.selected = true;
      ioSelect.appendChild(option);
    }

    const settingsRow = el("div", { className: "ce-settings-row" }, [
      el("div", { className: "ce-settings-left" }, [
        el("span", { className: "ce-settings-title", textContent: "API Cost Estimator" }),
        el("span", { className: "ce-settings-subtitle", textContent: "Estimates what your usage would cost via Claude API" }),
      ]),
      el("div", { className: "ce-settings-controls" }, [
        el("label", { className: "ce-settings-label" }, ["Plan ", tierSelect]),
        el("label", { className: "ce-settings-label" }, ["I/O ratio ", ioSelect]),
      ]),
    ]);

    const note = el("div", { className: "ce-settings-note", textContent: "Token estimates are approximate. Actual quotas depend on message length and system load." });

    panel.appendChild(settingsRow);
    panel.appendChild(note);
    container.insertBefore(panel, container.firstChild);

    tierSelect.addEventListener("change", (e) => {
      const s = getSettings();
      s.tier = e.target.value;
      saveSettings(s);
      update();
    });
    ioSelect.addEventListener("change", (e) => {
      const s = getSettings();
      s.ioRatio = parseFloat(e.target.value);
      saveSettings(s);
      update();
    });
  }

  function renderProjection(row, usagePct, resetInfo) {
    const { total, elapsed } = periodTimes(resetInfo);

    let projected = 0;
    if (elapsed > 60_000) projected = usagePct * (total / elapsed);
    projected = Math.round(Math.min(projected, 999));
    const displayPct = Math.min(projected, 100);
    const isOver = projected > 100;

    const timeInfo =
      resetInfo.type === "session"
        ? `${Math.floor(elapsed / 3_600_000)}h${Math.floor(
            (elapsed % 3_600_000) / 60_000
          )}m of ~5h elapsed`
        : `${(elapsed / 86_400_000).toFixed(1)}d of 7d elapsed`;

    let container = row.previousElementSibling;
    if (container && container.classList.contains("linear-budget-row"))
      container = container.previousElementSibling;
    if (container && container.classList.contains("ce-cost-container"))
      container = container.previousElementSibling;
    if (!container || !container.classList.contains("linear-projection-container")) {
      container = document.createElement("div");
      container.classList.add("linear-projection-container");
      row.parentElement.insertBefore(container, row);
    }

    container.className =
      "linear-projection-container" + (isOver ? " linear-projection-over" : "");

    container.replaceChildren(
      el("div", { className: "lp-label" }, [
        el("span", {}, [
          "\u23F1 Projected by end: ",
          el("b", { textContent: projected + "%" }),
          isOver ? " \u26A0\uFE0F" : "",
        ]),
        el("span", { style_fontSize: "10px", style_opacity: "0.7", textContent: timeInfo }),
      ]),
      el("div", { className: "lp-bar" }, [
        el("div", { className: "lp-fill", style_width: displayPct + "%" }),
      ])
    );
  }

  function renderBudget(row, resetInfo) {
    const { total, elapsed } = periodTimes(resetInfo);
    const budgetPct = Math.round((elapsed / total) * 100);

    let budgetRow = row.previousElementSibling;
    if (!budgetRow || !budgetRow.classList.contains("linear-budget-row")) {
      budgetRow = document.createElement("div");
      budgetRow.classList.add("linear-budget-row");
      row.parentElement.insertBefore(budgetRow, row);
    }

    budgetRow.replaceChildren(
      el("div", { className: "linear-budget-left" }, [
        el("span", { className: "linear-budget-left-label", textContent: "Linear budget" }),
      ]),
      el("div", { className: "linear-budget-right" }, [
        el("div", { className: "linear-budget-bar-wrapper" }, [
          el("div", { className: "linear-budget-bar" }, [
            el("div", { className: "linear-budget-fill", style_width: budgetPct + "%" }),
          ]),
        ]),
        el("p", { className: "linear-budget-pct", textContent: budgetPct + "% elapsed" }),
      ])
    );
  }

  function renderCostEstimate(row, usagePct, resetInfo) {
    const settings = getSettings();
    const model = detectModel(row);
    if (!model) return;

    const estimates = resetInfo.type === "session"
      ? SESSION_TOKEN_ESTIMATES
      : WEEKLY_TOKEN_ESTIMATES;
    const tierEstimates = estimates[settings.tier];
    if (!tierEstimates || !tierEstimates[model]) return;

    const totalTokens = tierEstimates[model];
    const usedTokens = Math.round(totalTokens * (usagePct / 100));
    const ioRatio = settings.ioRatio;

    const costs = {
      opus:   estimateCost(usedTokens, "opus", ioRatio),
      sonnet: estimateCost(usedTokens, "sonnet", ioRatio),
      haiku:  estimateCost(usedTokens, "haiku", ioRatio),
    };

    const activeCost = costs[model];
    const modelNames = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
    const periodLabel = resetInfo.type === "session" ? "this session" : "this week";

    // Find existing cost container
    let costEl = null;
    let sibling = row.previousElementSibling;
    while (sibling) {
      if (sibling.classList.contains("ce-cost-container")) {
        costEl = sibling;
        break;
      }
      if (sibling.classList.contains("linear-projection-container")) break;
      sibling = sibling.previousElementSibling;
    }

    if (!costEl) {
      costEl = el("div", { className: "ce-cost-container" });
      row.parentElement.insertBefore(costEl, row);
    }

    const chips = Object.entries(costs).map(([m, cost]) =>
      el("span", {
        className: "ce-chip" + (m === model ? " ce-chip-active" : ""),
        title: modelNames[m] + " API rate",
        textContent: modelNames[m] + ": " + formatCost(cost),
      })
    );

    costEl.replaceChildren(
      el("div", { className: "ce-cost-header" }, [
        el("span", {}, [
          "API cost estimate " + periodLabel + ": ",
          el("b", { textContent: formatCost(activeCost) }),
        ]),
        el("span", { className: "ce-cost-tokens", textContent: "~" + formatTokens(usedTokens) + " tokens" }),
      ]),
      el("div", { className: "ce-cost-comparison" }, [
        el("span", { className: "ce-cost-compare-label", textContent: "Same tokens via:" }),
        ...chips,
      ])
    );
  }

  function renderSummary() {
    const settings = getSettings();
    const bars = document.querySelectorAll('[role="progressbar"]');
    let totalCost = 0;
    let hasEstimate = false;

    for (let i = 0; i < bars.length && i < 3; i++) {
      const bar = bars[i];
      const row = findRow(bar);
      if (!row) continue;

      const model = detectModel(row);
      if (!model) continue;

      const resetText = getResetText(row);
      if (!resetText) continue;
      const resetInfo = parseResetTime(resetText);
      if (!resetInfo) continue;
      if (resetInfo.type === "session") continue; // only sum weekly for monthly comparison

      const usagePct = parseFloat(bar.getAttribute("aria-valuenow")) || 0;
      const tierEstimates = WEEKLY_TOKEN_ESTIMATES[settings.tier];
      if (!tierEstimates || !tierEstimates[model]) continue;

      const usedTokens = Math.round(tierEstimates[model] * (usagePct / 100));
      totalCost += estimateCost(usedTokens, model, settings.ioRatio);
      hasEstimate = true;
    }

    if (!hasEstimate) return;

    const monthlyApiEstimate = totalCost * 4.33;
    const planCost = PLAN_MONTHLY[settings.tier];

    let summaryEl = document.getElementById("ce-cost-summary");
    if (!summaryEl) {
      const lastBar = bars[Math.min(bars.length - 1, 2)];
      const lastRow = findRow(lastBar);
      if (!lastRow) return;
      summaryEl = el("div", { id: "ce-cost-summary", className: "ce-summary" });
      lastRow.parentElement.appendChild(summaryEl);
    }

    const savings = planCost - monthlyApiEstimate;
    const savingsClass = savings >= 0 ? "ce-savings-positive" : "ce-savings-negative";
    const savingsLabel = savings >= 0
      ? "Plan saves you ~" + formatCost(savings) + "/mo"
      : "API would save ~" + formatCost(-savings) + "/mo";

    summaryEl.replaceChildren(
      el("div", { className: "ce-summary-row" }, [
        el("span", { className: "ce-summary-label", textContent: "Estimated monthly API cost (at current pace)" }),
        el("span", { className: "ce-summary-value", textContent: formatCost(monthlyApiEstimate) }),
      ]),
      el("div", { className: "ce-summary-row" }, [
        el("span", { className: "ce-summary-label", textContent: PLAN_LABELS[settings.tier] }),
        el("span", { className: "ce-summary-value", textContent: formatCost(planCost) }),
      ]),
      el("div", { className: "ce-summary-row ce-summary-verdict" }, [
        el("span", { className: savingsClass, textContent: savingsLabel }),
      ])
    );
  }

  // -- Main update loop --

  function update() {
    const bars = document.querySelectorAll('[role="progressbar"]');
    if (bars.length < 3) return;

    renderSettingsPanel();

    for (let i = 0; i < 3; i++) {
      const bar = bars[i];
      const row = findRow(bar);
      if (!row) continue;

      const resetText = getResetText(row);
      if (!resetText) continue;

      const resetInfo = parseResetTime(resetText);
      if (!resetInfo) continue;

      const usagePct = parseFloat(bar.getAttribute("aria-valuenow")) || 0;

      renderProjection(row, usagePct, resetInfo);
      renderBudget(row, resetInfo);
      renderCostEstimate(row, usagePct, resetInfo);
    }

    renderSummary();
  }

  // -- Bootstrap --

  setTimeout(() => {
    update();
    setInterval(update, UPDATE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
})();

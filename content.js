// ABOUTME: Content script that injects projection and linear budget bars into Claude's usage page.
// ABOUTME: Calculates projected usage at period end and shows how much time budget has elapsed.

(function () {
  "use strict";

  const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 h session window
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;     // refresh every 1 h
  const INITIAL_DELAY_MS = 2000;                  // wait for page to render

  // -- Helpers --

  /** Walk up the DOM from a progress bar to find its row container. */
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

  /** Parse the "Resets in ..." / "Resets Sun 12:00 PM" text next to a bar. */
  function parseResetTime(text) {
    // Relative: "Resets in 2 hr 47 min" or "Resets in 47 min"
    const rel = text.match(/Resets in\s+(?:(\d+)\s*hr\s*)?(\d+)\s*min/);
    if (rel) {
      const h = parseInt(rel[1] || "0", 10);
      const m = parseInt(rel[2], 10);
      return { remainingMs: (h * 60 + m) * 60_000, type: "session" };
    }

    // Weekly: "Resets Sun 12:00 PM"
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

  /** Get the "Resets ..." text from <p> tags inside a row element. */
  function getResetText(row) {
    for (const p of row.querySelectorAll("p")) {
      if (p.textContent.trim().startsWith("Resets")) return p.textContent.trim();
    }
    return "";
  }

  /** Compute elapsed / total for a given reset info object. */
  function periodTimes(resetInfo) {
    const total =
      resetInfo.type === "session"
        ? SESSION_WINDOW_MS
        : resetInfo.totalPeriodMs;
    const elapsed = total - resetInfo.remainingMs;
    return { total, elapsed };
  }

  // -- Renderers --

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
    // Skip over the budget row if present
    if (container && container.classList.contains("linear-budget-row"))
      container = container.previousElementSibling;
    if (!container || !container.classList.contains("linear-projection-container")) {
      container = document.createElement("div");
      container.classList.add("linear-projection-container");
      row.parentElement.insertBefore(container, row);
    }

    container.className =
      "linear-projection-container" + (isOver ? " linear-projection-over" : "");
    container.innerHTML = `
      <div class="lp-label">
        <span>\u23F1 Projected by end: <b>${projected}%</b>${
      isOver ? " \u26A0\uFE0F" : ""
    }</span>
        <span style="font-size:10px;opacity:0.7">${timeInfo}</span>
      </div>
      <div class="lp-bar">
        <div class="lp-fill" style="width:${displayPct}%"></div>
      </div>`;
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

    budgetRow.innerHTML = `
      <div class="linear-budget-left">
        <span class="linear-budget-left-label">Linear budget</span>
      </div>
      <div class="linear-budget-right">
        <div class="linear-budget-bar-wrapper">
          <div class="linear-budget-bar">
            <div class="linear-budget-fill" style="width:${budgetPct}%"></div>
          </div>
        </div>
        <p class="linear-budget-pct">${budgetPct}% elapsed</p>
      </div>`;
  }

  // -- Main update loop --

  function update() {
    const bars = document.querySelectorAll('[role="progressbar"]');
    if (bars.length < 3) return;

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
    }
  }

  // -- Bootstrap --

  setTimeout(() => {
    update();
    setInterval(update, UPDATE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
})();

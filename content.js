// ABOUTME: Content script that injects projection and budget bars into Claude's usage page.
// ABOUTME: Calculates projected usage and elapsed time budget for session and weekly limits.

(function () {
  "use strict";

  const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 h session window
  const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;    // 7 day weekly window
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;     // refresh every 1 h

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

  function detectPeriodType(row) {
    const text = row.textContent.toLowerCase();
    if (text.includes("current session")) return "session";
    return "weekly";
  }

  function parseRemainingMs(text) {
    // Relative: "Resets in 2 hr 20 min"
    const rel = text.match(/Resets in\s+(?:(\d+)\s*hr?\s*)?(\d+)\s*min/);
    if (rel) {
      const h = parseInt(rel[1] || "0", 10);
      const m = parseInt(rel[2], 10);
      return (h * 60 + m) * 60_000;
    }

    // Absolute: "Resets Sun 12:00 PM" or "Resets Mon 3:00 AM"
    const abs = text.match(/Resets\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (abs) {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const targetDay = dayNames.indexOf(abs[1]);
      let hours = parseInt(abs[2], 10);
      const minutes = parseInt(abs[3], 10);
      const ampm = abs[4].toUpperCase();

      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;

      const now = new Date();
      const target = new Date(now);
      target.setHours(hours, minutes, 0, 0);

      // Move target to the correct day of week (forward)
      const nowDay = now.getDay();
      let daysAhead = targetDay - nowDay;
      if (daysAhead < 0) daysAhead += 7;
      if (daysAhead === 0 && target <= now) daysAhead = 7;
      target.setDate(target.getDate() + daysAhead);

      return target.getTime() - now.getTime();
    }

    return null;
  }

  function getResetText(row) {
    for (const p of row.querySelectorAll("p")) {
      if (p.textContent.trim().startsWith("Resets")) return p.textContent.trim();
    }
    return "";
  }

  // -- Safe DOM builder --

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

  function renderProjection(row, usagePct, remainingMs, periodType) {
    const totalMs = periodType === "session" ? SESSION_WINDOW_MS : WEEKLY_MS;
    const elapsed = totalMs - remainingMs;

    let projected = 0;
    if (elapsed > 60_000) projected = usagePct * (totalMs / elapsed);
    projected = Math.round(Math.min(projected, 999));
    const displayPct = Math.min(projected, 100);
    const isOver = projected > 100;

    const timeInfo =
      periodType === "session"
        ? `${Math.floor(elapsed / 3_600_000)}h${Math.floor(
            (elapsed % 3_600_000) / 60_000
          )}m of ~5h elapsed`
        : `${(elapsed / 86_400_000).toFixed(1)}d of 7d elapsed`;

    let container = row.previousElementSibling;
    if (container && container.classList.contains("linear-budget-row"))
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

  function renderBudget(row, remainingMs, periodType) {
    const totalMs = periodType === "session" ? SESSION_WINDOW_MS : WEEKLY_MS;
    const elapsed = totalMs - remainingMs;
    const budgetPct = Math.round((elapsed / totalMs) * 100);

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

  // -- Main update loop --

  function update() {
    const bars = document.querySelectorAll('[role="progressbar"]');
    if (bars.length === 0) return;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const row = findRow(bar);
      if (!row) continue;

      const resetText = getResetText(row);
      if (!resetText) continue;

      const remainingMs = parseRemainingMs(resetText);
      if (remainingMs === null) continue;

      const periodType = detectPeriodType(row);
      const usagePct = parseFloat(bar.getAttribute("aria-valuenow")) || 0;

      renderProjection(row, usagePct, remainingMs, periodType);
      renderBudget(row, remainingMs, periodType);
    }
  }

  // -- Bootstrap --

  let intervalId = null;

  function startUpdating() {
    if (intervalId) return;
    update();
    intervalId = setInterval(update, UPDATE_INTERVAL_MS);
  }

  // Try immediately in case bars are already rendered
  if (document.querySelectorAll('[role="progressbar"]').length > 0) {
    startUpdating();
  }

  // Watch for progress bars appearing (SPA may render them late)
  const observer = new MutationObserver(() => {
    if (document.querySelectorAll('[role="progressbar"]').length > 0) {
      observer.disconnect();
      startUpdating();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Safety timeout: stop observing after 30s to avoid leaks
  setTimeout(() => observer.disconnect(), 30_000);
})();

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const express = require("express");
const ExcelJS = require("exceljs");
const {
  ShariaMonitor,
  formatStockPairs,
  formatTradingViewList,
  formatTradingViewSymbol,
} = require("./monitor");

const app = express();
const port = Number(process.env.PORT) || 3000;
const monitor = new ShariaMonitor();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"), {
    maxAge: "7d",
    immutable: true,
  })
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: process.env.TZ || "Asia/Kolkata",
  }).format(date);
}

function getStockDestinations(stock) {
  const screenerUrl =
    stock.screenerUrl ||
    `https://www.screener.in/company/${encodeURIComponent(stock.symbol)}/`;
  const tradingViewSymbol = formatTradingViewSymbol(stock);
  const tradingViewUrl =
    "https://www.tradingview.com/chart/?symbol=" +
    encodeURIComponent(tradingViewSymbol);
  return { screenerUrl, tradingViewSymbol, tradingViewUrl };
}

function renderStockActions(stock) {
  const { screenerUrl, tradingViewSymbol, tradingViewUrl } =
    getStockDestinations(stock);

  return `
    <div class="row-actions">
      <a
        class="icon-link screener-link"
        href="${escapeHtml(screenerUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        title="Open ${escapeHtml(stock.symbol)} in Screener"
        aria-label="Open ${escapeHtml(stock.symbol)} in Screener"
        onclick="event.stopPropagation()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="5.5"></circle>
          <path d="m15 15 4.5 4.5"></path>
          <path d="M8 11.5 10 9l2 2 2-3"></path>
        </svg>
      </a>
      <a
        class="icon-link tradingview-link"
        href="${escapeHtml(tradingViewUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        title="Open ${escapeHtml(tradingViewSymbol)} in TradingView"
        aria-label="Open ${escapeHtml(tradingViewSymbol)} in TradingView"
        onclick="event.stopPropagation()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17.5 8 12l3.5 3.5L21 6"></path>
          <path d="M15 6h6v6"></path>
        </svg>
      </a>
    </div>
  `;
}

function displayStockValue(value) {
  return value === null || value === undefined || value === ""
    ? "—"
    : escapeHtml(value);
}

function renderStockTable(title, stocks, newSymbols = new Set()) {
  const rows = stocks
    .map(
      (stock, index) => {
        const isNew = newSymbols.has(stock.symbol);
        return `
        <tr class="${isNew ? "new-stock" : ""}">
          <td>${index + 1}</td>
          <td class="symbol">
            ${escapeHtml(stock.symbol)}
            ${isNew ? '<span class="new-badge">NEW</span>' : ""}
          </td>
          <td>${escapeHtml(stock.name)}</td>
          <td>${escapeHtml(formatDate(stock.firstSeenAt))}</td>
          <td>${displayStockValue(stock.cmp)}</td>
          <td>${displayStockValue(stock.marCap)}</td>
          <td>${displayStockValue(stock.indPe)}</td>
          <td>${displayStockValue(stock.pe)}</td>
          <td>${displayStockValue(stock.npQtr)}</td>
          <td>${displayStockValue(stock.salesQtr)}</td>
          <td>${displayStockValue(stock.pe5Yrs)}</td>
          <td>${displayStockValue(stock.compliance)}</td>
          <td>${renderStockActions(stock)}</td>
        </tr>
      `;
      }
    )
    .join("");

  const mobileRows = stocks
    .map(
      (stock) => {
        const isNew = newSymbols.has(stock.symbol);
        return `
        <details class="stock-accordion ${isNew ? "new-stock" : ""}">
          <summary>
            <span class="mobile-symbol">${escapeHtml(stock.symbol)}</span>
            ${isNew ? '<span class="new-badge">NEW</span>' : ""}
            ${renderStockActions(stock)}
            <span class="accordion-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m8 10 4 4 4-4"></path>
              </svg>
            </span>
          </summary>
          <div class="accordion-body">
            <div class="detail-row"><span>Name</span><strong>${displayStockValue(stock.name)}</strong></div>
            <div class="detail-row"><span>Added</span><strong>${escapeHtml(formatDate(stock.firstSeenAt))}</strong></div>
            <div class="detail-row"><span>CMP</span><strong>${displayStockValue(stock.cmp)}</strong></div>
            <div class="detail-row"><span>Market Cap</span><strong>${displayStockValue(stock.marCap)}</strong></div>
            <div class="detail-row"><span>Industry P/E</span><strong>${displayStockValue(stock.indPe)}</strong></div>
            <div class="detail-row"><span>P/E</span><strong>${displayStockValue(stock.pe)}</strong></div>
            <div class="detail-row"><span>NP Quarter</span><strong>${displayStockValue(stock.npQtr)}</strong></div>
            <div class="detail-row"><span>Sales Quarter</span><strong>${displayStockValue(stock.salesQtr)}</strong></div>
            <div class="detail-row"><span>5 Years P/E</span><strong>${displayStockValue(stock.pe5Yrs)}</strong></div>
            <div class="detail-row"><span>Sharia</span><strong>${displayStockValue(stock.compliance)}</strong></div>
          </div>
        </details>
      `;
      }
    )
    .join("");

  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>${escapeHtml(title)} <span>${stocks.length}</span></h2>
      </div>
      <div class="table-wrap stock-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Symbol</th><th>Name</th><th>Added</th><th>CMP</th>
              <th>Market Cap</th><th>Ind PE</th><th>P/E</th>
              <th>NP Qtr</th><th>Sales Qtr</th><th>5Yrs PE</th><th>Sharia</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="13" class="empty">No saved stocks yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="mobile-stock-list">
        ${mobileRows || '<p class="empty">No saved stocks yet.</p>'}
      </div>
    </section>
  `;
}

function renderHistory(history) {
  return history
    .map((run) => {
      const change = run.is_baseline
        ? "Baseline"
        : run.changed
          ? `+${run.added.length} / -${run.removed.length}`
          : "No change";
      return `
        <tr>
          <td>${escapeHtml(formatDate(run.completed_at || run.started_at))}</td>
          <td><span class="badge ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span></td>
          <td>${escapeHtml(change)}</td>
          <td>${escapeHtml(run.compliant_count ?? "—")}</td>
          <td>${escapeHtml(run.notification_status)}</td>
        </tr>
      `;
    })
    .join("");
}

app.get("/", (request, response) => {
  response.redirect("/sharia-tables");
});

app.get("/sharia-tables", (request, response) => {
  const allStocks = monitor.getCurrentStocks();
  const compliant = allStocks.filter(
    (stock) => stock.compliance === "COMPLIANT"
  );
  const other = allStocks.filter(
    (stock) => stock.compliance !== "COMPLIANT"
  );
  const status = monitor.getStatus();
  const history = monitor.getHistory(8);
  const latest = status.latest;
  const newSymbols = new Set(monitor.getLatestAddedSymbols());
  const tradingView = formatTradingViewList(compliant);
  const notificationTest = request.query.notificationTest;

  response.send(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
        <meta name="theme-color" content="#08795b">
        <meta name="application-name" content="Shariah Stock Monitor">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="default">
        <meta name="apple-mobile-web-app-title" content="Shariah Stocks">
        <link
          rel="icon"
          type="image/png"
          sizes="128x128"
          href="/assets/pushover-stock-icon-128.png"
        >
        <link
          rel="apple-touch-icon"
          sizes="128x128"
          href="/assets/pushover-stock-icon-128.png"
        >
        <link rel="manifest" href="/assets/site.webmanifest">
        <title>Shariah Stock Monitor</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #f3f5f4;
            --panel: #ffffff;
            --ink: #17211d;
            --muted: #65736d;
            --line: #dce4e0;
            --green: #08795b;
            --green-soft: #e1f4ed;
            --amber: #93620b;
            --amber-soft: #fff3d6;
            --red: #a63131;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--ink);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          }
          main { width: min(1500px, calc(100% - 32px)); margin: 28px auto 60px; }
          h1 { margin: 0 0 6px; font-size: clamp(26px, 4vw, 42px); letter-spacing: -0.04em; }
          h2 { margin: 0; font-size: 19px; }
          h2 span { color: var(--green); font-size: 14px; margin-left: 6px; }
          p { margin: 0; }
          .subhead { color: var(--muted); margin-bottom: 22px; }
          .status-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 16px;
          }
          .status-card, .panel {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 14px;
            box-shadow: 0 8px 28px rgba(28, 53, 43, 0.05);
          }
          .status-card { padding: 16px; }
          .status-card small { display: block; color: var(--muted); margin-bottom: 7px; }
          .status-card strong { display: block; font-size: 16px; }
          .status-card p { color: var(--muted); margin-top: 5px; font-size: 13px; }
          .dot {
            display: inline-block; width: 8px; height: 8px; border-radius: 50%;
            margin-right: 6px; background: ${status.running ? "var(--amber)" : "var(--green)"};
          }
          .toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 10px;
            margin: 16px 0;
          }
          .toolbar form { display: flex; }
          button, .button {
            appearance: none;
            border: 0;
            border-radius: 9px;
            background: var(--green);
            color: white;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font: inherit;
            font-weight: 700;
            min-height: 44px;
            padding: 10px 14px;
            text-decoration: none;
            touch-action: manipulation;
          }
          button.secondary, .button.secondary {
            background: var(--green-soft);
            color: var(--green);
          }
          button:disabled {
            cursor: not-allowed;
            opacity: .5;
          }
          .notice {
            border: 1px solid #f0d79f;
            background: var(--amber-soft);
            color: #6b4a0c;
            border-radius: 10px;
            padding: 12px 14px;
            margin-bottom: 16px;
          }
          .notice.success {
            border-color: #a9dec7;
            background: #e4f7ee;
            color: #08633f;
          }
          .notice.error {
            border-color: #efb7b7;
            background: #fdeaeb;
            color: var(--red);
          }
          .panel { overflow: hidden; margin: 16px 0; }
          .panel-heading { padding: 15px 17px; border-bottom: 1px solid var(--line); }
          .table-wrap {
            overflow-x: auto;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
          }
          table { border-collapse: collapse; min-width: 1080px; width: 100%; }
          th, td { border-bottom: 1px solid var(--line); padding: 10px 12px; text-align: left; white-space: nowrap; }
          th { background: #f7faf8; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
          td { font-size: 13px; }
          td.symbol { color: var(--green); font-weight: 800; }
          tr.new-stock td {
            background: linear-gradient(90deg, #e8f8ef 0%, #f5fcf8 100%);
          }
          tr.new-stock td:first-child {
            box-shadow: inset 4px 0 0 #11a36a;
          }
          .new-badge {
            display: inline-flex;
            align-items: center;
            min-height: 20px;
            margin-left: 7px;
            border-radius: 999px;
            padding: 3px 7px;
            color: #07633f;
            background: #c9f2dc;
            font-size: 9px;
            font-weight: 900;
            letter-spacing: .08em;
            vertical-align: middle;
          }
          .row-actions {
            display: flex;
            align-items: center;
            gap: 7px;
          }
          .icon-link {
            width: 34px;
            height: 34px;
            border: 1px solid var(--line);
            border-radius: 9px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--green);
            background: white;
            transition: transform 140ms ease, background 140ms ease, color 140ms ease;
          }
          .icon-link:hover {
            transform: translateY(-1px);
            background: var(--green);
            color: white;
          }
          .icon-link:focus-visible {
            outline: 3px solid rgba(8, 121, 91, 0.2);
            outline-offset: 2px;
          }
          .icon-link svg {
            width: 18px;
            height: 18px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.9;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .tradingview-link {
            color: #1d5fba;
          }
          .mobile-stock-list { display: none; }
          .stock-accordion {
            border-bottom: 1px solid var(--line);
            background: white;
          }
          .stock-accordion:last-child { border-bottom: 0; }
          .stock-accordion.new-stock {
            background: linear-gradient(90deg, #e8f8ef 0%, #f8fdfb 100%);
            box-shadow: inset 4px 0 0 #11a36a;
          }
          .stock-accordion.new-stock summary,
          .stock-accordion.new-stock .accordion-body {
            background: transparent;
          }
          .stock-accordion summary {
            min-height: 62px;
            padding: 10px 12px;
            display: flex;
            align-items: center;
            gap: 9px;
            cursor: pointer;
            list-style: none;
            touch-action: manipulation;
          }
          .stock-accordion summary::-webkit-details-marker { display: none; }
          .mobile-symbol {
            color: var(--green);
            font-size: 14px;
            font-weight: 850;
            letter-spacing: 0.01em;
          }
          .stock-accordion summary .row-actions { margin-left: 2px; }
          .accordion-chevron {
            width: 28px;
            height: 28px;
            margin-left: auto;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--muted);
            background: #f1f5f3;
            transition: transform 160ms ease;
          }
          .accordion-chevron svg {
            width: 17px;
            height: 17px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .stock-accordion[open] .accordion-chevron { transform: rotate(180deg); }
          .accordion-body {
            padding: 2px 14px 14px;
            background: #f8faf9;
          }
          .detail-row {
            min-height: 38px;
            border-bottom: 1px solid var(--line);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            font-size: 13px;
          }
          .detail-row:last-child { border-bottom: 0; }
          .detail-row span { color: var(--muted); }
          .detail-row strong {
            color: var(--ink);
            text-align: right;
            overflow-wrap: anywhere;
          }
          .empty { color: var(--muted); padding: 24px; text-align: center; }
          .history table { min-width: 720px; }
          .badge { border-radius: 99px; background: #edf1ef; padding: 4px 8px; font-size: 11px; font-weight: 800; }
          .badge.success { color: var(--green); background: var(--green-soft); }
          .badge.failed { color: var(--red); background: #fde9e9; }
          @media (max-width: 900px) {
            .status-grid { grid-template-columns: 1fr 1fr; }
          }
          @media (max-width: 700px) {
            .stock-table { display: none; }
            .mobile-stock-list { display: block; }
            .stock-accordion .icon-link {
              width: 38px;
              height: 38px;
            }
          }
          @media (max-width: 560px) {
            main { width: min(100% - 20px, 1500px); margin-top: 16px; }
            .status-grid { grid-template-columns: 1fr; }
            .toolbar {
              display: grid;
              grid-template-columns: 1fr;
              width: 100%;
            }
            .toolbar form,
            .toolbar button,
            .toolbar .button {
              width: 100%;
            }
            .panel { border-radius: 10px; }
            th, td { padding: 10px; }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Shariah Stock Monitor</h1>
          <p class="subhead">The page refreshes from SQLite every 5 seconds. External sources are checked every ${status.intervalSeconds} seconds.</p>

          <section class="status-grid">
            <article class="status-card">
              <small>Monitor</small>
              <strong><span class="dot"></span>${status.running ? "Checking now" : "Waiting"}</strong>
              <p>Next: ${escapeHtml(formatDate(status.nextCheckAt))}</p>
            </article>
            <article class="status-card">
              <small>Latest snapshot</small>
              <strong>${compliant.length} compliant / ${allStocks.length} total</strong>
              <p>${escapeHtml(formatDate(latest?.completed_at))}</p>
            </article>
            <article class="status-card">
              <small>Last change</small>
              <strong>${latest?.changed ? `+${latest.added.length} / -${latest.removed.length}` : "No list change"}</strong>
              <p>Unchanged checks never notify.</p>
            </article>
            <article class="status-card">
              <small>Notifications</small>
              <strong>${escapeHtml(status.notificationProvider)} · ${status.notificationConfigured ? "ready" : "needs credentials"}</strong>
              <p>${status.pendingNotifications} queued notification(s)</p>
            </article>
          </section>

          ${
            status.notificationConfigured
              ? ""
              : `<div class="notice">Push credentials are not configured yet. Any future list-change notification will remain queued safely in SQLite until credentials are added.</div>`
          }
          ${
            notificationTest === "success"
              ? '<div class="notice success" role="status">Test notification sent successfully. Check your Pushover app.</div>'
              : notificationTest === "error"
                ? '<div class="notice error" role="alert">The test notification could not be sent. Check the server terminal for the Pushover error.</div>'
                : ""
          }

          <div class="toolbar">
            <form method="post" action="/api/check-now">
              <button type="submit">Check now</button>
            </form>
            <a class="button secondary" href="/download-excel">Download Excel</a>
            <button
              type="button"
              data-watchlist="${escapeHtml(tradingView)}"
              onclick="copyToTradingView(this)"
              aria-label="Copy NSE and BSE symbols for TradingView"
            >Copy to TV</button>
            <form method="post" action="/api/test-notification">
              <button
                class="secondary"
                type="submit"
                ${status.notificationConfigured ? "" : "disabled"}
              >Send Test Notification</button>
            </form>
          </div>

          ${renderStockTable("Shariah-Compliant Stocks", compliant, newSymbols)}
          ${renderStockTable("Non-Compliant / Questionable / Unknown", other)}

          <section class="panel history">
            <div class="panel-heading"><h2>Recent checks</h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Time</th><th>Status</th><th>Change</th><th>Compliant</th><th>Notification</th></tr></thead>
                <tbody>${renderHistory(history) || '<tr><td colspan="5" class="empty">The initial check is running.</td></tr>'}</tbody>
              </table>
            </div>
          </section>
        </main>
        <script>
          if (new URLSearchParams(window.location.search).has("notificationTest")) {
            window.history.replaceState(null, "", "/sharia-tables");
          }

          async function copyToTradingView(button) {
            const watchlist = button.dataset.watchlist || "";
            if (!watchlist) return;

            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(watchlist);
            } else {
              const textarea = document.createElement("textarea");
              textarea.value = watchlist;
              textarea.style.position = "fixed";
              textarea.style.opacity = "0";
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand("copy");
              textarea.remove();
            }

            const original = button.textContent;
            button.textContent = "Copied to TV";
            setTimeout(() => { button.textContent = original; }, 1200);
          }
        </script>
      </body>
    </html>
  `);
});

app.get("/api/status", (request, response) => {
  const compliant = monitor.getCompliantStocks();
  response.json({
    ...monitor.getStatus(),
    compliantStocks: compliant.map(({ symbol, name }) => ({ symbol, name })),
    symbolNameList: formatStockPairs(compliant),
    tradingViewList: formatTradingViewList(compliant),
    history: monitor.getHistory(20),
  });
});

app.post("/api/check-now", (request, response) => {
  monitor.checkNow();
  if (request.accepts("html")) {
    response.redirect(303, "/sharia-tables");
  } else {
    response.status(202).json({ accepted: true, status: monitor.getStatus() });
  }
});

app.post("/api/test-notification", async (request, response) => {
  try {
    const result = await monitor.sendTestNotification();
    if (request.accepts("html")) {
      return response.redirect(303, "/sharia-tables?notificationTest=success");
    }
    return response.json({ sent: true, ...result });
  } catch (error) {
    const message = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error(`[notification] Test failed: ${message}`);
    if (request.accepts("html")) {
      return response.redirect(303, "/sharia-tables?notificationTest=error");
    }
    return response.status(502).json({ sent: false, error: message });
  }
});

app.get("/download-excel", async (request, response, next) => {
  try {
    const compliant = monitor.getCompliantStocks();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Shariah Screener");
    sheet.columns = [
      { header: "Symbol", key: "symbol", width: 15 },
      { header: "Name", key: "name", width: 28 },
      { header: "Added", key: "firstSeenAt", width: 24 },
      { header: "CMP", key: "cmp", width: 12 },
      { header: "Market Cap", key: "marCap", width: 15 },
      { header: "P/E", key: "pe", width: 10 },
      { header: "NP Qtr", key: "npQtr", width: 15 },
      { header: "Sales Qtr", key: "salesQtr", width: 15 },
      { header: "5Yrs PE", key: "pe5Yrs", width: 12 },
      { header: "Sharia", key: "compliance", width: 14 },
    ];
    compliant.forEach((stock) => sheet.addRow(stock));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    response.setHeader(
      "Content-Disposition",
      "attachment; filename=sharia_stocks.xlsx"
    );
    await workbook.xlsx.write(response);
    response.end();
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: error.message });
});

const server = app.listen(port, () => {
  console.log(`Server running -> http://localhost:${port}`);
  console.log(
    `Monitor interval -> ${Math.round(monitor.intervalMs / 1000)} seconds`
  );
  monitor.start();
});

function shutdown() {
  monitor.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { app, monitor, server };

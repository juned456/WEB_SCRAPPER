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

function formatDateOnly(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "UTC",
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

function renderComplianceBadge(compliance) {
  const status = String(compliance || "UNKNOWN").toUpperCase();
  return `<span class="compliance-badge ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span>`;
}

function renderIpoSortAttributes(stock, index) {
  const values = {
    index,
    symbol: stock.symbol,
    company: stock.name,
    listed: stock.listingDate,
    marketcap: stock.ipoMarketCap,
    ipoprice: stock.ipoPrice,
    current: stock.currentPrice,
    change: stock.changePercent,
    compliance: stock.compliance,
  };

  return Object.entries(values)
    .map(([key, value]) => `data-sort-${key}="${escapeHtml(value ?? "")}"`)
    .join(" ");
}

function renderIpoTable(stocks) {
  const desktopRows = stocks
    .map(
      (stock, index) => `
        <tr data-compliance="${escapeHtml(stock.compliance)}" ${renderIpoSortAttributes(stock, index)}>
          <td>${index + 1}</td>
          <td class="symbol">${escapeHtml(stock.symbol)}</td>
          <td>${escapeHtml(stock.name)}</td>
          <td>${escapeHtml(formatDateOnly(stock.listingDate))}</td>
          <td>${displayStockValue(stock.ipoMarketCap)}</td>
          <td>${displayStockValue(stock.ipoPrice)}</td>
          <td>${displayStockValue(stock.currentPrice)}</td>
          <td>${displayStockValue(stock.changePercent)}</td>
          <td>${renderComplianceBadge(stock.compliance)}</td>
          <td>${renderStockActions(stock)}</td>
        </tr>`
    )
    .join("");

  const mobileRows = stocks
    .map(
      (stock, index) => `
        <details class="ipo-card" data-compliance="${escapeHtml(stock.compliance)}" ${renderIpoSortAttributes(stock, index)}>
          <summary>
            <span class="ipo-card-title">
              <span class="mobile-symbol">${escapeHtml(stock.symbol)}</span>
              <small>${escapeHtml(formatDateOnly(stock.listingDate))}</small>
            </span>
            ${renderComplianceBadge(stock.compliance)}
            ${renderStockActions(stock)}
            <span class="accordion-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"></path></svg>
            </span>
          </summary>
          <div class="ipo-card-body">
            <div class="detail-row"><span>Name</span><strong>${displayStockValue(stock.name)}</strong></div>
            <div class="detail-row"><span>IPO Market Cap</span><strong>${displayStockValue(stock.ipoMarketCap)} Cr</strong></div>
            <div class="detail-row"><span>IPO Price</span><strong>${displayStockValue(stock.ipoPrice)}</strong></div>
            <div class="detail-row"><span>Current Price</span><strong>${displayStockValue(stock.currentPrice)}</strong></div>
            <div class="detail-row"><span>Change</span><strong>${displayStockValue(stock.changePercent)}</strong></div>
            <div class="detail-row"><span>Musaffa checked</span><strong>${escapeHtml(formatDate(stock.complianceCheckedAt))}</strong></div>
          </div>
        </details>`
    )
    .join("");

  return `
    <section class="ipo-list-panel">
      <div class="table-wrap ipo-table-wrap">
        <table class="ipo-table">
          <thead>
            <tr>
              <th>#</th>
              <th><button class="sort-button" type="button" data-sort-key="symbol">Symbol <span class="sort-arrow"></span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="company">Company <span class="sort-arrow"></span></button></th>
              <th aria-sort="descending"><button class="sort-button active" type="button" data-sort-key="listed">Listed <span class="sort-arrow">↓</span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="marketcap">IPO MCap Cr <span class="sort-arrow"></span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="ipoprice">IPO Price <span class="sort-arrow"></span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="current">Current <span class="sort-arrow"></span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="change">Change <span class="sort-arrow"></span></button></th>
              <th><button class="sort-button" type="button" data-sort-key="compliance">Musaffa <span class="sort-arrow"></span></button></th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>${desktopRows || '<tr><td colspan="10" class="empty">The first IPO check is running.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="ipo-mobile-list">
        ${mobileRows || '<p class="empty">The first IPO check is running.</p>'}
      </div>
    </section>`;
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
          .page-nav {
            display: inline-flex;
            gap: 5px;
            padding: 5px;
            margin-bottom: 20px;
            border: 1px solid var(--line);
            border-radius: 12px;
            background: white;
          }
          .page-nav a {
            border-radius: 8px;
            color: var(--muted);
            font-size: 13px;
            font-weight: 800;
            padding: 9px 12px;
            text-decoration: none;
          }
          .page-nav a.active { color: white; background: var(--green); }
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
          <nav class="page-nav" aria-label="Screeners">
            <a class="active" href="/sharia-tables">Stock Monitor</a>
            <a href="/mainboard-ipos">Mainboard IPOs</a>
          </nav>
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

app.get("/mainboard-ipos", (request, response) => {
  const stocks = monitor.getIpoStocks();
  const status = monitor.getIpoStatus();
  const compliant = stocks.filter((stock) => stock.compliance === "COMPLIANT");
  const unknown = stocks.filter((stock) => stock.compliance === "UNKNOWN");
  const nonCompliant = stocks.length - compliant.length - unknown.length;
  const tradingView = formatTradingViewList(compliant);

  response.send(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${status.running || !stocks.length ? '<meta http-equiv="refresh" content="12">' : ""}
        <meta name="theme-color" content="#063f34">
        <link rel="icon" type="image/png" sizes="128x128" href="/assets/pushover-stock-icon-128.png">
        <link rel="apple-touch-icon" sizes="128x128" href="/assets/pushover-stock-icon-128.png">
        <link rel="manifest" href="/assets/site.webmanifest">
        <title>Mainboard IPO Shariah Screener</title>
        <style>
          :root {
            color-scheme: light;
            --forest: #063f34;
            --forest-2: #0b6652;
            --mint: #d9f5e8;
            --paper: #f6f3eb;
            --card: #fffef9;
            --ink: #14231e;
            --muted: #68736e;
            --line: #d9ddd7;
            --amber: #ae7410;
            --red: #a33b3b;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background:
              linear-gradient(rgba(6,63,52,.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(6,63,52,.035) 1px, transparent 1px),
              var(--paper);
            background-size: 32px 32px;
            color: var(--ink);
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          }
          main { width: min(1440px, calc(100% - 32px)); margin: 24px auto 64px; }
          .page-nav {
            display: inline-flex; gap: 5px; padding: 5px; margin-bottom: 18px;
            border: 1px solid var(--line); border-radius: 12px; background: var(--card);
          }
          .page-nav a {
            border-radius: 8px; color: var(--muted); font-size: 13px;
            font-weight: 800; padding: 9px 12px; text-decoration: none;
          }
          .page-nav a.active { color: white; background: var(--forest); }
          .hero {
            position: relative; overflow: hidden; min-height: 240px;
            border-radius: 22px; padding: clamp(24px, 5vw, 56px);
            color: white; background: var(--forest);
            box-shadow: 0 20px 55px rgba(6, 63, 52, .18);
          }
          .hero::after {
            content: "IPO"; position: absolute; right: -18px; bottom: -58px;
            color: rgba(255,255,255,.055); font: 900 clamp(150px, 25vw, 330px)/1 Georgia, serif;
            letter-spacing: -.11em; pointer-events: none;
          }
          .eyebrow {
            display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px;
            color: #aee7d2; font-size: 11px; font-weight: 900; letter-spacing: .15em;
            text-transform: uppercase;
          }
          .eyebrow::before { content: ""; width: 28px; height: 2px; background: #77d0ae; }
          h1 {
            position: relative; z-index: 1; max-width: 780px; margin: 0;
            font: 700 clamp(34px, 6vw, 72px)/.98 Georgia, ui-serif, serif;
            letter-spacing: -.045em;
          }
          .hero p { position: relative; z-index: 1; max-width: 700px; margin: 20px 0 0; color: #cae7dc; line-height: 1.55; }
          .stats {
            position: relative; z-index: 2; display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
            margin: -30px 22px 20px;
          }
          .stat {
            min-height: 106px; border: 1px solid var(--line); border-radius: 15px;
            padding: 17px; background: rgba(255,254,249,.96);
            box-shadow: 0 12px 35px rgba(28,48,40,.08); backdrop-filter: blur(8px);
          }
          .stat small { display: block; color: var(--muted); margin-bottom: 8px; }
          .stat strong { display: block; font-size: 24px; letter-spacing: -.04em; }
          .stat p { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
          .dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; background: ${status.running ? "var(--amber)" : "#1a9b6b"}; }
          .controls {
            display: flex; flex-wrap: wrap; align-items: center; gap: 9px;
            margin: 18px 0;
          }
          .controls form { display: flex; }
          button, .button {
            min-height: 42px; border: 0; border-radius: 9px; padding: 9px 14px;
            display: inline-flex; align-items: center; justify-content: center;
            color: white; background: var(--forest); cursor: pointer;
            font: inherit; font-size: 13px; font-weight: 850; text-decoration: none;
          }
          button.secondary, .button.secondary { color: var(--forest); background: var(--mint); }
          .search {
            min-height: 42px; min-width: min(320px, 100%); border: 1px solid var(--line);
            border-radius: 9px; padding: 9px 13px; background: var(--card); color: var(--ink);
            font: inherit;
          }
          .filter-group { display: flex; gap: 6px; margin-left: auto; }
          .filter-chip { color: var(--forest); background: transparent; border: 1px solid #b8c9c2; }
          .filter-chip.active { color: white; background: var(--forest); }
          .notice {
            margin: 15px 0; border: 1px solid #edc7a1; border-radius: 11px;
            padding: 12px 14px; color: #70450c; background: #fff2dd;
          }
          .ipo-list-panel {
            overflow: hidden; border: 1px solid var(--line); border-radius: 16px;
            background: var(--card); box-shadow: 0 14px 42px rgba(28,48,40,.07);
          }
          .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
          table { width: 100%; min-width: 1080px; border-collapse: collapse; }
          th, td { padding: 12px 13px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
          th { color: var(--muted); background: #f0f2ed; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; }
          td { font-size: 13px; }
          .sort-button {
            min-height: 0; margin: -8px -9px; padding: 8px 9px;
            color: inherit; background: transparent; font-size: inherit;
            letter-spacing: inherit; text-transform: inherit; white-space: nowrap;
          }
          .sort-button:hover, .sort-button.active { color: var(--forest); background: #dfe9e2; }
          .sort-arrow { min-width: 10px; color: var(--forest-2); font-size: 13px; }
          td.symbol, .mobile-symbol { color: var(--forest-2); font-weight: 900; }
          tbody tr:hover td { background: #f5faf7; }
          .compliance-badge {
            display: inline-flex; border-radius: 999px; padding: 5px 8px;
            color: var(--muted); background: #ecefeb; font-size: 10px; font-weight: 900;
            letter-spacing: .04em;
          }
          .compliance-badge.compliant { color: #086242; background: #d5f3e5; }
          .compliance-badge.non_compliant, .compliance-badge.not_compliant { color: var(--red); background: #f8dddd; }
          .compliance-badge.questionable { color: #81560a; background: #fae9c5; }
          .row-actions { display: flex; align-items: center; gap: 6px; }
          .icon-link {
            width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 9px;
            display: inline-flex; align-items: center; justify-content: center;
            color: var(--forest-2); background: white; transition: 140ms ease;
          }
          .icon-link:hover { color: white; background: var(--forest); transform: translateY(-1px); }
          .tradingview-link { color: #1d5fba; }
          .icon-link svg, .accordion-chevron svg {
            width: 18px; height: 18px; fill: none; stroke: currentColor;
            stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
          }
          .ipo-mobile-list { display: none; }
          .mobile-sort-control { display: none; }
          .ipo-card { border-bottom: 1px solid var(--line); }
          .ipo-card summary {
            min-height: 72px; padding: 11px 12px; display: flex; align-items: center;
            gap: 8px; cursor: pointer; list-style: none;
          }
          .ipo-card summary::-webkit-details-marker { display: none; }
          .ipo-card-title { min-width: 0; display: grid; gap: 4px; }
          .ipo-card-title small { color: var(--muted); }
          .accordion-chevron {
            width: 27px; height: 27px; margin-left: auto; border-radius: 50%;
            display: inline-flex; align-items: center; justify-content: center;
            color: var(--muted); background: #edf1ed; transition: transform 160ms ease;
          }
          .ipo-card[open] .accordion-chevron { transform: rotate(180deg); }
          .ipo-card-body { padding: 3px 14px 14px; background: #f6f8f4; }
          .detail-row {
            min-height: 39px; border-bottom: 1px solid var(--line); display: flex;
            align-items: center; justify-content: space-between; gap: 18px; font-size: 13px;
          }
          .detail-row:last-child { border: 0; }
          .detail-row span { color: var(--muted); }
          .detail-row strong { text-align: right; overflow-wrap: anywhere; }
          .empty { padding: 34px; color: var(--muted); text-align: center; }
          .hidden-by-filter { display: none !important; }
          @media (max-width: 900px) {
            .stats { grid-template-columns: 1fr 1fr; }
            .filter-group { width: 100%; margin-left: 0; overflow-x: auto; }
          }
          @media (max-width: 700px) {
            main { width: min(100% - 20px, 1440px); margin-top: 14px; }
            .hero { min-height: 220px; border-radius: 16px; }
            .stats { margin: -22px 10px 18px; }
            .ipo-table-wrap { display: none; }
            .ipo-mobile-list { display: block; }
            .mobile-sort-control {
              display: grid; gap: 5px; width: 100%; color: var(--muted);
              font-size: 11px; font-weight: 850; letter-spacing: .06em;
              text-transform: uppercase;
            }
            .mobile-sort-control select {
              width: 100%; min-height: 42px; border: 1px solid var(--line);
              border-radius: 9px; padding: 8px 11px; color: var(--ink);
              background: var(--card); font: inherit; font-size: 14px;
              letter-spacing: 0; text-transform: none;
            }
            .ipo-card .icon-link { width: 38px; height: 38px; }
            .ipo-card .compliance-badge { display: none; }
          }
          @media (max-width: 520px) {
            .stats { grid-template-columns: 1fr 1fr; gap: 7px; }
            .stat { min-height: 96px; padding: 13px; }
            .stat strong { font-size: 20px; }
            .controls { display: grid; grid-template-columns: 1fr; }
            .controls form, .controls button, .controls .button, .search { width: 100%; }
            .filter-group { display: grid; grid-template-columns: repeat(3, 1fr); }
          }
        </style>
      </head>
      <body>
        <main>
          <nav class="page-nav" aria-label="Screeners">
            <a href="/sharia-tables">Stock Monitor</a>
            <a class="active" href="/mainboard-ipos">Mainboard IPOs</a>
          </nav>

          <section class="hero">
            <span class="eyebrow">Three-year listing window</span>
            <h1>Mainboard IPO Shariah Screener</h1>
            <p>Recently listed Indian mainboard companies, screened against Musaffa. SME listings and companies outside ${escapeHtml(status.window.start)} to ${escapeHtml(status.window.end)} are excluded.</p>
          </section>

          <section class="stats">
            <article class="stat"><small>Mainboard IPOs</small><strong>${stocks.length}</strong><p>Last three years</p></article>
            <article class="stat"><small>Shariah compliant</small><strong>${compliant.length}</strong><p>Verified by Musaffa</p></article>
            <article class="stat"><small>Unknown / pending</small><strong>${unknown.length}</strong><p>${nonCompliant} other result(s)</p></article>
            <article class="stat"><small>Daily monitor</small><strong><span class="dot"></span>${status.running ? "Checking" : "Ready"}</strong><p>${status.running ? "Refresh in progress" : `Next: ${escapeHtml(formatDate(status.nextCheckAt))}`}</p></article>
          </section>

          ${status.latest?.status === "failed" ? `<div class="notice">The last IPO refresh failed. The previous SQLite list is still being shown safely.</div>` : ""}

          <div class="controls">
            <form method="post" action="/api/check-ipos-now"><button type="submit">Refresh IPOs</button></form>
            <a class="button secondary" href="/download-ipo-excel">Download Excel</a>
            <button type="button" class="secondary" data-watchlist="${escapeHtml(tradingView)}" onclick="copyIpoWatchlist(this)">Copy compliant to TV</button>
            <input class="search" id="ipo-search" type="search" placeholder="Search symbol or company" aria-label="Search IPOs">
            <label class="mobile-sort-control" for="ipo-sort">
              Sort IPOs
              <select id="ipo-sort">
                <option value="listed:desc">Listing date — recent first</option>
                <option value="listed:asc">Listing date — oldest first</option>
                <option value="symbol:asc">Symbol — A to Z</option>
                <option value="symbol:desc">Symbol — Z to A</option>
                <option value="company:asc">Company — A to Z</option>
                <option value="company:desc">Company — Z to A</option>
                <option value="marketcap:desc">IPO market cap — high to low</option>
                <option value="marketcap:asc">IPO market cap — low to high</option>
                <option value="ipoprice:desc">IPO price — high to low</option>
                <option value="ipoprice:asc">IPO price — low to high</option>
                <option value="current:desc">Current price — high to low</option>
                <option value="current:asc">Current price — low to high</option>
                <option value="change:desc">Change — high to low</option>
                <option value="change:asc">Change — low to high</option>
                <option value="compliance:asc">Musaffa status — A to Z</option>
                <option value="compliance:desc">Musaffa status — Z to A</option>
              </select>
            </label>
            <div class="filter-group" aria-label="Filter by compliance">
              <button class="filter-chip active" type="button" data-filter="ALL">All</button>
              <button class="filter-chip" type="button" data-filter="COMPLIANT">Compliant</button>
              <button class="filter-chip" type="button" data-filter="UNKNOWN">Unknown</button>
            </div>
          </div>

          ${renderIpoTable(stocks)}
        </main>
        <script>
          const search = document.getElementById("ipo-search");
          const chips = [...document.querySelectorAll(".filter-chip")];
          const sortButtons = [...document.querySelectorAll(".sort-button")];
          const mobileSort = document.getElementById("ipo-sort");
          const desktopBody = document.querySelector(".ipo-table tbody");
          const mobileList = document.querySelector(".ipo-mobile-list");
          const numericSortKeys = new Set(["index", "marketcap", "ipoprice", "current", "change"]);
          let activeFilter = "ALL";
          let activeSort = { key: "listed", direction: "desc" };

          function getSortValue(row, key) {
            const raw = row.getAttribute("data-sort-" + key) || "";
            if (!numericSortKeys.has(key)) return raw.toLocaleLowerCase();
            const parsed = Number.parseFloat(raw.replaceAll(",", "").replace(/[^0-9.-]/g, ""));
            if (!Number.isFinite(parsed)) return null;
            if (key === "change" && /[⇣↓-]/.test(raw)) return -Math.abs(parsed);
            return parsed;
          }

          function compareIpoRows(a, b) {
            const aValue = getSortValue(a, activeSort.key);
            const bValue = getSortValue(b, activeSort.key);
            if (aValue === null || aValue === "") return bValue === null || bValue === "" ? 0 : 1;
            if (bValue === null || bValue === "") return -1;

            let result = 0;
            if (typeof aValue === "number") result = aValue - bValue;
            else result = aValue.localeCompare(bValue, undefined, { numeric: true });
            if (result === 0) {
              result = Number(a.dataset.sortIndex) - Number(b.dataset.sortIndex);
            }
            return activeSort.direction === "desc" ? -result : result;
          }

          function renderIpoSort() {
            const desktopRows = [...desktopBody.querySelectorAll("tr[data-compliance]")].sort(compareIpoRows);
            const mobileRows = [...mobileList.querySelectorAll("details[data-compliance]")].sort(compareIpoRows);
            desktopRows.forEach((row, index) => {
              row.querySelector("td").textContent = String(index + 1);
              desktopBody.appendChild(row);
            });
            mobileRows.forEach((row) => mobileList.appendChild(row));

            sortButtons.forEach((button) => {
              const selected = button.dataset.sortKey === activeSort.key;
              button.classList.toggle("active", selected);
              button.querySelector(".sort-arrow").textContent = selected
                ? activeSort.direction === "asc" ? "↑" : "↓"
                : "";
              const header = button.closest("th");
              if (selected) header.setAttribute("aria-sort", activeSort.direction === "asc" ? "ascending" : "descending");
              else header.removeAttribute("aria-sort");
            });
            mobileSort.value = activeSort.key + ":" + activeSort.direction;
          }

          function setIpoSort(key, direction) {
            activeSort = { key, direction };
            renderIpoSort();
          }

          function applyIpoFilters() {
            const query = (search.value || "").trim().toLowerCase();
            document.querySelectorAll("[data-compliance]").forEach((row) => {
              const matchesStatus = activeFilter === "ALL" || row.dataset.compliance === activeFilter;
              const matchesSearch = !query || row.textContent.toLowerCase().includes(query);
              row.classList.toggle("hidden-by-filter", !(matchesStatus && matchesSearch));
            });
          }

          search.addEventListener("input", applyIpoFilters);
          chips.forEach((chip) => chip.addEventListener("click", () => {
            activeFilter = chip.dataset.filter;
            chips.forEach((item) => item.classList.toggle("active", item === chip));
            applyIpoFilters();
          }));
          sortButtons.forEach((button) => button.addEventListener("click", () => {
            const key = button.dataset.sortKey;
            const direction = activeSort.key === key
              ? activeSort.direction === "asc" ? "desc" : "asc"
              : ["listed", "marketcap", "ipoprice", "current", "change"].includes(key) ? "desc" : "asc";
            setIpoSort(key, direction);
          }));
          mobileSort.addEventListener("change", () => {
            const [key, direction] = mobileSort.value.split(":");
            setIpoSort(key, direction);
          });
          renderIpoSort();

          async function copyIpoWatchlist(button) {
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
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = original; }, 1200);
          }
        </script>
      </body>
    </html>`);
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

app.get("/api/dashboard", (request, response) => {
  const stocks = monitor.getCurrentStocks();
  const compliant = stocks.filter(
    (stock) => stock.compliance === "COMPLIANT"
  );

  response.json({
    ...monitor.getStatus(),
    stocks,
    compliantCount: compliant.length,
    totalCount: stocks.length,
    latestAddedSymbols: monitor.getLatestAddedSymbols(),
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

app.post("/api/check-ipos-now", (request, response) => {
  monitor.checkIposNow();
  if (request.accepts("html")) {
    response.redirect(303, "/mainboard-ipos");
  } else {
    response.status(202).json({
      accepted: true,
      status: monitor.getIpoStatus(),
    });
  }
});

app.get("/api/ipos", (request, response) => {
  const stocks = monitor.getIpoStocks();
  const compliant = stocks.filter(
    (stock) => stock.compliance === "COMPLIANT"
  );

  response.json({
    ...monitor.getIpoStatus(),
    stocks,
    totalCount: stocks.length,
    compliantCount: compliant.length,
    tradingViewList: formatTradingViewList(compliant),
    history: monitor.getIpoHistory(20),
  });
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

app.get("/download-ipo-excel", async (request, response, next) => {
  try {
    const stocks = monitor.getIpoStocks();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mainboard IPOs");
    sheet.columns = [
      { header: "Symbol", key: "symbol", width: 15 },
      { header: "Company", key: "name", width: 34 },
      { header: "Listing Date", key: "listingDate", width: 16 },
      { header: "IPO Market Cap (Cr)", key: "ipoMarketCap", width: 20 },
      { header: "IPO Price", key: "ipoPrice", width: 14 },
      { header: "Current Price", key: "currentPrice", width: 16 },
      { header: "Change", key: "changePercent", width: 14 },
      { header: "Musaffa", key: "compliance", width: 18 },
      { header: "Musaffa Checked", key: "complianceCheckedAt", width: 25 },
    ];
    stocks.forEach((stock) => sheet.addRow(stock));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF063F34" },
    };
    sheet.autoFilter = "A1:I1";
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    response.setHeader(
      "Content-Disposition",
      "attachment; filename=mainboard_ipos_shariah.xlsx"
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

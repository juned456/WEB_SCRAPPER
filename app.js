const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = 3000;

// --- CONFIG -------------------------------------------------

// Your Screener screen URL
const SCREENER_BASE =
  "https://www.screener.in/screens/3285703/techno-funda-screener/";

// Musaffa Typesense API
const MUSAFFA_BASE =
  "https://0bs2hegi5nmtad4op.a1.typesense.net/collections/stocks_data/documents/";
const MUSAFFA_KEY = "GRhZdTOnzVKId4Ln9G1PIvuIgn1TK0fH"; // ideally keep in env var

// Safety: don't go crazy with pages
const MAX_PAGES = 10;

// --- SMALL UTILS --------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch and parse a single Screener page.
 * Returns an array of rows: each row is { columns... } keyed by header text.
 */
async function fetchScreenerPage(page) {
  const url = page === 1 ? SCREENER_BASE : `${SCREENER_BASE}?page=${page}`;

  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const $ = cheerio.load(res.data);

  // Pick the table that actually contains company links
  const table = $("table")
    .filter((i, el) => {
      return $(el).find('a[href^="/company/"]').length > 0;
    })
    .first();

  if (!table.length) {
    console.log("No company table found on this page");
    return [];
  }

  // Normalize header text into safe keys, like "CMP Rs." -> "cmp_rs"
  const rawHeaders = [];
  const normHeaders = [];

  const normalizeHeader = (text) =>
    text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const headerRow = table.find("tbody tr").first();

  headerRow.find("th, td").each((i, cell) => {
    const label = $(cell).text().replace(/\s+/g, " ").trim();
    rawHeaders[i] = label;
    normHeaders[i] = normalizeHeader(label);
  });

  const rows = [];

  table
    .find("tbody tr")
    .slice(1)
    .each((_, tr) => {
      const $tr = $(tr);

      // Only rows that have a company link
      const anchor = $tr.find('a[href^="/company/"]').first();
      if (!anchor.length) return;

      const name = anchor.text().trim();
      const href = anchor.attr("href") || "";
      const parts = href.split("/").filter(Boolean); // ["company","PARADEEP","consolidated"]
      if (parts.length < 2 || parts[0].toLowerCase() !== "company") return;

      const symbol = parts[1].toUpperCase(); // PARADEEP or 514448

      const cells = $tr.find("td");
      const row = {
        Name: name,
        Symbol: symbol,
        _raw: {},
      };

      if (page === 1 && rows.length === 0) {
        console.log("HEADERS:", rawHeaders);
      }

      cells.each((i, td) => {
        if (i < 2) return; // skip S.No + Name

        const headerIndex = i;
        const text = $(td).text().replace(/\s+/g, " ").trim();

        const rawHeader = rawHeaders[headerIndex];
        const normKey = normHeaders[headerIndex];

        if (!normKey) return;

        row[normKey] = text;
        row._raw[rawHeader] = text;
      });

      if (page === 1) {
        console.log("RAW HEADERS:", rawHeaders);
        console.log("NORM HEADERS:", normHeaders);
      }

      // Now derive friendly fields from normalized keys
      row.cmp = row.cmp_rs || row.cmp || null; // CMP Rs.

      row.marCap = row.mar_cap_rs_cr || row.market_cap_rs_cr || null; // Mar Cap Rs.Cr.

      row.indPe = row.ind_pe || null; // Ind PE
      row.pe = row.p_e || row.pe || null; // P/E

      row.npQtr = row.np_qtr_rs_cr || row.net_profit_qtr_rs_cr || null;

      row.npPrevQtr =
        row.np_prev_qtr_rs_cr || row.net_profit_prev_qtr_rs_cr || null;

      row.epsQtr = row.eps_qtr_rs || null;
      row.epsPrevQtr = row.eps_prev_qtr_rs || null;

      row.salesQtr = row.sales_qtr_rs_cr || row.revenue_qtr_rs_cr || null;

      row.salesPrevQtr =
        row.sales_prev_qtr_rs_cr || row.revenue_prev_qtr_rs_cr || null;

      row.pe5Yrs = row["5yrs_pe"] || row.pe_5yrs || null;

      rows.push(row);
    });

  return rows;
}

/**
 * Fetch all Screener rows across pages up to MAX_PAGES.
 */
async function fetchAllScreenerRows() {
  const all = [];
  const seenSymbols = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await fetchScreenerPage(page);

    if (!rows.length) break;

    let newRows = 0;

    for (const r of rows) {
      if (!seenSymbols.has(r.Symbol)) {
        seenSymbols.add(r.Symbol);
        all.push(r);
        newRows++;
      }
    }

    // If page brings no new stocks, stop (same page repeated)
    if (newRows === 0) {
      console.log(`Page ${page} repeated, stopping pagination`);
      break;
    }
  }

  console.log("Total unique Screener rows:", all.length);
  return all;
}

function getMusaffaSymbolCandidates(token) {
  const cleanToken = String(token || "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  if (!cleanToken) return [];

  const exchangeSymbol = /^\d{6}$/.test(cleanToken)
    ? `${cleanToken}.BO`
    : `${cleanToken}.NS`;

  return [exchangeSymbol, cleanToken];
}

/**
 * Call Musaffa for a given token.
 * For 6 digit BSE codes like 514448, tries 514448.BO first.
 * For other symbols, tries TOKEN.NS first.
 * Then falls back to TOKEN.
 */
async function fetchMusaffaDoc(token) {
  const headers = {
    Accept: "application/json",
    "X-Typesense-Api-Key": MUSAFFA_KEY,
    "User-Agent": "Node-MusaffaFetcher/1.0",
  };

  for (const symbol of getMusaffaSymbolCandidates(token)) {
    const url = MUSAFFA_BASE + encodeURIComponent(symbol);

    try {
      const res = await axios.get(url, { headers, timeout: 15000 });
      return res.data;
    } catch (e) {
      const code = e.response?.status || e.code || "unknown";
      console.log("Musaffa lookup failed for", symbol, "status:", code);
    }
  }

  return null;
}

/**
 * Extract sharia_compliance from Musaffa doc (flat, like in your PHP).
 */
function getShariaCompliance(doc) {
  if (!doc || typeof doc !== "object") return null;

  // exactly what Musaffa returns: "sharia_compliance": "COMPLIANT"
  if (Object.prototype.hasOwnProperty.call(doc, "sharia_compliance")) {
    return String(doc.sharia_compliance || "")
      .trim()
      .toUpperCase(); // e.g. "COMPLIANT"
  }

  return null;
}

function findShariaComplianceRecursive(data) {
  if (!data || typeof data !== "object") return null;

  for (const [key, value] of Object.entries(data)) {
    if (typeof key === "string" && key.toLowerCase() === "sharia_compliance") {
      return value;
    }
    if (value && typeof value === "object") {
      const res = findShariaComplianceRecursive(value);
      if (res !== null && res !== undefined) return res;
    }
  }
  return null;
}

function findAnyCompliantByRelatedKey(data) {
  if (!data || typeof data !== "object") return null;

  const hasCompliant = (val) =>
    typeof val === "string" && val.trim().toUpperCase() === "COMPLIANT";

  for (const [key, value] of Object.entries(data)) {
    if (
      typeof key === "string" &&
      (key.toLowerCase().includes("sharia") ||
        key.toLowerCase().includes("halal") ||
        key.toLowerCase().includes("musaffa"))
    ) {
      if (hasCompliant(value)) return value;

      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const v of value) {
            if (hasCompliant(v)) return v;
          }
        } else {
          for (const v of Object.values(value)) {
            if (hasCompliant(v)) return v;
          }
        }
        const nested = findAnyCompliantByRelatedKey(value);
        if (nested !== null && nested !== undefined) return nested;
      }
    } else if (value && typeof value === "object") {
      const nested = findAnyCompliantByRelatedKey(value);
      if (nested !== null && nested !== undefined) return nested;
    }
  }
  return null;
}

// Utility to remove duplicates
function dedupeRows(rows) {
  const map = {};
  rows.forEach((r) => {
    if (r.Symbol) map[r.Symbol] = r;
  });
  return Object.values(map);
}

// --- ROUTES -------------------------------------------------

// Home
app.get("/", (req, res) => {
  res.send(
    '<h2>Go to <a href="/sharia-tables">/sharia-tables</a> to view Shariah-compliant Screener stocks</h2>'
  );
});

app.get("/sharia-tables", async (req, res) => {
  try {
    const rawRows = await fetchAllScreenerRows();

    // remove duplicates by Symbol
    const uniqueRows = dedupeRows(rawRows);
    const enriched = [];

    for (const row of uniqueRows) {
      const symbol = row.Symbol || "";
      const token = symbol.replace(/[^A-Z0-9]/g, "");
      if (!token) continue;

      const doc = await fetchMusaffaDoc(token);
      const sharia = getShariaCompliance(doc);

      enriched.push({
        symbol,
        name: row.Name,

        cmp: row.cmp,
        marCap: row.marCap,
        indPe: row.indPe,
        pe: row.pe,

        npQtr: row.npQtr,
        npPrevQtr: row.npPrevQtr,

        epsQtr: row.epsQtr,
        epsPrevQtr: row.epsPrevQtr,

        salesQtr: row.salesQtr,
        salesPrevQtr: row.salesPrevQtr,

        pe5Yrs: row.pe5Yrs,
        musaffa_sharia: sharia,
      });

      await sleep(40);
    }

    const compliant = enriched.filter((s) => s.musaffa_sharia === "COMPLIANT");
    const nonCompliant = enriched.filter(
      (s) => s.musaffa_sharia !== "COMPLIANT"
    );

    // ---------- Sorting --------------
    const sortKey = req.query.sort || null;
    const orderParam = req.query.order === "desc" ? "desc" : "asc";
    const order = orderParam === "desc" ? -1 : 1;

    if (sortKey) {
      compliant.sort((a, b) => {
        const valA = a[sortKey] || "";
        const valB = b[sortKey] || "";

        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
          return (numA - numB) * order;
        }
        return String(valA).localeCompare(String(valB)) * order;
      });
    }

    // cache for Excel download
    global.cachedCompliantStocks = compliant;

    // HTML generator
    function buildTable(title, items, currentSortKey, currentOrderParam) {
      const nextOrder = (key) =>
        currentSortKey === key && currentOrderParam === "asc" ? "desc" : "asc";
      let html = `
      <a href="/download-excel" style="font-size:16px; margin-bottom:20px; display:inline-block;">
        Download Excel
      </a>
      <h2>${title} (${items.length})</h2>
      <table border="1" cellpadding="6" cellspacing="0">
      <tr>
        <th>#</th>
        <th><a href="?sort=symbol&order=${nextOrder("symbol")}">Symbol</a></th>
        <th><a href="?sort=name&order=${nextOrder("name")}">Name</a></th>
        <th><a href="?sort=cmp&order=${nextOrder("cmp")}">CMP</a></th>
        <th><a href="?sort=marCap&order=${nextOrder(
          "marCap"
        )}">Market Cap</a></th>
        <th><a href="?sort=indPe&order=${nextOrder("indPe")}">Ind PE</a></th>
        <th><a href="?sort=pe&order=${nextOrder("pe")}">P/E</a></th>
        <th><a href="?sort=npQtr&order=${nextOrder("npQtr")}">NP Qtr</a></th>
        <th><a href="?sort=npPrevQtr&order=${nextOrder(
          "npPrevQtr"
        )}">NP Prev Qtr</a></th>
        <th><a href="?sort=epsQtr&order=${nextOrder("epsQtr")}">EPS Qtr</a></th>
        <th><a href="?sort=epsPrevQtr&order=${nextOrder(
          "epsPrevQtr"
        )}">EPS Prev Qtr</a></th>
        <th><a href="?sort=salesQtr&order=${nextOrder(
          "salesQtr"
        )}">Sales Qtr</a></th>
        <th><a href="?sort=salesPrevQtr&order=${nextOrder(
          "salesPrevQtr"
        )}">Sales Prev Qtr</a></th>
        <th><a href="?sort=pe5Yrs&order=${nextOrder("pe5Yrs")}">5Yrs PE</a></th>
        <th><a href="?sort=musaffa_sharia&order=${nextOrder(
          "musaffa_sharia"
        )}">Sharia</a></th>
      </tr>`;

      items.forEach((s, i) => {
        html += `
        <tr>
          <td>${i + 1}</td>
          <td>${s.symbol}</td>
          <td>${s.name}</td>
          <td>${s.cmp}</td>
          <td>${s.marCap}</td>
          <td>${s.indPe}</td>
          <td>${s.pe}</td>
          <td>${s.npQtr}</td>
          <td>${s.npPrevQtr}</td>
          <td>${s.epsQtr}</td>
          <td>${s.epsPrevQtr}</td>
          <td>${s.salesQtr}</td>
          <td>${s.salesPrevQtr}</td>
          <td>${s.pe5Yrs}</td>
          <td>${s.musaffa_sharia}</td>
        </tr>`;
      });

      html += "</table><br><hr><br>";
      return html;
    }

    res.send(`
      <html>
      <head>
        <title>Shariah Status Screener</title>
        <style>
          body { font-family: Arial; padding: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th {
            background: #f5f7fa;
            color: #222;
            font-weight: 600;
          }
          th a {
            color: #0b5ed7;
            text-decoration: none;
          }
          th a:hover {
            text-decoration: underline;
          }
          td, th { padding: 6px 10px; }
        </style>
      </head>
      <body>
        <h1>Screener + Musaffa Shariah Screening</h1>
        ${buildTable(
          "Shariah-Compliant Stocks",
          compliant,
          sortKey,
          orderParam
        )}
        ${buildTable(
          "Non-Compliant / Questionable / Unknown",
          nonCompliant,
          sortKey,
          orderParam
        )}
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<pre>${err}</pre>`);
  }
});

app.get("/download-excel", async (req, res) => {
  const ExcelJS = require("exceljs");

  // Re-fetch fresh data
  const rawRows = await fetchAllScreenerRows();
  const uniqueRows = dedupeRows(rawRows);

  const enriched = [];

  for (const row of uniqueRows) {
    const token = (row.Symbol || "").replace(/[^A-Z0-9]/g, "");
    if (!token) continue;

    const doc = await fetchMusaffaDoc(token);
    const sharia = getShariaCompliance(doc);

    if (sharia === "COMPLIANT") {
      enriched.push({
        symbol: row.Symbol,
        name: row.Name,
        cmp: row.cmp,
        marCap: row.marCap,
        pe: row.pe,
        npQtr: row.npQtr,
        salesQtr: row.salesQtr,
        pe5Yrs: row.pe5Yrs,
        sharia,
      });
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Shariah Screener");

  sheet.columns = [
    { header: "Symbol", key: "symbol", width: 15 },
    { header: "Name", key: "name", width: 25 },
    { header: "CMP", key: "cmp", width: 12 },
    { header: "Market Cap", key: "marCap", width: 15 },
    { header: "P/E", key: "pe", width: 10 },
    { header: "NP Qtr", key: "npQtr", width: 15 },
    { header: "Sales Qtr", key: "salesQtr", width: 15 },
    { header: "5Yrs PE", key: "pe5Yrs", width: 12 },
    { header: "Sharia", key: "sharia", width: 12 },
  ];

  enriched.forEach((row) => sheet.addRow(row));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=sharia_stocks.xlsx"
  );

  await workbook.xlsx.write(res);
  res.end();
});

// --- START SERVER -------------------------------------------

app.listen(PORT, () => {
  console.log(`Server running -> http://localhost:${PORT}`);
});

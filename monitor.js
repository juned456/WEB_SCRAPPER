const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_SCREENER_URL =
  "https://www.screener.in/screens/3285703/techno-funda-screener/";
const DEFAULT_MUSAFFA_BASE =
  "https://0bs2hegi5nmtad4op.a1.typesense.net/collections/stocks_data/documents/";
const DEFAULT_MUSAFFA_KEY = "GRhZdTOnzVKId4Ln9G1PIvuIgn1TK0fH";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeader(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeStock(stock) {
  return {
    symbol: String(stock.symbol || "").trim().toUpperCase(),
    name: String(stock.name || "").replace(/\s+/g, " ").trim(),
  };
}

function sortStocks(stocks) {
  return [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function formatStockPairs(stocks) {
  return sortStocks(stocks)
    .map(({ symbol, name }) => `${symbol} ${name}`)
    .join(", ");
}

function formatTradingViewSymbol(stock) {
  const symbol = String(stock.symbol || "").trim().toUpperCase();
  const musaffaSymbol = String(stock.musaffaSymbol || "").toUpperCase();
  const exchange =
    musaffaSymbol.endsWith(".BO") || /^\d{6}$/.test(symbol) ? "BSE" : "NSE";
  return `${exchange}:${symbol}`;
}

function formatTradingViewList(stocks) {
  return sortStocks(stocks).map(formatTradingViewSymbol).join(",");
}

function diffStockLists(previousStocks, currentStocks) {
  const previous = new Map(
    previousStocks.map((stock) => [normalizeStock(stock).symbol, stock])
  );
  const current = new Map(
    currentStocks.map((stock) => [normalizeStock(stock).symbol, stock])
  );

  return {
    added: sortStocks(
      [...current.entries()]
        .filter(([symbol]) => !previous.has(symbol))
        .map(([, stock]) => normalizeStock(stock))
    ),
    removed: sortStocks(
      [...previous.entries()]
        .filter(([symbol]) => !current.has(symbol))
        .map(([, stock]) => normalizeStock(stock))
    ),
  };
}

function buildNotificationMessage({ added, removed, current, baseline = false }) {
  const lines = [];

  if (baseline) {
    lines.push(`Initial compliant list saved (${current.length}).`);
  } else {
    lines.push(`Shariah-compliant list changed (${current.length} total).`);
    lines.push(
      added.length
        ? `Added (${added.length}): ${formatStockPairs(added)}`
        : "Added (0): None"
    );
    lines.push(
      removed.length
        ? `Deleted (${removed.length}): ${formatStockPairs(removed)}`
        : "Deleted (0): None"
    );
  }

  lines.push(`Updated list: ${formatStockPairs(current) || "Empty"}`);
  lines.push(
    `TradingView: ${formatTradingViewList(current) || "No symbols available"}`
  );
  return lines.join("\n\n");
}

function splitMessage(message, maxLength) {
  if (message.length <= maxLength) return [message];

  const chunks = [];
  let remaining = message;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(", ", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).replace(/^,\s*/, "").trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function getNotificationConfig(env = process.env) {
  const configured =
    Boolean(env.PUSHOVER_APP_TOKEN) && Boolean(env.PUSHOVER_USER_KEY);

  return {
    provider: "pushover",
    configured,
    appToken: env.PUSHOVER_APP_TOKEN,
    userKey: env.PUSHOVER_USER_KEY,
    device: env.PUSHOVER_DEVICE || "",
    url: env.NOTIFICATION_DEEP_LINK || "",
  };
}

async function sendPushover(config, title, message) {
  const chunks = splitMessage(message, 900);

  for (let index = 0; index < chunks.length; index++) {
    const chunkTitle =
      chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title;
    const payload = {
      token: config.appToken,
      user: config.userKey,
      title: chunkTitle,
      message: chunks[index],
    };

    if (config.device) payload.device = config.device;
    if (config.url) {
      payload.url = config.url;
      payload.url_title = "Open Shariah monitor";
    }

    await axios.post("https://api.pushover.net/1/messages.json", payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    });
  }
}

async function sendNotification(config, title, message) {
  if (!config.configured) {
    const error = new Error("Notification credentials are not configured");
    error.code = "NOT_CONFIGURED";
    throw error;
  }

  return sendPushover(config, title, message);
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

function getShariaCompliance(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(doc, "sharia_compliance")) {
    return null;
  }
  return String(doc.sharia_compliance || "").trim().toUpperCase() || null;
}

class ShariaMonitor {
  constructor(options = {}) {
    const requestedInterval =
      Number(options.intervalMs) ||
      Number(process.env.POLL_INTERVAL_SECONDS) * 1000 ||
      DEFAULT_INTERVAL_MS;

    this.intervalMs = Math.max(requestedInterval, MIN_INTERVAL_MS);
    this.screenerUrl =
      options.screenerUrl ||
      process.env.SCREENER_URL ||
      DEFAULT_SCREENER_URL;
    this.musaffaBase =
      options.musaffaBase ||
      process.env.MUSAFFA_BASE_URL ||
      DEFAULT_MUSAFFA_BASE;
    this.musaffaKey =
      options.musaffaKey ||
      process.env.MUSAFFA_API_KEY ||
      DEFAULT_MUSAFFA_KEY;
    this.maxPages =
      Number(options.maxPages) || Number(process.env.MAX_SCREENER_PAGES) || 10;
    this.notifyOnInitial =
      String(process.env.NOTIFY_ON_INITIAL_SNAPSHOT || "false").toLowerCase() ===
      "true";

    this.dbPath =
      options.dbPath ||
      process.env.SQLITE_PATH ||
      path.join(__dirname, "data", "sharia-monitor.sqlite");
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.initializeDatabase();

    this.running = false;
    this.runningPromise = null;
    this.timer = null;
    this.stopped = true;
  }

  initializeDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitor_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        error TEXT,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        changed INTEGER NOT NULL DEFAULT 0,
        stock_count INTEGER,
        compliant_count INTEGER,
        added_json TEXT NOT NULL DEFAULT '[]',
        removed_json TEXT NOT NULL DEFAULT '[]',
        list_text TEXT,
        tradingview_text TEXT,
        notification_status TEXT NOT NULL DEFAULT 'not_required'
      );

      CREATE TABLE IF NOT EXISTS current_stocks (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        compliance TEXT NOT NULL,
        data_json TEXT NOT NULL,
        first_seen_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_run_id INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('ADDED', 'DELETED')),
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(poll_run_id) REFERENCES poll_runs(id)
      );

      CREATE TABLE IF NOT EXISTS notification_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_run_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        FOREIGN KEY(poll_run_id) REFERENCES poll_runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_poll_runs_started_at
        ON poll_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outbox_status
        ON notification_outbox(status, id);
    `);

    const stockColumns = this.db
      .prepare("PRAGMA table_info(current_stocks)")
      .all()
      .map((column) => column.name);
    if (!stockColumns.includes("first_seen_at")) {
      this.db.exec("ALTER TABLE current_stocks ADD COLUMN first_seen_at TEXT");
    }
    this.db.exec(`
      UPDATE current_stocks
      SET first_seen_at = updated_at
      WHERE first_seen_at IS NULL
    `);
  }

  getState(key) {
    return this.db
      .prepare("SELECT value FROM monitor_state WHERE key = ?")
      .get(key)?.value;
  }

  setState(key, value) {
    this.db
      .prepare(`
        INSERT INTO monitor_state(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, String(value));
  }

  isInitialized() {
    return this.getState("initialized") === "true";
  }

  getCurrentStocks() {
    return this.db
      .prepare(`
        SELECT symbol, name, compliance, data_json,
               COALESCE(first_seen_at, updated_at) AS first_seen_at,
               updated_at
        FROM current_stocks
        ORDER BY datetime(COALESCE(first_seen_at, updated_at)) DESC, symbol
      `)
      .all()
      .map((row) => ({
        ...safeJsonParse(row.data_json, {}),
        symbol: row.symbol,
        name: row.name,
        compliance: row.compliance,
        firstSeenAt: row.first_seen_at,
        updatedAt: row.updated_at,
      }));
  }

  getCompliantStocks() {
    return this.getCurrentStocks().filter(
      (stock) => stock.compliance === "COMPLIANT"
    );
  }

  getLatestAddedSymbols() {
    return this.db
      .prepare(`
        SELECT symbol
        FROM stock_events
        WHERE event_type = 'ADDED'
          AND poll_run_id = (
            SELECT MAX(poll_run_id)
            FROM stock_events
            WHERE event_type = 'ADDED'
          )
          AND symbol IN (SELECT symbol FROM current_stocks)
        ORDER BY symbol
      `)
      .all()
      .map((row) => row.symbol);
  }

  getHistory(limit = 10) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    return this.db
      .prepare(`
        SELECT id, started_at, completed_at, status, error, is_baseline,
               changed, stock_count, compliant_count, added_json, removed_json,
               list_text, tradingview_text, notification_status
        FROM poll_runs
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => ({
        ...row,
        is_baseline: Boolean(row.is_baseline),
        changed: Boolean(row.changed),
        added: safeJsonParse(row.added_json, []),
        removed: safeJsonParse(row.removed_json, []),
      }));
  }

  getStatus() {
    const provider = getNotificationConfig();
    const latest = this.getHistory(1)[0] || null;
    const pendingNotifications = Number(
      this.db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM notification_outbox
          WHERE status IN ('pending', 'failed', 'waiting_for_configuration')
        `)
        .get().count
    );

    return {
      running: this.running,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      dbPath: this.dbPath,
      notificationProvider: provider.provider,
      notificationConfigured: provider.configured,
      pendingNotifications,
      latest,
      nextCheckAt: this.getState("next_check_at") || null,
    };
  }

  async fetchScreenerPage(page) {
    const separator = this.screenerUrl.includes("?") ? "&" : "?";
    const url =
      page === 1 ? this.screenerUrl : `${this.screenerUrl}${separator}page=${page}`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });
    const $ = cheerio.load(response.data);
    const table = $("table")
      .filter((_, element) => {
        return $(element).find('a[href^="/company/"]').length > 0;
      })
      .first();

    if (!table.length) {
      throw new Error(`No company table found on Screener page ${page}`);
    }

    const rawHeaders = [];
    const normalizedHeaders = [];
    const headerRow = table.find("tbody tr").first();
    headerRow.find("th, td").each((index, cell) => {
      const label = $(cell).text().replace(/\s+/g, " ").trim();
      rawHeaders[index] = label;
      normalizedHeaders[index] = normalizeHeader(label);
    });

    const rows = [];
    table
      .find("tbody tr")
      .slice(1)
      .each((_, element) => {
        const rowElement = $(element);
        const anchor = rowElement.find('a[href^="/company/"]').first();
        if (!anchor.length) return;

        const parts = String(anchor.attr("href") || "")
          .split("/")
          .filter(Boolean);
        if (parts.length < 2 || parts[0].toLowerCase() !== "company") return;

        const companyPath = String(anchor.attr("href") || "");
        const row = {
          name: anchor.text().replace(/\s+/g, " ").trim(),
          symbol: parts[1].toUpperCase(),
          screenerUrl: new URL(companyPath, "https://www.screener.in").href,
          raw: {},
        };

        rowElement.find("td").each((index, cell) => {
          if (index < 2) return;
          const key = normalizedHeaders[index];
          if (!key) return;
          const value = $(cell).text().replace(/\s+/g, " ").trim();
          row[key] = value;
          row.raw[rawHeaders[index]] = value;
        });

        row.cmp = row.cmp_rs || row.cmp || null;
        row.marCap = row.mar_cap_rs_cr || row.market_cap_rs_cr || null;
        row.indPe = row.ind_pe || null;
        row.pe = row.p_e || row.pe || null;
        row.npQtr = row.np_qtr_rs_cr || row.net_profit_qtr_rs_cr || null;
        row.npPrevQtr =
          row.np_prev_qtr_rs_cr || row.net_profit_prev_qtr_rs_cr || null;
        row.epsQtr = row.eps_qtr_rs || null;
        row.epsPrevQtr = row.eps_prev_qtr_rs || null;
        row.salesQtr =
          row.sales_qtr_rs_cr || row.revenue_qtr_rs_cr || null;
        row.salesPrevQtr =
          row.sales_prev_qtr_rs_cr || row.revenue_prev_qtr_rs_cr || null;
        row.pe5Yrs = row["5yrs_pe"] || row.pe_5yrs || null;
        rows.push(row);
      });

    return rows;
  }

  async fetchAllScreenerRows() {
    const all = [];
    const seenSymbols = new Set();

    for (let page = 1; page <= this.maxPages; page++) {
      const rows = await this.fetchScreenerPage(page);
      let newRows = 0;

      for (const row of rows) {
        if (!seenSymbols.has(row.symbol)) {
          seenSymbols.add(row.symbol);
          all.push(row);
          newRows++;
        }
      }

      if (!rows.length || newRows === 0) break;
      await sleep(100);
    }

    if (!all.length) {
      throw new Error("Screener returned no stocks; keeping the previous snapshot");
    }
    return all;
  }

  async fetchMusaffaDoc(token) {
    const headers = {
      Accept: "application/json",
      "X-Typesense-Api-Key": this.musaffaKey,
      "User-Agent": "Node-MusaffaFetcher/1.0",
    };
    const errors = [];

    for (const symbol of getMusaffaSymbolCandidates(token)) {
      const url = this.musaffaBase + encodeURIComponent(symbol);
      try {
        const response = await axios.get(url, { headers, timeout: 15000 });
        return { doc: response.data, symbol, errors };
      } catch (error) {
        errors.push(`${symbol}: ${error.response?.status || error.code || "error"}`);
      }
    }

    return { doc: null, symbol: null, errors };
  }

  async buildObservedStocks(previousStocks) {
    const rows = await this.fetchAllScreenerRows();
    const previouslyCompliant = new Set(
      previousStocks
        .filter((stock) => stock.compliance === "COMPLIANT")
        .map((stock) => stock.symbol)
    );
    const observed = [];

    for (const row of rows) {
      const token = String(row.symbol || "").replace(/[^A-Z0-9]/g, "");
      if (!token) continue;

      const lookup = await this.fetchMusaffaDoc(token);
      let compliance = getShariaCompliance(lookup.doc);
      let verification = "LIVE";

      if (!compliance && previouslyCompliant.has(row.symbol)) {
        compliance = "COMPLIANT";
        verification = "CACHED_AFTER_LOOKUP_FAILURE";
      } else if (!compliance) {
        compliance = "UNKNOWN";
        verification = "LOOKUP_FAILED";
      }

      observed.push({
        ...row,
        compliance,
        verification,
        musaffaSymbol: lookup.symbol,
        lookupErrors: lookup.errors,
      });
      await sleep(40);
    }

    return observed;
  }

  replaceCurrentStocks(stocks, now) {
    const firstSeenBySymbol = new Map(
      this.db
        .prepare(`
          SELECT symbol, COALESCE(first_seen_at, updated_at) AS first_seen_at
          FROM current_stocks
        `)
        .all()
        .map((row) => [row.symbol, row.first_seen_at])
    );
    const insert = this.db.prepare(`
      INSERT INTO current_stocks(
        symbol, name, compliance, data_json, first_seen_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("DELETE FROM current_stocks");
    for (const stock of stocks) {
      const firstSeenAt =
        stock.firstSeenAt || firstSeenBySymbol.get(stock.symbol) || now;
      insert.run(
        stock.symbol,
        stock.name,
        stock.compliance,
        JSON.stringify(stock),
        firstSeenAt,
        now
      );
    }
  }

  enqueueNotification(runId, title, message, now) {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO notification_outbox(
          poll_run_id, title, message, status, created_at
        ) VALUES(?, ?, ?, 'pending', ?)
      `)
      .run(runId, title, message, now);
    this.db
      .prepare(`
        UPDATE poll_runs
        SET notification_status = 'pending'
        WHERE id = ?
      `)
      .run(runId);
  }

  async flushNotificationOutbox() {
    const config = getNotificationConfig();
    const queued = this.db
      .prepare(`
        SELECT id, poll_run_id, title, message, attempts
        FROM notification_outbox
        WHERE status IN ('pending', 'failed', 'waiting_for_configuration')
        ORDER BY id
      `)
      .all();

    if (!queued.length) return;

    if (!config.configured) {
      this.db
        .prepare(`
          UPDATE notification_outbox
          SET status = 'waiting_for_configuration',
              last_error = 'Notification credentials are not configured'
          WHERE status IN ('pending', 'failed')
        `)
        .run();
      this.db
        .prepare(`
          UPDATE poll_runs
          SET notification_status = 'waiting_for_configuration'
          WHERE id IN (
            SELECT poll_run_id FROM notification_outbox
            WHERE status = 'waiting_for_configuration'
          )
        `)
        .run();
      return;
    }

    for (const item of queued) {
      try {
        await sendNotification(config, item.title, item.message);
        const sentAt = new Date().toISOString();
        this.db
          .prepare(`
            UPDATE notification_outbox
            SET status = 'sent', attempts = attempts + 1,
                last_error = NULL, sent_at = ?
            WHERE id = ?
          `)
          .run(sentAt, item.id);
        this.db
          .prepare(`
            UPDATE poll_runs SET notification_status = 'sent' WHERE id = ?
          `)
          .run(item.poll_run_id);
      } catch (error) {
        const message = error.response?.data
          ? JSON.stringify(error.response.data)
          : error.message;
        this.db
          .prepare(`
            UPDATE notification_outbox
            SET status = 'failed', attempts = attempts + 1, last_error = ?
            WHERE id = ?
          `)
          .run(message, item.id);
        this.db
          .prepare(`
            UPDATE poll_runs SET notification_status = 'failed' WHERE id = ?
          `)
          .run(item.poll_run_id);
      }
    }
  }

  async sendTestNotification() {
    const config = getNotificationConfig();
    const sentAt = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: process.env.TZ || "Asia/Kolkata",
    }).format(new Date());

    await sendNotification(
      config,
      "Shariah Stock Monitor — Test",
      `Test successful. Pushover notifications are working.\n\nSent: ${sentAt}`
    );

    return { sentAt };
  }

  async runCheck() {
    const startedAt = new Date().toISOString();
    const runResult = this.db
      .prepare(`
        INSERT INTO poll_runs(started_at, status)
        VALUES(?, 'running')
      `)
      .run(startedAt);
    const runId = Number(runResult.lastInsertRowid);
    const previousStocks = this.getCurrentStocks();
    const previousCompliant = previousStocks.filter(
      (stock) => stock.compliance === "COMPLIANT"
    );
    const baseline = !this.isInitialized();

    try {
      const observed = await this.buildObservedStocks(previousStocks);
      const currentCompliant = observed.filter(
        (stock) => stock.compliance === "COMPLIANT"
      );
      const { added, removed } = diffStockLists(
        previousCompliant,
        currentCompliant
      );
      const changed = !baseline && (added.length > 0 || removed.length > 0);
      const completedAt = new Date().toISOString();
      const listText = formatStockPairs(currentCompliant);
      const tradingViewText = formatTradingViewList(currentCompliant);

      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.replaceCurrentStocks(observed, completedAt);
        this.db
          .prepare(`
            UPDATE poll_runs
            SET completed_at = ?, status = 'success', is_baseline = ?,
                changed = ?, stock_count = ?, compliant_count = ?,
                added_json = ?, removed_json = ?, list_text = ?,
                tradingview_text = ?, notification_status = ?
            WHERE id = ?
          `)
          .run(
            completedAt,
            baseline ? 1 : 0,
            changed ? 1 : 0,
            observed.length,
            currentCompliant.length,
            JSON.stringify(added),
            JSON.stringify(removed),
            listText,
            tradingViewText,
            changed || (baseline && this.notifyOnInitial)
              ? "pending"
              : baseline
                ? "skipped_initial"
                : "skipped_unchanged",
            runId
          );

        const eventInsert = this.db.prepare(`
          INSERT INTO stock_events(
            poll_run_id, event_type, symbol, name, created_at
          ) VALUES(?, ?, ?, ?, ?)
        `);
        for (const stock of added) {
          eventInsert.run(runId, "ADDED", stock.symbol, stock.name, completedAt);
        }
        for (const stock of removed) {
          eventInsert.run(runId, "DELETED", stock.symbol, stock.name, completedAt);
        }

        if (changed || (baseline && this.notifyOnInitial)) {
          const title = baseline
            ? "Shariah stock baseline ready"
            : `Shariah list: +${added.length} / -${removed.length}`;
          this.enqueueNotification(
            runId,
            title,
            buildNotificationMessage({
              added,
              removed,
              current: currentCompliant,
              baseline,
            }),
            completedAt
          );
        }

        this.setState("initialized", "true");
        this.setState("last_success_at", completedAt);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }

      await this.flushNotificationOutbox();
      return {
        runId,
        baseline,
        changed,
        added,
        removed,
        current: currentCompliant,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const message = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.stack || error.message;
      this.db
        .prepare(`
          UPDATE poll_runs
          SET completed_at = ?, status = 'failed', error = ?
          WHERE id = ?
        `)
        .run(completedAt, message, runId);
      throw error;
    }
  }

  async checkNow() {
    if (this.runningPromise) return this.runningPromise;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.running = true;
    this.runningPromise = this.runCheck()
      .catch((error) => {
        console.error(`[monitor] Check failed: ${error.message}`);
        return null;
      })
      .finally(() => {
        this.running = false;
        this.runningPromise = null;
        if (!this.stopped) this.scheduleNextCheck();
      });
    return this.runningPromise;
  }

  scheduleNextCheck() {
    const nextCheckAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.setState("next_check_at", nextCheckAt);
    this.timer = setTimeout(() => this.checkNow(), this.intervalMs);
    this.timer.unref?.();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.checkNow();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setState("next_check_at", "");
  }
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  ShariaMonitor,
  buildNotificationMessage,
  diffStockLists,
  formatStockPairs,
  formatTradingViewList,
  formatTradingViewSymbol,
  getNotificationConfig,
  sendNotification,
  splitMessage,
};

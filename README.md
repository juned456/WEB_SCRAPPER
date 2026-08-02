# Shariah Stock Monitor

This Express app checks a Screener.in screen, enriches its stocks with Musaffa
status, and stores the latest snapshot and change history in SQLite.

## Behavior

- The browser page refreshes from SQLite every 5 seconds.
- External services are checked every 5 minutes by default.
- A push notification is queued only when a compliant symbol is added or
  deleted. Unchanged lists do not create notifications.
- Notifications contain additions, deletions, the complete `SYMBOL NAME`
  comma-separated list, and a TradingView-ready symbol list.
- Failed or unconfigured notifications remain in the SQLite outbox and retry
  after notification credentials are configured.
- A failed Musaffa lookup does not remove a previously compliant stock.
- Stocks in NSE's official 2% or 5% daily price bands are excluded before they
  are saved, shown, copied to TradingView, or included in notifications.
- The latest valid circuit-band data is cached in SQLite so a temporary NSE
  report outage cannot cause a false list-change notification.
- A separate mainboard IPO screener tracks companies listed in the rolling last
  three years, excludes SME listings, and checks each company against Musaffa.
- IPO data refreshes daily by default. Musaffa IPO results are cached for seven
  days to avoid unnecessary repeated requests.

## Setup

```sh
cp .env.example .env
npm start
```

Set your Pushover credentials in `.env`.

```dotenv
PUSHOVER_APP_TOKEN=your_application_token
PUSHOVER_USER_KEY=your_user_key
PUSHOVER_DEVICE=your_optional_device_name
```

## Run

The port can be selected without editing source:

```sh
PORT=3002 npm start
```

Open:

- Stock monitor: `http://localhost:3002/sharia-tables`
- Mainboard IPO screener: `http://localhost:3002/mainboard-ipos`

The IPO page includes search and compliance filters, Screener and TradingView
links, a compliant TradingView watchlist copy button, and Excel export.

## Docker deployment

The Compose setup runs one monitor instance and stores SQLite in the persistent
Docker volume `sharia-monitor-data`.

```sh
cp .env.example .env
# Add your Pushover credentials to .env
docker compose up -d --build
docker compose ps
```

Open `http://127.0.0.1:3002/sharia-tables` on the server. The port binds only
to localhost by default so it can be published safely through an aaPanel
website reverse proxy with HTTPS.

Useful commands:

```sh
docker compose logs -f app
docker compose restart app
docker compose down
```

`docker compose down` keeps the SQLite volume. Do not use `docker compose down
-v` unless you intentionally want to delete the saved stock history.

### aaPanel

1. Clone this repository into a permanent server directory.
2. Create `.env` from `.env.example` and add the Pushover credentials.
3. In aaPanel Docker, create a Compose project from `compose.yaml`, or run
   `docker compose up -d --build` in the project directory.
4. Create an aaPanel website for the domain and reverse proxy it to
   `http://127.0.0.1:3002`.
5. Enable SSL for the domain.

Keep exactly one `app` container running. Multiple replicas can compete for
the same SQLite file and can send duplicate notifications.

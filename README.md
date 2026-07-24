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

Open `http://localhost:3002/sharia-tables`.

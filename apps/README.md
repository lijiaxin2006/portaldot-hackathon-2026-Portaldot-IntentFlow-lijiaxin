# Portaldot operator dashboard

The former dashboard and API informed the views for runs, pool state, execution
evidence, and reproducibility reports. Their implementation is tightly coupled
to the frozen Base replay schema and is not copied as if it were chain neutral.

The dashboard is a local operations view over the SQLite evidence database. It
accepts a user supplied swap intent, runs the same route and contract dry-run
checks as the acceptance runner, and can submit a confirmed intent when
broadcast is explicitly enabled in the server environment. Runtime and pool
details come from the latest persisted snapshots, so an empty database is
shown as uncollected instead of being filled with sample values.

The interface exposes:

- a user intent form for input/output assets, amount, minimum output, fee cap,
  deadline, and maximum route hops;
- persisted runtime and pool snapshots;
- intent, quote, risk breakdown, and route commitment;
- dry-run and transaction evidence;
- protection failures and replayable input hashes.

Run it from the repository root with `npm run p7:dashboard`. It binds to
`127.0.0.1:8787` by default. The server first reads `data/intentflow.sqlite3`;
when that file is absent it automatically uses the real single-chain acceptance
store `data/p4-p8-broadcast-final.sqlite3`, then the newest other `.sqlite3`
file in `data/`. Set `INTENTFLOW_EVIDENCE_DB` to select a specific SQLite file,
or `PORT` to choose another port. The API reports the selected relative file in
`databaseFile` so the UI cannot silently show data from an unexpected store.

The intent endpoints are `GET /api/intent/config` and `POST /api/intents`.
Dry-run is the default. To enable the optional broadcast action, set
`INTENTFLOW_ALLOW_BROADCAST=1`, `PORTALDOT_TEST_ACCOUNT_ADDRESS`, and
`PORTALDOT_TEST_ACCOUNT_MNEMONIC` in the dashboard process. The browser never
receives the mnemonic; it only sends the intent fields and a broadcast choice.

The public acceptance bundle is generated with `npm run p8:acceptance`.
Generation reads the same database and writes to
`artifacts/p8-public-acceptance`; it reports missing deployments, fewer than
ten finalized transactions, and insufficient performance samples as gaps.

This boundary preserves the operator workflow while keeping signing material on
the local server and recording the submitted intent, selected route, dry-run,
and finalized receipt in the configured evidence store.

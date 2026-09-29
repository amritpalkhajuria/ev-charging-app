# EV Charging Platform

Group industry project, City St George's, University of London.

Finds EV charging stations around London on a map, and simulates a charging
session with a cost calculation.

## Data flow

    OpenChargeMap API  ->  data/raw/*.json  ->  clean + flatten  ->  Azure SQL Database (MERGE)
                                                                 ->  REST API (bounding box)
                                                                 ->  map front end

1. `fetchOpenchargeStations.js` extracts every station in a country (default
   GB) from the OpenChargeMap API. It pages by station ID, 5,000 per request,
   and fetches connector and operator names once from `/referencedata`.
   Writes the raw extract and a `manifest.json` to `data/raw/`.
2. `storeStations.js` cleans the extract and loads it, keyed on the
   OpenChargeMap ID so re-runs update rather than duplicate:
   - **Azure SQL:** bulk copy into a staging table, then one `MERGE` that only
     updates rows whose values changed and reports inserted / updated / unchanged
   - **MySQL** (local development): batched `INSERT ... ON DUPLICATE KEY UPDATE`

   Cleaning rules:
   - repairs longitudes with a flipped sign, drops points outside the UK
   - repairs text that was mis-encoded upstream, including double-encoded text ("NestlÃ©" -> "Nestlé")
   - drops stations with no connectors, marked non-operational, or test records
   - drops duplicates (same point and same operator)
   - resolves connector and operator IDs to names; keeps the fastest connector as `power_kw`
   - leaves missing addresses as NULL rather than guessing

   Each run writes `data/load_report.json` with counts for every rule.
3. `fetching_stations.js` serves the stations inside a map bounding box
   (indexed on latitude/longitude); `managing_sessions.js` handles charging sessions.
4. `ev_locator.js` loads the stations in view as the user pans the Google Map.

## Latest run (GB, 29 Sep 2026, Azure SQL Database)

| | |
|---|---|
| Source records | 27,638 (6 API pages, 3.0 s) |
| Loaded | 27,088 (98.0%) |
| Dropped | 345 non-operational, 105 no connectors, 86 duplicates, 13 outside UK, 1 test |
| Repaired | 26 mis-encoded names, 2 flipped coordinates |
| Full load | 4.4 s (bulk copy + MERGE) |
| Row-by-row, for comparison | 19.4 ms/row measured on 1,000 rows, about 9 min for the full set |
| Re-run with no source changes | 0 rows written |
| Map query (central London) | 701 stations in 0.26 s |

## Running

    npm install
    cp sample.env .env      # fill in your database and API key
    npm run db:init         # creates the tables (Azure SQL or MySQL, from DB_ENGINE)
    npm run fetch:stations
    npm run load:dry-run    # optional: cleaning report without touching the database
    npm run load:stations
    npm start               # http://localhost:3000

Set `DB_ENGINE=mssql` for Azure SQL Database, or `DB_ENGINE=mysql` with
`DB_SSL=false` for a local MySQL. Put the password in single quotes in `.env`
if it contains `#`.

## My contribution

Data ingestion and cleaning (`fetchOpenchargeStations.js`, `storeStations.js`),
the MySQL schema and Express data endpoints, and the map front end
(`ev_locator.*`). The Go backend and payment integration in the wider team
repository were built by other team members.

## Notes

Credentials are read from environment variables. The raw extract in `data/raw/`
is gitignored (about 30 MB); `npm run fetch:stations` regenerates it.

// Cleans the raw OpenChargeMap extract and loads it into MySQL.
// Usage: node storeStations.js            load into the database in .env
//        node storeStations.js --dry-run  clean and report only, no database
//
// Loads are idempotent: rows are upserted on the OpenChargeMap ID, so running
// it again after a fresh fetch updates stations instead of duplicating them.
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const COUNTRY_CODE = process.env.COUNTRY_CODE || "GB";
const RAW_DIR = path.join(__dirname, "data", "raw");
const REPORT_FILE = path.join(__dirname, "data", "load_report.json");
const BATCH_SIZE = 1000;

// Rough bounding box for Great Britain and Northern Ireland
const BOUNDS = { minLat: 49.8, maxLat: 60.9, minLng: -8.7, maxLng: 1.8 };
const inBounds = (lat, lng) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;

// UTF-8 text that was decoded as Latin-1 upstream, e.g. "NestlÃ©" for "Nestlé".
// Some records went through this more than once, so undo it layer by layer.
const MOJIBAKE = /[ÂÃâ][\u0080-¿]/;

const repairEncoding = (text) => {
  for (let layer = 0; layer < 4 && MOJIBAKE.test(text); layer++) {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (repaired.includes("�")) break;
    text = repaired;
  }
  return text;
};

const clean = (text) => {
  if (typeof text !== "string") return null;
  const trimmed = repairEncoding(text.trim());
  return trimmed && trimmed.toLowerCase() !== "null" ? trimmed : null;
};

// Turns raw stations into rows for charging_stations, and counts why the
// others were dropped or changed.
const transform = (stations, referenceData) => {
  const connectionTypes = new Map(referenceData.ConnectionTypes.map((t) => [t.ID, t.Title]));
  const operators = new Map(referenceData.Operators.map((o) => [o.ID, o.Title]));
  const statusTypes = new Map(referenceData.StatusTypes.map((s) => [s.ID, s]));

  const rows = [];
  const dropped = {
    missing_coordinates: 0,
    outside_country: 0,
    no_connectors: 0,
    test_record: 0,
    not_operational: 0,
    duplicate: 0,
  };
  const fixed = { coordinates_sign_flipped: 0, encoding_repaired: 0, missing_address: 0, missing_power: 0 };
  const seen = new Set();

  // Newest first, so a duplicate keeps its most recently added record
  const ordered = [...stations].sort((a, b) => b.ID - a.ID);

  for (const station of ordered) {
    const info = station.AddressInfo || {};
    let { Latitude: lat, Longitude: lng } = info;

    if (lat == null || lng == null) {
      dropped.missing_coordinates++;
      continue;
    }

    // Some records have the longitude sign flipped (a Plymouth postcode at +4.15)
    if (!inBounds(lat, lng)) {
      if (inBounds(lat, -lng)) {
        lng = -lng;
        fixed.coordinates_sign_flipped++;
      } else {
        dropped.outside_country++;
        continue;
      }
    }

    const connections = station.Connections || [];
    if (connections.length === 0) {
      dropped.no_connectors++;
      continue;
    }

    const name = clean(info.Title) || clean(info.AddressLine1) || "Unknown Station";
    if (/\bqa test\b/i.test(name)) {
      dropped.test_record++;
      continue;
    }

    if (statusTypes.get(station.StatusTypeID)?.IsOperational === false) {
      dropped.not_operational++;
      continue;
    }

    // Same point and same operator is the same charger listed twice
    const key = `${lat.toFixed(5)},${lng.toFixed(5)},${station.OperatorID}`;
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    seen.add(key);

    if (["Title", "AddressLine1", "Town", "Postcode"].some((f) => MOJIBAKE.test(info[f] || ""))) {
      fixed.encoding_repaired++;
    }

    const address = clean(info.AddressLine1);
    if (!address) fixed.missing_address++;

    const connectorNames = [
      ...new Set(connections.map((c) => connectionTypes.get(c.ConnectionTypeID)).filter(Boolean)),
    ];
    const powers = connections.map((c) => c.PowerKW).filter((p) => typeof p === "number" && p > 0);
    if (powers.length === 0) fixed.missing_power++;

    rows.push([
      station.ID,
      name.slice(0, 255),
      lat,
      lng,
      address && address.slice(0, 255),
      clean(info.Town)?.slice(0, 100) ?? null,
      clean(info.Postcode)?.slice(0, 20) ?? null,
      operators.get(station.OperatorID)?.slice(0, 255) ?? null,
      connectorNames.join(", ").slice(0, 255) || null,
      powers.length ? Math.max(...powers) : null,
      connections.reduce((total, c) => total + (c.Quantity || 1), 0),
    ]);
  }

  return { rows, dropped, fixed };
};

const COLUMNS = [
  "ocm_id", "station_name", "latitude", "longitude", "address", "town", "postcode",
  "operator", "connector_type", "power_kw", "num_connectors",
];

const MYSQL_UPSERT = `
  INSERT INTO charging_stations
    (ocm_id, station_name, latitude, longitude, address, town, postcode,
     operator, connector_type, power_kw, num_connectors)
  VALUES ?
  ON DUPLICATE KEY UPDATE
    station_name = VALUES(station_name),
    latitude = VALUES(latitude),
    longitude = VALUES(longitude),
    address = VALUES(address),
    town = VALUES(town),
    postcode = VALUES(postcode),
    operator = VALUES(operator),
    connector_type = VALUES(connector_type),
    power_kw = VALUES(power_kw),
    num_connectors = VALUES(num_connectors)
`;

// MySQL: multi-row INSERT ... ON DUPLICATE KEY UPDATE in batches
const loadMysql = async (pool, rows) => {
  const countRows = async () => (await pool.query("SELECT COUNT(*) AS n FROM charging_stations"))[0][0].n;

  const before = await countRows();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await pool.query(MYSQL_UPSERT, [rows.slice(i, i + BATCH_SIZE)]);
  }
  const after = await countRows();
  return { rows_before: before, rows_after: after, inserted: after - before, upserted_existing: rows.length - (after - before) };
};

// SQL Server: bulk copy into a staging table, then one MERGE into the target.
// Only rows whose values actually changed are updated (the EXCEPT check is
// NULL-safe), and OUTPUT $action counts inserts vs updates.
const loadMssql = async (pool, rows) => {
  const sql = require("mssql");
  const stage = new sql.Table("#stage_stations");
  stage.create = true;
  stage.columns.add("ocm_id", sql.Int, { nullable: false });
  stage.columns.add("station_name", sql.NVarChar(255), { nullable: false });
  stage.columns.add("latitude", sql.Decimal(10, 7), { nullable: false });
  stage.columns.add("longitude", sql.Decimal(10, 7), { nullable: false });
  stage.columns.add("address", sql.NVarChar(255), { nullable: true });
  stage.columns.add("town", sql.NVarChar(100), { nullable: true });
  stage.columns.add("postcode", sql.NVarChar(20), { nullable: true });
  stage.columns.add("operator", sql.NVarChar(255), { nullable: true });
  stage.columns.add("connector_type", sql.NVarChar(255), { nullable: true });
  stage.columns.add("power_kw", sql.Decimal(6, 1), { nullable: true });
  stage.columns.add("num_connectors", sql.Int, { nullable: true });
  rows.forEach((row) => stage.rows.add(...row));

  const cols = COLUMNS.join(", ");
  const updates = COLUMNS.filter((c) => c !== "ocm_id").map((c) => `${c} = s.${c}`).join(", ");

  // A transaction pins one connection, so the temp table survives until the MERGE
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).bulk(stage);
    const result = await new sql.Request(transaction).query(`
      DECLARE @changes TABLE (action NVARCHAR(10));

      MERGE dbo.charging_stations AS t
      USING #stage_stations AS s ON t.ocm_id = s.ocm_id
      WHEN MATCHED AND EXISTS (SELECT s.${COLUMNS.join(", s.")} EXCEPT SELECT t.${COLUMNS.join(", t.")})
        THEN UPDATE SET ${updates}, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED BY TARGET
        THEN INSERT (${cols}) VALUES (s.${COLUMNS.join(", s.")})
      OUTPUT $action INTO @changes;

      SELECT
        (SELECT COUNT(*) FROM @changes WHERE action = 'INSERT') AS inserted,
        (SELECT COUNT(*) FROM @changes WHERE action = 'UPDATE') AS updated,
        (SELECT COUNT(*) FROM dbo.charging_stations) AS rows_after;

      DROP TABLE #stage_stations;
    `);
    await transaction.commit();

    const { inserted, updated, rows_after } = result.recordset[0];
    return { rows_after, inserted, updated, unchanged: rows.length - inserted - updated };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const load = async (rows) => {
  const db = require("./db");
  try {
    const pool = await db.connect();
    return await (db.engine === "mssql" ? loadMssql(pool, rows) : loadMysql(pool, rows));
  } finally {
    await db.close();
  }
};

const main = async () => {
  const dryRun = process.argv.includes("--dry-run");
  const started = Date.now();

  const stationsFile = path.join(RAW_DIR, `stations_${COUNTRY_CODE}.json`);
  if (!fs.existsSync(stationsFile)) {
    console.error(`${stationsFile} not found. Run npm run fetch:stations first.`);
    process.exit(1);
  }
  const stations = JSON.parse(fs.readFileSync(stationsFile, "utf8"));
  const referenceData = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "referencedata.json"), "utf8"));

  const { rows, dropped, fixed } = transform(stations, referenceData);
  const report = {
    country: COUNTRY_CODE,
    source_records: stations.length,
    loaded_records: rows.length,
    retained_pct: +((100 * rows.length) / stations.length).toFixed(1),
    dropped,
    fixed,
  };

  if (!dryRun) {
    report.database = { engine: require("./db").engine, ...(await load(rows)) };
  }
  report.seconds = (Date.now() - started) / 1000;
  report.run_at = new Date().toISOString();

  console.log(JSON.stringify(report, null, 2));
  if (!dryRun) fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Load failed:", err.message);
    process.exit(1);
  });
}

module.exports = { transform };

// Creates the tables for the configured engine. Safe to run more than once.
// Usage: node initDb.js
const fs = require("fs");
const path = require("path");
const db = require("./db");

const main = async () => {
  const file = db.engine === "mssql" ? "schema.mssql.sql" : "schema.sql";
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");

  // SQL Server scripts are split on GO lines, MySQL scripts on semicolons
  const statements = (db.engine === "mssql" ? text.split(/^\s*GO\s*$/im) : text.split(/;\s*$/m))
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim());

  try {
    for (const statement of statements) await db.query(statement);
    const tables = await db.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_name IN ('charging_stations', 'sessions')"
    );
    console.log(`Schema ready on ${db.engine}: ${tables.map((t) => t.name).join(", ")}`);
  } finally {
    await db.close();
  }
};

main().catch((err) => {
  console.error("Schema setup failed:", err.message);
  process.exit(1);
});

// Database access for both supported engines:
//   DB_ENGINE=mssql  Azure SQL Database (production)
//   DB_ENGINE=mysql  MySQL (local development, the default)
// Credentials come from environment variables - never commit them.
//
// Queries use ? placeholders for both engines; for SQL Server they are
// rewritten to named parameters (@p0, @p1, ...).
require("dotenv").config();

const engine = process.env.DB_ENGINE || "mysql";
const useTls = process.env.DB_SSL !== "false";
let pool;

const connectMysql = async () => {
  const mysql = require("mysql2/promise");
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: useTls ? { rejectUnauthorized: true } : undefined,
  });
};

const connectMssql = async () => {
  const sql = require("mssql");
  const config = {
    server: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 1433,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    options: { encrypt: useTls },
    connectionTimeout: 60000,
    requestTimeout: 120000,
  };

  // The free Azure SQL database auto-pauses when idle and takes up to a
  // minute to resume, so the first login can fail while it wakes up.
  for (let attempt = 1; ; attempt++) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (err) {
      const waking = err.code === "ETIMEOUT" || /not currently available/i.test(err.message);
      if (!waking || attempt >= 5) throw err;
      console.log(`Database not ready (${err.message}), retrying in 15s...`);
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
};

// Returns the underlying mysql2 pool or mssql ConnectionPool
const connect = async () => {
  if (!pool) {
    pool = (engine === "mssql" ? connectMssql() : connectMysql()).catch((err) => {
      pool = undefined; // let the next call try again
      throw err;
    });
  }
  return pool;
};

// Runs a query and returns the result rows
const query = async (text, params = []) => {
  const client = await connect();

  if (engine === "mssql") {
    const request = client.request();
    let i = 0;
    const named = text.replace(/\?/g, () => {
      request.input(`p${i}`, params[i]);
      return `@p${i++}`;
    });
    return (await request.query(named)).recordset || [];
  }

  const [rows] = await client.query(text, params);
  return rows;
};

// Runs an INSERT and returns the new row's generated ID
const insert = async (text, params, idColumn) => {
  if (engine === "mssql") {
    const rows = await query(text.replace(/\bVALUES\b/i, `OUTPUT INSERTED.${idColumn} VALUES`), params);
    return rows[0][idColumn];
  }
  const client = await connect();
  const [result] = await client.query(text, params);
  return result.insertId;
};

// Caps a SELECT at n rows (LIMIT in MySQL, TOP in SQL Server)
const limit = (text, n) =>
  engine === "mssql" ? text.replace(/^\s*SELECT\b/i, `SELECT TOP (${n})`) : `${text} LIMIT ${n}`;

const close = async () => {
  if (!pool) return;
  const client = await pool;
  pool = undefined;
  await (engine === "mssql" ? client.close() : client.end());
};

module.exports = { engine, connect, query, insert, limit, close };

const express = require("express");
const router = express.Router();
const db = require("./db");

const MAX_RESULTS = 2000;

db.connect()
  .then(() => console.log(`Connected to the database (${db.engine})`))
  .catch((err) => console.error("Error connecting to the database:", err.message));

// GET /stations?minLat=&maxLat=&minLng=&maxLng=
// Stations inside the map's visible area (uses idx_location). Without a
// bounding box it returns the first MAX_RESULTS stations.
router.get("/", async (req, res) => {
  const bounds = ["minLat", "maxLat", "minLng", "maxLng"].map((k) => parseFloat(req.query[k]));
  const hasBounds = bounds.every((b) => Number.isFinite(b));

  const query = hasBounds
    ? "SELECT * FROM charging_stations WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?"
    : "SELECT * FROM charging_stations";

  try {
    res.json(await db.query(db.limit(query, MAX_RESULTS), hasBounds ? bounds : []));
  } catch (err) {
    console.error("Error fetching stations:", err.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

module.exports = router;

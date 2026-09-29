const express = require("express");
const router = express.Router();
const db = require("./db");

const RATE_PER_HOUR = 20;

// POST /sessions/start-charging
router.post("/start-charging", async (req, res) => {
  const { station_id, user_id } = req.body;

  try {
    const session_id = await db.insert(
      "INSERT INTO sessions (station_id, user_id, start_time, status) VALUES (?, ?, ?, ?)",
      [station_id, user_id, new Date(), "active"],
      "session_id"
    );
    res.json({ message: "Session started", session_id });
  } catch (err) {
    console.error("Error starting session:", err.message);
    res.status(500).json({ error: "Failed to start session" });
  }
});

// POST /sessions/complete-charging - closes the session and prices it
router.post("/complete-charging", async (req, res) => {
  const { session_id } = req.body;
  const end_time = new Date();

  try {
    const result = await db.query(
      `SELECT s.start_time, cs.power_kw
       FROM sessions s
       JOIN charging_stations cs ON s.station_id = cs.id
       WHERE s.session_id = ?`,
      [session_id]
    );
    if (result.length === 0) return res.status(404).json({ error: "Session not found" });

    const { start_time, power_kw } = result[0];
    if (power_kw == null) return res.status(422).json({ error: "Station has no power rating to price the session" });
    // MySQL DATETIME rounds to whole seconds, so a sub-second session can come out negative
    const duration_hours = Math.max(0, end_time - new Date(start_time)) / (1000 * 60 * 60);
    const total_cost = parseFloat(power_kw) * duration_hours * RATE_PER_HOUR;

    await db.query("UPDATE sessions SET end_time = ?, status = ?, total_cost = ? WHERE session_id = ?", [
      end_time,
      "completed",
      total_cost,
      session_id,
    ]);
    res.json({ message: "Session completed", total_cost: total_cost.toFixed(2) });
  } catch (err) {
    console.error("Error completing session:", err.message);
    res.status(500).json({ error: "Failed to complete session" });
  }
});

// POST /sessions/get-cost
router.post("/get-cost", async (req, res) => {
  const { session_id } = req.body;

  try {
    const result = await db.query("SELECT total_cost FROM sessions WHERE session_id = ?", [session_id]);
    if (result.length === 0) return res.status(404).json({ error: "Session not found" });
    res.json({ total_cost: result[0].total_cost });
  } catch (err) {
    console.error("Error fetching cost:", err.message);
    res.status(500).json({ error: "Failed to fetch cost" });
  }
});

module.exports = router;

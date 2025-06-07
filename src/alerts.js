const express = require("express");
const db = require("./db");
const router = express.Router();

// Get all alerts
router.get("/", async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM alert_preferences ORDER BY store_name, item_type');
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching alerts:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add new alert
router.post("/", async (req, res) => {
  const { store_name, item_type, threshold, manager_email } = req.body;
  try {
    await db.query(
      "INSERT INTO alert_preferences (store_name, item_type, threshold, manager_email, alerted) VALUES ($1, $2, $3, $4, false)",
      [store_name, item_type, threshold, manager_email]
    );
    const result = await db.query("SELECT * FROM alert_preferences ORDER BY id DESC");
    res.status(201).json(result.rows);
  } catch (err) {
    console.error("Error adding alert:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete alert
router.delete("/:id", async (req, res) => {
  const alertId = req.params.id;
  try {
    await db.query("DELETE FROM alert_preferences WHERE id = $1", [alertId]);
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting alert:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
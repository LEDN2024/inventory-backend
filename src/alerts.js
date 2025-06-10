const express = require("express");
const db = require("./db");
const router = express.Router();

// GET all alert preferences
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM alert_preferences ORDER BY store_name, item_type"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching alerts:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST a new alert
router.post("/", async (req, res) => {
  const { store_name, item_type, threshold, manager_email } = req.body;

  if (!store_name || !item_type || !threshold || !manager_email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const insertResult = await db.query(
      `INSERT INTO alert_preferences 
       (store_name, item_type, threshold, manager_email, alerted) 
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [store_name, item_type, threshold, manager_email]
    );
    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error("Error adding alert:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE an alert by ID
router.delete("/:id", async (req, res) => {
  const alertId = req.params.id;
  try {
    await db.query("DELETE FROM alert_preferences WHERE id = $1", [alertId]);
    res.sendStatus(204);
  } catch (err) {
    console.error("Error deleting alert:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
const express = require("express");
const cors = require("cors");
require("dotenv").config();

require('./validateEnv');

const pool = require('./db');
const { checkAlerts } = require("./alertChecker");
const alertsRouter = require("./alerts.js");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cron = require("node-cron");

const app = express();

const crypto = require("crypto");
const { sendResetEmail } = require("./emailUtils");

// Inventory notification schedule (10mins)
cron.schedule("*/10 * * * *", () => {
  console.log("Running alert check...");
  checkAlerts().catch(console.error);
});

// Middleware
const corsOptions = {
  origin: "https://inventory-frontend-vhsk.onrender.com",
  methods: "GET,POST,PATCH,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Password reset (send reset email)
app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(200).json({ message: "If the email exists, a reset link will be sent." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE email = $3",
      [token, expires, email]
    );

    await sendResetEmail(email, token);
    res.json({ message: "Reset link sent if email exists." });
  } catch (err) {
    console.error("Forgot-password error:", err);
    res.status(500).send("Server error");
  }
});

// Reset password
app.post("/auth/reset-password", async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  try {
    const result = await pool.query(
      `SELECT id, reset_token_expires_at FROM users WHERE reset_token = $1`,
      [token]
    );

    if (
      result.rows.length === 0 ||
      new Date(result.rows[0].reset_token_expires_at) < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired token." });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE reset_token = $2`,
      [hashed, token]
    );

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset-password error:", err);
    res.status(500).send("Server error");
  }
});

// Register alert routes
app.use("/alerts", alertsRouter);

function generateQrId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes
app.get("/", (req, res) => {
  res.send("Inventory backend is running!");
});

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ time: result.rows[0] });
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).send("DB Error");
  }
});

app.post("/inventory", async (req, res) => {
  const {
    qr_id, qr_code_id, item_type, delivery_number,
    delivery_date, storage_location, store_name
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO inventory_items (
        qr_id, qr_code_id, item_type, delivery_number,
        delivery_date, storage_location, store_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [qr_id, qr_code_id, item_type, delivery_number, delivery_date, storage_location, store_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Insert error:", err);
    res.status(500).json({ error: "Error saving item" });
  }
});

app.get("/inventory/:id", async (req, res) => {
  const qr_code_id = decodeURIComponent(req.params.id);
  try {
    const result = await pool.query(
      `SELECT * FROM inventory_items WHERE qr_code_id = $1`,
      [qr_code_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Lookup error:", err);
    res.status(500).json({ error: "Error retrieving item" });
  }
});

app.get("/profitability", async (req, res) => {
  const { store_name, start_date, end_date } = req.query;
  if (!start_date || !end_date) return res.status(400).json({ error: "start_date and end_date are required" });

  try {
    let query = `
      SELECT SUM(it.price) AS total_cogs
      FROM inventory_items i
      JOIN item_types it ON i.item_type = it.name
      WHERE i.status = 'used' AND i.used_at BETWEEN $1 AND $2`;
    const values = [start_date, end_date];
    if (store_name && store_name !== "All") {
      query += " AND i.store_name = $3";
      values.push(store_name);
    }

    const result = await pool.query(query, values);
    const total_cogs = parseFloat(result.rows[0].total_cogs) || 0;
    res.json({ total_cogs });
  } catch (err) {
    console.error("Profitability error:", err);
    res.status(500).send("Server error");
  }
});

app.patch("/inventory/:qr_code_id", async (req, res) => {
  const { qr_code_id } = req.params;
  const { status } = req.body;

  if (!["opened", "used", "unopened"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    let query, values;
    if (status === "used") {
      query = `
        UPDATE inventory_items
        SET status = $1, used_at = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
        WHERE qr_code_id = $2 RETURNING *`;
      values = [status, qr_code_id];
    } else {
      query = `
        UPDATE inventory_items
        SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE qr_code_id = $2 RETURNING *`;
      values = [status, qr_code_id];
    }

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Error updating item");
  }
});

// Alerts
app.get('/alerts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM alert_preferences ORDER BY store_name, item_type');
    res.json(result.rows);
  } catch (err) {
    console.error("GET /alerts error:", err);
    res.status(500).send("Error fetching alerts");
  }
});

app.post('/alerts', async (req, res) => {
  const { manager_email, item_type, store_name, threshold } = req.body;
  if (!manager_email || !item_type || !store_name || isNaN(threshold)) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO alert_preferences (manager_email, item_type, store_name, threshold)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [manager_email, item_type, store_name, threshold]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /alerts error:", err);
    res.status(500).send("Error saving alert preference");
  }
});

app.delete('/alerts/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM alert_preferences WHERE id = $1", [req.params.id]);
    res.sendStatus(204);
  } catch (err) {
    console.error("DELETE /alerts error:", err);
    res.status(500).send("Error deleting alert preference");
  }
});

app.patch("/inventory/:qr_code_id/price", async (req, res) => {
  const { qr_code_id } = req.params;
  const { price } = req.body;

  if (isNaN(price) || price < 0) {
    return res.status(400).json({ error: "Invalid price value" });
  }

  try {
    const result = await pool.query(
      "UPDATE inventory_items SET price = $1 WHERE qr_code_id = $2 RETURNING *",
      [price, qr_code_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Price update error:", err);
    res.status(500).send("Server error updating price");
  }
});

// Store/item CRUD
app.get("/stores", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM store_names ORDER BY name ASC");
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error("GET /stores error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/items", async (req, res) => {
  try {
    const result = await pool.query("SELECT name, price FROM item_types ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("GET /items error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/stores", async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("INSERT INTO store_names (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    res.sendStatus(201);
  } catch (err) {
    console.error("POST /stores error:", err);
    res.sendStatus(500);
  }
});

app.post("/items", async (req, res) => {
  const { name, price } = req.body;
  try {
    await pool.query(
      "INSERT INTO item_types (name, price) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET price = EXCLUDED.price",
      [name, price]
    );
    res.sendStatus(201);
  } catch (err) {
    console.error("POST /items error:", err);
    res.sendStatus(500);
  }
});

app.delete("/stores/:name", async (req, res) => {
  const { name } = req.params;
  try {
    await pool.query("DELETE FROM store_names WHERE name = $1", [name]);
    res.sendStatus(204);
  } catch (err) {
    console.error("DELETE /stores error:", err);
    res.sendStatus(500);
  }
});

app.delete("/items/:name", async (req, res) => {
  const { name } = req.params;
  try {
    await pool.query("DELETE FROM item_types WHERE name = $1", [name]);
    res.sendStatus(204);
  } catch (err) {
    console.error("DELETE /items error:", err);
    res.sendStatus(500);
  }
});

// Auth routes
const MANAGER_REG_CODE = process.env.MANAGER_REG_CODE;

app.post("/auth/register", async (req, res) => {
  const { email, password, manager_code } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const role = manager_code === MANAGER_REG_CODE ? "manager" : "scooper";

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role`,
      [email, hashedPassword, role]
    );
    res.status(201).json({ message: "User registered successfully", user: result.rows[0] });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Email not found" });

    const user = result.rows[0];

    console.log("Incoming email:", email);
    console.log("Incoming password:", password);
    console.log("Stored hash:", user.password_hash);

    const isValid = await bcrypt.compare(password, user.password_hash);
    console.log("Password valid?", isValid);

    if (!isValid) return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ email: user.email, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, role FROM users ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// Auth middleware
function authenticateManager(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "manager") return res.status(403).json({ error: "Access denied: not a manager" });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// Role update
app.patch("/users/:id/role", authenticateManager, async (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;

  if (!["scooper", "manager"].includes(role)) {
    return res.status(400).json({ error: "Invalid role value" });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role`,
      [role, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });

    res.json({ message: "User role updated", user: result.rows[0] });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
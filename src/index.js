const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("dotenv").config();
require("./validateEnv");

const app = express();
const pool = require("./db");
const { sendResetEmail } = require("./emailUtils");
const { checkAlerts } = require("./alertChecker");
const alertsRouter = require("./alerts");

// Run alerts every 10 minutes
cron.schedule("*/10 * * * *", () => {
  console.log("🔁 Running alert check...");
  checkAlerts().catch(console.error);
});

// Middleware
const allowedOrigins = [
  'https://inventory-frontend-vhsk.onrender.com',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: "GET,POST,PATCH,DELETE",
  credentials: true,
}));

app.use(express.json());

// ========== AUTH ROUTES ==========

app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const user = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (user.rows.length === 0) {
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
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, reset_token_expires_at FROM users WHERE reset_token = $1",
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
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE reset_token = $2",
      [hashed, token]
    );

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset-password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/register", async (req, res) => {
  const { email, password, manager_code } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Email already registered." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const role = manager_code === process.env.MANAGER_REG_CODE ? "manager" : "scooper";

    const result = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role",
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
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2h" });
    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ========== USER MANAGEMENT ==========

function authenticateManager(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "manager") return res.status(403).json({ error: "Access denied: not a manager" });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

app.get("/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, role FROM users ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

app.patch("/users/:id/role", authenticateManager, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!["scooper", "manager"].includes(role)) {
    return res.status(400).json({ error: "Invalid role value" });
  }

  try {
    const result = await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role",
      [role, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User role updated", user: result.rows[0] });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========== INVENTORY ROUTES ==========

app.post("/inventory", async (req, res) => {
  const {
    item_type,
    delivery_number,
    delivery_date,
    storage_location,
    store_name
  } = req.body;

  const random_id = Math.random().toString(36).substring(2, 10); // 8-char string

  try {
    const result = await pool.query(
      `INSERT INTO inventory_items (
        qr_code_id, item_type, delivery_number,
        delivery_date, storage_location, store_name
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [random_id, item_type, delivery_number, delivery_date, storage_location, store_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Insert error:", err); // check this in backend logs!
    res.status(500).json({ error: "Error saving item" });
  }
});

app.get("/inventory/:id", async (req, res) => {
  const qr_id = decodeURIComponent(req.params.id);
  try {
    const result = await pool.query("SELECT * FROM inventory_items WHERE qr_id = $1", [qr_id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Lookup error:", err);
    res.status(500).json({ error: "Error retrieving item" });
  }
});

app.get("/inventory", async (req, res) => {
  const {
    store_name,
    item_type,
    status,
    delivery_number,
    delivery_date
  } = req.query;

  const filters = [];
  const values = [];

  if (store_name && store_name !== "All") {
    values.push(store_name);
    filters.push(`store_name = $${values.length}`);
  }
  if (item_type && item_type !== "All") {
    values.push(item_type);
    filters.push(`item_type = $${values.length}`);
  }
  if (status && status !== "All") {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }
  if (delivery_number) {
    values.push(delivery_number);
    filters.push(`delivery_number = $${values.length}`);
  }
  if (delivery_date) {
    values.push(delivery_date);
    filters.push(`delivery_date = $${values.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const query = `SELECT * FROM inventory_items ${whereClause} ORDER BY created_at DESC`;

  try {
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch inventory error:", err);
    res.status(500).json({ error: "Error retrieving inventory items" });
  }
});

app.patch("/inventory/:qr_code_id", async (req, res) => {
  const { qr_code_id } = req.params;
  const { status } = req.body;
  const validStatuses = ["opened", "used", "unopened"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    const update = status === "used"
      ? `SET status = $1, used_at = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP`
      : `SET status = $1, updated_at = CURRENT_TIMESTAMP`;

    const result = await pool.query(
      `UPDATE inventory_items ${update} WHERE qr_code_id = $2 RETURNING *`,
      [status, qr_code_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Item not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Error updating item" });
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
    res.status(500).json({ error: "Server error updating price" });
  }
});

app.get("/profitability", async (req, res) => {
  const { store_name, start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date are required" });
  }

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
    res.status(500).json({ error: "Server error" });
  }
});

// ========== METADATA ROUTES ==========

app.get("/stores", async (_, res) => {
  try {
    const result = await pool.query("SELECT name FROM store_names ORDER BY name ASC");
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error("GET /stores error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/items", async (_, res) => {
  try {
    const result = await pool.query("SELECT name, price FROM item_types ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("GET /items error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/stores", async (req, res) => {
  try {
    await pool.query("INSERT INTO store_names (name) VALUES ($1) ON CONFLICT DO NOTHING", [req.body.name]);
    res.sendStatus(201);
  } catch (err) {
    console.error("POST /stores error:", err);
    res.sendStatus(500);
  }
});

app.post("/items", async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO item_types (name, price) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET price = EXCLUDED.price",
      [req.body.name, req.body.price]
    );
    res.sendStatus(201);
  } catch (err) {
    console.error("POST /items error:", err);
    res.sendStatus(500);
  }
});

app.delete("/stores/:name", async (req, res) => {
  try {
    await pool.query("DELETE FROM store_names WHERE name = $1", [req.params.name]);
    res.sendStatus(204);
  } catch (err) {
    console.error("DELETE /stores error:", err);
    res.sendStatus(500);
  }
});

app.delete("/items/:name", async (req, res) => {
  try {
    await pool.query("DELETE FROM item_types WHERE name = $1", [req.params.name]);
    res.sendStatus(204);
  } catch (err) {
    console.error("DELETE /items error:", err);
    res.sendStatus(500);
  }
});

// ========== ALERTS ==========
app.use("/alerts", alertsRouter);

// ========== HEALTH ==========
app.get("/", (_, res) => {
  res.send("Inventory backend is running!");
});

app.get("/test-db", async (_, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ time: result.rows[0] });
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({ error: "DB Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
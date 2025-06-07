const db = require('./db');
const { sendEmail } = require('./emailUtils');

const checkAlerts = async () => {
  try {
    const alerts = await db.query("SELECT * FROM alert_preferences");

    for (const alert of alerts.rows) {
      const countRes = await db.query(
        "SELECT COUNT(*) FROM inventory_items WHERE store_name = $1 AND item_type = $2 AND status != 'used'",
        [alert.store_name, alert.item_type]
      );
      const currentCount = parseInt(countRes.rows[0].count, 10);

      if (currentCount < alert.threshold && !alert.alerted) {
        await sendEmail(alert.manager_email, alert.item_type, alert.store_name, currentCount);
        await db.query("UPDATE alert_preferences SET alerted = true WHERE id = $1", [alert.id]);
      }

      if (currentCount >= alert.threshold && alert.alerted) {
        await db.query("UPDATE alert_preferences SET alerted = false WHERE id = $1", [alert.id]);
      }
    }
  } catch (err) {
    console.error("Error checking alerts:", err);
  }
};

module.exports = { checkAlerts };
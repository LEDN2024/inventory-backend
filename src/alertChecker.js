const db = require('./db');
const { sendEmail } = require('./emailUtils');

const checkAlerts = async () => {
  try {
    const alertsResult = await db.query("SELECT * FROM alert_preferences");

    for (const alert of alertsResult.rows) {
      const { store_name, item_type, threshold, alerted, manager_email, id } = alert;

      const countResult = await db.query(
        `SELECT COUNT(*) FROM inventory_items 
         WHERE store_name = $1 AND item_type = $2 AND status != 'used'`,
        [store_name, item_type]
      );

      const currentCount = parseInt(countResult.rows[0].count, 10);

      if (currentCount < threshold && !alerted) {
        await sendEmail(manager_email, item_type, store_name, currentCount);
        await db.query("UPDATE alert_preferences SET alerted = true WHERE id = $1", [id]);
      }

      if (currentCount >= threshold && alerted) {
        await db.query("UPDATE alert_preferences SET alerted = false WHERE id = $1", [id]);
      }
    }
  } catch (err) {
    console.error("Error checking alerts:", err);
  }
};

module.exports = { checkAlerts };
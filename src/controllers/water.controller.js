const sql = require('../../api/db');

async function logWater(req, res) {
  try {
    const { userId, amountMl } = req.body;

    if (!userId || !amountMl) {
      return res.status(400).json({ error: "userId and amountMl required" });
    }

    // ========================================
    // STEP 1 — Archive old logs first
    // ========================================
    const oldLogs = await sql`
      SELECT date, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date < CURRENT_DATE
      GROUP BY date
    `;

    if (oldLogs.length > 0) {
      // Get user's current goal
      const profile = await sql`
        SELECT water_goal FROM user_profiles
        WHERE user_id = ${userId}
      `;
      const goal = profile[0]?.water_goal || 2500;

      // Save each old day to water_daily
      for (const log of oldLogs) {
        await sql`
          INSERT INTO water_daily (user_id, date, total_ml, goal)
          VALUES (${userId}, ${log.date}, ${Number(log.total)}, ${goal})
          ON CONFLICT (user_id, date)
          DO UPDATE SET total_ml = EXCLUDED.total_ml
        `;
      }

      // Delete archived logs from water_logs
      await sql`
        DELETE FROM water_logs
        WHERE user_id = ${userId}
        AND date < CURRENT_DATE
      `;

      console.log(`✅ Archived ${oldLogs.length} days for user ${userId}`);
    }

    // ========================================
    // STEP 2 — Insert new log
    // ========================================
    const result = await sql`
      INSERT INTO water_logs (user_id, amount_ml, logged_at, date)
      VALUES (${userId}, ${amountMl}, NOW(), CURRENT_DATE)
      RETURNING *
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log water error:", error.message);
    res.status(500).json({ error: "Failed to log water" });
  }

}

async function resetWater(req, res) {
  try {
    const { userId } = req.params;

    await sql`
      DELETE FROM water_logs
      WHERE user_id = ${userId}
      AND DATE(logged_at) = CURRENT_DATE
    `;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset water" });
  }

}

async function getWater(req, res) {
  try {
    const { userId } = req.params;

    // ========================================
    // STEP 1 — Archive old logs first
    // (same as POST, runs on every GET too)
    // ========================================
    const oldLogs = await sql`
      SELECT date, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date < CURRENT_DATE
      GROUP BY date
    `;

    if (oldLogs.length > 0) {
      const profile = await sql`
        SELECT water_goal FROM user_profiles
        WHERE user_id = ${userId}
      `;
      const goal = profile[0]?.water_goal || 2500;

      for (const log of oldLogs) {
        await sql`
          INSERT INTO water_daily (user_id, date, total_ml, goal)
          VALUES (${userId}, ${log.date}, ${Number(log.total)}, ${goal})
          ON CONFLICT (user_id, date)
          DO UPDATE SET total_ml = EXCLUDED.total_ml
        `;
      }

      await sql`
        DELETE FROM water_logs
        WHERE user_id = ${userId}
        AND date < CURRENT_DATE
      `;

      console.log(`✅ Archived ${oldLogs.length} days for user ${userId}`);
    }

    // ========================================
    // STEP 2 — Get today's logs
    // ========================================
    const todayLogs = await sql`
      SELECT id, amount_ml, logged_at, date
      FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
      ORDER BY logged_at DESC
    `;

    // ========================================
    // STEP 3 — Get today's total
    // ========================================
    const totalResult = await sql`
      SELECT COALESCE(SUM(amount_ml), 0) as total_ml
      FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
    `;

    // ========================================
    // STEP 4 — Get goal from user_profiles
    // ========================================
    const profileResult = await sql`
      SELECT water_goal FROM user_profiles
      WHERE user_id = ${userId}
    `;
    const goal = profileResult[0]?.water_goal || 2500;

    // ========================================
    // STEP 5 — Build response
    // ========================================
    res.json({
      total_ml: Number(totalResult[0].total_ml),
      goal: goal,
      logs: todayLogs.map(log => ({
        id: log.id,
        amount_ml: log.amount_ml,
        logged_at: log.logged_at,
        date: log.date,
      }))
    });

  } catch (error) {
    console.log("Get water error:", error.message);
    res.status(500).json({ error: "Failed to get water intake" });
  }

}

async function deleteWater(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // ========================================
    // STEP 1 — Find most recent log today
    // ========================================
    const recentLog = await sql`
      SELECT id, amount_ml FROM water_logs
      WHERE user_id = ${userId}
      AND date = CURRENT_DATE
      ORDER BY logged_at DESC
      LIMIT 1
    `;

    // ========================================
    // STEP 2 — Check if log exists
    // ========================================
    if (recentLog.length === 0) {
      return res.status(404).json({ error: "No log found for today" });
    }

    // ========================================
    // STEP 3 — Delete that exact row by id
    // ========================================
    const deleted = await sql`
      DELETE FROM water_logs
      WHERE id = ${recentLog[0].id}
      AND user_id = ${userId}
      RETURNING *
    `;

    console.log(`✅ Deleted log id=${recentLog[0].id} amount=${recentLog[0].amount_ml}ml for user ${userId}`);

    res.json({
      success: true,
      deleted: {
        id: deleted[0].id,
        amount_ml: deleted[0].amount_ml,
        logged_at: deleted[0].logged_at,
      }
    });

  } catch (error) {
    console.log("Delete water error:", error.message);
    res.status(500).json({ error: "Failed to delete log" });
  }

}

module.exports = { logWater, resetWater, getWater, deleteWater };

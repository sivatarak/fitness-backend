const sql = require('../../api/db');

async function getWorkoutHistory(req, res) {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      // Get workouts for specific date
      query = sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
          AND DATE(completed_at) = ${date}
        ORDER BY completed_at DESC
      `;
    } else {
      // Get workouts for last X days
      query = sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
          AND completed_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY completed_at DESC
      `;
    }

    const workouts = await query;
    res.json(workouts);
  } catch (error) {
    console.log("Get workout history error:", error.message);
    res.status(500).json({ error: "Failed to get workout history" });
  }

}

async function getFoodHistory(req, res) {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      query = sql`
        SELECT * FROM food_logs
        WHERE user_id = ${userId}
          AND DATE(logged_at) = ${date}
        ORDER BY logged_at DESC
      `;
    } else {
      query = sql`
        SELECT * FROM food_logs
        WHERE user_id = ${userId}
          AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY logged_at DESC
      `;
    }

    const foodLogs = await query;
    res.json(foodLogs);
  } catch (error) {
    console.log("Get food history error:", error.message);
    res.status(500).json({ error: "Failed to get food history" });
  }

}

async function getWaterHistory(req, res) {
  try {
    const { userId } = req.params;
    const { days = 7, date } = req.query;

    let query;
    if (date) {
      query = sql`
        SELECT * FROM water_logs
        WHERE user_id = ${userId}
          AND DATE(logged_at) = ${date}
        ORDER BY logged_at DESC
      `;
    } else {
      query = sql`
        SELECT * FROM water_logs
        WHERE user_id = ${userId}
          AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY logged_at DESC
      `;
    }

    const waterLogs = await query;
    res.json(waterLogs);
  } catch (error) {
    console.log("Get water history error:", error.message);
    res.status(500).json({ error: "Failed to get water history" });
  }

}

async function getWeightHistory(req, res) {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const weightHistory = await sql`
      SELECT * FROM weight_history
      WHERE user_id = ${userId}
        AND logged_at >= NOW() - (${days} * INTERVAL '1 day')
      ORDER BY logged_at ASC
    `;

    res.json(weightHistory);
  } catch (error) {
    console.log("Get weight history error:", error.message);
    res.status(500).json({ error: "Failed to get weight history" });
  }

}

async function logWeight(req, res) {
  try {
    const { userId, weight, notes } = req.body;

    if (!userId || !weight) {
      return res.status(400).json({ error: "userId and weight required" });
    }

    const result = await sql`
      INSERT INTO weight_history (user_id, weight, notes, logged_at)
      VALUES (${userId}, ${weight}, ${notes || ''}, NOW())
      RETURNING *
    `;

    // Update user profile current weight
    await sql`
      UPDATE user_profiles 
      SET weight = ${weight}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log weight error:", error.message);
    res.status(500).json({ error: "Failed to log weight" });
  }

}

async function getWeeklySummary(req, res) {
  try {
    const { userId } = req.params;

    const weeklyData = await sql`
      SELECT 
        DATE_TRUNC('week', completed_at) as week_start,
        SUM(calories_burned) as total_calories,
        SUM(duration_minutes) as total_minutes,
        COUNT(*) as workout_count
      FROM workouts
      WHERE user_id = ${userId}
        AND completed_at >= NOW() - INTERVAL '4 weeks'
      GROUP BY DATE_TRUNC('week', completed_at)
      ORDER BY week_start DESC
    `;

    res.json(weeklyData);
  } catch (error) {
    console.log("Get weekly summary error:", error.message);
    res.status(500).json({ error: "Failed to get weekly summary" });
  }

}

module.exports = { getWorkoutHistory, getFoodHistory, getWaterHistory, getWeightHistory, logWeight, getWeeklySummary };

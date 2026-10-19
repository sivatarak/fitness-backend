const sql = require('../../api/db');

async function logWorkout(req, res) {
  try {
    const { userId, exerciseId, exerciseName, sets, durationMinutes, notes, caloriesBurned } = req.body;

    if (!userId || !exerciseId || !sets) {
      return res.status(400).json({ error: "userId, exerciseId, and sets required" });
    }

    // Calculate totals
    let totalVolume = 0, totalReps = 0;
    sets.forEach(set => {
      totalReps += set.reps || 0;
      totalVolume += (set.reps || 0) * (set.weight || 0);
    });

    const result = await sql`
      INSERT INTO workouts (
        user_id, exercise_id, exercise_name, sets, 
        duration_minutes, total_volume, total_reps, notes, calories_burned, completed_at
      ) VALUES (
        ${userId}, ${exerciseId}, ${exerciseName}, ${JSON.stringify(sets)},
        ${durationMinutes || 0}, ${totalVolume}, ${totalReps}, ${notes || ''}, ${caloriesBurned || 0}, NOW()
      )
      RETURNING *
    `;

    res.json(result[0]);
  } catch (error) {
    console.log("Log workout error:", error.message);
    res.status(500).json({ error: "Failed to log workout" });
  }

}

async function getWorkouts(req, res) {
  try {
    const { userId } = req.params;
    const { limit = 50, days } = req.query;

    // base query
    let workouts;

    if (days) {
      workouts = await sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
        AND completed_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY completed_at DESC
        LIMIT ${Number(limit)}
      `;
    } else {
      workouts = await sql`
        SELECT * FROM workouts
        WHERE user_id = ${userId}
        ORDER BY completed_at DESC
        LIMIT ${Number(limit)}
      `;
    }

    res.json(workouts);
  } catch (error) {
    console.log("Get workouts error:", error.message);
    res.status(500).json({ error: "Failed to get workouts" });
  }

}

async function calculateCaloriesBurned(req, res) {
  try {
    const { exerciseId, weight, duration } = req.query;

    // Validate required parameters
    if (!exerciseId || !weight || !duration) {
      return res.status(400).json({
        error: "exerciseId, weight, and duration are required"
      });
    }

    // Get exercise from database
    const exercise = await sql`
      SELECT name, met_value 
      FROM exercises 
      WHERE id = ${exerciseId}
    `;

    // If exercise not found, return 404
    if (exercise.length === 0) {
      return res.status(404).json({
        error: `Exercise with id ${exerciseId} not found`
      });
    }

    const met = parseFloat(exercise[0].met_value);
    const weightKg = parseFloat(weight);
    const durationHours = parseFloat(duration) / 60;

    // Validate numeric values
    if (isNaN(met) || isNaN(weightKg) || isNaN(durationHours)) {
      return res.status(400).json({
        error: "Invalid numeric values for met, weight, or duration"
      });
    }

    const caloriesBurned = Math.round(met * weightKg * durationHours);

    res.json({
      exercise_name: exercise[0].name,
      met_value: met,
      weight_kg: weightKg,
      duration_minutes: parseFloat(duration),
      calories_burned: caloriesBurned
    });

  } catch (error) {
    console.error("Calories calculation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }

}

module.exports = { logWorkout, getWorkouts, calculateCaloriesBurned };

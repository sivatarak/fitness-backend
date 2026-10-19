const sql = require('../../api/db');
const { calculateWorkoutStreak, calculateStrictStreak } = require('../utils/streaks');

async function getDashboard(req, res) {
  try {
    const { userId } = req.params;

    // Get profile
    const profile = await sql`SELECT * FROM user_profiles WHERE user_id = ${userId}`;
    if (profile.length === 0) return res.status(404).json({ error: "Profile not found" });

    const profileData = profile[0];

    // Parse workout_days from JSON string
    let workoutDays = [];
    if (profileData.workout_days) {
      try {
        workoutDays = typeof profileData.workout_days === 'string'
          ? JSON.parse(profileData.workout_days)
          : profileData.workout_days;
      } catch (e) {
        workoutDays = [];
      }
    }

    // Get today's info
    const today = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[today.getDay()];
    const isWorkoutDay = workoutDays.includes(todayName);

    // Check if user is new (< 7 days)
    const createdDate = new Date(profileData.created_at);
    const daysSinceSignup = Math.floor((today - createdDate) / (1000 * 60 * 60 * 24));
    const isNewUser = daysSinceSignup < 7;

    // Get today's food - ROUND the values
    const food = await sql`
      SELECT 
        ROUND(COALESCE(SUM(calories * quantity), 0)) as calories,
        ROUND(COALESCE(SUM(protein * quantity), 0)) as protein,
        ROUND(COALESCE(SUM(carbs * quantity), 0)) as carbs,
        ROUND(COALESCE(SUM(fat * quantity), 0)) as fat
      FROM food_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get today's workouts - ROUND the values
    const workout = await sql`
      SELECT 
        COUNT(*) as count,
        ROUND(COALESCE(SUM(duration_minutes), 0)) as duration,
        ROUND(COALESCE(SUM(calories_burned), 0)) as calories_burned,
        ROUND(COALESCE(SUM(total_volume), 0)) as total_volume
      FROM workouts
      WHERE user_id = ${userId} AND DATE(completed_at) = CURRENT_DATE
    `;

    // Get today's water - ROUND the values
    const water = await sql`
      SELECT ROUND(COALESCE(SUM(amount_ml), 0)) as total_ml
      FROM water_logs
      WHERE user_id = ${userId} AND DATE(logged_at) = CURRENT_DATE
    `;

    // Get last week same day workout (for personalization)
    const lastWeekSameDay = await sql`
      SELECT 
        exercise_name,
        duration_minutes,
        calories_burned,
        sets,
        DATE(completed_at) as workout_date
      FROM workouts
      WHERE user_id = ${userId} 
        AND DATE(completed_at) = CURRENT_DATE - INTERVAL '7 days'
      ORDER BY completed_at DESC
    `;

    // Group exercises from last week
    const lastWeekExercises = lastWeekSameDay.map(w => ({
      name: w.exercise_name,
      duration: w.duration_minutes,
      calories_burned: w.calories_burned,
      sets: w.sets
    }));

    const lastWeekTotalDuration = lastWeekSameDay.reduce((sum, w) => sum + (w.duration_minutes || 0), 0);
    const lastWeekTotalCalories = lastWeekSameDay.reduce((sum, w) => sum + (w.calories_burned || 0), 0);

    // Get weekly data for charts - ROUND the values
    const weekly = await sql`
      SELECT 
        DATE(logged_at) as date,
        ROUND(COALESCE(SUM(calories * quantity), 0)) as calories
      FROM food_logs
      WHERE user_id = ${userId} AND logged_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(logged_at)
      ORDER BY date
    `;

    res.json({
      user: {
        user_id: profileData.user_id,
        name: profileData.name,
        created_at: profileData.created_at,
        days_since_signup: daysSinceSignup,
        is_new_user: isNewUser,
        daily_calorie_goal: profileData.daily_calorie_goal,
        water_goal: profileData.water_goal,
        workout_days: workoutDays,
        target_weight: profileData.target_weight,
        current_weight: profileData.weight
      },
      today: {
        date: today.toISOString().split('T')[0],
        day_name: todayName,
        is_workout_day: isWorkoutDay,
        food: {
          calories: Number(food[0].calories),
          protein: Number(food[0].protein),
          carbs: Number(food[0].carbs),
          fat: Number(food[0].fat)
        },
        workout: {
          completed: Number(workout[0].count) > 0,
          count: Number(workout[0].count),
          duration: Number(workout[0].duration),
          calories_burned: Number(workout[0].calories_burned),
          total_volume: Number(workout[0].total_volume)
        },
        water: {
          total_ml: Number(water[0].total_ml),
          goal: profileData.water_goal
        }
      },
      last_week_same_day: lastWeekSameDay.length > 0 ? {
        date: lastWeekSameDay[0].workout_date,
        total_duration: lastWeekTotalDuration,
        total_calories_burned: lastWeekTotalCalories,
        exercises: lastWeekExercises
      } : null,
      weekly
    });
  } catch (error) {
    console.log("Dashboard error:", error.message);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }

}

async function getStats(req, res) {
  try {
    const { userId } = req.params;
    const { period = "week" } = req.query;

    console.log(`📊 Getting stats for user: ${userId}, period: ${period}`);

    let daysAgo = 7;
    if (period === "month") daysAgo = 30;
    if (period === "year") daysAgo = 365;

    // ================================
    // PROFILE
    // ================================
    const profile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    if (!profile.length) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profileData = profile[0];

    // ================================
    // WEIGHT PROGRESS
    // ================================
    const firstWeight = await sql`
      SELECT weight FROM weight_history
      WHERE user_id = ${userId}
      ORDER BY id ASC
      LIMIT 1
    `;

    const startWeight = firstWeight[0]?.weight
      ? Number(firstWeight[0].weight)
      : Number(profileData.weight);

    const currentWeight = Number(profileData.weight);
    const targetWeight = Number(profileData.target_weight);

    // ================================
    // FOOD / WORKOUT / WATER (current period)
    // ================================
    const foodData = await sql`
      SELECT date::text, SUM(calories * quantity) as total
      FROM food_logs
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
      GROUP BY date
    `;

    const workoutData = await sql`
      SELECT DATE(completed_at)::text as date, SUM(duration_minutes) as total
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY DATE(completed_at)
    `;

    const waterLogsData = await sql`
      SELECT date::text, SUM(amount_ml) as total
      FROM water_logs
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
      GROUP BY date
    `;

    const waterDailyData = await sql`
      SELECT date::text, total_ml as total
      FROM water_daily
      WHERE user_id = ${userId}
      AND date >= CURRENT_DATE - (${daysAgo} * INTERVAL '1 day')
    `;

    // ================================
    // STREAK DATES (unchanged — full history, not period-scoped)
    // ================================
    const workoutDates = await sql`
      SELECT DISTINCT DATE(completed_at)::text as date
      FROM workouts
      WHERE user_id = ${userId}
    `;

    const waterDates = await sql`
      SELECT DISTINCT date::text as date FROM water_daily WHERE user_id = ${userId}
      UNION
      SELECT DISTINCT date::text as date FROM water_logs  WHERE user_id = ${userId}
    `;

    const foodDates = await sql`
      SELECT DISTINCT date::text as date
      FROM food_logs
      WHERE user_id = ${userId}
    `;

    // ================================
    // TOP EXERCISES
    // ================================
    const topExercises = await sql`
      SELECT exercise_name, COUNT(*) as total_sets
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
      GROUP BY exercise_name
      ORDER BY total_sets DESC
      LIMIT 5
    `;

    // ================================
    // TOTAL WORKOUT STATS — current period
    // ================================
    const totalStats = await sql`
      SELECT
        COALESCE(SUM(duration_minutes), 0) as total_minutes,
        COALESCE(SUM(calories_burned),  0) as total_calories
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo} * INTERVAL '1 day')
    `;

    // ================================
    // TOTAL WORKOUT STATS — previous period (for comparison)
    // Same length window immediately before the current one.
    // ================================
    const previousStats = await sql`
      SELECT COALESCE(SUM(calories_burned), 0) as total_calories
      FROM workouts
      WHERE user_id = ${userId}
      AND completed_at >= NOW() - (${daysAgo * 2} * INTERVAL '1 day')
      AND completed_at <  NOW() - (${daysAgo} * INTERVAL '1 day')
    `;

    // ================================
    // BUILD DAILY MAPS
    // ================================
    const foodMap = Object.fromEntries(
      foodData.map(d => [d.date, Number(d.total)])
    );

    const workoutMap = Object.fromEntries(
      workoutData.map(d => [d.date, Number(d.total)])
    );

    // water_daily takes priority; water_logs fills in missing dates
    const waterFromLogs = Object.fromEntries(waterLogsData.map(d => [d.date, Number(d.total)]));
    const waterFromDaily = Object.fromEntries(waterDailyData.map(d => [d.date, Number(d.total)]));
    const waterMap = { ...waterFromLogs, ...waterFromDaily }; // daily overwrites logs if both exist

    // ================================
    // WALK EVERY DAY IN THE WINDOW ONCE
    // (gives us date-ordered arrays we can then bucket however the
    //  period needs — daily / weekly / monthly)
    // ================================
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const days = []; // [{ dateStr, dateObj, calories, workoutMins, waterMl }]
    for (let i = daysAgo - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      days.push({
        dateStr,
        dateObj: d,
        calories: foodMap[dateStr] || 0,
        workoutMins: workoutMap[dateStr] || 0,
        waterMl: waterMap[dateStr] || 0,
      });
    }

    // ================================
    // BUCKET INTO CHART DATA BASED ON PERIOD
    // ================================
    let labels = [];
    let calories_consumed = [];
    let workout_minutes = [];
    let water_liters = [];

    if (period === "week") {
      // one point per day
      for (const d of days) {
        labels.push(dayNames[d.dateObj.getDay()]);
        calories_consumed.push(d.calories);
        workout_minutes.push(d.workoutMins);
        water_liters.push(Number((d.waterMl / 1000).toFixed(1)));
      }
    } else if (period === "month") {
      // ~5 weekly buckets (7-day chunks, oldest first; last chunk may be short)
      const chunkSize = 7;
      let weekIndex = 1;
      for (let i = 0; i < days.length; i += chunkSize) {
        const chunk = days.slice(i, i + chunkSize);
        labels.push(`W${weekIndex}`);
        calories_consumed.push(chunk.reduce((sum, d) => sum + d.calories, 0));
        workout_minutes.push(chunk.reduce((sum, d) => sum + d.workoutMins, 0));
        water_liters.push(
          Number((chunk.reduce((sum, d) => sum + d.waterMl, 0) / 1000).toFixed(1))
        );
        weekIndex++;
      }
    } else if (period === "year") {
      // 12 calendar-month buckets, oldest to newest
      const buckets = new Map(); // "YYYY-M" -> { calories, workoutMins, waterMl, label }
      for (const d of days) {
        const key = `${d.dateObj.getFullYear()}-${d.dateObj.getMonth()}`;
        if (!buckets.has(key)) {
          buckets.set(key, {
            calories: 0,
            workoutMins: 0,
            waterMl: 0,
            label: monthNames[d.dateObj.getMonth()],
          });
        }
        const bucket = buckets.get(key);
        bucket.calories += d.calories;
        bucket.workoutMins += d.workoutMins;
        bucket.waterMl += d.waterMl;
      }
      for (const bucket of buckets.values()) {
        labels.push(bucket.label);
        calories_consumed.push(bucket.calories);
        workout_minutes.push(bucket.workoutMins);
        water_liters.push(Number((bucket.waterMl / 1000).toFixed(1)));
      }
    }

    // ================================
    // QUICK STATS (whole period, not just the last bucket)
    // ================================
    const workoutDaysCount = days.filter(d => d.workoutMins > 0).length;
    const restDays = daysAgo - workoutDaysCount;
    const totalCaloriesBurned = Number(totalStats[0]?.total_calories || 0);
    const totalWaterLiters = Number(
      (days.reduce((sum, d) => sum + d.waterMl, 0) / 1000).toFixed(1)
    );

    // ================================
    // COMPARISON — % change in calories burned vs previous equal period
    // ================================
    const currentCaloriesBurned = totalCaloriesBurned;
    const prevCaloriesBurned = Number(previousStats[0]?.total_calories || 0);
    const changePercent = prevCaloriesBurned > 0
      ? Math.round(((currentCaloriesBurned - prevCaloriesBurned) / prevCaloriesBurned) * 100)
      : 0;

    // ================================
    // STREAKS (unchanged)
    // ================================
    const schedule = profileData.workout_schedule || ["Mon", "Tue", "Wed", "Thu", "Fri"];

    const workoutStreak = calculateWorkoutStreak(
      workoutDates.map(d => d.date),
      schedule
    );

    const waterStreak = calculateStrictStreak(waterDates.map(d => d.date));
    const foodStreak = calculateStrictStreak(foodDates.map(d => d.date));

    // ================================
    // RESPONSE
    // ================================
    res.json({
      period,
      chart_data: {
        labels,
        calories_consumed,
        workout_minutes,
        water_liters,
      },
      quick_stats: {
        workout_days: workoutDaysCount,
        rest_days: restDays,
        total_calories_burned: totalCaloriesBurned,
        total_water_liters: totalWaterLiters,
      },
      weight_progress: {
        start_weight: Number(startWeight.toFixed(1)),
        current_weight: currentWeight,
        target_weight: targetWeight,
      },
      top_exercises: topExercises.map(e => ({
        name: e.exercise_name,
        sets: Number(e.total_sets),
      })),
      streaks: {
        workout_streak: workoutStreak,
        water_streak: waterStreak,
        food_log_streak: foodStreak,
      },
      total_stats: {
        total_active_minutes: Number(totalStats[0]?.total_minutes || 0),
      },
      comparison: {
        change_percent: changePercent,
      },
    });

  } catch (error) {
    console.error("❌ Stats API error:", error);
    res.status(500).json({
      error: "Failed to get stats data",
      details: error.message,
    });
  }

}

module.exports = { getDashboard, getStats };

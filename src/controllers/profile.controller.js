const sql = require('../../api/db');

async function saveProfile(req, res) {
  try {
    const {
      userId, name, age, weight, height, gender,
      targetWeight, timeline, activityLevel, workoutDays,
      dailyCalorieGoal, basic_completed, goals_completed, workout_completed
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Check if user exists in users table (create if not)
    const userExists = await sql`SELECT id FROM users WHERE id = ${userId}`;
    if (userExists.length === 0) {
      await sql`
        INSERT INTO users (id, email, name, created_at)
        VALUES (${userId}, ${userId} || '@betofit.com', ${name || 'User'}, NOW())
      `;
    }

    // Get existing profile
    const existingProfile = await sql`
      SELECT * FROM user_profiles WHERE user_id = ${userId}
    `;

    // Prepare data with existing values or defaults
    let finalName = name;
    let finalAge = age ? parseInt(age) : null;
    let finalWeight = weight ? parseFloat(weight) : null;
    let finalHeight = height ? parseFloat(height) : null;
    let finalGender = gender;
    let finalTargetWeight = targetWeight ? parseFloat(targetWeight) : null;
    let finalTimeline = timeline ? parseInt(timeline) : null;
    let finalActivityLevel = activityLevel;
    let finalWorkoutDays = Array.isArray(workoutDays) ? workoutDays : [];
    let finalDailyCalorieGoal = dailyCalorieGoal ? Math.round(dailyCalorieGoal) : null;

    // If profile exists, use existing values for missing fields
    if (existingProfile.length > 0) {
      const existing = existingProfile[0];
      if (finalName === undefined) finalName = existing.name;
      if (finalAge === null) finalAge = existing.age;
      if (finalWeight === null) finalWeight = existing.weight;
      if (finalHeight === null) finalHeight = existing.height;
      if (finalGender === undefined) finalGender = existing.gender;
      if (finalTargetWeight === null) finalTargetWeight = existing.target_weight;
      if (finalTimeline === null) finalTimeline = existing.timeline;
      if (finalActivityLevel === undefined) finalActivityLevel = existing.activity_level;
      if (finalWorkoutDays.length === 0 && existing.workout_days) {
        try {
          finalWorkoutDays = JSON.parse(existing.workout_days);
        } catch (e) {
          finalWorkoutDays = [];
        }
      }
      if (finalDailyCalorieGoal === null) finalDailyCalorieGoal = existing.daily_calorie_goal;
    }

    // Initialize calculated values
    let bmrRounded = null;
    let tdee = null;
    let waterGoal = null;
    let weeklyWeightLoss = null;
    let dailyGoal = finalDailyCalorieGoal;

    // Calculate BMR and TDEE if we have all required data
    if (finalWeight && finalHeight && finalAge && finalGender) {
      let bmr;
      if (finalGender === 'male') {
        bmr = (10 * finalWeight) + (6.25 * finalHeight) - (5 * finalAge) + 5;
      } else {
        bmr = (10 * finalWeight) + (6.25 * finalHeight) - (5 * finalAge) - 161;
      }
      bmrRounded = Math.round(bmr);

      const activityMultipliers = {
        'sedentary': 1.2,
        'light': 1.375,
        'moderate': 1.55,
        'active': 1.725,
        'very_active': 1.9
      };
      const multiplier = activityMultipliers[finalActivityLevel] || 1.55;
      tdee = Math.round(bmrRounded * multiplier);

      // Water goal
      waterGoal = Math.round(finalWeight * 33);

      // Daily calorie goal if not provided
      if (!finalDailyCalorieGoal && finalTargetWeight && finalTimeline && finalTargetWeight > 0 && finalTimeline > 0) {
        const weightDiff = Math.abs(finalWeight - finalTargetWeight);
        weeklyWeightLoss = weightDiff / finalTimeline;
        const dailyDeficit = Math.round((weeklyWeightLoss * 7700) / 7);
        const isLosingWeight = finalWeight > finalTargetWeight;
        dailyGoal = isLosingWeight ? tdee - dailyDeficit : tdee + dailyDeficit;
      } else if (!finalDailyCalorieGoal) {
        dailyGoal = tdee;
      }
    }

    const workoutDaysJson = JSON.stringify(finalWorkoutDays);

    console.log("Saving profile with values:", {
      userId,
      name: finalName,
      age: finalAge,
      weight: finalWeight,
      height: finalHeight,
      gender: finalGender,
      targetWeight: finalTargetWeight,
      timeline: finalTimeline,
      activityLevel: finalActivityLevel,
      bmr: bmrRounded,
      tdee: tdee,
      dailyGoal: dailyGoal,
      waterGoal: waterGoal,
      workoutDays: finalWorkoutDays
    });

    // ✅ UPDATED: Now saving ALL calculated values
    const profile = await sql`
      INSERT INTO user_profiles (
        user_id, name, age, weight, height, gender,
        target_weight, timeline, activity_level, workout_days,
        daily_calorie_goal, bmr, tdee, water_goal,
        basic_completed, goals_completed, workout_completed,
        profile_complete, created_at, updated_at
      ) VALUES (
        ${userId}, ${finalName}, ${finalAge}, ${finalWeight}, ${finalHeight}, ${finalGender},
        ${finalTargetWeight}, ${finalTimeline}, ${finalActivityLevel}, ${workoutDaysJson},
        ${dailyGoal}, ${bmrRounded}, ${tdee}, ${waterGoal},
        ${basic_completed || false}, ${goals_completed || false}, ${workout_completed || false},
        ${(basic_completed && goals_completed && workout_completed) || false},
        NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        weight = EXCLUDED.weight,
        height = EXCLUDED.height,
        gender = EXCLUDED.gender,
        target_weight = EXCLUDED.target_weight,
        timeline = EXCLUDED.timeline,
        activity_level = EXCLUDED.activity_level,
        workout_days = EXCLUDED.workout_days,
        daily_calorie_goal = EXCLUDED.daily_calorie_goal,
        bmr = EXCLUDED.bmr,
        tdee = EXCLUDED.tdee,
        water_goal = EXCLUDED.water_goal,
        basic_completed = EXCLUDED.basic_completed,
        goals_completed = EXCLUDED.goals_completed,
        workout_completed = EXCLUDED.workout_completed,
        profile_complete = EXCLUDED.basic_completed AND EXCLUDED.goals_completed AND EXCLUDED.workout_completed,
        updated_at = NOW()
      RETURNING *
    `;

    res.status(201).json(profile[0]);

  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Failed to save profile: " + error.message });
  }

}

async function getProfile(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const profiles = await sql`
      SELECT * FROM user_profiles 
      WHERE user_id = ${userId}
    `;

    if (profiles.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Parse workout_days back to array if it's stored as JSON
    const profile = profiles[0];
    if (profile.workout_days && typeof profile.workout_days === 'string') {
      try {
        profile.workout_days = JSON.parse(profile.workout_days);
      } catch (e) {
        profile.workout_days = [];
      }
    }

    res.json(profile);

  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }

}

module.exports = { saveProfile, getProfile };

function calculateWorkoutStreak(workoutDates, schedule) {
  if (!workoutDates.length) return 0;

  const completed = new Set(workoutDates);
  let streak = 0;
  let current = new Date();

  while (true) {
    const dayName = current.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = current.toISOString().split("T")[0];

    if (schedule.includes(dayName)) {
      if (completed.has(dateStr)) {
        streak++;
      } else {
        break;
      }
    }

    current.setDate(current.getDate() - 1);
  }

  return streak;
}

function calculateStrictStreak(dates) {
  if (!dates.length) return 0;

  const set = new Set(dates);
  let streak = 0;
  let current = new Date();

  while (true) {
    const dateStr = current.toISOString().split("T")[0];

    if (set.has(dateStr)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

module.exports = { calculateWorkoutStreak, calculateStrictStreak };

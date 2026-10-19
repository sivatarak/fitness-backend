const sql = require('../../api/db');
const axios = require('axios');

async function listExercises(req, res) {
  try {
    const { bodyPart, equipment, difficulty, exercise_type, limit = 100 } = req.query;

    let exercises;

    if (bodyPart && equipment && difficulty && exercise_type) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment}
          AND difficulty = ${difficulty} AND exercise_type = ${exercise_type}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && equipment && difficulty) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment} AND difficulty = ${difficulty}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && equipment) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND equipment = ${equipment}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart && difficulty) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart} AND difficulty = ${difficulty}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else if (bodyPart) {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        WHERE body_part = ${bodyPart}
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    } else {
      exercises = await sql`
        SELECT id, name, body_part, target_muscle, equipment, difficulty, exercise_type,
               instructions, secondary_muscles, met_value, youtube_video_id, video_title, video_duration_seconds
        FROM exercises
        ORDER BY body_part, name LIMIT ${parseInt(limit)}
      `;
    }

    res.json(exercises);
  } catch (error) {
    console.log("Get exercises error:", error.message);
    res.status(500).json({ error: "Failed to get exercises" });
  }

}

async function getExercise(req, res) {
  try {
    const { id } = req.params;

    const exercise = await sql`SELECT * FROM exercises WHERE id = ${id}`;
    if (exercise.length === 0)
      return res.status(404).json({ error: "Exercise not found" });

    let ex = exercise[0];

    if (!ex.youtube_video_id && process.env.YOUTUBE_API_KEY) {
      try {
        const searchQuery = `${ex.name} proper form tutorial`;
        const youtubeResponse = await axios.get(
          "https://www.googleapis.com/youtube/v3/search",
          {
            params: {
              key: process.env.YOUTUBE_API_KEY,
              q: searchQuery,
              part: "snippet",
              type: "video",
              maxResults: 1,
            },
          }
        );

        if (youtubeResponse.data.items.length > 0) {
          const videoId = youtubeResponse.data.items[0].id.videoId;
          const videoTitle = youtubeResponse.data.items[0].snippet.title;

          await sql`
            UPDATE exercises
            SET youtube_video_id = ${videoId}, video_title = ${videoTitle},
                video_fetched_at = NOW(), updated_at = NOW()
            WHERE id = ${id}
          `;

          ex.youtube_video_id = videoId;
          ex.video_title = videoTitle;
        }
      } catch (ytError) {
        console.log("YouTube search failed:", ytError.message);
      }
    }

    await sql`
      UPDATE exercises
      SET video_view_count = COALESCE(video_view_count, 0) + 1
      WHERE id = ${id}
    `;

    res.json(ex);
  } catch (error) {
    console.log("Get exercise error:", error.message);
    res.status(500).json({ error: "Failed to get exercise" });
  }

}

module.exports = { listExercises, getExercise };

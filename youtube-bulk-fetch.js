// ================================
// YOUTUBE VIDEO BULK FETCH SCRIPT
// Fetches videos for all exercises with NULL youtube_video_id
// Run this ONCE after importing exercises
// ================================

require("dotenv").config();
const { neon } = require("@neondatabase/serverless");
const axios = require("axios");

const sql = neon(process.env.POSTGRES_URL);
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

async function fetchVideoForExercise(exercise) {
  try {
    const searchQuery = `${exercise.name} proper form tutorial`;
    
    const response = await axios.get(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          key: YOUTUBE_API_KEY,
          q: searchQuery,
          part: 'snippet',
          type: 'video',
          maxResults: 1,
          videoDuration: 'medium', // 4-20 minutes
          videoDefinition: 'high',
          order: 'relevance'
        }
      }
    );

    if (response.data.items.length > 0) {
      const videoId = response.data.items[0].id.videoId;
      const videoTitle = response.data.items[0].snippet.title;
      
      // Get video details for duration
      const detailsResponse = await axios.get(
        'https://www.googleapis.com/youtube/v3/videos',
        {
          params: {
            key: YOUTUBE_API_KEY,
            id: videoId,
            part: 'contentDetails'
          }
        }
      );

      // Parse duration (PT5M30S -> 330 seconds)
      const duration = detailsResponse.data.items[0]?.contentDetails?.duration || '';
      const seconds = parseDuration(duration);

      // Update database
      await sql`
        UPDATE exercises
        SET 
          youtube_video_id = ${videoId},
          video_source = 'auto_search',
          video_search_query = ${searchQuery},
          video_title = ${videoTitle},
          video_duration_seconds = ${seconds},
          video_fetched_at = NOW()
        WHERE id = ${exercise.id}
      `;

      console.log(`✅ ${exercise.name} -> ${videoId}`);
      return true;
    } else {
      console.log(`❌ No video found for ${exercise.name}`);
      return false;
    }
  } catch (error) {
    console.error(`Error fetching video for ${exercise.name}:`, error.message);
    return false;
  }
}

function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  
  return hours * 3600 + minutes * 60 + seconds;
}

async function bulkFetchVideos() {
  try {
    console.log("Starting bulk video fetch...\n");
    
    // Get all exercises without videos
    const exercises = await sql`
      SELECT id, name FROM exercises
      WHERE youtube_video_id IS NULL
      ORDER BY body_part, name
    `;

    console.log(`Found ${exercises.length} exercises without videos\n`);
    
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];
      
      console.log(`[${i + 1}/${exercises.length}] Fetching: ${exercise.name}`);
      
      const success = await fetchVideoForExercise(exercise);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Wait 0.5 seconds between requests to avoid rate limiting
      // YouTube API allows 100 requests per 100 seconds
      await new Promise(resolve => setTimeout(resolve, 500));

      // Progress update every 10 exercises
      if ((i + 1) % 10 === 0) {
        console.log(`\n--- Progress: ${i + 1}/${exercises.length} ---`);
        console.log(`Success: ${successCount}, Failed: ${failCount}\n`);
      }
    }

    console.log("\n================================");
    console.log("BULK FETCH COMPLETE!");
    console.log(`Total exercises: ${exercises.length}`);
    console.log(`Videos found: ${successCount}`);
    console.log(`Not found: ${failCount}`);
    console.log("================================");
    
  } catch (error) {
    console.error("Bulk fetch error:", error.message);
  }
}

// Run the script
bulkFetchVideos();

// ================================
// USAGE INSTRUCTIONS
// ================================
// 1. Make sure you have POSTGRES_URL and YOUTUBE_API_KEY in .env
// 2. Install dependencies: npm install
// 3. Run: node youtube-bulk-fetch.js
// 4. Wait ~5 minutes for all 300 videos (with 0.5s delay between requests)
// 5. Done! All exercises will have YouTube video IDs
// ================================

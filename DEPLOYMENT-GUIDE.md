# 🚀 FITNESS APP - COMPLETE DEPLOYMENT GUIDE

## 📋 PRE-DEPLOYMENT CHECKLIST

- [ ] Vercel account created
- [ ] GitHub repository with backend code
- [ ] FatSecret API credentials
- [ ] USDA API key
- [ ] YouTube Data API key
- [ ] 300 exercises JSON file ready

---

## PHASE 1: VERCEL SETUP (30 minutes)

### Step 1.1: Create Vercel Project

```bash
1. Go to vercel.com
2. Click "New Project"
3. Import your GitHub repository
4. Configure:
   - Framework Preset: Other
   - Root Directory: ./
   - Build Command: (leave empty)
   - Output Directory: (leave empty)
   - Install Command: npm install
5. Click "Deploy"
```

### Step 1.2: Create Vercel Postgres Database

```bash
1. Go to your Vercel project dashboard
2. Click "Storage" tab
3. Click "Create Database"
4. Select "Postgres"
5. Name: "fitness-app-db"
6. Region: Select closest to your users
7. Click "Create"
8. Wait 30 seconds ✅
```

### Step 1.3: Connect Database to Project

```bash
1. Database created automatically generates environment variables
2. Go to your project → Settings → Environment Variables
3. Verify these exist (auto-added):
   - POSTGRES_URL
   - POSTGRES_PRISMA_URL
   - POSTGRES_URL_NON_POOLING
   - POSTGRES_USER
   - POSTGRES_HOST
   - POSTGRES_PASSWORD
   - POSTGRES_DATABASE
```

### Step 1.4: Add Your API Keys

```bash
In Vercel Dashboard → Your Project → Settings → Environment Variables

ADD THESE:
1. FATSECRET_CLIENT_ID = your_value
2. FATSECRET_CLIENT_SECRET = your_value
3. USDA_API_KEY = your_value
4. YOUTUBE_API_KEY = your_value (optional, for video auto-fetch)

For each:
- Value: paste your key
- Environment: Production, Preview, Development (select all)
- Click "Save"
```

---

## PHASE 2: DATABASE SETUP (1 hour)

### Step 2.1: Connect to Database

**OPTION A: Vercel Dashboard (Easiest)**
```bash
1. Vercel Dashboard → Storage → Your Database
2. Click ".env.local" tab
3. Copy the POSTGRES_URL
4. Use any SQL client:
   - TablePlus (recommended)
   - DBeaver (free)
   - pgAdmin
```

**OPTION B: Vercel CLI**
```bash
1. Install Vercel CLI: npm i -g vercel
2. Login: vercel login
3. Link project: vercel link
4. Get connection: vercel env pull .env.local
```

### Step 2.2: Run Database Schema

```bash
1. Open your SQL client
2. Connect using POSTGRES_URL from Step 2.1
3. Copy contents of database-schema.sql
4. Paste into SQL editor
5. Execute
6. Verify: You should see 10 tables created ✅
```

### Step 2.3: Import 300 Exercises

**METHOD A: Using Node.js Script (Recommended)**

Create `import-exercises.js`:

```javascript
require("dotenv").config();
const { neon } = require("@neondatabase/serverless");
const exercises = require("./exercises.json"); // Your 300 exercises

const sql = neon(process.env.POSTGRES_URL);

async function importExercises() {
  console.log(`Importing ${exercises.length} exercises...`);
  
  for (const ex of exercises) {
    await sql`
      INSERT INTO exercises (
        id, name, body_part, target_muscle, equipment,
        difficulty, exercise_type, instructions, secondary_muscles,
        met_value, source
      ) VALUES (
        ${ex.id},
        ${ex.name},
        ${ex.bodyPart},
        ${ex.target},
        ${ex.equipment},
        ${ex.difficulty || 'intermediate'},
        ${ex.type || 'strength'},
        ${Array.isArray(ex.instructions) ? ex.instructions.join(' ') : ex.instructions},
        ${JSON.stringify(ex.secondaryMuscles || [])},
        6.0,
        'ExerciseDB'
      )
      ON CONFLICT (id) DO NOTHING
    `;
    
    if (exercises.indexOf(ex) % 10 === 0) {
      console.log(`Progress: ${exercises.indexOf(ex)}/${exercises.length}`);
    }
  }
  
  console.log('✅ Import complete!');
}

importExercises();
```

Run it:
```bash
npm install @neondatabase/serverless dotenv
node import-exercises.js
```

### Step 2.4: Apply MET Values

```bash
1. Copy contents of met-values-assignment.sql
2. Paste into SQL editor
3. Execute
4. Verify:
   SELECT met_value, COUNT(*) FROM exercises GROUP BY met_value;
```

---

## PHASE 3: DEPLOY BACKEND (30 minutes)

### Step 3.1: Push Code to GitHub

```bash
git add .
git commit -m "Production ready backend"
git push origin main
```

### Step 3.2: Redeploy on Vercel

```bash
1. Vercel automatically deploys on git push
2. OR manually: Vercel Dashboard → Deployments → Redeploy
3. Wait 1-2 minutes
4. Deployment complete! ✅
```

### Step 3.3: Test Your API

```bash
Your API is now live at: https://your-project.vercel.app

Test endpoints:

1. Health check:
   https://your-project.vercel.app/

2. Get exercises:
   https://your-project.vercel.app/api/exercises?bodyPart=chest

3. Search food:
   https://your-project.vercel.app/api/food/search?q=banana
```

---

## PHASE 4: OPTIONAL ENHANCEMENTS

### Step 4.1: Auto-Fetch YouTube Videos (Optional)

```bash
1. Make sure YOUTUBE_API_KEY is in Vercel environment variables
2. Download your database .env.local
3. Run locally:
   node youtube-bulk-fetch.js
4. Wait ~5 minutes for all 300 videos
5. Done! All exercises now have video IDs ✅
```

### Step 4.2: Populate Indian Foods Database (Coming Soon)

```bash
I will provide indian-foods-import.sql with 350-450 items
Run the same way as exercises import
```

---

## PHASE 5: FRONTEND INTEGRATION

### Step 5.1: Update React Native App

```javascript
// In your React Native app

// OLD:
const API_URL = "http://192.168.0.103:10000";

// NEW:
const API_URL = "https://your-project.vercel.app/api";
```

### Step 5.2: Test All Features

```bash
✅ Exercise library loads from database
✅ Food search works
✅ Calorie tracking works
✅ Workout logging saves to database
✅ Dashboard shows real data
```

---

## 🎯 FINAL VERIFICATION

Run these checks:

```bash
1. ✅ Vercel project deployed successfully
2. ✅ Database has 10 tables
3. ✅ 300 exercises imported
4. ✅ MET values assigned
5. ✅ API endpoints respond correctly
6. ✅ Environment variables set
7. ✅ Frontend connects to production API
```

---

## 📊 MONITORING

### Vercel Dashboard

```bash
1. Logs: See all API requests and errors
2. Analytics: Track usage and performance
3. Database: Monitor query performance
```

### Set Up Alerts

```bash
1. Vercel Dashboard → Settings → Notifications
2. Enable email alerts for:
   - Deployment failures
   - Error spikes
   - Performance issues
```

---

## 🆘 TROUBLESHOOTING

### Issue: Database connection fails

```bash
Solution:
1. Check POSTGRES_URL in environment variables
2. Verify database is in same region as deployment
3. Check Vercel logs for connection errors
```

### Issue: API returns 500 errors

```bash
Solution:
1. Check Vercel logs: Dashboard → Functions → Logs
2. Verify all environment variables are set
3. Test database connection manually
```

### Issue: Food search not working

```bash
Solution:
1. Verify FATSECRET_CLIENT_ID and CLIENT_SECRET
2. Check USDA_API_KEY is valid
3. Look at Vercel logs for API errors
```

---

## 💰 COST TRACKING

```bash
Current Monthly Cost: $0

Free Tier Limits:
- Vercel Hosting: 100GB bandwidth/month
- Vercel Postgres: 256MB storage, 60 hours compute
- All APIs: Free tier

You should stay FREE for 1,000-5,000 users!
```

---

## 🚀 LAUNCH CHECKLIST

Before going live:

- [ ] All 300 exercises imported
- [ ] MET values assigned
- [ ] Food search tested with Indian foods
- [ ] Workout logging works
- [ ] Dashboard displays correctly
- [ ] Mobile app connects to production
- [ ] Error monitoring enabled
- [ ] Backup strategy in place

---

## 📞 NEXT STEPS

1. Complete deployment using this guide
2. Test thoroughly
3. When ready for Indian foods database, let me know
4. I'll provide the 350-450 Indian foods SQL import

**ESTIMATED TOTAL TIME: 2-3 hours from start to production! 🎉**

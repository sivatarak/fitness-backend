# 💪 FITNESS APP - PRODUCTION BACKEND

Complete fitness tracking backend with PostgreSQL database, food search APIs, exercise library, and workout logging.

## 🎯 FEATURES

### ✅ Exercise Library
- 300+ exercises with detailed instructions
- 6 body parts (chest, back, shoulders, arms, legs, abs)
- 10 equipment types
- Auto-fetch YouTube tutorial videos
- MET-based calorie calculation

### ✅ Food Tracking
- Multi-source food search (FatSecret, USDA, OpenFoodFacts)
- Indian foods database (350-450 items)
- Auto-translation (Telugu, Hindi → English)
- Smart caching and learning
- Complete macro tracking

### ✅ Workout Logging
- Track sets, reps, weight
- Auto-calculate calories burned
- Workout history
- Progress analytics

### ✅ User Profiles
- Complete onboarding system
- Goal setting (weight loss/gain)
- Activity level tracking
- Macro calculations
- Water intake goals

### ✅ Analytics
- Daily dashboard
- Weight tracking
- Progress charts
- Calorie balance (in vs out)

---

## 🏗️ TECH STACK

- **Backend**: Node.js + Express
- **Database**: Vercel Postgres (Neon)
- **Hosting**: Vercel (Serverless)
- **Authentication**: Firebase Auth
- **APIs**: 
  - FatSecret (food data)
  - USDA (food data)
  - OpenFoodFacts (food data)
  - YouTube Data API (exercise videos)
  - Google Translate (translation)

---

## 📋 DATABASE SCHEMA

10 tables:
1. `users` - User accounts
2. `user_profiles` - User settings and goals
3. `exercises` - Exercise library (300+)
4. `workouts` - Workout logs
5. `food_logs` - Food diary
6. `weight_history` - Weight tracking
7. `water_logs` - Hydration tracking
8. `indian_foods` - Local Indian food database
9. `search_intelligence` - Learning system
10. `translation_cache` - Translation optimization

---

## 🚀 QUICK START

### 1. Clone Repository

```bash
git clone <your-repo>
cd fitness-app-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

```bash
cp .env.example .env
# Fill in your API keys in .env
```

### 4. Deploy to Vercel

```bash
vercel
```

### 5. Set Up Database

```bash
# Run in order:
1. database-schema.sql (creates tables)
2. node import-exercises.js (imports 300 exercises)
3. met-values-assignment.sql (assigns MET values)
4. node youtube-bulk-fetch.js (optional - fetches videos)
```

---

## 📁 PROJECT STRUCTURE

```
/
├── index.js                    # Main Express app
├── api/
│   └── db.js                   # Database connection
├── package.json                # Dependencies
├── vercel.json                 # Vercel config
├── .env.example                # Environment template
├── database-schema.sql         # Database tables
├── met-values-assignment.sql   # MET values
├── import-exercises.js         # Exercise importer
├── youtube-bulk-fetch.js       # Video fetcher
├── DEPLOYMENT-GUIDE.md         # Deployment steps
└── README.md                   # This file
```

---

## 🔌 API ENDPOINTS

### Food
- `GET /api/food/search?q=banana` - Search food
- `POST /api/food/log` - Log food entry
- `GET /api/food/logs?userId=xxx` - Get today's logs

### Exercises
- `GET /api/exercises` - Get all exercises
- `GET /api/exercises?bodyPart=chest` - Filter by body part
- `GET /api/exercises/:id` - Get single exercise (auto-fetches video)

### Workouts
- `POST /api/workouts` - Log workout
- `GET /api/workouts?userId=xxx` - Get workout history

### Tracking
- `POST /api/weight` - Log weight
- `GET /api/weight/history?userId=xxx` - Weight chart
- `POST /api/water` - Log water
- `GET /api/water/today?userId=xxx` - Today's water

### Analytics
- `GET /api/dashboard?userId=xxx` - Complete dashboard data

---

## 🔑 ENVIRONMENT VARIABLES

Required in Vercel:

```bash
# Database (auto-injected by Vercel)
POSTGRES_URL

# Food APIs
FATSECRET_CLIENT_ID
FATSECRET_CLIENT_SECRET
USDA_API_KEY

# YouTube (optional)
YOUTUBE_API_KEY

# Firebase (for auth)
FIREBASE_SERVICE_ACCOUNT
```

---

## 💰 COST

**FREE for 1,000-5,000 users/month**

- Vercel Hosting: FREE
- Vercel Postgres: FREE (256MB)
- All APIs: FREE tier

---

## 📊 DATA CAPACITY

Free tier handles:
- 10,000 users
- 1M workouts/month
- 5M food logs/month
- 100K API calls/month

---

## 🛠️ DEVELOPMENT

```bash
# Install
npm install

# Run locally
npm run dev

# Test
curl http://localhost:10000/api/exercises
```

---

## 🚀 DEPLOYMENT

See [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md) for complete step-by-step instructions.

Quick deploy:
```bash
git push origin main
# Vercel auto-deploys
```

---

## 📈 FEATURES ROADMAP

### Phase 1 (Launch) ✅
- Exercise library
- Food tracking
- Workout logging
- Basic analytics

### Phase 2 (3 months)
- Social features
- Custom workout plans
- Progress photos
- AI meal suggestions

### Phase 3 (6 months)
- Trainer marketplace
- Video workouts
- Community challenges
- Advanced analytics

---

## 🆘 TROUBLESHOOTING

### Database connection fails
```bash
# Check Vercel environment variables
# Verify POSTGRES_URL is set
```

### Food search not working
```bash
# Verify API keys in Vercel
# Check FatSecret credentials
```

### Exercises not loading
```bash
# Run import-exercises.js
# Check database has 300 rows
```

---

## 📞 SUPPORT

Questions? Check:
1. DEPLOYMENT-GUIDE.md
2. Vercel logs (Dashboard → Functions → Logs)
3. Database query logs (Vercel → Storage → Insights)

---

## 📄 LICENSE

MIT

---

## 🙏 ACKNOWLEDGMENTS

- ExerciseDB for exercise data
- FatSecret, USDA, OpenFoodFacts for food data
- Vercel for hosting
- Neon for serverless Postgres

---

**Built with ❤️ for fitness enthusiasts**

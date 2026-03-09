-- ================================
-- MET VALUES ASSIGNMENT
-- Apply to exercises after import
-- ================================

-- ================================
-- HEAVY COMPOUND LIFTS (MET 6.0)
-- ================================
UPDATE exercises SET met_value = 6.0
WHERE name LIKE '%deadlift%'
   OR name LIKE '%squat%'
   OR name LIKE '%bench press%'
   OR name LIKE '%clean%'
   OR name LIKE '%snatch%'
   OR name LIKE '%power clean%';

-- ================================
-- BARBELL COMPOUND EXERCISES (MET 5.5)
-- ================================
UPDATE exercises SET met_value = 5.5
WHERE equipment = 'barbell'
  AND name NOT LIKE '%deadlift%'
  AND name NOT LIKE '%squat%'
  AND name NOT LIKE '%bench press%'
  AND name NOT LIKE '%curl%'
  AND name NOT LIKE '%raise%'
  AND name NOT LIKE '%extension%';

-- ================================
-- DUMBBELL COMPOUND EXERCISES (MET 5.0)
-- ================================
UPDATE exercises SET met_value = 5.0
WHERE equipment = 'dumbbell'
  AND (name LIKE '%press%' 
    OR name LIKE '%row%'
    OR name LIKE '%lunge%'
    OR name LIKE '%fly%');

-- ================================
-- DUMBBELL ISOLATION (MET 3.5)
-- ================================
UPDATE exercises SET met_value = 3.5
WHERE equipment = 'dumbbell'
  AND (name LIKE '%curl%'
    OR name LIKE '%raise%'
    OR name LIKE '%extension%'
    OR name LIKE '%kickback%');

-- ================================
-- BODYWEIGHT COMPOUND (MET 4.5)
-- ================================
UPDATE exercises SET met_value = 4.5
WHERE equipment = 'body weight'
  AND (name LIKE '%pull%up%'
    OR name LIKE '%chin%up%'
    OR name LIKE '%dip%'
    OR name LIKE '%push%up%'
    OR name LIKE '%muscle%up%');

-- ================================
-- BODYWEIGHT ISOLATION (MET 4.0)
-- ================================
UPDATE exercises SET met_value = 4.0
WHERE equipment = 'body weight'
  AND met_value = 6.0; -- Update only those not yet assigned

-- ================================
-- CABLE EXERCISES (MET 3.5)
-- ================================
UPDATE exercises SET met_value = 3.5
WHERE equipment = 'cable';

-- ================================
-- LEVERAGE MACHINE (MET 3.5)
-- ================================
UPDATE exercises SET met_value = 3.5
WHERE equipment = 'leverage machine';

-- ================================
-- KETTLEBELL EXERCISES (MET 5.0)
-- ================================
UPDATE exercises SET met_value = 5.0
WHERE equipment = 'kettlebell';

-- ================================
-- MEDICINE BALL (MET 4.0)
-- ================================
UPDATE exercises SET met_value = 4.0
WHERE equipment = 'medicine ball';

-- ================================
-- STABILITY BALL (MET 3.5)
-- ================================
UPDATE exercises SET met_value = 3.5
WHERE equipment = 'stability ball';

-- ================================
-- ASSISTED EXERCISES (MET 3.0)
-- ================================
UPDATE exercises SET met_value = 3.0
WHERE equipment = 'assisted';

-- ================================
-- ROPE EXERCISES (MET 4.5)
-- ================================
UPDATE exercises SET met_value = 4.5
WHERE equipment = 'rope';

-- ================================
-- CORE/ABS EXERCISES (MET 3.8)
-- ================================
UPDATE exercises SET met_value = 3.8
WHERE body_part = 'waist';

-- ================================
-- ISOLATION EXERCISES BY NAME (MET 3.0)
-- ================================
UPDATE exercises SET met_value = 3.0
WHERE (name LIKE '%curl%'
    OR name LIKE '%raise%'
    OR name LIKE '%extension%'
    OR name LIKE '%fly%'
    OR name LIKE '%kickback%')
  AND equipment NOT IN ('barbell', 'kettlebell', 'rope');

-- ================================
-- VERIFICATION QUERY
-- ================================
-- Run this to check MET value distribution:
-- SELECT met_value, COUNT(*) as exercise_count 
-- FROM exercises 
-- GROUP BY met_value 
-- ORDER BY met_value DESC;

-- Expected output:
-- met_value | exercise_count
-- ----------+---------------
--   6.0     |     ~30
--   5.5     |     ~40
--   5.0     |     ~50
--   4.5     |     ~30
--   4.0     |     ~50
--   3.8     |     ~50 (all waist exercises)
--   3.5     |     ~40
--   3.0     |     ~10

-- ================================
-- COMPLETE ✅
-- ================================

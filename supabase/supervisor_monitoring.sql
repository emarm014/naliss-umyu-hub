-- ── SUPERVISOR MONITORING SCRIPT ──
-- Save this script and run it in your Supabase SQL Editor whenever you need to check database health.

-- 1. Identify Top 10 Slowest Queries
SELECT 
    query, 
    calls, 
    total_exec_time / 1000 as total_exec_time_seconds, 
    mean_exec_time, 
    max_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- 2. Identify the Most Frequently Executed Queries
SELECT 
    query, 
    calls, 
    rows 
FROM pg_stat_statements 
ORDER BY calls DESC 
LIMIT 10;

-- 3. Cache Hit Ratio (Should be > 99%)
SELECT 
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit)  as heap_hit,
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio
FROM pg_statio_user_tables;

-- 4. Unused Indexes (Consider dropping these if size is large)
SELECT 
    schemaname || '.' || relname AS table,
    indexrelname AS index,
    pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
    idx_scan as index_scans
FROM pg_stat_user_indexes ui
JOIN pg_index i ON ui.indexrelid = i.indexrelid
WHERE NOT indisunique 
  AND idx_scan < 50 
  AND pg_relation_size(relid) > 5 * 1024 * 1024
ORDER BY pg_relation_size(i.indexrelid) DESC;

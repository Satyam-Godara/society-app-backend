const express  = require('express');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { isTreasurer, isAdmin } = require('../middleware/roles');
const router   = express.Router();

// ── GET /api/reports/collection ───────────────────────
// Monthly collection breakdown
router.get('/collection', auth, isTreasurer, async (req, res) => {
  const { month, year } = req.query;
  const now   = new Date();
  const m     = parseInt(month) || now.getMonth() + 1;
  const y     = parseInt(year)  || now.getFullYear();
  const start = new Date(y, m-1, 1).toISOString();
  const end   = new Date(y, m,   1).toISOString();

  const { data: txns, error } = await supabase
    .from('transactions')
    .select('amount, method, created_at, users(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .eq('status', 'success')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const total      = txns.reduce((s,t) => s + parseFloat(t.amount), 0);
  const byMethod   = txns.reduce((acc,t) => {
    acc[t.method] = (acc[t.method] || 0) + parseFloat(t.amount);
    return acc;
  }, {});

  // Get total expected (all bills for the month)
  const { data: bills } = await supabase
    .from('bills')
    .select('amount, status')
    .eq('society_id', req.user.society_id)
    .gte('due_date', `${y}-${String(m).padStart(2,'0')}-01`)
    .lt('due_date',  `${y}-${String(m+1 > 12 ? 1 : m+1).padStart(2,'0')}-01`);

  const totalExpected = (bills||[]).reduce((s,b) => s + parseFloat(b.amount), 0);
  const collectionRate = totalExpected > 0
    ? Math.round((total / totalExpected) * 100) : 0;

  res.json({
    month: m, year: y,
    total_collected:   total,
    total_expected:    totalExpected,
    collection_rate:   collectionRate,
    transaction_count: txns.length,
    by_method:         byMethod,
    transactions:      txns,
  });
});

// ── GET /api/reports/complaints ───────────────────────
router.get('/complaints', auth, isAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('complaints')
    .select('status, priority, category, created_at, resolved_at')
    .eq('society_id', req.user.society_id);
  if (error) return res.status(500).json({ error: error.message });

  const byStatus   = data.reduce((a,c) => { a[c.status]   = (a[c.status]   ||0)+1; return a; },{});
  const byCategory = data.reduce((a,c) => { a[c.category] = (a[c.category] ||0)+1; return a; },{});
  const resolved   = data.filter(c => c.resolved_at);
  const avgHrs     = resolved.length
    ? Math.round(resolved.reduce((s,c) => {
        return s + (new Date(c.resolved_at) - new Date(c.created_at));
      }, 0) / resolved.length / 3600000)
    : null;

  res.json({
    total:            data.length,
    by_status:        byStatus,
    by_category:      byCategory,
    avg_resolution_hours: avgHrs,
  });
});

// ── GET /api/reports/ai-usage ─────────────────────────
router.get('/ai-usage', auth, isAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('ai_chat_logs')
    .select('question, helpful, language, created_at')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  const helpful   = data.filter(d => d.helpful === true).length;
  const unhelpful = data.filter(d => d.helpful === false).length;
  const byLang    = data.reduce((a,d) => { a[d.language]=(a[d.language]||0)+1; return a; },{});

  res.json({
    total_queries:    data.length,
    helpful_count:    helpful,
    unhelpful_count:  unhelpful,
    satisfaction_pct: data.length
      ? Math.round((helpful/(helpful+unhelpful||1))*100) : null,
    by_language: byLang,
    recent:      data.slice(0,10),
  });
});

module.exports = router;
const express = require('express');
const supabase = require('../lib/supabase');
const auth = require('../middleware/auth');
const router = express.Router();
const { summarizeNotice } = require('../lib/gemini');

// GET /api/notices — all residents see society notices
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('notices')
    .select('*, users!posted_by(name, role)')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/notices — admin posts a notice
// router.post('/', auth, async (req, res) => {
//   if (req.user.role !== 'admin') {
//     return res.status(403).json({ error: 'Admin only' });
//   }

//   const { title, body, target = 'all' } = req.body;

//   if (!title || !body) {
//     return res.status(400).json({ error: 'title and body are required' });
//   }

//   const { data, error } = await supabase
//     .from('notices')
//     .insert({
//       society_id: req.user.society_id,
//       posted_by: req.user.id,
//       title,
//       body,
//       target
//     })
//     .select()
//     .single();

//   if (error) return res.status(500).json({ error: error.message });
//   res.status(201).json(data);
// });
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { title, body, target = 'all' } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body required' });
  }

  // Auto-generate AI summary (non-blocking — don't fail if AI errors)
  let ai_summary = null;
  try {
    ai_summary = await summarizeNotice(body);
  } catch (e) {
    console.log('AI summary failed:', e.message);
  }

  const { data, error } = await supabase
    .from('notices')
    .insert({
      society_id: req.user.society_id,
      posted_by:  req.user.id,
      title,
      body,
      ai_summary,  // ← auto-generated
      target
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
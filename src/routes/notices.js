// const express = require('express');
// const supabase = require('../lib/supabase');
// const auth = require('../middleware/auth');
// const router = express.Router();
// const { summarizeNotice } = require('../lib/gemini');

// // GET /api/notices — all residents see society notices
// router.get('/', auth, async (req, res) => {
//   const { data, error } = await supabase
//     .from('notices')
//     .select('*, users!posted_by(name, role)')
//     .eq('society_id', req.user.society_id)
//     .order('created_at', { ascending: false })
//     .limit(20);

//   if (error) return res.status(500).json({ error: error.message });
//   res.json(data);
// });

// // POST /api/notices — admin posts a notice
// // router.post('/', auth, async (req, res) => {
// //   if (req.user.role !== 'admin') {
// //     return res.status(403).json({ error: 'Admin only' });
// //   }

// //   const { title, body, target = 'all' } = req.body;

// //   if (!title || !body) {
// //     return res.status(400).json({ error: 'title and body are required' });
// //   }

// //   const { data, error } = await supabase
// //     .from('notices')
// //     .insert({
// //       society_id: req.user.society_id,
// //       posted_by: req.user.id,
// //       title,
// //       body,
// //       target
// //     })
// //     .select()
// //     .single();

// //   if (error) return res.status(500).json({ error: error.message });
// //   res.status(201).json(data);
// // });
// router.post('/', auth, async (req, res) => {
//   if (req.user.role !== 'admin') {
//     return res.status(403).json({ error: 'Admin only' });
//   }

//   const { title, body, target = 'all' } = req.body;
//   if (!title || !body) {
//     return res.status(400).json({ error: 'title and body required' });
//   }

//   // Auto-generate AI summary (non-blocking — don't fail if AI errors)
//   let ai_summary = null;
//   try {
//     ai_summary = await summarizeNotice(body);
//   } catch (e) {
//     console.log('AI summary failed:', e.message);
//   }

//   const { data, error } = await supabase
//     .from('notices')
//     .insert({
//       society_id: req.user.society_id,
//       posted_by:  req.user.id,
//       title,
//       body,
//       ai_summary,  // ← auto-generated
//       target
//     })
//     .select()
//     .single();

//   if (error) return res.status(500).json({ error: error.message });
//   res.status(201).json(data);
// });

// module.exports = router;


const express  = require('express');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { isAdmin } = require('../middleware/roles');
const { summarizeNotice } = require('../lib/gemini');
const router   = express.Router();

// ── GET /api/notices ──────────────────────────────────
// Residents see: broadcasts + direct messages to them
// Admins see: everything
router.get('/', auth, async (req, res) => {
  let query = supabase
    .from('notices')
    .select('*, users!posted_by(name,role)')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    // Resident: see broadcasts (direct_to IS NULL) OR messages to them
    query = query.or(`direct_to.is.null,direct_to.eq.${req.user.id}`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/notices/inbox ────────────────────────────
// Resident's personal inbox — only direct messages to them
router.get('/inbox', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('notices')
    .select('*, users!posted_by(name,role)')
    .eq('society_id', req.user.society_id)
    .eq('direct_to', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/notices/unread-count ────────────────────
router.get('/unread-count', auth, async (req, res) => {
  const { count, error } = await supabase
    .from('notices')
    .select('id', { count: 'exact' })
    .eq('society_id', req.user.society_id)
    .eq('is_read', false)
    .or(`direct_to.is.null,direct_to.eq.${req.user.id}`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ unread: count || 0 });
});

// ── POST /api/notices ─────────────────────────────────
// Admin posts broadcast or direct notice
router.post('/', auth, isAdmin, async (req, res) => {
  const {
    title, body,
    target     = 'all',   // 'all' | flat number string e.g. 'B-204'
    direct_to  = null,    // specific user UUID for DM
    priority   = 'normal' // 'normal' | 'urgent'
  } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body required' });
  }

  // If target is a flat number (not 'all'), find that resident's user id
  let resolvedDirectTo = direct_to;
  if (!direct_to && target !== 'all') {
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('society_id', req.user.society_id)
      .eq('flat_number', target)
      .eq('role', 'resident')
      .single();
    if (targetUser) resolvedDirectTo = targetUser.id;
  }

  // AI summary (non-blocking)
  let ai_summary = null;
  try { ai_summary = await summarizeNotice(body); }
  catch (e) { console.log('AI summary skip:', e.message); }

  const { data, error } = await supabase
    .from('notices')
    .insert({
      society_id: req.user.society_id,
      posted_by:  req.user.id,
      title,
      body,
      ai_summary,
      target,
      direct_to:  resolvedDirectTo,
      priority,
      is_read:    false,
    })
    .select('*, users!posted_by(name)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── PUT /api/notices/:id/read ─────────────────────────
router.put('/:id/read', auth, async (req, res) => {
  const { error } = await supabase
    .from('notices')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── DELETE /api/notices/:id ───────────────────────────
router.delete('/:id', auth, isAdmin, async (req, res) => {
  const { error } = await supabase
    .from('notices')
    .delete()
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
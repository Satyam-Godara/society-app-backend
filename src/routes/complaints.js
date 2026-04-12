const express = require('express');
const supabase = require('../lib/supabase');
const auth = require('../middleware/auth');
const router = express.Router();

// POST /api/complaints — resident raises complaint
router.post('/', auth, async (req, res) => {
  const { category, description } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }

  const { data, error } = await supabase
    .from('complaints')
    .insert({
      society_id: req.user.society_id,
      raised_by: req.user.id,
      category: category || 'general',
      description,
      status: 'open',
      priority: 'medium'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/complaints — get complaints
// residents see their own, admins see all
router.get('/', auth, async (req, res) => {
  let query = supabase
    .from('complaints')
    .select('*, users!raised_by(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false });

  if (req.user.role !== 'admin') {
    query = query.eq('raised_by', req.user.id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/complaints/:id — admin updates status
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { status, assigned_to, priority } = req.body;
  const updates = {};
  if (status) updates.status = status;
  if (assigned_to) updates.assigned_to = assigned_to;
  if (priority) updates.priority = priority;
  if (status === 'resolved') updates.resolved_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('complaints')
    .update(updates)
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
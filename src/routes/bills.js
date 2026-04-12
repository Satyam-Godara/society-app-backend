const express = require('express');
const supabase = require('../lib/supabase');
const auth = require('../middleware/auth');
const router = express.Router();

// GET /api/bills — get my bills
router.get('/', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('society_id', req.user.society_id)
    .eq('user_id', req.user.id)
    .order('due_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/bills/all — admin: get all society bills
router.get('/all', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { data, error } = await supabase
    .from('bills')
    .select('*, users(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .order('due_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/bills — admin: create bill(s) for residents
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { user_id, type, amount, due_date } = req.body;

  const { data, error } = await supabase
    .from('bills')
    .insert({
      society_id: req.user.society_id,
      user_id,
      type,
      amount,
      due_date,
      status: 'pending'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/bills/:id/pay — mark bill paid after Razorpay success
router.put('/:id/pay', auth, async (req, res) => {
  const { razorpay_order_id } = req.body;

  const { data, error } = await supabase
    .from('bills')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      razorpay_order_id
    })
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Also log the transaction
  await supabase.from('transactions').insert({
    society_id: req.user.society_id,
    bill_id: req.params.id,
    user_id: req.user.id,
    amount: data.amount,
    method: req.body.method || 'upi',
    razorpay_id: razorpay_order_id,
    status: 'success'
  });

  res.json(data);
});



// POST /api/bills/bulk — admin generates monthly bills for all residents
router.post('/bulk', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { type, amount, due_date } = req.body;

  if (!type || !amount || !due_date) {
    return res.status(400).json({ error: 'type, amount, due_date required' });
  }

  // Get all residents in this society
  const { data: residents, error: rErr } = await supabase
    .from('users')
    .select('id')
    .eq('society_id', req.user.society_id)
    .eq('role', 'resident');

  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!residents.length) {
    return res.status(400).json({ error: 'No residents found in society' });
  }

  // Create one bill per resident
  const bills = residents.map(r => ({
    society_id: req.user.society_id,
    user_id:    r.id,
    type,
    amount,
    due_date,
    status: 'pending',
  }));

  const { data, error } = await supabase
    .from('bills')
    .insert(bills)
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    success: true,
    bills_created: data.length,
    message: `Created ${data.length} bills for all residents`,
  });
});


module.exports = router;
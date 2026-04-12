const express = require('express');
const supabase = require('../lib/supabase');
const auth = require('../middleware/auth');
const router = express.Router();

// Generate a random 4-digit OTP
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /api/visitors — resident creates a visitor pass
router.post('/', auth, async (req, res) => {
  const { visitor_name, purpose, valid_hours = 8 } = req.body;

  if (!visitor_name) {
    return res.status(400).json({ error: 'visitor_name is required' });
  }

  const valid_from = new Date();
  const valid_until = new Date(
    valid_from.getTime() + valid_hours * 60 * 60 * 1000
  );

  const { data, error } = await supabase
    .from('visitor_passes')
    .insert({
      society_id: req.user.society_id,
      resident_id: req.user.id,
      visitor_name,
      purpose,
      otp_code: generateOTP(),
      valid_from: valid_from.toISOString(),
      valid_until: valid_until.toISOString(),
      status: 'active'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/visitors/my — resident: see their passes
router.get('/my', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('visitor_passes')
    .select('*')
    .eq('society_id', req.user.society_id)
    .eq('resident_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/visitors/verify — guard verifies OTP at gate
router.post('/verify', auth, async (req, res) => {
  const { otp_code } = req.body;

  if (!otp_code) {
    return res.status(400).json({ error: 'otp_code is required' });
  }

  const now = new Date().toISOString();

  const { data: pass, error } = await supabase
    .from('visitor_passes')
    .select('*, users!resident_id(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .eq('otp_code', otp_code)
    .eq('status', 'active')
    .lte('valid_from', now)
    .gte('valid_until', now)
    .single();

  if (error || !pass) {
    return res.status(404).json({ error: 'Invalid or expired OTP' });
  }

  // Mark as used
  await supabase
    .from('visitor_passes')
    .update({ status: 'used', used_at: now })
    .eq('id', pass.id);

  res.json({
    success: true,
    visitor_name: pass.visitor_name,
    purpose: pass.purpose,
    invited_by: pass.users
  });
});

module.exports = router;
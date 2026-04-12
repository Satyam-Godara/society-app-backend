const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const router = express.Router();


// Add this helper at the top of auth.js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



// POST /api/auth/register-society
// Called once by the committee admin to set up their society
router.post('/register-society', async (req, res) => {
  const { name, address, city, total_units, admin } = req.body;

  if (!name || !city || !admin?.name || !admin?.phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Create society
  const { data: society, error: sErr } = await supabase
    .from('societies')
    .insert({ name, address, city, total_units })
    .select()
    .single();

  if (sErr) return res.status(500).json({ error: sErr.message });

  // 2. Create admin user
  const { data: user, error: uErr } = await supabase
    .from('users')
    .insert({
      id: admin.firebase_uid,
      society_id: society.id,
      name: admin.name,
      phone: admin.phone,
      role: 'admin',
      flat_number: 'ADMIN'
    })
    .select()
    .single();

  if (uErr) return res.status(500).json({ error: uErr.message });

  // 3. Issue JWT
  const token = jwt.sign(
    { id: user.id, society_id: society.id, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(201).json({ token, society, user });
});

// POST /api/auth/login
// Called when a resident logs in after Firebase phone OTP verification
router.post('/login', async (req, res) => {
  const { firebase_uid, phone, name, flat_number, society_id } = req.body;

  if (!firebase_uid || !phone) {
    return res.status(400).json({ error: 'Missing firebase_uid or phone' });
  }
  // Add this check inside the login route, after the !firebase_uid check:
    if (!UUID_REGEX.test(firebase_uid)) {
    return res.status(400).json({
        error: 'Invalid firebase_uid format. Must be a valid UUID.'
        });
    }

  // Check if user exists
  let { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', firebase_uid)
    .single();

  // First time login — auto-create resident
  if (!user) {
    if (!society_id || !name) {
      return res.status(400).json({
        error: 'New user — provide society_id, name, flat_number'
      });
    }

    const { data: newUser, error: cErr } = await supabase
      .from('users')
      .insert({
        id: firebase_uid,
        society_id,
        name,
        phone,
        flat_number,
        role: 'resident'
      })
      .select()
      .single();

    if (cErr) return res.status(500).json({ error: cErr.message });
    user = newUser;
  }

  const token = jwt.sign(
    { id: user.id, society_id: user.society_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({ token, user });
});

// GET /api/auth/me — get current user profile
const auth = require('../middleware/auth');
router.get('/me', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*, societies(*)')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

module.exports = router;
// const express = require('express');
// const jwt = require('jsonwebtoken');
// const supabase = require('../lib/supabase');
// const router = express.Router();


// // Add this helper at the top of auth.js
// const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



// // POST /api/auth/register-society
// // Called once by the committee admin to set up their society
// router.post('/register-society', async (req, res) => {
//   const { name, address, city, total_units, admin } = req.body;

//   if (!name || !city || !admin?.name || !admin?.phone) {
//     return res.status(400).json({ error: 'Missing required fields' });
//   }

//   // 1. Create society
//   const { data: society, error: sErr } = await supabase
//     .from('societies')
//     .insert({ name, address, city, total_units })
//     .select()
//     .single();

//   if (sErr) return res.status(500).json({ error: sErr.message });

//   // 2. Create admin user
//   const { data: user, error: uErr } = await supabase
//     .from('users')
//     .insert({
//       id: admin.firebase_uid,
//       society_id: society.id,
//       name: admin.name,
//       phone: admin.phone,
//       role: 'admin',
//       flat_number: 'ADMIN'
//     })
//     .select()
//     .single();

//   if (uErr) return res.status(500).json({ error: uErr.message });

//   // 3. Issue JWT
//   const token = jwt.sign(
//     { id: user.id, society_id: society.id, role: 'admin' },
//     process.env.JWT_SECRET,
//     { expiresIn: '30d' }
//   );

//   res.status(201).json({ token, society, user });
// });

// // POST /api/auth/login
// // Called when a resident logs in after Firebase phone OTP verification
// router.post('/login', async (req, res) => {
//   const { firebase_uid, phone, name, flat_number, society_id } = req.body;
//   console.log(req.body);
  
//   if (!firebase_uid || !phone) {
//     return res.status(400).json({ error: 'Missing firebase_uid or phone' });
//   }
//   // Add this check inside the login route, after the !firebase_uid check:
//     if (!UUID_REGEX.test(firebase_uid)) {
//     return res.status(400).json({
//         error: 'Invalid firebase_uid format. Must be a valid UUID.'
//         });
//     }

//       console.log("Login UID:",firebase_uid);
//   // Check if user exists
//   let { data: user, error } = await supabase
//     .from('users')
//     .select('*')
//     .eq('id', firebase_uid)
//     .maybeSingle();

//   // First time login — auto-create resident
//   if (!user) {
//     if (!society_id || !name) {
//       return res.status(400).json({
//         error: 'New user — provide society_id, name, flat_number'
//       });
//     }

//     const { data: newUser, error: cErr } = await supabase
//       .from('users')
//       .insert({
//         id: firebase_uid,
//         society_id,
//         name,
//         phone,
//         flat_number,
//         role: 'resident'
//       })
//       .select()
//       .single();

//     if (cErr) return res.status(500).json({ error: cErr.message });
//     user = newUser;
//   }

//   const token = jwt.sign(
//     { id: user.id, society_id: user.society_id, role: user.role },
//     process.env.JWT_SECRET,
//     { expiresIn: '30d' }
//   );

//   res.json({ token, user });
// });

// // GET /api/auth/me — get current user profile
// const auth = require('../middleware/auth');
// router.get('/me', auth, async (req, res) => {
//   const { data, error } = await supabase
//     .from('users')
//     .select('*, societies(*)')
//     .eq('id', req.user.id)
//     .single();

//   if (error) return res.status(404).json({ error: 'User not found' });
//   res.json(data);
// });

// module.exports = router;


const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const supabase  = require('../lib/supabase');
const auth      = require('../middleware/auth');
const router    = express.Router();

const UUID_REGEX = /^[0-9a-f-]{36}$/i;

function makeToken(user) {
  return jwt.sign(
    {
      id:         user.id,
      society_id: user.society_id,
      role:       user.role,
      plan:       user.societies?.plan || 'starter',
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ─────────────────────────────────────────
// POST /api/auth/register-society
// Creates society + first admin with password
// ─────────────────────────────────────────
router.post('/register-society', async (req, res) => {
  const { name, address, city, total_units, admin } = req.body;

  if (!name || !city || !admin?.name || !admin?.phone || !admin?.password) {
    return res.status(400).json({
      error: 'name, city, admin.name, admin.phone, admin.password required'
    });
  }

  if (admin.password.length < 6) {
    return res.status(400).json({
      error: 'Password must be at least 6 characters'
    });
  }

  if (!UUID_REGEX.test(admin.firebase_uid)) {
    return res.status(400).json({ error: 'Invalid firebase_uid format' });
  }

  // Check phone not already used in any society as admin
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', admin.phone)
    .eq('role', 'admin')
    .single();

  if (existing) {
    return res.status(409).json({
      error: 'This phone is already registered as an admin'
    });
  }

  const password_hash = await bcrypt.hash(admin.password, 12);

  // Create society
  const { data: society, error: sErr } = await supabase
    .from('societies')
    .insert({ name, address, city, total_units: total_units || 0 })
    .select()
    .single();

  if (sErr) return res.status(500).json({ error: sErr.message });

  // Create admin user
  const { data: user, error: uErr } = await supabase
    .from('users')
    .insert({
      id:            admin.firebase_uid,
      society_id:    society.id,
      name:          admin.name,
      phone:         admin.phone,
      email:         admin.email || null,
      password_hash,
      role:          'admin',
      flat_number:   'ADMIN',
    })
    .select('*, societies(*)')
    .single();

  if (uErr) return res.status(500).json({ error: uErr.message });

  res.status(201).json({
    token:   makeToken(user),
    society,
    user:    { ...user, password_hash: undefined },
  });
});

// ─────────────────────────────────────────
// POST /api/auth/register
// Residents, guards, workers self-register
// ─────────────────────────────────────────
router.post('/register', async (req, res) => {
  const {
    firebase_uid, phone, name,
    password, flat_number,
    society_id, role = 'resident',
    email, skill, bio, rate_per_hour,
  } = req.body;

  if (!firebase_uid || !phone || !name || !password || !society_id) {
    return res.status(400).json({
      error: 'firebase_uid, phone, name, password, society_id required'
    });
  }

  if (!UUID_REGEX.test(firebase_uid)) {
    return res.status(400).json({ error: 'Invalid firebase_uid format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Only these roles can self-register
  const selfRegisterRoles = ['resident', 'guard', 'service_worker'];
  if (!selfRegisterRoles.includes(role)) {
    return res.status(403).json({
      error: 'Admins and treasurers must be invited by an admin'
    });
  }

  // Verify society exists
  const { data: society } = await supabase
    .from('societies')
    .select('id, name, max_units')
    .eq('id', society_id)
    .single();

  if (!society) {
    return res.status(404).json({ error: 'Society not found. Check your Society ID.' });
  }

  // Check phone not already registered in this society
  const { data: dupe } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .eq('society_id', society_id)
    .single();

  if (dupe) {
    return res.status(409).json({
      error: 'This phone number is already registered in this society'
    });
  }

  const password_hash = await bcrypt.hash(password, 12);

  const { data: user, error: uErr } = await supabase
    .from('users')
    .insert({
      id:            firebase_uid,
      society_id,
      name,
      phone,
      email:         email || null,
      password_hash,
      flat_number:   flat_number || null,
      role,
    })
    .select('*, societies(*)')
    .single();

  if (uErr) {
    console.error('Register error:', uErr.message);
    return res.status(500).json({ error: uErr.message });
  }

  // If service worker — create their worker profile too
  if (role === 'service_worker' && skill) {
    await supabase.from('service_workers').insert({
      user_id:      user.id,
      society_id,
      skill,
      bio:          bio || null,
      rate_per_hour: rate_per_hour || null,
      is_approved:  false, // admin must approve
    });
  }

  res.status(201).json({
    token: makeToken(user),
    user:  { ...user, password_hash: undefined },
  });
});

// ─────────────────────────────────────────
// POST /api/auth/login
// All roles login with phone + password
// ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { phone, password, society_id } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password required' });
  }

  // Build query
  let query = supabase
    .from('users')
    .select('*, societies(*)')
    .eq('phone', phone)
    .eq('is_active', true);

  // society_id narrows to a specific society if provided
  if (society_id) query = query.eq('society_id', society_id);

  const { data: users, error } = await query;

  if (error) {
    console.error('Login DB error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  if (!users || users.length === 0) {
    return res.status(401).json({ error: 'Phone number not registered' });
  }

  // If multiple societies — require society_id to disambiguate
  if (users.length > 1 && !society_id) {
    return res.status(400).json({
      error:    'Multiple societies found for this phone. Provide society_id.',
      societies: users.map(u => ({
        society_id:   u.society_id,
        society_name: u.societies?.name,
        role:         u.role,
      }))
    });
  }

  const user = users[0];

  if (!user.password_hash) {
    return res.status(401).json({
      error: 'No password set. Please register again or reset your password.'
    });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Update last login
  await supabase
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  res.json({
    token: makeToken(user),
    user:  { ...user, password_hash: undefined },
    role:  user.role,
  });
});

// ─────────────────────────────────────────
// POST /api/auth/invite — admin invites treasurer/another admin
// ─────────────────────────────────────────
router.post('/invite', auth, async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only admins can invite users' });
  }

  const { name, phone, role, flat_number } = req.body;

  if (!name || !phone || !role) {
    return res.status(400).json({ error: 'name, phone, role required' });
  }

  const invitableRoles = ['treasurer', 'admin', 'guard', 'resident'];
  if (!invitableRoles.includes(role)) {
    return res.status(400).json({ error: `Cannot invite role: ${role}` });
  }

  // Check plan limits for admins
  if (role === 'admin' || role === 'treasurer') {
    const { data: society } = await supabase
      .from('societies')
      .select('max_admins')
      .eq('id', req.user.society_id)
      .single();

    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact' })
      .eq('society_id', req.user.society_id)
      .in('role', ['admin', 'treasurer']);

    if (count >= (society?.max_admins || 1)) {
      return res.status(403).json({
        error: `Your plan allows max ${society.max_admins} admins. Upgrade to add more.`
      });
    }
  }

  // Generate a temp invite token (6-digit code)
  const invite_code = Math.floor(100000 + Math.random() * 900000).toString();
  const temp_uid    = crypto.randomUUID();
  const temp_pass   = await bcrypt.hash(invite_code, 12);

  const { data, error } = await supabase
    .from('users')
    .insert({
      id:           temp_uid,
      society_id:   req.user.society_id,
      name,
      phone,
      password_hash: temp_pass,
      role,
      flat_number:  flat_number || null,
      invited_by:   req.user.id,
      is_active:    true,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    message:     `${role} invited successfully`,
    invite_code,
    user_id:     data.id,
    note:        `Share invite_code with ${name}. They login with phone + this code, then change password.`
  });
});

// ─────────────────────────────────────────
// PUT /api/auth/change-password
// ─────────────────────────────────────────
router.put('/change-password', auth, async (req, res) => {
  const { old_password, new_password } = req.body;

  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'old_password and new_password required' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();

  const valid = await bcrypt.compare(old_password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Old password is incorrect' });
  }

  const password_hash = await bcrypt.hash(new_password, 12);

  await supabase
    .from('users')
    .update({ password_hash })
    .eq('id', req.user.id);

  res.json({ success: true, message: 'Password changed successfully' });
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*, societies(*)')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'User not found' });
  res.json({ ...data, password_hash: undefined });
});

module.exports = router;
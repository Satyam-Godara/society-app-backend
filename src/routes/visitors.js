// const express = require('express');
// const supabase = require('../lib/supabase');
// const auth = require('../middleware/auth');
// const router = express.Router();

// // Generate a random 4-digit OTP
// function generateOTP() {
//   return Math.floor(1000 + Math.random() * 9000).toString();
// }

// // POST /api/visitors — resident creates a visitor pass
// router.post('/', auth, async (req, res) => {
//   const { visitor_name, purpose, valid_hours = 8 } = req.body;

//   if (!visitor_name) {
//     return res.status(400).json({ error: 'visitor_name is required' });
//   }

//   const valid_from = new Date();
//   const valid_until = new Date(
//     valid_from.getTime() + valid_hours * 60 * 60 * 1000
//   );

//   const { data, error } = await supabase
//     .from('visitor_passes')
//     .insert({
//       society_id: req.user.society_id,
//       resident_id: req.user.id,
//       visitor_name,
//       purpose,
//       otp_code: generateOTP(),
//       valid_from: valid_from.toISOString(),
//       valid_until: valid_until.toISOString(),
//       status: 'active'
//     })
//     .select()
//     .single();

//   if (error) return res.status(500).json({ error: error.message });
//   res.status(201).json(data);
// });

// // GET /api/visitors/my — resident: see their passes
// router.get('/my', auth, async (req, res) => {
//   const { data, error } = await supabase
//     .from('visitor_passes')
//     .select('*')
//     .eq('society_id', req.user.society_id)
//     .eq('resident_id', req.user.id)
//     .order('created_at', { ascending: false });

//   if (error) return res.status(500).json({ error: error.message });
//   res.json(data);
// });

// // POST /api/visitors/verify — guard verifies OTP at gate
// router.post('/verify', auth, async (req, res) => {
//   const { otp_code } = req.body;

//   if (!otp_code) {
//     return res.status(400).json({ error: 'otp_code is required' });
//   }

//   const now = new Date().toISOString();

//   const { data: pass, error } = await supabase
//     .from('visitor_passes')
//     .select('*, users!resident_id(name, flat_number)')
//     .eq('society_id', req.user.society_id)
//     .eq('otp_code', otp_code)
//     .eq('status', 'active')
//     .lte('valid_from', now)
//     .gte('valid_until', now)
//     .single();

//   if (error || !pass) {
//     return res.status(404).json({ error: 'Invalid or expired OTP' });
//   }

//   // Mark as used
//   await supabase
//     .from('visitor_passes')
//     .update({ status: 'used', used_at: now })
//     .eq('id', pass.id);

//   res.json({
//     success: true,
//     visitor_name: pass.visitor_name,
//     purpose: pass.purpose,
//     invited_by: pass.users
//   });
// });

// module.exports = router;


// backend/src/routes/visitors.js — FULL REPLACEMENT for Phase 3
// Adds: visitor logs, exit logging, guard entry history

const express  = require('express');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { isGuard } = require('../middleware/roles');
const router   = express.Router();

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// ── POST /api/visitors ────────────────────────────────
// Resident creates a visitor pass
router.post('/', auth, async (req, res) => {
  const { visitor_name, purpose, valid_hours = 8, visitor_phone } = req.body;

  if (!visitor_name?.trim()) {
    return res.status(400).json({ error: 'visitor_name is required' });
  }

  const valid_from  = new Date();
  const valid_until = new Date(valid_from.getTime() + valid_hours * 3600000);

  const { data, error } = await supabase
    .from('visitor_passes')
    .insert({
      society_id:    req.user.society_id,
      resident_id:   req.user.id,
      visitor_name:  visitor_name.trim(),
      visitor_phone: visitor_phone || null,
      purpose:       purpose || null,
      otp_code:      generateOTP(),
      valid_from:    valid_from.toISOString(),
      valid_until:   valid_until.toISOString(),
      status:        'active',
    })
    .select('*, users!resident_id(name, flat_number)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── GET /api/visitors/my ──────────────────────────────
// Resident sees their own passes
router.get('/my', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('visitor_passes')
    .select('*')
    .eq('society_id', req.user.society_id)
    .eq('resident_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/visitors/verify ─────────────────────────
// Guard verifies OTP at gate — core guard action
router.post('/verify', auth, isGuard, async (req, res) => {
  const { otp_code } = req.body;

  if (!otp_code?.trim()) {
    return res.status(400).json({ error: 'otp_code is required' });
  }

  const now = new Date().toISOString();

  // Find active pass matching OTP
  const { data: pass, error } = await supabase
    .from('visitor_passes')
    .select('*, users!resident_id(id, name, flat_number, phone)')
    .eq('society_id', req.user.society_id)
    .eq('otp_code', otp_code.trim())
    .eq('status', 'active')
    .lte('valid_from', now)
    .gte('valid_until', now)
    .single();

  if (error || !pass) {
    // Log failed attempt
    console.log(`Failed OTP attempt: ${otp_code} by guard ${req.user.id}`);
    return res.status(404).json({
      error:   'Invalid or expired OTP',
      hindi:   'यह OTP गलत है या समय सीमा समाप्त हो गई है',
    });
  }

  // Mark pass as used
  await supabase
    .from('visitor_passes')
    .update({ status: 'used', used_at: now })
    .eq('id', pass.id);

  // Create visitor log entry
  const { data: log } = await supabase
    .from('visitor_logs')
    .insert({
      society_id:   req.user.society_id,
      pass_id:      pass.id,
      visitor_name: pass.visitor_name,
      flat_visited: pass.users?.flat_number || 'Unknown',
      resident_id:  pass.resident_id,
      verified_by:  req.user.id,
      entry_at:     now,
    })
    .select()
    .single();

  res.json({
    success:      true,
    log_id:       log?.id,
    visitor_name: pass.visitor_name,
    visitor_phone:pass.visitor_phone,
    purpose:      pass.purpose,
    invited_by: {
      name:        pass.users?.name,
      flat_number: pass.users?.flat_number,
      phone:       pass.users?.phone,
    },
    valid_until: pass.valid_until,
    // Hindi translations for guard UI
    hindi: {
      entry_approved: 'प्रवेश स्वीकृत',
      visiting:       'मिलने जा रहे हैं',
      flat:           'फ्लैट',
    },
  });
});

// ── POST /api/visitors/logs/:logId/exit ───────────────
// Guard logs visitor exit
router.post('/logs/:logId/exit', auth, isGuard, async (req, res) => {
  const { data, error } = await supabase
    .from('visitor_logs')
    .update({ exit_at: new Date().toISOString() })
    .eq('id', req.params.logId)
    .eq('society_id', req.user.society_id)
    .is('exit_at', null) // only if not already exited
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Log not found or already exited' });
  }
  res.json({ success: true, data });
});

// ── GET /api/visitors/logs ────────────────────────────
// Guard sees today's entry log
router.get('/logs', auth, isGuard, async (req, res) => {
  const { date } = req.query; // optional: YYYY-MM-DD
  const start = date
    ? new Date(date + 'T00:00:00').toISOString()
    : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const end = date
    ? new Date(date + 'T23:59:59').toISOString()
    : new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  const { data, error } = await supabase
    .from('visitor_logs')
    .select('*, users!resident_id(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .gte('entry_at', start)
    .lte('entry_at', end)
    .order('entry_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    date:  date || new Date().toISOString().split('T')[0],
    count: data.length,
    inside: data.filter(l => !l.exit_at).length,
    logs:  data,
  });
});

// ── GET /api/visitors/logs/stats ──────────────────────
// Admin/guard dashboard stats
router.get('/logs/stats', auth, async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('visitor_logs')
    .select('entry_at, exit_at')
    .eq('society_id', req.user.society_id)
    .gte('entry_at', today.toISOString());

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    today_total:  data.length,
    still_inside: data.filter(l => !l.exit_at).length,
    exited:       data.filter(l => !!l.exit_at).length,
  });
});

// ── GET /api/visitors/active ──────────────────────────
// Guard sees who is currently inside
router.get('/active', auth, isGuard, async (req, res) => {
  const { data, error } = await supabase
    .from('visitor_logs')
    .select('*, users!resident_id(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .is('exit_at', null)
    .order('entry_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;

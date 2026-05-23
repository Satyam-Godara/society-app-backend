// const express  = require('express');
// const supabase = require('../lib/supabase');
// const auth     = require('../middleware/auth');
// const { isAdmin, isTreasurer } = require('../middleware/roles');
// const router   = express.Router();

// // GET /api/admin/residents — list all residents
// router.get('/residents', auth, isAdmin, async (req, res) => {
//   const { data, error } = await supabase
//     .from('users')
//     .select('id, name, phone, flat_number, role, is_active, last_login_at, created_at')
//     .eq('society_id', req.user.society_id)
//     .order('flat_number');

//   if (error) return res.status(500).json({ error: error.message });
//   res.json(data);
// });

// // PUT /api/admin/residents/:id — activate / deactivate / change role
// router.put('/residents/:id', auth, isAdmin, async (req, res) => {
//   const { is_active, role, flat_number } = req.body;
//   const updates = {};
//   if (is_active !== undefined) updates.is_active  = is_active;
//   if (role)                    updates.role       = role;
//   if (flat_number)             updates.flat_number = flat_number;

//   const { data, error } = await supabase
//     .from('users')
//     .update(updates)
//     .eq('id', req.params.id)
//     .eq('society_id', req.user.society_id)
//     .select()
//     .single();

//   if (error) return res.status(500).json({ error: error.message });
//   res.json({ ...data, password_hash: undefined });
// });

// // GET /api/admin/dashboard — key metrics
// router.get('/dashboard', auth, isAdmin, async (req, res) => {
//   const sid = req.user.society_id;
//   const startOfMonth = new Date();
//   startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

//   const [residents, openComplaints, pendingBills, collected, visitors] =
//     await Promise.all([
//       supabase.from('users').select('id', { count:'exact' })
//         .eq('society_id', sid).eq('role','resident'),
//       supabase.from('complaints').select('id', { count:'exact' })
//         .eq('society_id', sid).eq('status','open'),
//       supabase.from('bills').select('amount')
//         .eq('society_id', sid).eq('status','pending'),
//       supabase.from('transactions').select('amount')
//         .eq('society_id', sid).eq('status','success')
//         .gte('created_at', startOfMonth.toISOString()),
//       supabase.from('visitor_logs').select('id', { count:'exact' })
//         .eq('society_id', sid)
//         .gte('entry_at', startOfMonth.toISOString()),
//     ]);

//   const totalPending   = (pendingBills.data || [])
//     .reduce((s,b) => s + parseFloat(b.amount), 0);
//   const totalCollected = (collected.data || [])
//     .reduce((s,t) => s + parseFloat(t.amount), 0);

//   res.json({
//     residents:        residents.count || 0,
//     open_complaints:  openComplaints.count || 0,
//     pending_amount:   totalPending,
//     collected_month:  totalCollected,
//     visitors_month:   visitors.count || 0,
//   });
// });

// // GET /api/admin/defaulters — unpaid bills grouped by flat
// router.get('/defaulters', auth, isTreasurer, async (req, res) => {
//   const { data, error } = await supabase
//     .from('bills')
//     .select('*, users(name, flat_number, phone)')
//     .eq('society_id', req.user.society_id)
//     .eq('status', 'pending')
//     .order('due_date');

//   if (error) return res.status(500).json({ error: error.message });

//   // Group by flat
//   const grouped = {};
//   for (const b of data) {
//     const key = b.users?.flat_number || 'Unknown';
//     if (!grouped[key]) grouped[key] = { flat: key, name: b.users?.name,
//       phone: b.users?.phone, total: 0, bills: [] };
//     grouped[key].total += parseFloat(b.amount);
//     grouped[key].bills.push(b);
//   }

//   res.json(Object.values(grouped).sort((a,b) => b.total - a.total));
// });

// // PUT /api/admin/workers/:id/approve — approve service worker
// router.put('/workers/:id/approve', auth, isAdmin, async (req, res) => {
//   const { is_approved } = req.body;

//   const { data, error } = await supabase
//     .from('service_workers')
//     .update({ is_approved })
//     .eq('id', req.params.id)
//     .eq('society_id', req.user.society_id)
//     .select()
//     .single();

//   if (error) return res.status(500).json({ error: error.message });
//   res.json(data);
// });

// module.exports = router;




const express  = require('express');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { isAdmin, isTreasurer } = require('../middleware/roles');
const router   = express.Router();

// ── GET /api/admin/dashboard ──────────────────────────
router.get('/dashboard', auth, isAdmin, async (req, res) => {
  const sid = req.user.society_id;
  const startOfMonth = new Date();
  startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

  const [residents, openComplaints, pendingBills,
         collected, visitors, aiUsage] = await Promise.all([
    supabase.from('users').select('id',{count:'exact'})
      .eq('society_id',sid).eq('role','resident'),
    supabase.from('complaints').select('id',{count:'exact'})
      .eq('society_id',sid).eq('status','open'),
    supabase.from('bills').select('amount')
      .eq('society_id',sid).eq('status','pending'),
    supabase.from('transactions').select('amount')
      .eq('society_id',sid).eq('status','success')
      .gte('created_at', startOfMonth.toISOString()),
    supabase.from('visitor_logs').select('id',{count:'exact'})
      .eq('society_id',sid)
      .gte('entry_at', startOfMonth.toISOString()),
    supabase.from('ai_chat_logs').select('id',{count:'exact'})
      .eq('society_id',sid)
      .gte('created_at', startOfMonth.toISOString()),
  ]);

  const totalPending   = (pendingBills.data||[])
    .reduce((s,b)=>s+parseFloat(b.amount),0);
  const totalCollected = (collected.data||[])
    .reduce((s,t)=>s+parseFloat(t.amount),0);

  res.json({
    residents:       residents.count      || 0,
    open_complaints: openComplaints.count || 0,
    pending_amount:  totalPending,
    collected_month: totalCollected,
    visitors_month:  visitors.count       || 0,
    ai_queries_month:aiUsage.count        || 0,
  });
});

// ── GET /api/admin/residents ──────────────────────────
router.get('/residents', auth, isAdmin, async (req, res) => {
  const { search, role } = req.query;
  let query = supabase
    .from('users')
    .select('id,name,phone,flat_number,role,is_active,last_login_at,created_at,email')
    .eq('society_id', req.user.society_id)
    .order('flat_number', { ascending: true });

  if (role)   query = query.eq('role', role);
  if (search) query = query.or(
    `name.ilike.%${search}%,flat_number.ilike.%${search}%,phone.ilike.%${search}%`
  );

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/admin/residents/:id ─────────────────────
router.get('/residents/:id', auth, isAdmin, async (req, res) => {
  const { data: user, error: uErr } = await supabase
    .from('users')
    .select('id,name,phone,flat_number,role,is_active,email,created_at,last_login_at')
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id)
    .single();
  if (uErr) return res.status(404).json({ error: 'Resident not found' });

  const [bills, complaints, passes] = await Promise.all([
    supabase.from('bills').select('*')
      .eq('user_id', req.params.id)
      .eq('society_id', req.user.society_id)
      .order('due_date', { ascending: false }).limit(10),
    supabase.from('complaints').select('*')
      .eq('raised_by', req.params.id)
      .eq('society_id', req.user.society_id)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('visitor_passes').select('*')
      .eq('resident_id', req.params.id)
      .eq('society_id', req.user.society_id)
      .order('created_at', { ascending: false }).limit(5),
  ]);

  res.json({
    user,
    bills:      bills.data      || [],
    complaints: complaints.data || [],
    passes:     passes.data     || [],
  });
});

// ── PUT /api/admin/residents/:id ──────────────────────
router.put('/residents/:id', auth, isAdmin, async (req, res) => {
  const { is_active, role, flat_number, name } = req.body;
  const updates = {};
  if (is_active  !== undefined) updates.is_active   = is_active;
  if (role)                     updates.role         = role;
  if (flat_number)              updates.flat_number  = flat_number;
  if (name)                     updates.name         = name;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id)
    .select('id,name,phone,flat_number,role,is_active')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/admin/residents/:id ──────────────────
router.delete('/residents/:id', auth, isAdmin, async (req, res) => {
  // Soft delete — just deactivate, never hard-delete for audit trail
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Resident deactivated' });
});

// ── GET /api/admin/defaulters ─────────────────────────
router.get('/defaulters', auth, isTreasurer, async (req, res) => {
  const { data, error } = await supabase
    .from('bills')
    .select('*, users(id,name,flat_number,phone)')
    .eq('society_id', req.user.society_id)
    .neq('status', 'paid')
    .order('due_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  for (const b of data) {
    const key = b.users?.flat_number || 'Unknown';
    if (!grouped[key]) grouped[key] = {
      flat: key, name: b.users?.name,
      phone: b.users?.phone, user_id: b.users?.id,
      total: 0, bills: [], months_due: 0
    };
    grouped[key].total      += parseFloat(b.amount);
    grouped[key].months_due += 1;
    grouped[key].bills.push(b);
  }
  res.json(Object.values(grouped).sort((a,b) => b.total - a.total));
});

// ── GET /api/admin/complaints ─────────────────────────
router.get('/complaints', auth, isAdmin, async (req, res) => {
  const { status, priority } = req.query;
  let query = supabase
    .from('complaints')
    .select('*, users!raised_by(name,flat_number), users!assigned_to(name)')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false });

  if (status)   query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PUT /api/admin/complaints/:id ─────────────────────
router.put('/complaints/:id', auth, isAdmin, async (req, res) => {
  const { status, assigned_to, priority, admin_note } = req.body;
  const updates = {};
  if (status)      updates.status      = status;
  if (assigned_to) updates.assigned_to = assigned_to;
  if (priority)    updates.priority    = priority;
  if (admin_note)  updates.admin_note  = admin_note;
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

// ── PUT /api/admin/workers/:id/approve ───────────────
router.put('/workers/:id/approve', auth, isAdmin, async (req, res) => {
  const { is_approved } = req.body;
  const { data, error } = await supabase
    .from('service_workers')
    .update({ is_approved })
    .eq('id', req.params.id)
    .eq('society_id', req.user.society_id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/admin/workers ────────────────────────────
router.get('/workers', auth, isAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('service_workers')
    .select('*, users(name,phone)')
    .eq('society_id', req.user.society_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
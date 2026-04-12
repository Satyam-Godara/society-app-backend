const express  = require('express');
const supabase = require('../lib/supabase');
const auth     = require('../middleware/auth');
const { createOrder, verifySignature } = require('../lib/razorpay');

const router = express.Router();

// ─────────────────────────────────────────────────────────
// POST /api/payments/create-order
// Step 1: App calls this → get Razorpay order details back
// ─────────────────────────────────────────────────────────
router.post('/create-order', auth, async (req, res) => {
  const { bill_id } = req.body;

  if (!bill_id) {
    return res.status(400).json({ error: 'bill_id is required' });
  }

  // Fetch the bill — ensure it belongs to this user's society
  const { data: bill, error: billErr } = await supabase
    .from('bills')
    .select('*, users(name, phone)')
    .eq('id', bill_id)
    .eq('society_id', req.user.society_id)
    .eq('user_id', req.user.id)
    .single();

  if (billErr || !bill) {
    return res.status(404).json({ error: 'Bill not found' });
  }

  if (bill.status === 'paid') {
    return res.status(400).json({ error: 'Bill is already paid' });
  }

  try {
    const order = await createOrder(
      parseFloat(bill.amount),
      bill.id,
      {
        bill_id:    bill.id,
        user_id:    req.user.id,
        society_id: req.user.society_id,
        bill_type:  bill.type,
        flat:       bill.users?.name,
      }
    );

    // Save order ID to bill so we can match it on verify
    await supabase
      .from('bills')
      .update({ razorpay_order_id: order.id })
      .eq('id', bill.id);

    res.json({
      order_id:   order.id,
      amount:     order.amount,      // in paise
      currency:   order.currency,
      key_id:     process.env.RAZORPAY_KEY_ID,
      bill_type:  bill.type,
      user_name:  bill.users?.name,
      user_phone: bill.users?.phone,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create payment order: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/payments/verify
// Step 2: After Razorpay checkout succeeds, app calls this
// ─────────────────────────────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  const {
    bill_id,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  if (!bill_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  // CRITICAL: Verify signature before doing anything
  const isValid = verifySignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  // Fetch bill to get amount
  const { data: bill } = await supabase
    .from('bills')
    .select('amount, type')
    .eq('id', bill_id)
    .eq('society_id', req.user.society_id)
    .single();

  if (!bill) {
    return res.status(404).json({ error: 'Bill not found' });
  }

  // Mark bill as paid
  const { data: updatedBill, error: updateErr } = await supabase
    .from('bills')
    .update({
      status:              'paid',
      paid_at:             new Date().toISOString(),
      razorpay_order_id,
    })
    .eq('id', bill_id)
    .eq('society_id', req.user.society_id)
    .select()
    .single();

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  // Log the transaction
  await supabase.from('transactions').insert({
    society_id:   req.user.society_id,
    bill_id,
    user_id:      req.user.id,
    amount:       bill.amount,
    method:       'razorpay',
    razorpay_id:  razorpay_payment_id,
    status:       'success',
  });

  res.json({
    success:     true,
    message:     'Payment successful',
    bill:        updatedBill,
    payment_id:  razorpay_payment_id,
  });
});

// ─────────────────────────────────────────────────────────
// GET /api/payments/history
// Resident sees their payment history
// ─────────────────────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, bills(type, due_date)')
    .eq('society_id', req.user.society_id)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────
// GET /api/payments/society-summary  (admin only)
// Committee sees total collections this month
// ─────────────────────────────────────────────────────────
router.get('/society-summary', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, method, created_at, users(name, flat_number)')
    .eq('society_id', req.user.society_id)
    .eq('status', 'success')
    .gte('created_at', startOfMonth.toISOString())
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const total = data.reduce((sum, t) => sum + parseFloat(t.amount), 0);

  res.json({
    total_collected: total,
    transaction_count: data.length,
    transactions: data,
  });
});

module.exports = router;
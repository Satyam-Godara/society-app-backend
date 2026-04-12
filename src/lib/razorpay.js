const Razorpay = require('razorpay');
const crypto  = require('crypto');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a Razorpay order for a bill payment
 * @param {number} amountInRupees
 * @param {string} receipt  - your internal bill ID
 * @param {object} notes    - metadata stored on Razorpay dashboard
 */
async function createOrder(amountInRupees, receipt, notes = {}) {
  const order = await razorpay.orders.create({
    amount:   Math.round(amountInRupees * 100), // Razorpay uses paise
    currency: 'INR',
    receipt,
    notes,
  });
  return order;
}

/**
 * Verify Razorpay payment signature
 * This MUST be called before marking any bill paid
 */
function verifySignature(orderId, paymentId, signature) {
  const body      = orderId + '|' + paymentId;
  const expected  = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
}

module.exports = { createOrder, verifySignature };
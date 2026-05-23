// Reusable role guards — use after auth middleware
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Access denied. Required role: ${roles.join(' or ')}`
    });
  }
  next();
};

// Plan feature gate — checks society features jsonb
const requireFeature = (feature) => async (req, res, next) => {
  const supabase = require('../lib/supabase');
  const { data: society } = await supabase
    .from('societies')
    .select('plan, features')
    .eq('id', req.user.society_id)
    .single();

  if (!society) {
    return res.status(404).json({ error: 'Society not found' });
  }

  const features = society.features || {};
  if (!features[feature]) {
    return res.status(403).json({
      error: `This feature requires a higher plan`,
      current_plan: society.plan,
      upgrade_to: society.plan === 'starter' ? 'pro' : 'township'
    });
  }
  next();
};

module.exports = {
  requireRole,
  requireFeature,
  isAdmin:     requireRole('admin', 'super_admin'),
  isTreasurer: requireRole('admin', 'treasurer', 'super_admin'),
  isGuard:     requireRole('guard', 'admin', 'super_admin'),
  isResident:  requireRole('resident', 'admin', 'super_admin'),
  isWorker:    requireRole('service_worker'),
};
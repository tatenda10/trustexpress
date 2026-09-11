import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import {
  choosePassengerRideCashPayment,
  handlePassengerSmilePayWebhook,
  initializePassengerRidePayment,
  linkPassengerSmileCash,
  openPassengerSmileCash,
  verifyPassengerRidePayment,
} from '../lib/passenger-payments.js';

const router = Router();

async function requirePassenger(req, res) {
  const clerkUser = await getClerkUserById(req.userId);
  const user = toAppUser(clerkUser);
  const role = normalizeRole(user.role);
  if (role !== 'passenger' && role !== 'driver') {
    res.status(403).json({ error: 'Passenger account required' });
    return null;
  }
  return { clerkUser, user };
}

router.post('/smile-cash/open', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const smileCash = await openPassengerSmileCash({
      passengerUserId: req.userId,
      clerkUser: passenger.clerkUser,
      payload: req.body || {},
    });
    return res.json({ ok: true, smileCash });
  } catch (err) {
    console.error('POST /api/passengers/payments/smile-cash/open', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Server error',
      code: err.code || null,
    });
  }
});

router.post('/smile-cash/link', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const smileCash = await linkPassengerSmileCash({
      passengerUserId: req.userId,
      clerkUser: passenger.clerkUser,
      payload: req.body || {},
    });
    return res.json({ ok: true, smileCash });
  } catch (err) {
    console.error('POST /api/passengers/payments/smile-cash/link', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Server error',
      code: err.code || null,
    });
  }
});

router.post('/rides/:rideRequestId/choose-cash', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    const payment = await choosePassengerRideCashPayment({
      passengerUserId: req.userId,
      rideRequestId,
    });
    return res.json({ ok: true, payment });
  } catch (err) {
    console.error('POST /api/passengers/payments/rides/:rideRequestId/choose-cash', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.post('/rides/:rideRequestId/smilepay/initiate', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    const payment = await initializePassengerRidePayment({
      passengerUserId: req.userId,
      passenger: passenger.user,
      rideRequestId,
      callbackUrl: req.body?.callbackUrl,
    });
    return res.json({ ok: true, payment });
  } catch (err) {
    console.error('POST /api/passengers/payments/rides/:rideRequestId/smilepay/initiate', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.post('/rides/:rideRequestId/smilepay/verify', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const result = await verifyPassengerRidePayment({
      passengerUserId: req.userId,
      rideRequestId: Number(req.params.rideRequestId),
      reference: req.body?.reference,
    });
    return res.json({ ok: true, alreadyVerified: !!result.alreadyVerified, payment: result.payment });
  } catch (err) {
    console.error('POST /api/passengers/payments/rides/:rideRequestId/smilepay/verify', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.post('/webhooks/smilepay', async (req, res) => {
  try {
    const result = await handlePassengerSmilePayWebhook(req.body || {});
    return res.status(200).json({ ok: true, alreadyVerified: !!result.alreadyVerified });
  } catch (err) {
    console.error('POST /api/passengers/payments/webhooks/smilepay', err);
    const status = Number(err.status || 500);
    if (status === 404) {
      return res.status(200).json({ ok: false, error: err.message });
    }
    return res.status(status >= 500 ? 500 : 200).json({ ok: false, error: err.message || 'Server error' });
  }
});

export default router;

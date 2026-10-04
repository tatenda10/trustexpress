import { createDispatchRide, listDispatchRideOptions, quoteDispatchRide } from '../admin-ride-dispatch.js';
import { query } from '../../db/connection.js';
import { assignAcceptedDriverToRide } from '../assign-ride-driver.js';
import { buildPassengerSafetyPinPayload } from '../ride-safety-pin.js';
import { normalizeZimbabwePhoneNumber } from '../phone-number.js';
import {
  getWhatsAppRideByRideRequestId,
  loadSession,
  recordWhatsAppRide,
  saveSession,
  updateWhatsAppRideStatus,
} from './session-store.js';
import { sendButtons, sendList, sendLocationRequest, sendText } from './cloud-api.js';

const DEFAULT_TIER_KEY = process.env.WHATSAPP_DEFAULT_TIER_KEY || 'trust-express';
const TIER_ACTION_PREFIX = 'tier:';

function normalizePhone(rawPhone) {
  const normalized = normalizeZimbabwePhoneNumber(rawPhone);
  if (normalized.ok) return normalized.e164Phone.replace('+', '');
  return String(rawPhone || '').replace(/\D/g, '');
}

function locationToPoint(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function locationToLabel(location, fallback) {
  return String(location?.name || location?.address || fallback || '').trim() || fallback;
}

function extractAction(message) {
  const interactive = message?.interactive || null;
  const buttonId = interactive?.button_reply?.id || null;
  const listId = interactive?.list_reply?.id || null;
  if (buttonId || listId) return String(buttonId || listId);
  const text = String(message?.text?.body || '').trim().toLowerCase();
  if (['hi', 'hie', 'hey', 'hello', 'menu', 'start'].includes(text)) return 'menu';
  if (['book', 'ride', 'book ride', 'book a ride'].includes(text)) return 'book_ride';
  if (['support', 'help', 'talk to support'].includes(text)) return 'support';
  if (['account', 'my account', 'check account'].includes(text)) return 'account';
  if (['cancel', 'stop'].includes(text)) return 'cancel_ride';
  return text || null;
}

async function sendMainMenu(phone) {
  await sendText(phone, 'Welcome to Trust Express. What would you like to do?');
  await sendButtons(phone, 'Choose an option:', [
    { id: 'book_ride', title: 'Book a Ride' },
    { id: 'support', title: 'Support' },
    { id: 'account', title: 'My Account' },
  ]);
}

async function sendSupportMenu(phone) {
  await sendText(
    phone,
    [
      'Trust Express support',
      'Reply with your issue here and our team can assist you.',
      'You can also choose Book a Ride to start a booking.',
    ].join('\n')
  );
  await sendButtons(phone, 'What next?', [
    { id: 'book_ride', title: 'Book a Ride' },
    { id: 'menu', title: 'Main Menu' },
  ]);
}

async function sendAccountMenu(phone) {
  await sendText(
    phone,
    [
      'Account options are coming soon on WhatsApp.',
      'For now, you can book a ride here or talk to support.',
    ].join('\n')
  );
  await sendButtons(phone, 'Choose an option:', [
    { id: 'book_ride', title: 'Book a Ride' },
    { id: 'support', title: 'Support' },
    { id: 'menu', title: 'Main Menu' },
  ]);
}

async function askPickup(phone) {
  await sendLocationRequest(phone, 'Please share your pickup location pin.');
}

async function askRideType(phone) {
  const options = await listDispatchRideOptions();
  const tiers = Array.isArray(options?.tiers) ? options.tiers : [];
  if (!tiers.length) {
    await sendText(phone, 'No active ride types are available right now. Please try again later.');
    await sendMainMenu(phone);
    return false;
  }
  await sendList(
    phone,
    'What type of ride do you want?',
    'Ride type',
    tiers.map((tier) => ({
      id: `${TIER_ACTION_PREFIX}${tier.tierKey}`,
      title: tier.tierName || tier.tierKey,
      description: `Up to ${tier.maxPassengerCount || 4} passengers`,
    }))
  );
  return true;
}

async function askDropoff(phone) {
  await sendLocationRequest(phone, 'Now share your drop-off location pin.');
}

async function askPassengerCount(phone) {
  await sendList(phone, 'How many passengers are riding?', 'Passengers', [
    { id: 'pax_1', title: '1 passenger' },
    { id: 'pax_2', title: '2 passengers' },
    { id: 'pax_3', title: '3 passengers' },
    { id: 'pax_4', title: '4 passengers' },
  ]);
}

async function askPaymentMethod(phone) {
  await sendButtons(phone, 'Choose payment method:', [
    { id: 'pay_cash', title: 'Cash' },
    { id: 'pay_wallet', title: 'Wallet' },
    { id: 'pay_smilepay', title: 'Smile & Pay' },
  ]);
}

function paymentFromAction(action) {
  if (action === 'pay_wallet') return 'wallet';
  if (action === 'pay_smilepay') return 'smilepay';
  return 'cash';
}

function passengerCountFromAction(action) {
  const match = String(action || '').match(/^pax_(\d+)$/);
  const count = Number(match?.[1] || 0);
  return Number.isInteger(count) && count > 0 ? count : null;
}

function tierKeyFromAction(action) {
  const value = String(action || '');
  if (!value.startsWith(TIER_ACTION_PREFIX)) return null;
  return value.slice(TIER_ACTION_PREFIX.length).trim() || null;
}

function parseWhatsAppDriverSelectionAction(action) {
  const value = String(action || '');
  const match = value.match(/^wa_(accept|decline):(\d+):(.+)$/);
  if (!match) return null;
  return {
    decision: match[1],
    rideRequestId: Number(match[2]),
    driverUserId: match[3],
  };
}

function logFlow(event, details = {}) {
  console.log(`[whatsapp.ride-booking] ${event}`, details);
}

function summarizePayload(payload = {}) {
  return {
    selectedTierKey: payload.selectedTierKey || null,
    hasPickupCoordinate: !!payload.pickupCoordinate,
    pickupCoordinate: payload.pickupCoordinate || null,
    pickupLabel: payload.pickupLabel || null,
    hasDropoffCoordinate: !!payload.dropoffCoordinate,
    dropoffCoordinate: payload.dropoffCoordinate || null,
    dropoffLabel: payload.dropoffLabel || null,
    passengerCount: payload.passengerCount || null,
    paymentMethod: payload.paymentMethod || null,
    hasQuote: !!payload.quote,
  };
}

async function quoteAndAskConfirmation(phone, session) {
  const payload = session.payload || {};
  logFlow('quote:start', {
    phone,
    state: session.state,
    payload: summarizePayload(payload),
    defaultTierKey: DEFAULT_TIER_KEY,
  });
  const quote = await quoteDispatchRide({
    pickupCoordinate: payload.pickupCoordinate,
    dropoffCoordinate: payload.dropoffCoordinate,
    pickupLabel: payload.pickupLabel,
    dropoffLabel: payload.dropoffLabel,
    selectedTierKey: payload.selectedTierKey || DEFAULT_TIER_KEY,
    passengerCount: payload.passengerCount,
    paymentMethod: payload.paymentMethod,
  });

  session.payload = { ...payload, quote };
  session.state = 'awaiting_confirmation';
  await saveSession(session);

  logFlow('quote:success', {
    phone,
    tierKey: quote.tierKey,
    tierName: quote.tierName,
    distanceKm: quote.distanceKm,
    estimatedAmount: quote.estimatedAmount,
    paymentMethod: quote.paymentMethod,
  });

  await sendButtons(
    phone,
    [
      `Ride estimate: USD ${Number(quote.estimatedAmount || 0).toFixed(2)}`,
      `From: ${quote.pickupLabel}`,
      `To: ${quote.dropoffLabel}`,
      `Distance: ${Number(quote.distanceKm || 0).toFixed(1)} km`,
      `Payment: ${quote.paymentMethod}`,
      '',
      'Confirm this ride?',
    ].join('\n'),
    [
      { id: 'confirm_ride', title: 'Confirm Ride' },
      { id: 'cancel_ride', title: 'Cancel' },
    ]
  );
}

async function confirmRide(phone, session) {
  const payload = session.payload || {};
  logFlow('confirm:start', {
    phone,
    state: session.state,
    payload: summarizePayload(payload),
  });
  const result = await createDispatchRide({
    passengerName: `WhatsApp ${phone}`,
    passengerPhone: phone,
    pickupCoordinate: payload.pickupCoordinate,
    dropoffCoordinate: payload.dropoffCoordinate,
    pickupLabel: payload.pickupLabel,
    dropoffLabel: payload.dropoffLabel,
    selectedTierKey: payload.selectedTierKey || DEFAULT_TIER_KEY,
    passengerCount: payload.passengerCount,
    paymentMethod: payload.paymentMethod,
    bookingSource: 'whatsapp',
    passengerUserId: `whatsapp:${phone}`,
  });

  session.state = 'ride_requested';
  session.rideRequestId = result.rideRequest.id;
  session.payload = {
    ...payload,
    rideRequest: result.rideRequest,
  };
  await saveSession(session);
  await recordWhatsAppRide({ phone, rideRequest: result.rideRequest, payload: session.payload });

  logFlow('confirm:success', {
    phone,
    rideRequestId: result.rideRequest.id,
    publicId: result.rideRequest.publicId,
    nearbyDriverCount: result.rideRequest.nearbyDriverCount,
  });

  await sendText(
    phone,
    [
      `Ride requested: ${result.rideRequest.publicId}`,
      `Fare estimate: USD ${Number(result.rideRequest.estimatedAmount || 0).toFixed(2)}`,
      `Drivers notified: ${result.rideRequest.nearbyDriverCount}`,
      'We will send updates here when a driver accepts.',
    ].join('\n')
  );
}

async function resetSession(phone, message = 'Ride booking cancelled.') {
  await saveSession({
    phone,
    state: 'idle',
    payload: {},
    rideRequestId: null,
    status: 'active',
  });
  await sendText(phone, message);
  await sendMainMenu(phone);
}

async function handleDriverSelectionAction(phone, action) {
  const selection = parseWhatsAppDriverSelectionAction(action);
  if (!selection || !Number.isInteger(selection.rideRequestId) || !selection.driverUserId) {
    return false;
  }

  const whatsappRide = await getWhatsAppRideByRideRequestId(selection.rideRequestId);
  if (!whatsappRide || String(whatsappRide.phone) !== String(phone)) {
    await sendText(phone, 'This driver response does not match your WhatsApp ride.');
    return true;
  }

  const [ride] = await query(
    `SELECT *
     FROM ride_requests
     WHERE id = ?
     LIMIT 1`,
    [selection.rideRequestId]
  );
  if (!ride) {
    await sendText(phone, 'This ride is no longer available.');
    return true;
  }

  if (selection.decision === 'decline') {
    await query(
      `UPDATE ride_request_driver_responses
       SET status = 'declined',
           selected_at = NULL
       WHERE ride_request_id = ?
         AND driver_user_id = ?
         AND status = 'accepted'`,
      [selection.rideRequestId, selection.driverUserId]
    );
    const [acceptedCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND status = 'accepted'`,
      [selection.rideRequestId]
    );
    const nextStatus = Number(acceptedCountRow?.total || 0) > 0 ? 'driver_found' : 'requested';
    await query(
      `UPDATE ride_requests
       SET status = ?
       WHERE id = ?
         AND driver_user_id IS NULL
         AND status IN ('requested', 'driver_found')`,
      [nextStatus, selection.rideRequestId]
    );
    await updateWhatsAppRideStatus(selection.rideRequestId, 'driver_declined', {
      declinedDriverUserId: selection.driverUserId,
      declinedAt: new Date().toISOString(),
    });
    await sendText(phone, 'Driver declined. We will keep looking for another driver.');
    return true;
  }

  const [offer] = await query(
    `SELECT status
     FROM ride_request_driver_responses
     WHERE ride_request_id = ?
       AND driver_user_id = ?
     LIMIT 1`,
    [selection.rideRequestId, selection.driverUserId]
  );
  if (!offer || String(offer.status || '') !== 'accepted') {
    await sendText(phone, 'That driver is no longer available. We will keep looking for another driver.');
    return true;
  }

  const [availability] = await query(
    `SELECT *
     FROM driver_availability
     WHERE driver_user_id = ?
     LIMIT 1`,
    [selection.driverUserId]
  );
  if (!availability) {
    await sendText(phone, 'That driver is no longer available. We will keep looking for another driver.');
    return true;
  }

  const assignment = await assignAcceptedDriverToRide({
    ride,
    driverUserId: selection.driverUserId,
    driverAvailability: availability,
  });
  const [assignedRide] = await query(
    `SELECT *
     FROM ride_requests
     WHERE id = ?
     LIMIT 1`,
    [selection.rideRequestId]
  );
  const safetyPinPayload = buildPassengerSafetyPinPayload(assignedRide || {
    ...ride,
    status: 'driver_assigned',
  });
  await updateWhatsAppRideStatus(selection.rideRequestId, 'driver_assigned', {
    selectedDriverUserId: selection.driverUserId,
    safetyPinRequired: safetyPinPayload.safetyPinRequired,
    safetyPin: safetyPinPayload.safetyPin || null,
    selectedAt: new Date().toISOString(),
  });
  await sendText(
    phone,
    [
      'Driver confirmed.',
      `Driver: ${availability.driver_name || 'Driver'}`,
      availability.phone_number ? `Phone: ${availability.phone_number}` : null,
      `ETA: ${assignment.driverEtaMinutes} min`,
      safetyPinPayload.safetyPinRequired && safetyPinPayload.safetyPin
        ? `Safety PIN: ${safetyPinPayload.safetyPin}`
        : null,
      'Please be ready at your pickup point.',
    ].filter(Boolean).join('\n')
  );
  return true;
}

export async function handleWhatsAppRideMessage(rawPhone, message) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return;

  const session = await loadSession(phone);
  const action = extractAction(message);
  logFlow('inbound:state', {
    phone,
    messageType: message?.type || null,
    action,
    state: session.state,
    payload: summarizePayload(session.payload || {}),
    rawLocation: message?.location || null,
    rawInteractive: message?.interactive || null,
    rawText: message?.text?.body || null,
  });

  try {
    if (await handleDriverSelectionAction(phone, action)) {
      return;
    }

    if (action === 'menu') {
      session.state = 'idle';
      session.payload = {};
      await saveSession(session);
      await sendMainMenu(phone);
      return;
    }

    if (action === 'cancel_ride') {
      await resetSession(phone);
      return;
    }

    if (action === 'support') {
      session.state = 'idle';
      session.payload = {};
      await saveSession(session);
      await sendSupportMenu(phone);
      return;
    }

    if (action === 'account') {
      session.state = 'idle';
      session.payload = {};
      await saveSession(session);
      await sendAccountMenu(phone);
      return;
    }

    if (action === 'book_ride') {
      session.state = 'awaiting_ride_type';
      session.payload = {};
      await saveSession(session);
      logFlow('state:book_ride', { phone, nextState: session.state });
      await askRideType(phone);
      return;
    }

    if (session.state === 'idle') {
      await sendMainMenu(phone);
      return;
    }

    if (
      ['awaiting_pickup', 'awaiting_dropoff'].includes(session.state)
      && !(session.payload || {}).selectedTierKey
      && !message?.location
    ) {
      session.state = 'idle';
      session.payload = {};
      await saveSession(session);
      await sendMainMenu(phone);
      return;
    }

    if (session.state === 'awaiting_ride_type') {
      const selectedTierKey = tierKeyFromAction(action);
      if (!selectedTierKey) {
        await askRideType(phone);
        return;
      }
      session.payload = { ...session.payload, selectedTierKey };
      session.state = 'awaiting_pickup';
      await saveSession(session);
      logFlow('state:ride_type_selected', {
        phone,
        selectedTierKey,
        nextState: session.state,
        payload: summarizePayload(session.payload),
      });
      await askPickup(phone);
      return;
    }

    if (session.state === 'awaiting_pickup') {
      const point = locationToPoint(message?.location);
      console.log('[whatsapp.ride-booking] pickup location received', {
        phone,
        hasLocation: !!message?.location,
        location: message?.location || null,
        parsedPoint: point,
      });
      if (!point) {
        await askPickup(phone);
        return;
      }
      session.payload = {
        ...session.payload,
        pickupCoordinate: point,
        pickupLabel: locationToLabel(message.location, 'WhatsApp pickup pin'),
      };
      session.state = 'awaiting_dropoff';
      await saveSession(session);
      logFlow('state:pickup_saved', {
        phone,
        nextState: session.state,
        payload: summarizePayload(session.payload),
      });
      await askDropoff(phone);
      return;
    }

    if (session.state === 'awaiting_dropoff') {
      const point = locationToPoint(message?.location);
      console.log('[whatsapp.ride-booking] dropoff location received', {
        phone,
        hasLocation: !!message?.location,
        location: message?.location || null,
        parsedPoint: point,
      });
      if (!point) {
        await askDropoff(phone);
        return;
      }
      session.payload = {
        ...session.payload,
        dropoffCoordinate: point,
        dropoffLabel: locationToLabel(message.location, 'WhatsApp drop-off pin'),
      };
      session.state = 'awaiting_passenger_count';
      await saveSession(session);
      logFlow('state:dropoff_saved', {
        phone,
        nextState: session.state,
        payload: summarizePayload(session.payload),
      });
      await askPassengerCount(phone);
      return;
    }

    if (session.state === 'awaiting_passenger_count') {
      const passengerCount = passengerCountFromAction(action);
      if (!passengerCount) {
        await askPassengerCount(phone);
        return;
      }
      session.payload = { ...session.payload, passengerCount };
      session.state = 'awaiting_payment_method';
      await saveSession(session);
      logFlow('state:passenger_count_saved', {
        phone,
        passengerCount,
        nextState: session.state,
        payload: summarizePayload(session.payload),
      });
      await askPaymentMethod(phone);
      return;
    }

    if (session.state === 'awaiting_payment_method') {
      if (!['pay_cash', 'pay_wallet', 'pay_smilepay'].includes(action)) {
        await askPaymentMethod(phone);
        return;
      }
      session.payload = { ...session.payload, paymentMethod: paymentFromAction(action) };
      if (!session.payload.selectedTierKey) {
        logFlow('state:missing_ride_type_before_quote', {
          phone,
          action,
          state: session.state,
          payload: summarizePayload(session.payload),
        });
        session.state = 'awaiting_ride_type';
        await saveSession(session);
        await sendText(phone, 'Please choose your ride type before we calculate the fare.');
        await askRideType(phone);
        return;
      }
      await saveSession(session);
      logFlow('state:payment_saved', {
        phone,
        paymentMethod: session.payload.paymentMethod,
        nextState: 'quote',
        payload: summarizePayload(session.payload),
      });
      await quoteAndAskConfirmation(phone, session);
      return;
    }

    if (session.state === 'awaiting_confirmation') {
      if (action !== 'confirm_ride') {
        await sendButtons(phone, 'Confirm this ride?', [
          { id: 'confirm_ride', title: 'Confirm Ride' },
          { id: 'cancel_ride', title: 'Cancel' },
        ]);
        return;
      }
      await confirmRide(phone, session);
      return;
    }

    await sendMainMenu(phone);
  } catch (error) {
    console.error('[whatsapp.ride-booking] flow failed', {
      phone,
      state: session.state,
      action,
      message: error?.message || String(error),
      status: error?.status || null,
    });
    await sendText(phone, error?.message || 'Could not complete this WhatsApp ride request. Please try again.');
    await sendMainMenu(phone);
  }
}

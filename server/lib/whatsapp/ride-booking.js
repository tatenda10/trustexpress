import crypto from 'crypto';
import { createDispatchRide, listDispatchRideOptions, quoteDispatchRide } from '../admin-ride-dispatch.js';
import { query } from '../../db/connection.js';
import { assignAcceptedDriverToRide } from '../assign-ride-driver.js';
import { buildPassengerSafetyPinPayload } from '../ride-safety-pin.js';
import { normalizeZimbabwePhoneNumber } from '../phone-number.js';
import { emitRideRequestRemovedFromDriver, emitRideStatusToDriver, emitRideStatusToPassenger } from '../realtime.js';
import { createSupportMessage, getOrCreateSupportThreadForUser } from '../support-chat.js';
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
const SUPPORT_RIDE_PREFIX = 'support_ride:';
const LOST_ITEM_MAX_LENGTH = 2000;

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

function getPassengerNameFromUser(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || 'Passenger';
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function normalizeCity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
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
  if (['lost item', 'lost items', 'lost property'].includes(text)) return 'support_lost_item';
  if (['report', 'report issue', 'problem', 'complaint'].includes(text)) return 'support_report';
  if (['account', 'my account', 'check account', 'settings'].includes(text)) return 'account';
  if (['my rides', 'rides', 'trips', 'my trips'].includes(text)) return 'my_rides';
  if (['delete account', 'remove account'].includes(text)) return 'delete_account';
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

async function sendKnownPassengerMenu(phone, passengerName) {
  await sendText(phone, `Hi ${passengerName || 'there'} 👋\nWhat would you like to do?`);
  await sendButtons(phone, 'Choose an option:', [
    { id: 'book_ride', title: 'Book a Ride' },
    { id: 'support', title: 'Support' },
    { id: 'account', title: 'My Account' },
  ]);
}

async function askRegistrationName(phone) {
  await sendText(
    phone,
    [
      'Hi, welcome to Trust Express 👋',
      'Please register before booking a ride.',
      '',
      'Reply with your full name and surname.',
    ].join('\n')
  );
}

async function askRegistrationCity(phone) {
  await sendText(phone, 'Which city are you registering from? Example: Harare, Bulawayo, Gweru');
}

async function askRegistrationTerms(phone) {
  await sendButtons(
    phone,
    [
      'Do you accept Trust Express terms and privacy policy so we can create your WhatsApp passenger account?',
      'Privacy policy: https://trustexpress.co.za/privacy',
    ].join('\n'),
    [
      { id: 'reg_terms_accept', title: 'Accept' },
      { id: 'reg_terms_cancel', title: 'Cancel' },
    ]
  );
}

async function findPassengerByWhatsAppPhone(phone) {
  const normalized = normalizeZimbabwePhoneNumber(phone);
  if (!normalized.ok) {
    return {
      found: false,
      phone,
      localPhone: null,
      e164Phone: null,
      error: normalized.error,
      passengerUserId: null,
      passengerName: null,
    };
  }
  const compactE164 = normalized.e164Phone.replace('+', '');
  const rows = await query(
    `SELECT clerk_user_id, first_name, last_name, phone_number
     FROM users
     WHERE role = 'passenger'
       AND phone_number IN (?, ?, ?)
     ORDER BY phone_verified_at DESC, updated_at DESC
     LIMIT 1`,
    [normalized.localPhone, normalized.e164Phone, compactE164]
  );
  const user = rows[0] || null;
  return {
    found: !!user,
    phone,
    localPhone: normalized.localPhone,
    e164Phone: normalized.e164Phone,
    compactE164,
    passengerUserId: user?.clerk_user_id || null,
    passengerName: user ? getPassengerNameFromUser(user) : null,
  };
}

async function createWhatsAppPassenger({ phone, fullName, city }) {
  const normalized = normalizeZimbabwePhoneNumber(phone);
  if (!normalized.ok) {
    const error = new Error(normalized.error);
    error.status = 400;
    throw error;
  }
  const passengerUserId = `whatsapp:${normalized.e164Phone.replace(/\D/g, '')}`;
  const { firstName, lastName } = splitFullName(fullName);
  const safeCity = normalizeCity(city);
  await query(
    `INSERT INTO users (
       clerk_user_id,
       first_name,
       last_name,
       role,
       phone_number,
       phone_verified_at,
       registration_city,
       registration_country_code,
       registration_source,
       registration_detected_at
     ) VALUES (?, ?, ?, 'passenger', ?, CURRENT_TIMESTAMP, ?, 'ZW', 'whatsapp', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name),
       last_name = VALUES(last_name),
       role = 'passenger',
       phone_number = VALUES(phone_number),
       phone_verified_at = COALESCE(phone_verified_at, CURRENT_TIMESTAMP),
       registration_city = VALUES(registration_city),
       registration_country_code = 'ZW',
       registration_source = COALESCE(registration_source, 'whatsapp'),
       registration_detected_at = COALESCE(registration_detected_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP`,
    [
      passengerUserId,
      firstName || 'WhatsApp',
      lastName || 'Passenger',
      normalized.localPhone,
      safeCity || null,
    ]
  );
  return {
    passengerUserId,
    passengerName: [firstName || 'WhatsApp', lastName || 'Passenger'].filter(Boolean).join(' '),
    localPhone: normalized.localPhone,
    e164Phone: normalized.e164Phone,
    city: safeCity || null,
  };
}

async function ensurePassengerSession(phone, session) {
  const payload = session.payload || {};
  if (payload.passengerUserId && payload.passengerName && payload.localPhone) {
    return {
      registered: true,
      passengerUserId: payload.passengerUserId,
      passengerName: payload.passengerName,
      localPhone: payload.localPhone,
    };
  }
  const match = await findPassengerByWhatsAppPhone(phone);
  logFlow('passenger_lookup', {
    phone,
    found: match.found,
    localPhone: match.localPhone,
    passengerUserId: match.passengerUserId,
    passengerName: match.passengerName,
    error: match.error || null,
  });
  if (!match.found) return { registered: false, ...match };

  session.payload = {
    ...payload,
    passengerUserId: match.passengerUserId,
    passengerName: match.passengerName,
    localPhone: match.localPhone,
    e164Phone: match.e164Phone,
  };
  await saveSession(session);
  return { registered: true, ...session.payload };
}

async function sendSupportMenu(phone) {
  await sendText(phone, 'Trust Express support. What do you need help with?');
  await sendButtons(phone, 'Choose support option:', [
    { id: 'support_report', title: 'Report Issue' },
    { id: 'support_lost_item', title: 'Lost Item' },
    { id: 'menu', title: 'Main Menu' },
  ]);
}

async function sendAccountMenu(phone) {
  await sendText(
    phone,
    [
      'Account settings',
      'Choose what you want to manage.',
    ].join('\n')
  );
  await sendButtons(phone, 'Choose an option:', [
    { id: 'my_rides', title: 'My Rides' },
    { id: 'delete_account', title: 'Delete Account' },
    { id: 'menu', title: 'Main Menu' },
  ]);
}

function createCaseReference(prefix, rideRequestId) {
  return `${prefix}-${String(rideRequestId || '').padStart(6, '0')}-${crypto.randomInt(100, 999)}`;
}

function trimWhatsAppDescription(value, maxLength = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function supportRideAction(rideId, kind) {
  return `${SUPPORT_RIDE_PREFIX}${kind}:${rideId}`;
}

function parseSupportRideAction(action) {
  const match = String(action || '').match(/^support_ride:(lost|report):(\d+)$/);
  if (!match) return null;
  return {
    kind: match[1],
    rideRequestId: Number(match[2]),
  };
}

async function createWhatsAppSupportThreadMessage({ passenger, phone, subject, message }) {
  const thread = await getOrCreateSupportThreadForUser(passenger.passengerUserId, 'passenger');
  const text = [
    subject ? `[WhatsApp] ${subject}` : '[WhatsApp] Support message',
    `Phone: +${phone}`,
    '',
    String(message || '').trim(),
  ].filter(Boolean).join('\n');
  await createSupportMessage({
    threadId: thread.id,
    senderType: 'passenger',
    senderUserId: passenger.passengerUserId,
    message: text,
  });
  return thread;
}

async function listRecentSupportRides(passengerUserId) {
  const rows = await query(
    `SELECT id, public_id, pickup_label, dropoff_label, status, requested_at, final_estimated_amount, estimated_amount
     FROM ride_requests
     WHERE passenger_user_id = ?
     ORDER BY requested_at DESC, id DESC
     LIMIT 10`,
    [passengerUserId]
  );
  return Array.isArray(rows) ? rows : [];
}

async function askSupportRideSelection(phone, session, kind) {
  const passenger = await ensurePassengerSession(phone, session);
  if (!passenger.registered) {
    session.state = 'registration_awaiting_name';
    session.payload = {};
    await saveSession(session);
    await askRegistrationName(phone);
    return false;
  }

  const rides = await listRecentSupportRides(passenger.passengerUserId);
  if (!rides.length) {
    session.state = kind === 'lost' ? 'support_lost_awaiting_description' : 'support_report_awaiting_message';
    session.payload = {
      ...(session.payload || {}),
      passengerUserId: passenger.passengerUserId,
      passengerName: passenger.passengerName,
      localPhone: passenger.localPhone,
      supportRideRequestId: null,
      supportKind: kind,
    };
    await saveSession(session);
    await sendText(
      phone,
      kind === 'lost'
        ? 'Tell us what item was lost. Include where you sat and any details that help identify it.'
        : 'Please type the issue you want to report. Our support team will see it in the admin inbox.'
    );
    return true;
  }

  session.state = kind === 'lost' ? 'support_lost_awaiting_ride' : 'support_report_awaiting_ride';
  session.payload = {
    ...(session.payload || {}),
    passengerUserId: passenger.passengerUserId,
    passengerName: passenger.passengerName,
    localPhone: passenger.localPhone,
    supportKind: kind,
  };
  await saveSession(session);

  await sendList(
    phone,
    kind === 'lost' ? 'Which ride did you lose the item on?' : 'Which ride is this report about?',
    'Select ride',
    rides.map((ride) => ({
      id: supportRideAction(ride.id, kind),
      title: trimWhatsAppDescription(ride.public_id || `Ride #${ride.id}`, 24),
      description: trimWhatsAppDescription(`${ride.status || 'ride'} - ${ride.pickup_label || 'Pickup'} to ${ride.dropoff_label || 'Drop-off'}`),
    }))
  );
  return true;
}

async function createLostItemReport({ phone, passenger, rideRequestId, description }) {
  const itemDescription = String(description || '').trim();
  if (!itemDescription) {
    const error = new Error('Please describe the lost item.');
    error.status = 400;
    throw error;
  }
  if (itemDescription.length > LOST_ITEM_MAX_LENGTH) {
    const error = new Error(`Please keep the lost item description under ${LOST_ITEM_MAX_LENGTH} characters.`);
    error.status = 400;
    throw error;
  }

  let ride = null;
  if (Number.isInteger(Number(rideRequestId)) && Number(rideRequestId) > 0) {
    [ride] = await query(
      `SELECT id, public_id, driver_user_id, passenger_user_id
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [Number(rideRequestId), passenger.passengerUserId]
    );
  }
  if (!ride) {
    const [latestRide] = await query(
      `SELECT id, public_id, driver_user_id, passenger_user_id
       FROM ride_requests
       WHERE passenger_user_id = ?
       ORDER BY requested_at DESC, id DESC
       LIMIT 1`,
      [passenger.passengerUserId]
    );
    ride = latestRide || null;
  }
  if (!ride) {
    await createWhatsAppSupportThreadMessage({
      passenger,
      phone,
      subject: 'Lost item report',
      message: itemDescription,
    });
    return { lostItemId: null, caseReference: null };
  }

  const caseReference = createCaseReference('LI', ride.id);
  const result = await query(
    `INSERT INTO ride_lost_items (
       ride_request_id,
       ride_public_id,
       passenger_user_id,
       driver_user_id,
       item_description,
       contact_phone,
       case_reference,
       case_priority,
       status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'high', 'open')`,
    [
      ride.id,
      ride.public_id || null,
      passenger.passengerUserId,
      ride.driver_user_id || null,
      itemDescription,
      passenger.localPhone || phone || null,
      caseReference,
    ]
  );
  return {
    lostItemId: Number(result?.insertId || 0),
    caseReference,
  };
}

async function handleSupportFlow(phone, action, message, session) {
  const rideSelection = parseSupportRideAction(action);
  if (action === 'support_report') {
    await askSupportRideSelection(phone, session, 'report');
    return true;
  }
  if (action === 'support_lost_item') {
    await askSupportRideSelection(phone, session, 'lost');
    return true;
  }

  if (rideSelection && ['support_lost_awaiting_ride', 'support_report_awaiting_ride'].includes(session.state)) {
    session.payload = {
      ...(session.payload || {}),
      supportRideRequestId: rideSelection.rideRequestId,
      supportKind: rideSelection.kind,
    };
    session.state = rideSelection.kind === 'lost'
      ? 'support_lost_awaiting_description'
      : 'support_report_awaiting_message';
    await saveSession(session);
    await sendText(
      phone,
      rideSelection.kind === 'lost'
        ? 'Please describe the lost item. Include colour, brand, where you sat, and anything unique.'
        : 'Please type the issue you want to report for this ride.'
    );
    return true;
  }

  if (session.state === 'support_lost_awaiting_description') {
    const description = String(message?.text?.body || '').trim();
    if (!description) {
      await sendText(phone, 'Please describe the lost item in a text message.');
      return true;
    }
    const passenger = await ensurePassengerSession(phone, session);
    if (!passenger.registered) {
      session.state = 'registration_awaiting_name';
      session.payload = {};
      await saveSession(session);
      await askRegistrationName(phone);
      return true;
    }
    const report = await createLostItemReport({
      phone,
      passenger,
      rideRequestId: session.payload?.supportRideRequestId,
      description,
    });
    session.state = 'idle';
    session.payload = {
      passengerUserId: passenger.passengerUserId,
      passengerName: passenger.passengerName,
      localPhone: passenger.localPhone,
      e164Phone: passenger.e164Phone,
    };
    await saveSession(session);
    await sendText(
      phone,
      report.caseReference
        ? `Lost item report received. Case: ${report.caseReference}. Support will follow up.`
        : 'Lost item report received. Support will follow up from the admin inbox.'
    );
    await sendButtons(phone, 'What next?', [
      { id: 'menu', title: 'Main Menu' },
      { id: 'my_rides', title: 'My Rides' },
      { id: 'support', title: 'Support' },
    ]);
    return true;
  }

  if (session.state === 'support_report_awaiting_message') {
    const reportMessage = String(message?.text?.body || '').trim();
    if (!reportMessage) {
      await sendText(phone, 'Please type the issue you want to report.');
      return true;
    }
    const passenger = await ensurePassengerSession(phone, session);
    if (!passenger.registered) {
      session.state = 'registration_awaiting_name';
      session.payload = {};
      await saveSession(session);
      await askRegistrationName(phone);
      return true;
    }
    const rideId = Number(session.payload?.supportRideRequestId || 0);
    await createWhatsAppSupportThreadMessage({
      passenger,
      phone,
      subject: rideId > 0 ? `Ride #${rideId} issue report` : 'General issue report',
      message: reportMessage,
    });
    session.state = 'idle';
    session.payload = {
      passengerUserId: passenger.passengerUserId,
      passengerName: passenger.passengerName,
      localPhone: passenger.localPhone,
      e164Phone: passenger.e164Phone,
    };
    await saveSession(session);
    await sendText(phone, 'Report received. Our support team will review it in the admin inbox.');
    await sendButtons(phone, 'What next?', [
      { id: 'menu', title: 'Main Menu' },
      { id: 'my_rides', title: 'My Rides' },
      { id: 'book_ride', title: 'Book a Ride' },
    ]);
    return true;
  }

  return false;
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

function parseWhatsAppTripAction(action) {
  const value = String(action || '');
  const match = value.match(/^wa_(cancel|coming):(\d+)$/);
  if (!match) return null;
  return {
    action: match[1],
    rideRequestId: Number(match[2]),
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
  const passengerPhone = normalizeZimbabwePhoneNumber(payload.localPhone || phone);
  logFlow('confirm:phone_normalized', {
    phone,
    ok: passengerPhone.ok,
    localPhone: passengerPhone.localPhone || null,
    e164Phone: passengerPhone.e164Phone || null,
    error: passengerPhone.error || null,
  });
  if (!passengerPhone.ok) {
    await sendText(
      phone,
      'We could not read a valid Zimbabwe WhatsApp phone number for this chat. Please contact support to complete this booking.'
    );
    return;
  }
  logFlow('confirm:start', {
    phone,
    state: session.state,
    payload: summarizePayload(payload),
  });
  const result = await createDispatchRide({
    passengerName: payload.passengerName || `WhatsApp ${phone}`,
    passengerPhone: passengerPhone.localPhone,
    pickupCoordinate: payload.pickupCoordinate,
    dropoffCoordinate: payload.dropoffCoordinate,
    pickupLabel: payload.pickupLabel,
    dropoffLabel: payload.dropoffLabel,
    selectedTierKey: payload.selectedTierKey || DEFAULT_TIER_KEY,
    passengerCount: payload.passengerCount,
    paymentMethod: payload.paymentMethod,
    bookingSource: 'whatsapp',
    passengerUserId: payload.passengerUserId || `whatsapp:${phone}`,
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
  await sendButtons(phone, 'Ride options:', [
    { id: `wa_cancel:${result.rideRequest.id}`, title: 'Cancel Ride' },
    { id: 'support', title: 'Support' },
  ]);
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
  await sendButtons(
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
    ].filter(Boolean).join('\n'),
    [
      { id: `wa_cancel:${selection.rideRequestId}`, title: 'Cancel Ride' },
      { id: 'support', title: 'Support' },
    ]
  );
  return true;
}

async function handleTripAction(phone, action) {
  const tripAction = parseWhatsAppTripAction(action);
  if (!tripAction || !Number.isInteger(tripAction.rideRequestId)) return false;

  const whatsappRide = await getWhatsAppRideByRideRequestId(tripAction.rideRequestId);
  if (!whatsappRide || String(whatsappRide.phone) !== String(phone)) {
    await sendText(phone, 'This ride action does not match your WhatsApp ride.');
    return true;
  }

  const [ride] = await query(
    `SELECT *
     FROM ride_requests
     WHERE id = ?
     LIMIT 1`,
    [tripAction.rideRequestId]
  );
  if (!ride) {
    await sendText(phone, 'This ride is no longer available.');
    return true;
  }

  if (tripAction.action === 'coming') {
    await query(
      `UPDATE ride_requests
       SET passenger_confirmed_at = COALESCE(passenger_confirmed_at, CURRENT_TIMESTAMP)
       WHERE id = ?
         AND status = 'driver_arrived'
         AND passenger_confirmed_at IS NULL`,
      [tripAction.rideRequestId]
    );
    const [updatedRide] = await query(
      `SELECT *
       FROM ride_requests
       WHERE id = ?
       LIMIT 1`,
      [tripAction.rideRequestId]
    );
    if (!updatedRide?.passenger_confirmed_at) {
      await sendText(phone, 'You can confirm once the driver has arrived.');
      return true;
    }
    if (updatedRide.driver_user_id) {
      emitRideStatusToDriver(updatedRide.driver_user_id, {
        rideRequestId: tripAction.rideRequestId,
        status: 'passenger_confirmed',
        passengerConfirmedAt: new Date(updatedRide.passenger_confirmed_at).toISOString(),
      });
    }
    await updateWhatsAppRideStatus(tripAction.rideRequestId, 'passenger_confirmed', {
      passengerConfirmedAt: new Date(updatedRide.passenger_confirmed_at).toISOString(),
    });
    await sendText(phone, 'Thanks. We have told your driver you are coming.');
    return true;
  }

  if (tripAction.action === 'cancel') {
    if (['completed', 'cancelled', 'expired'].includes(String(ride.status || ''))) {
      await sendText(phone, 'This ride can no longer be cancelled.');
      return true;
    }
    await query(
      `UPDATE ride_requests
       SET status = 'cancelled',
           cancellation_reason = 'Passenger cancelled from WhatsApp',
           cancelled_by = 'passenger',
           cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')`,
      [tripAction.rideRequestId]
    );
    const affectedDrivers = await query(
      `SELECT driver_user_id
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?`,
      [tripAction.rideRequestId]
    );
    affectedDrivers.forEach((row) => {
      emitRideRequestRemovedFromDriver(row.driver_user_id, {
        rideRequestId: tripAction.rideRequestId,
        reason: 'passenger_cancelled',
      });
      emitRideStatusToDriver(row.driver_user_id, {
        rideRequestId: tripAction.rideRequestId,
        status: 'cancelled',
        passengerUserId: ride.passenger_user_id,
      });
    });
    emitRideStatusToPassenger(ride.passenger_user_id, {
      rideRequestId: tripAction.rideRequestId,
      status: 'cancelled',
    });
    await updateWhatsAppRideStatus(tripAction.rideRequestId, 'cancelled', {
      cancelledAt: new Date().toISOString(),
      cancelledBy: 'passenger',
    });
    await sendText(phone, 'Your ride has been cancelled.');
    await sendKnownPassengerMenu(phone, whatsappRide.payload?.passengerName || 'there');
    return true;
  }

  return false;
}

async function cancelLatestActiveWhatsAppRide(phone) {
  const [row] = await query(
    `SELECT wr.ride_request_id
     FROM whatsapp_ride_requests wr
     INNER JOIN ride_requests rr ON rr.id = wr.ride_request_id
     WHERE wr.whatsapp_phone = ?
       AND rr.status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')
     ORDER BY rr.requested_at DESC, rr.id DESC
     LIMIT 1`,
    [phone]
  );
  if (!row?.ride_request_id) return false;
  return handleTripAction(phone, `wa_cancel:${row.ride_request_id}`);
}

async function sendMyRides(phone, session) {
  const passenger = await ensurePassengerSession(phone, session);
  if (!passenger.registered) {
    session.state = 'registration_awaiting_name';
    session.payload = {};
    await saveSession(session);
    await askRegistrationName(phone);
    return;
  }

  const rows = await query(
    `SELECT id, public_id, pickup_label, dropoff_label, status, requested_at, final_estimated_amount, estimated_amount
     FROM ride_requests
     WHERE passenger_user_id = ?
     ORDER BY requested_at DESC, id DESC
     LIMIT 5`,
    [passenger.passengerUserId]
  );
  if (!rows.length) {
    await sendText(phone, 'You do not have any rides yet.');
    await sendKnownPassengerMenu(phone, passenger.passengerName);
    return;
  }
  await sendText(
    phone,
    [
      'Your recent rides:',
      ...rows.map((ride) => [
        `${ride.public_id || `#${ride.id}`} - ${ride.status}`,
        `${ride.pickup_label || 'Pickup'} → ${ride.dropoff_label || 'Drop-off'}`,
        `Fare: USD ${Number(ride.final_estimated_amount || ride.estimated_amount || 0).toFixed(2)}`,
      ].join('\n')),
    ].join('\n\n')
  );
  await sendButtons(phone, 'What would you like to do next?', [
    { id: 'menu', title: 'Main Menu' },
    { id: 'book_ride', title: 'Book a Ride' },
    { id: 'support', title: 'Support' },
  ]);
}

async function handleDeleteAccount(phone, session, confirmed = false) {
  const passenger = await ensurePassengerSession(phone, session);
  if (!passenger.registered) {
    await sendText(phone, 'No registered WhatsApp passenger account was found for this number.');
    return;
  }
  if (!confirmed) {
    await sendButtons(
      phone,
      'Deleting your WhatsApp passenger account will unlink this number from Trust Express WhatsApp bookings. Continue?',
      [
        { id: 'delete_confirm', title: 'Yes Delete' },
        { id: 'account', title: 'No' },
      ]
    );
    return;
  }
  const [activeRide] = await query(
    `SELECT id
     FROM ride_requests
     WHERE passenger_user_id = ?
       AND status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')
     LIMIT 1`,
    [passenger.passengerUserId]
  );
  if (activeRide) {
    await sendText(phone, 'Please cancel or complete your active ride before deleting your account.');
    return;
  }
  await query(
    `UPDATE users
     SET first_name = 'Deleted',
         last_name = 'WhatsApp User',
         phone_number = NULL,
         phone_verified_at = NULL,
         registration_source = 'whatsapp_deleted',
         updated_at = CURRENT_TIMESTAMP
     WHERE clerk_user_id = ?
       AND clerk_user_id LIKE 'whatsapp:%'`,
    [passenger.passengerUserId]
  );
  await saveSession({
    phone,
    state: 'idle',
    payload: {},
    rideRequestId: null,
    status: 'active',
  });
  await sendText(phone, 'Your WhatsApp passenger account has been deleted/unlinked.');
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
    if (await handleTripAction(phone, action)) {
      return;
    }
    if (await handleSupportFlow(phone, action, message, session)) {
      return;
    }

    if (String(session.state || '').startsWith('registration_') && action === 'cancel_ride') {
      await resetSession(phone, 'Registration cancelled.');
      return;
    }

    if (String(session.state || '').startsWith('registration_') && action === 'menu') {
      session.state = 'registration_awaiting_name';
      session.payload = {};
      await saveSession(session);
      await askRegistrationName(phone);
      return;
    }

    if (session.state === 'registration_awaiting_name') {
      const fullName = String(message?.text?.body || '').trim().replace(/\s+/g, ' ');
      if (fullName.length < 2 || !/[A-Za-z]/.test(fullName)) {
        await sendText(phone, 'Please reply with your full name and surname.');
        return;
      }
      session.payload = {
        ...(session.payload || {}),
        registrationFullName: fullName,
      };
      session.state = 'registration_awaiting_city';
      await saveSession(session);
      await askRegistrationCity(phone);
      return;
    }

    if (session.state === 'registration_awaiting_city') {
      const city = normalizeCity(message?.text?.body);
      if (city.length < 2) {
        await askRegistrationCity(phone);
        return;
      }
      session.payload = {
        ...(session.payload || {}),
        registrationCity: city,
      };
      session.state = 'registration_awaiting_terms';
      await saveSession(session);
      await askRegistrationTerms(phone);
      return;
    }

    if (session.state === 'registration_awaiting_terms') {
      if (action !== 'reg_terms_accept') {
        if (action === 'reg_terms_cancel' || action === 'cancel_ride') {
          await resetSession(phone, 'Registration cancelled.');
          return;
        }
        await askRegistrationTerms(phone);
        return;
      }
      const registered = await createWhatsAppPassenger({
        phone,
        fullName: session.payload?.registrationFullName,
        city: session.payload?.registrationCity,
      });
      session.state = 'idle';
      session.payload = {
        passengerUserId: registered.passengerUserId,
        passengerName: registered.passengerName,
        localPhone: registered.localPhone,
        e164Phone: registered.e164Phone,
        registrationCity: registered.city,
      };
      await saveSession(session);
      await sendText(phone, `Registration complete. Welcome ${registered.passengerName} 👋`);
      await sendKnownPassengerMenu(phone, registered.passengerName);
      return;
    }

    if (action === 'menu') {
      const passenger = await ensurePassengerSession(phone, session);
      if (!passenger.registered) {
        session.state = 'registration_awaiting_name';
        session.payload = {};
        await saveSession(session);
        await askRegistrationName(phone);
        return;
      }
      session.state = 'idle';
      session.payload = {
        passengerUserId: passenger.passengerUserId,
        passengerName: passenger.passengerName,
        localPhone: passenger.localPhone,
        e164Phone: passenger.e164Phone,
      };
      await saveSession(session);
      await sendKnownPassengerMenu(phone, passenger.passengerName);
      return;
    }

    if (action === 'cancel_ride') {
      if (await cancelLatestActiveWhatsAppRide(phone)) {
        return;
      }
      await resetSession(phone);
      return;
    }

    if (action === 'support') {
      session.state = 'idle';
      await saveSession(session);
      await sendSupportMenu(phone);
      return;
    }

    if (action === 'account') {
      session.state = 'idle';
      await saveSession(session);
      await sendAccountMenu(phone);
      return;
    }

    if (action === 'my_rides') {
      await sendMyRides(phone, session);
      return;
    }

    if (action === 'delete_account') {
      await handleDeleteAccount(phone, session, false);
      return;
    }

    if (action === 'delete_confirm') {
      await handleDeleteAccount(phone, session, true);
      return;
    }

    if (action === 'book_ride') {
      const passenger = await ensurePassengerSession(phone, session);
      if (!passenger.registered) {
        session.state = 'registration_awaiting_name';
        session.payload = {};
        await saveSession(session);
        await askRegistrationName(phone);
        return;
      }
      session.state = 'awaiting_ride_type';
      session.payload = {
        passengerUserId: passenger.passengerUserId,
        passengerName: passenger.passengerName,
        localPhone: passenger.localPhone,
        e164Phone: passenger.e164Phone,
      };
      await saveSession(session);
      logFlow('state:book_ride', { phone, nextState: session.state });
      await askRideType(phone);
      return;
    }

    if (session.state === 'idle') {
      const passenger = await ensurePassengerSession(phone, session);
      if (!passenger.registered) {
        session.state = 'registration_awaiting_name';
        session.payload = {};
        await saveSession(session);
        await askRegistrationName(phone);
        return;
      }
      await sendKnownPassengerMenu(phone, passenger.passengerName);
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

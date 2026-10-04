import { sendText } from './cloud-api.js';
import { getWhatsAppRideByRideRequestId, updateWhatsAppRideStatus } from './session-store.js';
import { sendButtons } from './cloud-api.js';
import { buildPassengerSafetyPinPayload } from '../ride-safety-pin.js';

function formatMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

export async function notifyWhatsAppRideAssigned({
  ride,
  driverUserId,
  driverName,
  driverPhone,
  driverEtaMinutes,
  vehicleLabel,
  plate,
} = {}) {
  const rideRequestId = Number(ride?.id || ride?.rideRequestId || 0);
  if (!rideRequestId) return { sent: false, reason: 'invalid_ride' };

  const whatsappRide = await getWhatsAppRideByRideRequestId(rideRequestId);
  if (!whatsappRide?.phone) return { sent: false, reason: 'not_whatsapp_ride' };

  const publicId = ride?.public_id || whatsappRide.publicId || `#${rideRequestId}`;
  const lines = [
    `Driver assigned for ride ${publicId}.`,
    `Driver: ${driverName || 'Driver'}`,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    plate ? `Plate: ${String(plate).toUpperCase()}` : null,
    driverPhone ? `Phone: ${driverPhone}` : null,
    Number(driverEtaMinutes || 0) > 0 ? `ETA: ${driverEtaMinutes} min` : null,
    `Fare estimate: USD ${formatMoney(ride?.final_estimated_amount || ride?.estimated_amount)}`,
    '',
    'Please be ready at your pickup point.',
  ].filter(Boolean);

  await sendText(whatsappRide.phone, lines.join('\n'));
  await updateWhatsAppRideStatus(rideRequestId, 'driver_assigned', {
    driverUserId,
    driverName: driverName || null,
    driverPhone: driverPhone || null,
    driverEtaMinutes: driverEtaMinutes || null,
    vehicleLabel: vehicleLabel || null,
    plate: plate || null,
    assignedAt: new Date().toISOString(),
  });

  return { sent: true, phone: whatsappRide.phone };
}

export async function notifyWhatsAppDriverOffer({
  ride,
  driverUserId,
  driverName,
  driverPhone,
  driverEtaMinutes,
  vehicleLabel,
  plate,
} = {}) {
  const rideRequestId = Number(ride?.id || ride?.rideRequestId || 0);
  if (!rideRequestId) return { sent: false, reason: 'invalid_ride' };

  const whatsappRide = await getWhatsAppRideByRideRequestId(rideRequestId);
  if (!whatsappRide?.phone) return { sent: false, reason: 'not_whatsapp_ride' };

  const publicId = ride?.public_id || whatsappRide.publicId || `#${rideRequestId}`;
  const body = [
    `Driver accepted ride ${publicId}.`,
    `Driver: ${driverName || 'Driver'}`,
    vehicleLabel ? `Vehicle: ${vehicleLabel}` : null,
    plate ? `Plate: ${String(plate).toUpperCase()}` : null,
    driverPhone ? `Phone: ${driverPhone}` : null,
    Number(driverEtaMinutes || 0) > 0 ? `ETA: ${driverEtaMinutes} min` : null,
    `Fare estimate: USD ${formatMoney(ride?.final_estimated_amount || ride?.estimated_amount)}`,
    '',
    'Do you want this driver?',
  ].filter(Boolean).join('\n');

  await sendButtons(whatsappRide.phone, body, [
    { id: `wa_accept:${rideRequestId}:${driverUserId}`, title: 'Accept Driver' },
    { id: `wa_decline:${rideRequestId}:${driverUserId}`, title: 'Decline' },
  ]);

  await updateWhatsAppRideStatus(rideRequestId, 'driver_offered', {
    offeredDriverUserId: driverUserId,
    offeredDriverName: driverName || null,
    offeredDriverPhone: driverPhone || null,
    offeredDriverEtaMinutes: driverEtaMinutes || null,
    offeredVehicleLabel: vehicleLabel || null,
    offeredPlate: plate || null,
    offeredAt: new Date().toISOString(),
  });

  return { sent: true, phone: whatsappRide.phone };
}

export async function notifyWhatsAppDriverArrived({ ride } = {}) {
  const rideRequestId = Number(ride?.id || ride?.rideRequestId || 0);
  if (!rideRequestId) return { sent: false, reason: 'invalid_ride' };

  const whatsappRide = await getWhatsAppRideByRideRequestId(rideRequestId);
  if (!whatsappRide?.phone) return { sent: false, reason: 'not_whatsapp_ride' };

  const safetyPinPayload = buildPassengerSafetyPinPayload(ride);
  await sendText(
    whatsappRide.phone,
    [
      'Your driver has arrived at the pickup point.',
      safetyPinPayload.safetyPinRequired && safetyPinPayload.safetyPin
        ? `Safety PIN: ${safetyPinPayload.safetyPin}`
        : null,
      'Give this PIN to the driver only when you are ready to start the ride.',
    ].filter(Boolean).join('\n')
  );
  await updateWhatsAppRideStatus(rideRequestId, 'driver_arrived', {
    safetyPinRequired: safetyPinPayload.safetyPinRequired,
    safetyPin: safetyPinPayload.safetyPin || null,
    arrivedAt: new Date().toISOString(),
  });

  return { sent: true, phone: whatsappRide.phone };
}

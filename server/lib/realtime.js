let ioInstance = null;

function getUserRoom(userId) {
  return `user:${String(userId || '').trim()}`;
}

export function setRealtimeServer(io) {
  ioInstance = io;
}

export function getRealtimeServer() {
  return ioInstance;
}

export function emitToUser(userId, event, payload = {}) {
  if (!ioInstance || !userId || !event) return;
  ioInstance.to(getUserRoom(userId)).emit(event, payload);
}

export function emitRideRequestToDriver(driverUserId, payload = {}) {
  emitToUser(driverUserId, 'ride_request:new', payload);
}

export function emitRideRequestRemovedFromDriver(driverUserId, payload = {}) {
  emitToUser(driverUserId, 'ride_request:removed', payload);
}

export function emitRideStatusToPassenger(passengerUserId, payload = {}) {
  emitToUser(passengerUserId, 'ride_status:updated', payload);
}

export function emitRideStatusToDriver(driverUserId, payload = {}) {
  emitToUser(driverUserId, 'driver_ride:updated', payload);
}

export function getRealtimeUserRoom(userId) {
  return getUserRoom(userId);
}

export function emitTripRatingToDriver(driverUserId, payload = {}) {
  emitToUser(driverUserId, 'driver_rating:received', payload);
}

export function emitTripRatingToPassenger(passengerUserId, payload = {}) {
  emitToUser(passengerUserId, 'passenger_rating:received', payload);
}

export function emitRideChatMessageToUser(userId, payload = {}) {
  emitToUser(userId, 'ride_chat:message', payload);
}

export function emitSupportChatMessageToUser(userId, payload = {}) {
  emitToUser(userId, 'support_chat:message', payload);
}

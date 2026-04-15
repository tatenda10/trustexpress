/**
 * Backend connection - BASE_URL and helpers for API routes.
 */
export const BASE_URL = 'https://ridehailcarsserver.online';

// Optional global auth error handler (set from App.js) – e.g. to auto sign the user out on 401.
let authErrorHandler = null;
export function setApiAuthErrorHandler(handler) {
  authErrorHandler = typeof handler === 'function' ? handler : null;
}

export function getApiUrl(path) {
  const base = BASE_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function getFriendlyApiErrorMessage(status, fallbackMessage) {
  if (status === 401) {
    return 'Session expired. Please sign in again.';
  }
  if (status === 429) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }
  if (status >= 500) {
    return 'Something went wrong on our side. Please try again in a moment.';
  }
  return fallbackMessage || 'Something went wrong. Please try again.';
}

export async function apiFetch(path, options = {}, token) {
  const { suppressAuthErrorHandler = false, ...fetchOptions } = options || {};
  const url = getApiUrl(path);
  const headers = { ...(fetchOptions.headers || {}) };
  if (fetchOptions.body === undefined || typeof fetchOptions.body === 'string') headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  let data = {};
  try {
    res = await fetch(url, { ...fetchOptions, headers });
    data = await res.json().catch(() => ({}));
  } catch (error) {
    const err = new Error('Network error. Please check your connection and try again.');
    err.status = 0;
    err.cause = error;
    throw err;
  }
  if (!res.ok) {
    const message = getFriendlyApiErrorMessage(res.status, data?.error);
    const err = new Error(message);
    err.status = res.status;
    // If the backend reports an auth problem, trigger the global handler so the app can log out.
    if (res.status === 401 && authErrorHandler && !suppressAuthErrorHandler) {
      try {
        authErrorHandler();
      } catch {
        // ignore handler errors – still throw the original error
      }
    }
    throw err;
  }
  return data;
}

export async function registerUser(token, payload) {
  return apiFetch('/api/users/register', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function resolveAgentInvite(inviteToken) {
  const token = String(inviteToken || '').trim();
  return apiFetch(`/api/agent/invite/${encodeURIComponent(token)}`, {}, undefined);
}

export async function attachAgentReferral(token, inviteToken) {
  return apiFetch('/api/users/agent-referral/attach', {
    method: 'POST',
    body: JSON.stringify({ inviteToken }),
  }, token);
}

export async function getMe(token) {
  return apiFetch('/api/users/me', {}, token);
}

export async function updateMe(token, payload) {
  return apiFetch('/api/users/me', { method: 'PATCH', body: JSON.stringify(payload) }, token);
}

export async function deleteMe(token) {
  return apiFetch('/api/users/me', { method: 'DELETE', body: JSON.stringify({}) }, token);
}

export async function saveUserPushToken(token, pushToken) {
  return apiFetch(
    '/api/users/push-token',
    {
      method: 'POST',
      body: JSON.stringify({ pushToken }),
    },
    token,
  );
}

export async function getDriverMe(token) {
  return apiFetch('/api/drivers/me', {}, token);
}

export async function saveDriverPushToken(token, pushToken) {
  return apiFetch(
    '/api/drivers/push-token',
    {
      method: 'POST',
      body: JSON.stringify({ pushToken }),
    },
    token,
  );
}

export async function getDriverRideRequests(token) {
  return apiFetch('/api/drivers/ride-requests', {}, token);
}

export async function getDriverRideHistory(token, options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/api/drivers/history${suffix}`, {}, token);
}

export async function getDriverCurrentRide(token, options = {}) {
  return apiFetch('/api/drivers/current-ride', {
    suppressAuthErrorHandler: Boolean(options?.suppressAuthErrorHandler),
  }, token);
}

export async function markDriverCurrentRideArrived(token, rideRequestId, options = {}) {
  return apiFetch(`/api/drivers/current-ride/${rideRequestId}/arrived`, {
    method: 'PATCH',
    body: JSON.stringify({}),
    suppressAuthErrorHandler: Boolean(options?.suppressAuthErrorHandler),
  }, token);
}

export async function startDriverCurrentRide(token, rideRequestId, options = {}) {
  return apiFetch(`/api/drivers/current-ride/${rideRequestId}/start`, {
    method: 'PATCH',
    body: JSON.stringify({}),
    suppressAuthErrorHandler: Boolean(options?.suppressAuthErrorHandler),
  }, token);
}

export async function completeDriverCurrentRide(token, rideRequestId, payload = {}, options = {}) {
  return apiFetch(`/api/drivers/current-ride/${rideRequestId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    suppressAuthErrorHandler: Boolean(options?.suppressAuthErrorHandler),
  }, token);
}

export async function cancelDriverCurrentRide(token, rideRequestId, reason) {
  return apiFetch(`/api/drivers/current-ride/${rideRequestId}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ reason: reason || 'Driver cancelled' }),
  }, token);
}

export async function acceptDriverRideRequest(token, rideRequestId) {
  return apiFetch(`/api/drivers/ride-requests/${rideRequestId}/accept`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token);
}

export async function getPassengerRideOptions(token) {
  return apiFetch('/api/passengers/ride-options', {}, token);
}

export async function submitPassengerIdentity(token, payload) {
  return apiFetch('/api/passengers/identity', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function getNearbyPassengerDrivers(token, { latitude, longitude, radiusKm = 8 }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    radiusKm: String(radiusKm),
  });
  return apiFetch(`/api/passengers/nearby-drivers?${params.toString()}`, {}, token);
}

export async function getPassengerRideHistory(token, options = {}) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiFetch(`/api/rides/passenger/history${suffix}`, {}, token);
}

export async function getPassengerRideDetails(token, rideRequestId) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/details`, {}, token);
}

export async function getPassengerRideReceipt(token, rideRequestId) {
  const url = getApiUrl(`/api/rides/passenger/${rideRequestId}/receipt`);
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(text || getFriendlyApiErrorMessage(res.status, 'Could not download receipt.'));
    err.status = res.status;
    throw err;
  }
  return text;
}

export async function reportLostItem(token, rideRequestId, payload) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/lost-items`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function submitPassengerDriverRating(token, rideRequestId, payload) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/rate-driver`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function findNearbyDrivers(token, payload) {
  return apiFetch('/api/rides/passenger/find-driver', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function selectRideDriver(token, rideRequestId, driverUserId) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/select-driver`, {
    method: 'PATCH',
    body: JSON.stringify({ driverUserId }),
  }, token);
}

export async function getPassengerRideRequestStatus(token, rideRequestId) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/status`, {}, token);
}

export async function getPassengerCurrentRide(token) {
  return apiFetch('/api/rides/passenger/current-ride', {}, token);
}

export async function getRideMessages(token, rideRequestId) {
  return apiFetch(`/api/rides/${rideRequestId}/messages`, {}, token);
}

export async function sendRideMessage(token, rideRequestId, message) {
  return apiFetch(`/api/rides/${rideRequestId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  }, token);
}

export async function getSupportThread(token) {
  return apiFetch('/api/users/support/thread', {}, token);
}

export async function getSupportMessages(token) {
  return apiFetch('/api/users/support/messages', {}, token);
}

export async function sendSupportMessage(token, message) {
  return apiFetch('/api/users/support/messages', {
    method: 'POST',
    body: JSON.stringify({ message }),
  }, token);
}

export async function cancelRideRequest(token, rideRequestId, reason) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ reason: reason || 'Passenger cancelled' }),
  }, token);
}

export async function submitDriverPassengerRating(token, rideRequestId, payload) {
  return apiFetch(`/api/drivers/ride-requests/${rideRequestId}/rate-passenger`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function markRideArrived(token, rideRequestId) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/arrived`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token);
}

export async function completeRideRequest(token, rideRequestId) {
  return apiFetch(`/api/rides/passenger/${rideRequestId}/complete`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token);
}

export async function getDriverVehicleOptions(token) {
  return apiFetch('/api/drivers/vehicle-options', {}, token);
}

export async function updateDriverAvailability(token, payload) {
  return apiFetch('/api/drivers/availability', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function submitDriverDocuments(token, payload) {
  return apiFetch('/api/drivers/documents', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function submitVehicle(token, payload) {
  return apiFetch('/api/drivers/vehicle', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function confirmPhoneVerification(token, phoneNumber) {
  return apiFetch('/api/verify-phone/confirm', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  }, token);
}

export async function uploadFile(token, formData) {
  const url = getApiUrl('/api/upload');
  const headers = { Authorization: `Bearer ${token}` };
  let res;
  let data = {};
  try {
    res = await fetch(url, { method: 'POST', headers, body: formData });
    data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
  } catch (error) {
    const err = new Error('Upload failed because the network connection was interrupted. Please try again.');
    err.status = 0;
    err.cause = error;
    throw err;
  }
  if (!res.ok) {
    let message = getFriendlyApiErrorMessage(res.status, data?.error);
    if (res.status === 401) {
      if (authErrorHandler) {
        try {
          authErrorHandler();
        } catch {
          // ignore handler errors
        }
      }
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

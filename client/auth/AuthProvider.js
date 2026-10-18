import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { apiFetch } from '../api';

const SESSION_STORAGE_KEY = 'trust_auth_session_v1';
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

const AuthContext = createContext(null);

async function readStoredSession() {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}

async function writeStoredSession(session) {
  if (!session) {
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session)).catch(() => {});
}

function toSession(result, previousUser = null) {
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: Date.now() + Number(result.accessTokenExpiresIn || 3600) * 1000,
    user: result.user || previousUser || null,
  };
}

/** Device details sent with every sign-in so sessions can be told apart. */
export function getDeviceInfo() {
  return {
    deviceName: Device.modelName || Device.deviceName || null,
    platform: Platform.OS,
  };
}

export function AuthProvider({ children }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [session, setSessionState] = useState(null);
  const sessionRef = useRef(null);
  const refreshPromiseRef = useRef(null);

  const setSession = useCallback(async (next) => {
    sessionRef.current = next;
    setSessionState(next);
    await writeStoredSession(next);
  }, []);

  const clearLocalSession = useCallback(async () => {
    refreshPromiseRef.current = null;
    await setSession(null);
  }, [setSession]);

  const refreshAccessToken = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const current = sessionRef.current;
    if (!current?.refreshToken) return Promise.resolve(null);

    refreshPromiseRef.current = apiFetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: current.refreshToken }),
      suppressAuthErrorHandler: true,
    })
      .then(async (result) => {
        if (sessionRef.current?.refreshToken !== current.refreshToken) return sessionRef.current?.accessToken || null;
        const next = toSession(result, current.user);
        await setSession(next);
        return next.accessToken;
      })
      .catch(async (error) => {
        // Only a definite "session ended" answer signs the user out; network and server errors keep them signed in.
        if (error?.status === 401 && sessionRef.current?.refreshToken === current.refreshToken) {
          await clearLocalSession();
          return null;
        }
        return current.accessToken || null;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });
    return refreshPromiseRef.current;
  }, [clearLocalSession, setSession]);

  const getToken = useCallback(async (options = {}) => {
    const current = sessionRef.current;
    if (!current?.refreshToken) return null;
    const fresh = current.accessToken
      && Number(current.accessTokenExpiresAt) - ACCESS_TOKEN_REFRESH_MARGIN_MS > Date.now();
    if (fresh && !options?.skipCache) return current.accessToken;
    return refreshAccessToken();
  }, [refreshAccessToken]);

  const reloadUser = useCallback(async () => {
    const token = await getToken();
    if (!token) return null;
    const data = await apiFetch('/api/auth/me', { suppressAuthErrorHandler: true }, token);
    const current = sessionRef.current;
    if (data?.user && current) await setSession({ ...current, user: data.user });
    return data?.user || null;
  }, [getToken, setSession]);

  /** Call with the response of any sign-in endpoint that returned status "signed_in". */
  const completeSignIn = useCallback(async (result) => {
    if (!result?.accessToken || !result?.refreshToken) throw new Error('Sign-in did not return a session');
    await setSession(toSession(result));
  }, [setSession]);

  const signOut = useCallback(async () => {
    const refreshToken = sessionRef.current?.refreshToken;
    await clearLocalSession();
    if (refreshToken) {
      apiFetch('/api/auth/sign-out', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        suppressAuthErrorHandler: true,
      }).catch(() => {});
    }
  }, [clearLocalSession]);

  useEffect(() => {
    let cancelled = false;
    readStoredSession().then((stored) => {
      if (cancelled) return;
      sessionRef.current = stored;
      setSessionState(stored);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const userId = session?.user?.id || null;
  useEffect(() => {
    if (userId) reloadUser().catch(() => {});
  }, [reloadUser, userId]);

  const value = useMemo(() => ({
    isLoaded,
    isSignedIn: Boolean(session?.refreshToken),
    userId,
    rawUser: session?.user || null,
    getToken,
    signOut,
    completeSignIn,
    reloadUser,
  }), [completeSignIn, getToken, isLoaded, reloadUser, session, signOut, userId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Auth hooks must be used inside <AuthProvider>');
  return context;
}

export function useAuth() {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuthContext();
  return { isLoaded, isSignedIn, userId, getToken, signOut };
}

export function useSignIn() {
  const { completeSignIn } = useAuthContext();
  return { completeSignIn };
}

export function useClerk() {
  const { signOut } = useAuthContext();
  return { signOut };
}

export function useUser() {
  const { isLoaded, rawUser, getToken, reloadUser } = useAuthContext();

  const user = useMemo(() => {
    if (!rawUser) return null;
    return {
      id: rawUser.id,
      firstName: rawUser.firstName || null,
      lastName: rawUser.lastName || null,
      fullName: [rawUser.firstName, rawUser.lastName].filter(Boolean).join(' ') || null,
      imageUrl: rawUser.imageUrl || null,
      primaryEmailAddress: rawUser.email ? { emailAddress: rawUser.email, verified: rawUser.emailVerified } : null,
      primaryPhoneNumber: rawUser.phoneNumber ? { phoneNumber: rawUser.phoneNumber, verified: rawUser.phoneVerified } : null,
      passwordEnabled: Boolean(rawUser.hasPassword),
      role: rawUser.role,
      update: async ({ firstName, lastName } = {}) => {
        const token = await getToken();
        await apiFetch('/api/users/me', { method: 'PATCH', body: JSON.stringify({ firstName, lastName }) }, token);
        return reloadUser();
      },
      reload: reloadUser,
    };
  }, [getToken, rawUser, reloadUser]);

  return { isLoaded, isSignedIn: Boolean(user), user };
}

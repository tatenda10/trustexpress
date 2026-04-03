import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveAgentInvite } from '../api';

const STORAGE_KEY = 'trust_agent_invite';
const AgentInviteContext = createContext(null);

async function readStoredInvite() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AgentInviteProvider({ children }) {
  const [inviteToken, setInviteToken] = useState('');
  const [inviteData, setInviteData] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [attachedUserId, setAttachedUserId] = useState('');

  const hydrateStoredInvite = useCallback(async () => {
    const stored = await readStoredInvite();
    if (!stored?.token) return null;

    setInviteToken(stored.token);
    setAttachedUserId(String(stored.attachedUserId || stored.attachedDriverUserId || ''));
    if (stored.invite) {
      setInviteData(stored.invite);
      return stored;
    }

    try {
      const data = await resolveAgentInvite(stored.token);
      const payload = {
        token: stored.token,
        invite: data?.invite || null,
        attachedUserId: stored.attachedUserId || stored.attachedDriverUserId || '',
      };
      setInviteData(payload.invite);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return payload;
    } catch {
      return stored;
    }
  }, []);

  const setInviteFromToken = useCallback(async (token) => {
    const nextToken = String(token || '').trim();
    if (!nextToken) return null;

    setLoadingInvite(true);
    try {
      const data = await resolveAgentInvite(nextToken);
      const payload = {
        token: nextToken,
        invite: data?.invite || null,
        attachedUserId: '',
      };
      setInviteToken(nextToken);
      setInviteData(payload.invite);
      setAttachedUserId('');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return payload;
    } finally {
      setLoadingInvite(false);
    }
  }, []);

  const markInviteAttached = useCallback(async (userId) => {
    const nextUserId = String(userId || '').trim();
    if (!inviteToken || !nextUserId) return;

    const payload = {
      token: inviteToken,
      invite: inviteData,
      attachedUserId: nextUserId,
    };
    setAttachedUserId(nextUserId);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [inviteToken, inviteData]);

  const clearInvite = useCallback(async () => {
    setInviteToken('');
    setInviteData(null);
    setAttachedUserId('');
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(() => ({
    inviteToken,
    inviteData,
    loadingInvite,
    hasInvite: !!inviteToken,
    attachedUserId,
    setInviteFromToken,
    hydrateStoredInvite,
    markInviteAttached,
    clearInvite,
  }), [inviteToken, inviteData, loadingInvite, attachedUserId, setInviteFromToken, hydrateStoredInvite, markInviteAttached, clearInvite]);

  return (
    <AgentInviteContext.Provider value={value}>
      {children}
    </AgentInviteContext.Provider>
  );
}

export function useAgentInvite() {
  const context = useContext(AgentInviteContext);
  if (!context) {
    throw new Error('useAgentInvite must be used inside AgentInviteProvider');
  }
  return context;
}

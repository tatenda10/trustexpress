import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROCESSED_INSTALL_REFERRER_KEY = 'trust_agent_processed_install_referrer';

function parseInstallReferrerValue(rawReferrer) {
  const raw = String(rawReferrer || '').trim();
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const inviteToken = String(params.get('invite') || '').trim();
  const target = String(params.get('target') || '').trim().toLowerCase();
  if (!inviteToken) return null;

  return {
    raw,
    inviteToken,
    target: target === 'passenger' ? 'passenger' : 'driver',
  };
}

function getInstallReferrerInfoAsync(PlayInstallReferrer) {
  return new Promise((resolve, reject) => {
    try {
      PlayInstallReferrer.getInstallReferrerInfo((installReferrerInfo, error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(installReferrerInfo || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function restoreAgentInviteFromAndroidInstallReferrer({ setInviteFromToken }) {
  if (Platform.OS !== 'android' || typeof setInviteFromToken !== 'function') {
    return null;
  }

  let moduleExports;
  try {
    moduleExports = await import('react-native-play-install-referrer');
  } catch {
    return null;
  }

  const PlayInstallReferrer =
    moduleExports?.PlayInstallReferrer ||
    moduleExports?.default?.PlayInstallReferrer ||
    moduleExports?.default;

  if (!PlayInstallReferrer?.getInstallReferrerInfo) {
    return null;
  }

  try {
    const installReferrerInfo = await getInstallReferrerInfoAsync(PlayInstallReferrer);
    const parsed = parseInstallReferrerValue(installReferrerInfo?.installReferrer);
    if (!parsed?.inviteToken) {
      return null;
    }

    const processedRaw = String((await AsyncStorage.getItem(PROCESSED_INSTALL_REFERRER_KEY)) || '').trim();
    if (processedRaw && processedRaw === parsed.raw) {
      return {
        inviteToken: parsed.inviteToken,
        target: parsed.target,
        alreadyProcessed: true,
      };
    }

    await setInviteFromToken(parsed.inviteToken);
    await AsyncStorage.setItem(PROCESSED_INSTALL_REFERRER_KEY, parsed.raw);

    return {
      inviteToken: parsed.inviteToken,
      target: parsed.target,
      alreadyProcessed: false,
    };
  } catch (error) {
    console.log('[agent-referrer] Could not restore install referrer', {
      message: error?.message || null,
      responseCode: error?.responseCode ?? null,
    });
    return null;
  }
}

import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';

const SUPPORT_EMAIL = 'support@trustexpress.co.za';

function formatReturnTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TrafficLightIllustration() {
  return (
    <View className="mt-12 h-72 w-full items-center justify-center">
      <View className="absolute h-48 w-48 rotate-45 bg-red-100" />
      <View className="absolute h-44 w-44 -rotate-45 bg-red-100/80" />
      <View className="absolute left-12 top-24 h-10 w-16 border-l-2 border-t-2 border-black" />
      <View className="absolute right-14 top-20 h-12 w-16 border-r-2 border-t-2 border-black" />
      <View className="absolute bottom-16 left-16 h-12 w-16 border-l-2 border-t-2 border-black" />
      <View className="absolute bottom-24 right-10 h-10 w-16 border-r-2 border-t-2 border-black" />
      <View className="h-44 w-20 items-center rounded-sm border-[3px] border-black bg-white">
        <View className="mt-4 h-14 w-14 rounded-full border-[3px] border-black bg-red-500" />
        <View className="mt-2 h-14 w-14 rounded-full border-[3px] border-black bg-white" />
        <View className="mt-2 h-14 w-14 rounded-full border-[3px] border-black bg-white" />
      </View>
      <View className="h-24 w-[3px] bg-black" />
    </View>
  );
}

export default function BlockedAccountScreen({ route }) {
  const { signOut } = useAuth();
  const params = route?.params || {};
  const restriction = params.restriction || {};
  const reasonParam = String(params.reason || '').trim().toLowerCase();
  const isFlagged = reasonParam === 'flagged';
  const restrictionReason = String(restriction.reason || params.message || '').trim();
  const returnTime = formatReturnTime(restriction.expiresAt);
  const title = isFlagged ? 'Your account is restricted' : 'Your account is blocked';
  const reason = restrictionReason
    .replace(/\s*Restricted:\s.*$/i, '')
    .replace(/\s*Contact support.*$/i, '')
    .trim()
    || 'Violation of Trust Express rules.';
  const supportBody = encodeURIComponent([
    'Hello Trust Express Support,',
    '',
    'I would like to request a review of my account restriction.',
    restriction.scope ? `Restricted action: ${restriction.scope}` : null,
    restriction.expiresAt ? `Restriction expires: ${restriction.expiresAt}` : 'Restriction type: Permanent or admin review required',
    '',
    'Thank you.',
  ].filter(Boolean).join('\n'));

  const contactSupport = async () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=Account restriction review&body=${supportBody}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch {
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-8 pt-10">
        <Text className="text-center text-3xl font-black tracking-[3px] text-[#08316f]">
          TRUST EXPRESS
        </Text>

        <TrafficLightIllustration />

        <View className="mt-8">
          <Text className="text-[34px] font-black leading-tight text-black">
            {title}
          </Text>
          <View className="mt-8">
            <Text className="text-2xl text-black">Reason:</Text>
            <Text className="mt-2 text-2xl leading-8 text-black">{reason}</Text>
          </View>

          {returnTime ? (
            <View className="mt-6 rounded-2xl bg-blue-50 px-4 py-3">
              <Text className="text-base font-semibold text-[#0d4ea6]">Access returns</Text>
              <Text className="mt-1 text-base text-[#0d4ea6]">{returnTime}</Text>
            </View>
          ) : null}

          {restriction.scope ? (
            <Text className="mt-5 text-base text-gray-500">
              Restricted action: {restriction.scopeLabel || restriction.scope}
            </Text>
          ) : null}

          <Pressable
            onPress={contactSupport}
            className="mt-10 h-16 items-center justify-center rounded-xl bg-[#0d4ea6]"
          >
            <Text className="text-2xl font-bold text-white">Contact support</Text>
          </Pressable>

          <Text className="mt-8 text-lg leading-7 text-gray-500">
            Contact support to request a review.
          </Text>

          <Pressable
            onPress={() => signOut().catch(() => {})}
            className="mt-8 self-start"
          >
            <Text className="text-sm font-semibold text-gray-400">Sign out</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

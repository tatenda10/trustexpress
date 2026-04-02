import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { connectRealtime } from '../../realtime';
import { getRideMessages, sendRideMessage } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const CHAT_REFRESH_MS = 5000;

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MessageBubble({ item, isMine }) {
  return (
    <View className={`mb-3 ${isMine ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[82%] rounded-2xl px-4 py-3 ${isMine ? 'rounded-br-md' : 'rounded-bl-md'}`}
        style={{ backgroundColor: isMine ? PRIMARY_BLUE : '#f3f4f6' }}
      >
        <Text style={{ color: isMine ? '#fff' : '#111827', fontSize: 15, lineHeight: 21 }}>
          {item.message}
        </Text>
      </View>
      <Text className="mt-1 text-[11px] text-gray-400">{formatTime(item.createdAt)}</Text>
    </View>
  );
}

export default function RideChatScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const { rideRequestId, chatTitle, role = 'passenger' } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const title = chatTitle || (role === 'driver' ? 'Passenger chat' : 'Driver chat');

  const loadMessages = useCallback(async (isRefresh = false) => {
    if (!rideRequestId) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      const token = await getTokenRef.current?.();
      if (!token) throw new Error('Not signed in');
      const data = await getRideMessages(token, rideRequestId);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load chat messages.');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [rideRequestId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!rideRequestId) return undefined;
    const interval = setInterval(() => {
      loadMessages(true);
    }, CHAT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [rideRequestId, loadMessages]);

  useEffect(() => {
    if (!rideRequestId) return undefined;
    let localSocket = null;
    let isMounted = true;

    const subscribe = async () => {
      try {
        const token = await getTokenRef.current?.();
        if (!token || !isMounted) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleMessage = (payload) => {
          if (String(payload?.rideRequestId || '') !== String(rideRequestId)) return;
          loadMessages(true);
        };

        localSocket.on('ride_chat:message', handleMessage);

        return () => {
          localSocket?.off('ride_chat:message', handleMessage);
        };
      } catch {
        return undefined;
      }
    };

    let cleanup = null;
    subscribe().then((dispose) => {
      cleanup = dispose;
    });

    return () => {
      isMounted = false;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [rideRequestId, loadMessages]);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  const handleSend = async () => {
    const message = String(draft || '').trim();
    if (!message || sending || !rideRequestId) return;

    try {
      setSending(true);
      setError('');
      const token = await getTokenRef.current?.();
      if (!token) throw new Error('Not signed in');
      const data = await sendRideMessage(token, rideRequestId, message);
      if (data?.messageRecord) {
        setMessages((prev) => {
          const next = [...prev.filter((item) => String(item.id) !== String(data.messageRecord.id)), data.messageRecord];
          return next;
        });
      } else {
        await loadMessages(true);
      }
      setDraft('');
    } catch (sendError) {
      setError(sendError?.message || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center px-5 py-4 border-b border-gray-100">
          <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <Ionicons name="arrow-back" size={20} color="#111827" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-[18px] font-bold text-gray-900">{title}</Text>
            <Text className="text-sm text-gray-500">Ride messages</Text>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          </View>
        ) : (
          <>
            {!!error && (
              <View className="mx-5 mt-4 rounded-xl bg-red-50 px-4 py-3">
                <Text className="text-sm text-red-700">{error}</Text>
              </View>
            )}

            <FlatList
              data={sortedMessages}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => <MessageBubble item={item} isMine={String(item.senderUserId) === String(user?.id)} />}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, flexGrow: sortedMessages.length ? 0 : 1 }}
              onRefresh={() => loadMessages(true)}
              refreshing={refreshing}
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center py-24">
                  <Ionicons name="chatbubble-ellipses-outline" size={36} color="#9ca3af" />
                  <Text className="mt-4 text-lg font-semibold text-gray-900">No messages yet</Text>
                  <Text className="mt-2 px-8 text-center text-sm leading-6 text-gray-500">
                    Send a message here if you need to coordinate pickup or dropoff.
                  </Text>
                </View>
              }
            />

            <View
              className="border-t border-gray-100 px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom + 10, 16) }}
            >
              <View className="flex-row items-end rounded-2xl border border-gray-200 bg-white px-3 py-2">
                <TextInput
                  className="flex-1 px-2 py-2 text-[15px] text-gray-900"
                  placeholder="Type a message"
                  placeholderTextColor="#9ca3af"
                  multiline
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={1000}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={sending || !String(draft || '').trim()}
                  className="ml-2 h-11 w-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: sending || !String(draft || '').trim() ? '#93c5fd' : PRIMARY_BLUE }}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send" size={18} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

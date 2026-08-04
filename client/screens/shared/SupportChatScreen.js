import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Image,
  Alert,
  ActionSheetIOS,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { connectRealtime } from '../../realtime';
import {
  getSupportMessages,
  sendSupportMessage,
  uploadFile,
  resolveUploadedMediaUrl,
} from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

const CHAT_REFRESH_MS = 5000;

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MessageBubble({ item, isMine }) {
  const bubbleBackgroundColor = isMine ? PRIMARY_BLUE : '#eff6ff';
  const textColor = isMine ? '#fff' : '#1e3a8a';
  const attachmentUri = resolveUploadedMediaUrl(item.attachmentUrl);
  return (
    <View className={`mb-3 ${isMine ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[82%] overflow-hidden rounded-2xl ${isMine ? 'rounded-br-md' : 'rounded-bl-md'}`}
        style={{ backgroundColor: bubbleBackgroundColor }}
      >
        {attachmentUri ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => Linking.openURL(attachmentUri).catch(() => {})}
          >
            <Image
              source={{ uri: attachmentUri }}
              style={{ width: 220, height: 220, backgroundColor: isMine ? '#1d4ed8' : '#dbeafe' }}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ) : null}
        {item.message ? (
          <View className="px-4 py-3">
            <Text style={{ color: textColor, fontSize: 17, lineHeight: 24 }}>
              {item.message}
            </Text>
          </View>
        ) : null}
        {!item.message && attachmentUri ? (
          <View className="px-3 py-2">
            <Text style={{ color: textColor, fontSize: 12, opacity: 0.85 }}>Photo</Text>
          </View>
        ) : null}
      </View>
      {!isMine && item?.isAiReply ? (
        <Text className="mt-1 text-[11px] font-semibold" style={{ color: PRIMARY_BLUE }}>Support assistant</Text>
      ) : null}
      <Text className="mt-1 text-[11px] text-gray-400">{formatTime(item.createdAt)}</Text>
    </View>
  );
}

export default function SupportChatScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();
  const getTokenRef = useRef(getToken);
  const { role = 'passenger' } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [threadId, setThreadId] = useState(null);
  const lastIncomingAdminMessageIdRef = useRef(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const getAuthToken = useCallback(async () => {
    const getTokenFn = getTokenRef.current;
    if (!getTokenFn) return null;
    return (await getTokenFn({ skipCache: true })) || (await getTokenFn());
  }, []);

  const loadMessages = useCallback(async ({ showLoader = false, showRefreshing = false } = {}) => {
    try {
      if (showRefreshing) setRefreshing(true);
      if (showLoader) setLoading(true);
      if (showLoader || showRefreshing) setError('');
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const data = await getSupportMessages(token);
      setThreadId(data?.thread?.id || null);
      const incomingMessages = Array.isArray(data?.messages) ? data.messages : [];
      const latestAdminMessage = [...incomingMessages]
        .reverse()
        .find((item) => item?.senderType === 'admin');

      if (
        latestAdminMessage?.id &&
        lastIncomingAdminMessageIdRef.current &&
        String(latestAdminMessage.id) !== String(lastIncomingAdminMessageIdRef.current)
      ) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Support replied',
            body: String(
              latestAdminMessage.message
              || (latestAdminMessage.attachmentUrl ? 'Support sent a photo.' : 'Support sent a new message.')
            ).slice(0, 140),
            sound: 'default',
            data: {
              type: 'support_chat',
              threadId: data?.thread?.id || threadId || null,
            },
          },
          trigger: null,
        }).catch(() => {});
      }
      if (latestAdminMessage?.id) {
        lastIncomingAdminMessageIdRef.current = latestAdminMessage.id;
      }

      setMessages((prevMessages) => {
        const isSame =
          prevMessages.length === incomingMessages.length &&
          prevMessages.every((prevItem, index) => {
            const nextItem = incomingMessages[index];
            if (!nextItem) return false;
            return (
              String(prevItem?.id ?? '') === String(nextItem?.id ?? '') &&
              String(prevItem?.updatedAt ?? prevItem?.createdAt ?? '') ===
                String(nextItem?.updatedAt ?? nextItem?.createdAt ?? '')
            );
          });
        return isSame ? prevMessages : incomingMessages;
      });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load support messages.');
    } finally {
      if (showRefreshing) setRefreshing(false);
      if (showLoader) setLoading(false);
    }
  }, [getAuthToken, threadId]);

  useEffect(() => {
    loadMessages({ showLoader: true });
  }, [loadMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadMessages();
    }, CHAT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    let localSocket = null;
    let isMounted = true;

    const subscribe = async () => {
      try {
        const token = await getAuthToken();
        if (!token || !isMounted) return;
        localSocket = connectRealtime(token);
        if (!localSocket) return;

        const handleMessage = (payload) => {
          if (threadId && String(payload?.threadId || '') !== String(threadId)) return;
          loadMessages();
        };

        localSocket.on('support_chat:message', handleMessage);

        return () => {
          localSocket?.off('support_chat:message', handleMessage);
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
  }, [getAuthToken, threadId, loadMessages]);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  const postMessage = async ({ message = '', attachmentUrl = null } = {}) => {
    const token = await getAuthToken();
    if (!token) throw new Error('Not signed in');
    const data = await sendSupportMessage(token, { message, attachmentUrl });
    if (data?.thread?.id) setThreadId(data.thread.id);
    if (data?.messageRecord) {
      setMessages((prev) => [...prev.filter((item) => String(item.id) !== String(data.messageRecord.id)), data.messageRecord]);
    } else {
      await loadMessages();
    }
    if (data?.aiReplyRecord) {
      setMessages((prev) => [...prev.filter((item) => String(item.id) !== String(data.aiReplyRecord.id)), data.aiReplyRecord]);
      if (data?.aiReplyRecord?.id) {
        lastIncomingAdminMessageIdRef.current = data.aiReplyRecord.id;
      }
    }
  };

  const handleSend = async () => {
    const message = String(draft || '').trim();
    if (!message || sending) return;

    try {
      setSending(true);
      setError('');
      await postMessage({ message });
      setDraft('');
    } catch (sendError) {
      setError(sendError?.message || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const uploadAndSendPhoto = async (asset) => {
    if (!asset?.uri || sending) return;
    try {
      setSending(true);
      setError('');
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');

      const formData = new FormData();
      const name = asset.fileName || `support-${Date.now()}.jpg`;
      formData.append('file', {
        uri: asset.uri,
        name,
        type: asset.mimeType || 'image/jpeg',
      });

      const uploaded = await uploadFile(token, formData);
      const attachmentUrl = uploaded?.url || uploaded?.path || null;
      if (!attachmentUrl) throw new Error('Photo upload failed.');

      const caption = String(draft || '').trim();
      await postMessage({
        message: caption || 'Photo for verification / account recovery',
        attachmentUrl,
      });
      setDraft('');
    } catch (sendError) {
      setError(sendError?.message || 'Could not send photo.');
    } finally {
      setSending(false);
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send verification photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndSendPhoto(result.assets[0]);
    }
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to send verification photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndSendPhoto(result.assets[0]);
    }
  };

  const handleAttachPhoto = () => {
    if (sending) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take photo', 'Choose from library'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickFromCamera();
          if (buttonIndex === 2) pickFromLibrary();
        }
      );
      return;
    }
    Alert.alert('Send photo', 'For account recovery, send a clear photo of your ID or selfie.', [
      { text: 'Camera', onPress: pickFromCamera },
      { text: 'Gallery', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const canSendText = Boolean(String(draft || '').trim()) && !sending;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-white">
      <View className="flex-row items-center px-5 py-4 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-[18px] font-bold text-gray-900">Support chat</Text>
          <Text className="text-sm text-gray-500">
            {role === 'driver' ? 'Driver support' : 'Passenger support'} · photos OK for recovery
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={PRIMARY_BLUE} />
          </View>
        ) : (
          <View className="flex-1">
          {!!error && (
            <View className="mx-5 mt-4 rounded-xl bg-red-50 px-4 py-3">
              <Text className="text-sm text-red-700">{error}</Text>
            </View>
          )}

          <FlatList
            style={{ flex: 1 }}
            data={sortedMessages}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <MessageBubble
                item={item}
                isMine={String(item.senderUserId) === String(user?.id) && item.senderType !== 'admin'}
              />
            )}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(insets.bottom + 104, 132),
              flexGrow: sortedMessages.length ? 0 : 1,
            }}
            onRefresh={() => loadMessages({ showRefreshing: true })}
            refreshing={refreshing}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-24">
                <Ionicons name="headset-outline" size={36} color="#9ca3af" />
                <Text className="mt-4 text-lg font-semibold text-gray-900">Start a support chat</Text>
                <Text className="mt-2 px-8 text-center text-sm leading-6 text-gray-500">
                  Message support or attach a photo (ID / selfie) for account recovery verification.
                </Text>
              </View>
            }
          />

          <View
            className="border-t border-gray-100 bg-white px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 10) }}
          >
            <View className="flex-row items-end rounded-[26px] border border-blue-100 bg-[#eff6ff] px-2 py-2">
              <TouchableOpacity
                onPress={handleAttachPhoto}
                disabled={sending}
                className="mb-1 h-11 w-11 items-center justify-center rounded-full"
                accessibilityLabel="Attach photo"
              >
                <Ionicons name="image-outline" size={22} color={sending ? '#93c5fd' : PRIMARY_BLUE} />
              </TouchableOpacity>
              <TextInput
                className="flex-1 px-2 py-3 text-[15px] text-gray-900"
                placeholder="Message or caption for photo"
                placeholderTextColor="#9ca3af"
                multiline
                value={draft}
                onChangeText={setDraft}
                maxLength={1000}
                textAlignVertical="top"
                style={{ minHeight: 48, maxHeight: 120 }}
              />
              <TouchableOpacity
                onPress={handleSend}
                disabled={!canSendText}
                className="mb-1 ml-1 h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: canSendText ? PRIMARY_BLUE : '#93c5fd' }}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

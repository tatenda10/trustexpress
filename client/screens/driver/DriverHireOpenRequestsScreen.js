import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createHireQuote, listHireVehicles, listOpenHireRequests } from '../../api';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function DriverHireOpenRequestsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requests, setRequests] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [vehicleId, setVehicleId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const token = await getToken({ skipCache: true });
      const [openData, vehicleData] = await Promise.all([
        listOpenHireRequests(token),
        listHireVehicles(token),
      ]);
      setRequests(Array.isArray(openData?.requests) ? openData.requests : []);
      const approved = (vehicleData?.vehicles || []).filter((item) => item.status === 'approved');
      setVehicles(approved);
      if (approved[0] && !vehicleId) setVehicleId(approved[0].id);
    } catch (err) {
      Alert.alert('Hire requests', err?.message || 'Could not load open hire requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken, vehicleId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitQuote = async () => {
    try {
      if (!selected?.id) return;
      if (!vehicleId) {
        Alert.alert('Vehicle required', 'Add and get an approved hire vehicle first.');
        return;
      }
      const quoteAmount = Number(amount);
      if (!(quoteAmount > 0)) {
        Alert.alert('Amount required', 'Enter a valid quote amount.');
        return;
      }
      setSubmitting(true);
      const token = await getToken({ skipCache: true });
      await createHireQuote(token, selected.id, {
        hireVehicleId: vehicleId,
        amount: quoteAmount,
        currency: 'USD',
        message: message.trim() || undefined,
      });
      setSelected(null);
      setAmount('');
      setMessage('');
      Alert.alert('Quote sent', 'Your hire quote was submitted.');
      load(true);
    } catch (err) {
      Alert.alert('Quote failed', err?.message || 'Could not submit quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-[#f6f7f3]">
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 14 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="text-[18px] font-bold text-gray-900">Hire jobs</Text>
        <View className="h-10 w-10" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={PRIMARY_BLUE} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={PRIMARY_BLUE}
            />
          )}
          ListEmptyComponent={(
            <View className="mt-10 rounded-[24px] bg-white px-5 py-8 items-center">
              <Text className="text-base font-semibold text-gray-900">No open hire requests</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                When passengers request hire, they will appear here for quoting.
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelected(item)}
              className="mb-3 rounded-[24px] bg-white px-4 py-4"
              activeOpacity={0.85}
            >
              <Text className="text-[15px] font-bold text-gray-900">{item.pickupLabel}</Text>
              {item.dropoffLabel ? (
                <Text className="mt-1 text-sm text-gray-500">To {item.dropoffLabel}</Text>
              ) : null}
              <Text className="mt-2 text-xs text-gray-500">
                {item.startAt ? new Date(item.startAt).toLocaleString() : 'Time TBD'}
                {' · '}
                {item.passengerCount} pax
                {item.quoteCount != null ? ` · ${item.quoteCount} quotes` : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[28px] bg-white px-5 pb-8 pt-5">
            <Text className="text-lg font-bold text-gray-900">Send quote</Text>
            <Text className="mt-1 text-sm text-gray-500">{selected?.pickupLabel}</Text>

            <Text className="mb-2 mt-4 text-xs font-semibold uppercase text-gray-500">Vehicle</Text>
            {vehicles.length === 0 ? (
              <Text className="text-sm text-rose-600">You need an approved hire vehicle first.</Text>
            ) : (
              vehicles.map((vehicle) => (
                <TouchableOpacity
                  key={vehicle.id}
                  onPress={() => setVehicleId(vehicle.id)}
                  className="mb-2 rounded-2xl border px-3 py-3"
                  style={{ borderColor: vehicleId === vehicle.id ? PRIMARY_BLUE : '#e2e8f0' }}
                >
                  <Text className="font-semibold text-gray-900">{vehicle.title}</Text>
                </TouchableOpacity>
              ))
            )}

            <Text className="mb-2 mt-2 text-xs font-semibold uppercase text-gray-500">Amount (USD)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="120"
              className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-base"
            />
            <Text className="mb-2 mt-3 text-xs font-semibold uppercase text-gray-500">Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Optional note"
              className="h-12 rounded-2xl border border-gray-200 bg-slate-50 px-4 text-base"
            />

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                onPress={() => setSelected(null)}
                className="h-12 flex-1 items-center justify-center rounded-2xl bg-slate-100"
              >
                <Text className="font-semibold text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitQuote}
                disabled={submitting}
                className="h-12 flex-1 items-center justify-center rounded-2xl"
                style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : (
                  <Text className="font-semibold text-white">Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

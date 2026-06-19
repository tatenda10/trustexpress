import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPassengerRideDetails, reportLostItem, submitPassengerDriverRating, tipDriver } from '../../api';
import { downloadReceiptPdf, printReceiptPdf } from '../../services/receiptPrint';
import { PRIMARY_BLUE } from '../../constants/colors';
import { PASSENGER_DRIVER_RATING_TAGS, isPassengerDriverReviewTagSelected, togglePassengerDriverReviewTag } from '../../constants/rideRatingTags';

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getFareBreakdown(ride) {
  const originalFare = Number(ride?.originalEstimatedAmount ?? ride?.estimatedAmount ?? 0);
  const discountAmount = Number(ride?.discountAmount || 0);
  const fareAfterDiscount = Number(ride?.finalEstimatedAmount ?? ride?.estimatedAmount ?? 0);
  const tipAmount = Number(ride?.tipAmount || 0);
  const totalAmount = Number(ride?.totalAmount ?? (fareAfterDiscount + tipAmount) ?? 0);
  return { originalFare, discountAmount, fareAfterDiscount, tipAmount, totalAmount };
}

export default function PassengerRideDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const rideRequestId = route.params?.rideRequestId;
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [submittingLostItem, setSubmittingLostItem] = useState(false);
  const [submittingTip, setSubmittingTip] = useState(false);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [lostItemDescription, setLostItemDescription] = useState('');
  const [lostItemContactPhone, setLostItemContactPhone] = useState('');
  const tipOptions = [1, 2, 5, 10];

  useEffect(() => {
    let active = true;

    const loadRide = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getPassengerRideDetails(token, rideRequestId);
        if (!active) return;
        setRide(data?.ride || null);
        setRating(Number(data?.ride?.passengerDriverRating || 0));
        setReview(String(data?.ride?.passengerDriverReview || ''));
      } catch (error) {
        if (!active) return;
        Alert.alert('Ride details unavailable', error?.message || 'Could not load this ride.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRide();
    return () => {
      active = false;
    };
  }, [getToken, rideRequestId]);

  const handleSubmitRating = async () => {
    try {
      if (!rideRequestId || rating < 1) {
        Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
        return;
      }
      setSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const reviewText = String(review || '').trim();
      await submitPassengerDriverRating(token, rideRequestId, {
        rating,
        review: reviewText,
      });
      setRide((current) => current ? {
        ...current,
        passengerDriverRating: rating,
        passengerDriverReview: reviewText,
        canRateDriver: false,
      } : current);
      Alert.alert('Thanks', 'Your rating was saved.');
    } catch (error) {
      Alert.alert('Rating failed', error?.message || 'Could not save your rating.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadReceipt = async () => {
    try {
      if (!rideRequestId) return;
      setDownloadingReceipt(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const result = await downloadReceiptPdf(token, rideRequestId);
      Alert.alert('Receipt downloaded', `${result.fileName} was saved.`);
    } catch (error) {
      Alert.alert('Receipt download failed', error?.message || 'Could not download your ride receipt.');
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const handlePrintReceipt = async () => {
    try {
      if (!rideRequestId) return;
      setPrintingReceipt(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await printReceiptPdf(token, rideRequestId);
    } catch (error) {
      Alert.alert('Receipt print failed', error?.message || 'Could not print your ride receipt.');
    } finally {
      setPrintingReceipt(false);
    }
  };

  const handleReportLostItem = async () => {
    const itemDescription = String(lostItemDescription || '').trim();
    const contactPhone = String(lostItemContactPhone || '').trim();
    if (!itemDescription) {
      Alert.alert('Missing details', 'Please describe the lost item.');
      return;
    }

    try {
      setSubmittingLostItem(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await reportLostItem(token, rideRequestId, {
        itemDescription,
        contactPhone: contactPhone || undefined,
      });
      setLostItemDescription('');
      setLostItemContactPhone('');
      Alert.alert('Reported', 'Your lost item report has been sent to support.');
    } catch (error) {
      Alert.alert('Report failed', error?.message || 'Could not submit lost item report.');
    } finally {
      setSubmittingLostItem(false);
    }
  };

  const handleSendTip = async (amount) => {
    try {
      if (!rideRequestId) return;
      setSubmittingTip(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await tipDriver(token, rideRequestId, amount);
      setRide((current) => current ? {
        ...current,
        tipAmount: Number(amount),
        totalAmount: Number(current.finalEstimatedAmount ?? current.estimatedAmount ?? 0) + Number(amount),
        canTipDriver: false,
      } : current);
      Alert.alert('Tip sent', `Your $${Number(amount).toFixed(2)} tip was added for ${ride.driverName || 'your driver'}.`);
    } catch (error) {
      Alert.alert('Tip failed', error?.message || 'Could not send your tip right now.');
    } finally {
      setSubmittingTip(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <ActivityIndicator size="large" color={PRIMARY_BLUE} />
        <Text className="mt-4 text-base text-gray-500">Loading ride details...</Text>
      </View>
    );
  }

  if (!ride) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-5">
        <Text className="text-xl font-bold text-gray-900">Ride not found</Text>
      </View>
    );
  }

  const { originalFare, fareAfterDiscount, tipAmount, totalAmount } = getFareBreakdown(ride);

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-100 bg-white px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-[#f3f6fb]">
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-gray-900">Ride Details</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 140, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="rounded-[28px] border border-gray-100 bg-white px-5 py-5">
          <Text className="text-lg font-bold text-gray-900">{ride.pickupLabel}</Text>
          <Text className="mt-1 text-sm text-gray-500">to {ride.dropoffLabel}</Text>
          <Text className="mt-4 text-3xl font-bold text-gray-900">{formatCurrency(totalAmount)}</Text>
          <Text className="mt-1 text-sm text-gray-500">{ride.tierName || 'Ride'}</Text>
          {tipAmount > 0 ? (
            <Text className="mt-2 text-sm font-medium text-green-600">
              Includes {formatCurrency(tipAmount)} tip
            </Text>
          ) : null}

          <View className="mt-5 rounded-[22px] bg-[#f8fafc] px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-gray-500">Ride fare</Text>
              <Text className="text-sm font-semibold text-gray-900">{formatCurrency(fareAfterDiscount || originalFare)}</Text>
            </View>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-sm text-gray-500">Tip</Text>
              <Text className="text-sm font-semibold text-gray-900">{formatCurrency(tipAmount)}</Text>
            </View>
            <View className="mt-3 flex-row items-center justify-between border-t border-gray-200 pt-3">
              <Text className="text-sm font-bold text-gray-900">Passenger total</Text>
              <Text className="text-base font-bold text-gray-900">{formatCurrency(totalAmount)}</Text>
            </View>
          </View>

          <View className="mt-5 border-t border-gray-100 pt-4">
            <Text className="text-sm text-gray-500">Driver</Text>
            <Text className="mt-1 text-base font-bold text-gray-900">{ride.driverName || 'No driver assigned'}</Text>
            <Text className="mt-1 text-sm text-gray-500">{formatDate(ride.completedAt || ride.requestedAt)}</Text>
          </View>

          <View className="mt-5 flex-row items-center justify-between gap-3">
            <TouchableOpacity
              onPress={handleDownloadReceipt}
              disabled={downloadingReceipt}
              className="flex-1 h-12 items-center justify-center rounded-[16px] border border-blue-200 bg-white"
              style={{ opacity: downloadingReceipt ? 0.6 : 1 }}
            >
              {downloadingReceipt ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <Text className="text-sm font-bold uppercase" style={{ color: PRIMARY_BLUE }}>
                  Download receipt
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePrintReceipt}
              disabled={printingReceipt}
              className="flex-1 h-12 items-center justify-center rounded-[16px] bg-[#206EFF]"
              style={{ opacity: printingReceipt ? 0.6 : 1 }}
            >
              {printingReceipt ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-sm font-bold uppercase text-white">
                  Print receipt
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {ride.canRateDriver ? (
          <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Rate Driver</Text>
            <Text className="mt-2 text-sm text-gray-500">How was your trip with {ride.driverName || 'your driver'}?</Text>

            <View className="mt-5 flex-row items-center justify-between">
              {[1, 2, 3, 4, 5].map((value) => (
                <TouchableOpacity key={value} onPress={() => setRating(value)} className="h-12 w-12 items-center justify-center rounded-full bg-[#f8fafc]">
                  <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={28} color={value <= rating ? '#f59e0b' : '#9ca3af'} />
                </TouchableOpacity>
              ))}
            </View>

            <View className="mt-5 flex-row flex-wrap">
              {PASSENGER_DRIVER_RATING_TAGS.map((tag) => {
                const selected = isPassengerDriverReviewTagSelected(review, tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => {
                      setReview((current) => togglePassengerDriverReviewTag(current, tag));
                    }}
                    className={`mb-2 mr-2 rounded-full border px-4 py-2 ${selected ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}
                  >
                    <Text className={`text-sm font-semibold ${selected ? 'text-blue-700' : 'text-gray-600'}`}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              value={review}
              onChangeText={setReview}
              placeholder="Write optional feedback"
              multiline
              textAlignVertical="top"
              className="mt-4 min-h-[120px] rounded-[22px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
            />

            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={submitting}
              className="mt-5 h-14 items-center justify-center rounded-[22px]"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-lg font-bold text-white">Save Rating</Text>}
            </TouchableOpacity>
          </View>
        ) : ride.passengerDriverRating ? (
          <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Your Rating</Text>
            <View className="mt-4 flex-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <Ionicons key={value} name={value <= ride.passengerDriverRating ? 'star' : 'star-outline'} size={24} color={value <= ride.passengerDriverRating ? '#f59e0b' : '#9ca3af'} />
              ))}
            </View>
            {ride.passengerDriverReview ? (
              <Text className="mt-4 text-base text-gray-700">{ride.passengerDriverReview}</Text>
            ) : null}
          </View>
        ) : null}

        {ride.canTipDriver ? (
          <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Tip Driver</Text>
            <Text className="mt-2 text-sm text-gray-500">
              Add an optional thank-you tip for {ride.driverName || 'your driver'}.
            </Text>
            <View className="mt-5 flex-row flex-wrap">
              {tipOptions.map((amount) => (
                <TouchableOpacity
                  key={amount}
                  onPress={() => handleSendTip(amount)}
                  disabled={submittingTip}
                  className="mb-3 mr-3 h-12 min-w-[72px] items-center justify-center rounded-full border border-blue-200 bg-[#eff6ff] px-4"
                >
                  <Text className="text-base font-bold" style={{ color: PRIMARY_BLUE }}>
                    {formatCurrency(amount)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {submittingTip ? (
              <View className="mt-2 flex-row items-center">
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
                <Text className="ml-2 text-sm text-gray-500">Sending tip...</Text>
              </View>
            ) : null}
          </View>
        ) : Number(ride.tipAmount || 0) > 0 ? (
          <View className="mt-5 rounded-[28px] border border-green-100 bg-white px-5 py-5">
            <Text className="text-xl font-bold text-gray-900">Driver Tip</Text>
            <Text className="mt-3 text-2xl font-bold text-green-600">{formatCurrency(ride.tipAmount)}</Text>
            <Text className="mt-2 text-sm text-gray-500">Thanks for supporting your driver.</Text>
          </View>
        ) : null}

        <View className="mt-5 rounded-[28px] border border-gray-100 bg-white px-5 py-5">
          <Text className="text-xl font-bold text-gray-900">Lost item</Text>
          <Text className="mt-2 text-sm text-gray-500">
            Left something in the car? Report it here and support will follow up.
          </Text>
          <TextInput
            value={lostItemDescription}
            onChangeText={setLostItemDescription}
            placeholder="Describe the item you lost"
            multiline
            textAlignVertical="top"
            className="mt-4 min-h-[110px] rounded-[18px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
          />
          <TextInput
            value={lostItemContactPhone}
            onChangeText={setLostItemContactPhone}
            placeholder="Contact phone (optional)"
            keyboardType="phone-pad"
            className="mt-3 h-12 rounded-[18px] bg-[#f8fafc] px-4 text-base text-gray-900"
          />
          <TouchableOpacity
            onPress={handleReportLostItem}
            disabled={submittingLostItem}
            className="mt-4 h-12 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingLostItem ? 0.7 : 1 }}
          >
            {submittingLostItem ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-sm font-bold uppercase text-white">Report lost item</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

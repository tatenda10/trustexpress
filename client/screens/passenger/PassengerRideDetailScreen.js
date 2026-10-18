import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getPassengerRideDetails, choosePassengerRideCashPayment, initiatePassengerRideSmilePay, reportLostItem, submitPassengerDriverRating, tipDriver, verifyPassengerRideSmilePay } from '../../api';
import { downloadReceiptPdf, printReceiptPdf } from '../../services/receiptPrint';
import RideRatingTagPicker from '../../components/ride/RideRatingTagPicker';
import { PRIMARY_BLUE } from '../../constants/colors';
import {
  PASSENGER_DRIVER_RATING_GROUPS,
  buildRatingReviewText,
  toggleRatingTag,
} from '../../constants/rideRatingTags';
import { isTransientNetworkError, withNetworkRetry } from '../../lib/networkRetry';

WebBrowser.maybeCompleteAuthSession();

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

function DetailRow({ icon, label, value, last }) {
  return (
    <View className={`flex-row items-center py-3 ${last ? '' : 'border-b border-gray-100'}`}>
      <Ionicons name={icon} size={17} color="#9ca3af" />
      <Text className="ml-2.5 flex-1 text-[14px] text-gray-500">{label}</Text>
      <Text className="max-w-[60%] text-right text-[14px] font-semibold text-gray-900" numberOfLines={1}>{value}</Text>
    </View>
  );
}

function stripPrefix(label) {
  return String(label || '').replace(/^(Pickup|Drop-off):\s*/i, '');
}

const STATUS_HERO = {
  Completed: { icon: 'checkmark', color: '#16a34a', bg: '#dcfce7', title: 'Trip completed', subtitle: 'Thanks for riding with Trust Express!' },
  Cancelled: { icon: 'close', color: '#dc2626', bg: '#fee2e2', title: 'Trip cancelled', subtitle: 'This ride did not go ahead.' },
  default: { icon: 'time', color: PRIMARY_BLUE, bg: '#dbeafe', title: 'Trip in progress', subtitle: 'Your ride is still active.' },
};

export default function PassengerRideDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const rideRequestId = route.params?.rideRequestId;
  const initialRide = route.params?.initialRide || null;
  const [ride, setRide] = useState(initialRide);
  const [loading, setLoading] = useState(!initialRide);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [submittingLostItem, setSubmittingLostItem] = useState(false);
  const [submittingTip, setSubmittingTip] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [rating, setRating] = useState(Number(initialRide?.passengerDriverRating || 0));
  const [review, setReview] = useState(String(initialRide?.passengerDriverReview || ''));
  const [selectedRatingTags, setSelectedRatingTags] = useState(
    Array.isArray(initialRide?.passengerDriverFeedbackTags) ? initialRide.passengerDriverFeedbackTags : []
  );
  const [lostItemDescription, setLostItemDescription] = useState('');
  const [lostItemContactPhone, setLostItemContactPhone] = useState('');
  const [tipDraft, setTipDraft] = useState('');
  const [showFareBreakdown, setShowFareBreakdown] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showLostItem, setShowLostItem] = useState(false);

  const loadRide = useCallback(async ({ silent = false } = {}) => {
    if (!rideRequestId) {
      setLoadError('Missing ride id.');
      setLoading(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await withNetworkRetry(async () => {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        return getPassengerRideDetails(token, rideRequestId);
      }, { retries: 2, delayMs: 700 });

      setRide(data?.ride || null);
      setRating(Number(data?.ride?.passengerDriverRating || 0));
      setSelectedRatingTags(
        Array.isArray(data?.ride?.passengerDriverFeedbackTags) ? data.ride.passengerDriverFeedbackTags : []
      );
      setReview(String(data?.ride?.passengerDriverReview || ''));
      setLoadError('');
    } catch (error) {
      const message = isTransientNetworkError(error)
        ? 'Could not reach Trust Express right now. Tap Try again when you are ready.'
        : (error?.message || 'Could not load this ride.');
      setLoadError(message);
      // Keep any seeded/cached ride visible — never block the user with an alert popup.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken, rideRequestId]);

  useEffect(() => {
    loadRide({ silent: Boolean(initialRide) });
  }, [initialRide, loadRide]);

  const handleSubmitRating = async () => {
    try {
      if (!rideRequestId || rating < 1) {
        Alert.alert('Choose a rating', 'Select between 1 and 5 stars.');
        return;
      }
      setSubmitting(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const reviewText = buildRatingReviewText(selectedRatingTags, review);
      await submitPassengerDriverRating(token, rideRequestId, {
        rating,
        review: reviewText,
        feedbackTags: selectedRatingTags,
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

  const handleSendTip = async () => {
    const amount = Number(String(tipDraft || '').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Tip amount', 'Enter how much you want to tip (for example 0.50).');
      return;
    }
    if (amount > 200) {
      Alert.alert('Tip amount', 'Tip amount must be $200.00 or less.');
      return;
    }
    const normalizedAmount = Number(amount.toFixed(2));
    try {
      if (!rideRequestId) return;
      setSubmittingTip(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await tipDriver(token, rideRequestId, normalizedAmount);
      setRide((current) => current ? {
        ...current,
        tipAmount: normalizedAmount,
        totalAmount: Number(current.finalEstimatedAmount ?? current.estimatedAmount ?? 0) + normalizedAmount,
        canTipDriver: false,
      } : current);
      setTipDraft('');
      Alert.alert('Tip sent', `Your $${normalizedAmount.toFixed(2)} tip was added for ${ride.driverName || 'your driver'}.`);
    } catch (error) {
      Alert.alert('Tip failed', error?.message || 'Could not send your tip right now.');
    } finally {
      setSubmittingTip(false);
    }
  };

  const handlePayWithSmilePay = async () => {
    try {
      if (!rideRequestId) return;
      setStartingPayment(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const callbackUrl = ExpoLinking.createURL('passenger-ride-payment');
      const result = await initiatePassengerRideSmilePay(token, rideRequestId, {
        callbackUrl,
        checkoutMode: 'hosted',
      });
      const payment = result?.payment || {};
      if (!payment.authorizationUrl && String(payment.nextAction || '').toLowerCase() !== 'poll') {
        throw new Error('Could not start Smile&Pay checkout.');
      }

      const authResult = payment.authorizationUrl
        ? await WebBrowser.openAuthSessionAsync(payment.authorizationUrl, callbackUrl)
        : { type: 'poll' };
      const references = [payment.reference].filter(Boolean);
      if (authResult?.type === 'success' && authResult?.url) {
        const parsed = ExpoLinking.parse(authResult.url);
        const returnedReference =
          parsed?.queryParams?.reference
          || parsed?.queryParams?.orderReference
          || parsed?.queryParams?.transactionReference;
        if (returnedReference && !references.includes(String(returnedReference))) {
          references.push(String(returnedReference));
        }
      }

      if (!payment.authorizationUrl) {
        Alert.alert(
          'Payment started',
          'Smile&Pay has started the express payment. Approve it on your phone, then wait a moment while we confirm it.'
        );
        await new Promise((resolve) => setTimeout(resolve, 3500));
      }
      let verifiedPayment = null;
      for (const reference of references) {
        const verifyResult = await verifyPassengerRideSmilePay(token, rideRequestId, reference);
        verifiedPayment = verifyResult?.payment || verifiedPayment;
      }
      const verifiedStatus = String(verifiedPayment?.status || '').toLowerCase();
      if (verifiedStatus !== 'success') {
        setRide((current) => current ? {
          ...current,
          paymentStatus: verifiedStatus || 'pending',
          paymentProvider: 'smilepay',
          paymentReference: references[0] || current.paymentReference,
        } : current);
        Alert.alert('Payment pending', 'We could not confirm a successful Smile&Pay payment yet. Please try checking again in a moment.');
        return;
      }
      setRide((current) => current ? {
        ...current,
        paymentStatus: 'paid',
        paymentProvider: 'smilepay',
        paymentMethod: 'online',
        paymentReference: references[0] || current.paymentReference,
        canPayWithSmilePay: false,
        canPayCash: false,
        canChoosePaymentMethod: false,
      } : current);
      Alert.alert('Payment complete', 'Online payment received. The service fee was withheld and the remaining amount was credited to the driver Trust Express wallet.');
    } catch (error) {
      Alert.alert('Payment failed', error?.message || 'Could not complete Smile&Pay payment.');
    } finally {
      setStartingPayment(false);
    }
  };

  const handlePayCash = async () => {
    try {
      if (!rideRequestId) return;
      setStartingPayment(true);
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      await choosePassengerRideCashPayment(token, rideRequestId);
      setRide((current) => current ? {
        ...current,
        paymentStatus: 'unpaid',
        paymentMethod: 'cash',
        canPayCash: false,
        canPayWithSmilePay: false,
        canChoosePaymentMethod: false,
      } : current);
      Alert.alert('Cash selected', 'Pay the driver in cash at the end of the trip.');
    } catch (error) {
      Alert.alert('Could not select cash', error?.message || 'Try again.');
    } finally {
      setStartingPayment(false);
    }
  };

  if (loading && !ride) {
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
        <Text className="text-xl font-bold text-gray-900">Ride details unavailable</Text>
        <Text className="mt-3 text-center text-sm text-gray-500">
          {loadError || 'Could not load this ride right now.'}
        </Text>
        <TouchableOpacity
          onPress={() => loadRide()}
          disabled={refreshing}
          className="mt-6 h-12 min-w-[160px] items-center justify-center rounded-[18px] px-5"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: refreshing ? 0.7 : 1 }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-sm font-bold text-white">Try again</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} className="mt-4 px-4 py-2">
          <Text className="text-sm font-semibold text-gray-500">Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { originalFare, fareAfterDiscount, tipAmount, totalAmount } = getFareBreakdown(ride);
  const paymentStatus = String(ride?.paymentStatus || 'unpaid').toLowerCase();
  const paymentMethod = String(ride?.paymentMethod || '').toLowerCase();
  const isRefundedPayment = paymentStatus === 'refunded' || paymentStatus === 'refund_pending';
  const canPayWithSmilePay = Boolean(ride?.canPayWithSmilePay) && paymentStatus !== 'paid' && paymentMethod !== 'cash' && !isRefundedPayment;
  const canPayCash = Boolean(ride?.canPayCash) && paymentStatus !== 'paid' && paymentMethod !== 'cash' && !isRefundedPayment;
  const hero = STATUS_HERO[ride.status] || STATUS_HERO.default;
  const paymentLabel = paymentStatus === 'paid'
    ? 'Paid by card'
    : paymentStatus === 'refunded'
      ? 'Refunded'
      : paymentStatus === 'refund_pending'
        ? 'Refund in progress'
        : paymentMethod === 'cash'
          ? 'Cash'
          : 'Not paid yet';
  const paymentIcon = paymentMethod === 'cash' ? 'cash' : paymentStatus === 'paid' ? 'card' : 'wallet-outline';
  const distanceKm = Number(ride.estimatedDistanceKm || 0);
  const minutes = Number(ride.estimatedMinutes || 0);
  const detailRows = [
    distanceKm > 0 ? { icon: 'navigate-outline', label: 'Distance', value: `${distanceKm.toFixed(1)} km` } : null,
    minutes > 0 ? { icon: 'time-outline', label: 'Time', value: `${minutes} min` } : null,
    { icon: 'person-outline', label: 'Driver', value: ride.driverName || 'No driver assigned' },
    ride.tierName ? { icon: 'car-outline', label: 'Ride type', value: ride.tierName } : null,
    { icon: 'calendar-outline', label: 'Date', value: formatDate(ride.completedAt || ride.requestedAt) },
  ].filter(Boolean);

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center px-4 pb-2" style={{ paddingTop: insets.top + 6 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} className="h-10 w-10 items-center justify-center rounded-full">
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text className="ml-1 text-[16px] font-semibold text-gray-900">Ride details</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {loadError ? (
          <View className="mb-4 flex-row items-center rounded-2xl bg-amber-50 px-4 py-3">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-sm font-semibold text-amber-900">Could not refresh details</Text>
              <Text className="mt-1 text-xs text-amber-800">{loadError}</Text>
            </View>
            <TouchableOpacity
              onPress={() => loadRide({ silent: true })}
              disabled={refreshing}
              className="rounded-full bg-white px-3 py-2"
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <Text className="text-xs font-bold" style={{ color: PRIMARY_BLUE }}>Retry</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <View className="items-center pb-5 pt-2">
          <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hero.color }}>
            <Ionicons name={hero.icon} size={34} color="#fff" />
          </View>
          <Text className="mt-3 text-[22px] font-extrabold text-gray-950">{hero.title}</Text>
          <Text className="mt-1 text-[14px] text-gray-500">{hero.subtitle}</Text>
        </View>

        <TouchableOpacity
          onPress={() => setShowFareBreakdown((current) => !current)}
          activeOpacity={0.8}
          className="rounded-2xl border border-gray-200 px-4 py-4"
        >
          <View className="flex-row items-center">
            <View className="flex-1">
              <Text className="text-[13px] text-gray-500">Total fare</Text>
              <Text className="mt-0.5 text-[28px] font-extrabold text-gray-950">{formatCurrency(totalAmount)}</Text>
              {tipAmount > 0 ? (
                <Text className="text-[12px] font-medium text-green-600">Includes {formatCurrency(tipAmount)} tip</Text>
              ) : null}
            </View>
            <Ionicons name={showFareBreakdown ? 'chevron-up' : 'chevron-forward'} size={20} color="#9ca3af" />
          </View>
          {showFareBreakdown ? (
            <View className="mt-3 border-t border-gray-100 pt-3">
              <View className="flex-row justify-between">
                <Text className="text-[14px] text-gray-500">Ride fare</Text>
                <Text className="text-[14px] font-semibold text-gray-900">{formatCurrency(fareAfterDiscount || originalFare)}</Text>
              </View>
              {Number(ride.discountAmount || 0) > 0 ? (
                <View className="mt-2 flex-row justify-between">
                  <Text className="text-[14px] text-gray-500">Discount</Text>
                  <Text className="text-[14px] font-semibold text-green-600">-{formatCurrency(ride.discountAmount)}</Text>
                </View>
              ) : null}
              <View className="mt-2 flex-row justify-between">
                <Text className="text-[14px] text-gray-500">Tip</Text>
                <Text className="text-[14px] font-semibold text-gray-900">{formatCurrency(tipAmount)}</Text>
              </View>
            </View>
          ) : null}
        </TouchableOpacity>

        <View className="mt-3 rounded-2xl border border-gray-200 px-4 py-3.5">
          <View className="flex-row items-center">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-green-50">
              <Ionicons name={paymentIcon} size={19} color="#16a34a" />
            </View>
            <Text className="ml-3 flex-1 text-[15px] font-semibold text-gray-900">{paymentLabel}</Text>
            {paymentStatus === 'paid' ? <Ionicons name="checkmark-circle" size={20} color="#16a34a" /> : null}
          </View>
          {(canPayCash || canPayWithSmilePay) ? (
            <View className="mt-3 flex-row gap-2.5">
              {canPayCash ? (
                <TouchableOpacity
                  onPress={handlePayCash}
                  disabled={startingPayment}
                  className="h-11 flex-1 items-center justify-center rounded-xl bg-[#f3f4f6]"
                  style={{ opacity: startingPayment ? 0.7 : 1 }}
                >
                  <Text className="text-[14px] font-bold text-gray-800">Pay cash</Text>
                </TouchableOpacity>
              ) : null}
              {canPayWithSmilePay ? (
                <TouchableOpacity
                  onPress={handlePayWithSmilePay}
                  disabled={startingPayment}
                  className="h-11 flex-1 items-center justify-center rounded-xl"
                  style={{ backgroundColor: PRIMARY_BLUE, opacity: startingPayment ? 0.7 : 1 }}
                >
                  {startingPayment ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-[14px] font-bold text-white">Pay by card</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        <View className="mt-3 rounded-2xl border border-gray-200 px-4 py-3.5">
          <View className="flex-row">
            <View className="mr-3 items-center pt-1.5">
              <View className="h-2.5 w-2.5 rounded-full bg-green-600" />
              <View className="my-1 w-0.5 flex-1 bg-gray-200" />
              <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRIMARY_BLUE }} />
            </View>
            <View className="flex-1">
              <Text className="text-[12px] text-gray-400">Pickup</Text>
              <Text className="text-[14px] font-semibold text-gray-900">{stripPrefix(ride.pickupLabel)}</Text>
              <Text className="mt-3 text-[12px] text-gray-400">Drop-off</Text>
              <Text className="text-[14px] font-semibold text-gray-900">{stripPrefix(ride.dropoffLabel)}</Text>
            </View>
          </View>
        </View>

        <Text className="mb-1 mt-5 text-[16px] font-bold text-gray-900">Ride details</Text>
        {detailRows.map((row, index) => (
          <DetailRow key={row.label} {...row} last={index === detailRows.length - 1} />
        ))}

        {ride.passengerDriverRating && !ride.canRateDriver ? (
          <View className="mt-4 rounded-2xl bg-[#f9fafb] px-4 py-3.5">
            <Text className="text-[13px] text-gray-500">Your rating</Text>
            <View className="mt-1.5 flex-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <Ionicons key={value} name={value <= ride.passengerDriverRating ? 'star' : 'star-outline'} size={20} color={value <= ride.passengerDriverRating ? '#f59e0b' : '#d1d5db'} />
              ))}
            </View>
            {ride.passengerDriverReview ? (
              <Text className="mt-2 text-[14px] text-gray-700">{ride.passengerDriverReview}</Text>
            ) : null}
          </View>
        ) : null}

        {ride.canRateDriver && showRating ? (
          <View className="mt-4 rounded-2xl border border-gray-200 px-4 py-4">
            <RideRatingTagPicker
              rating={rating}
              onChangeRating={setRating}
              groups={PASSENGER_DRIVER_RATING_GROUPS}
              selectedTags={selectedRatingTags}
              onToggleTag={(tag) => setSelectedRatingTags((current) => toggleRatingTag(current, tag))}
              review={review}
              onChangeReview={setReview}
              title="Rate your Trust Express Captain"
              subtitle={`How was your trip with ${ride.driverName || 'your driver'}?`}
            />
            <TouchableOpacity
              onPress={handleSubmitRating}
              disabled={submitting}
              className="mt-4 h-12 items-center justify-center rounded-xl"
              style={{ backgroundColor: PRIMARY_BLUE, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-[15px] font-bold text-white">Save rating</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {ride.canTipDriver && paymentStatus !== 'paid' ? (
          <View className="mt-4 rounded-2xl border border-gray-200 px-4 py-4">
            <Text className="text-[15px] font-bold text-gray-900">Tip {ride.driverName || 'your driver'}</Text>
            <Text className="mt-0.5 text-[13px] text-gray-500">Optional thank-you, any amount.</Text>
            <View className="mt-3 flex-row items-center">
              <View className="h-11 flex-1 flex-row items-center rounded-xl bg-[#f3f4f6] px-3">
                <Text className="text-[16px] font-bold text-gray-700">$</Text>
                <TextInput
                  value={tipDraft}
                  onChangeText={setTipDraft}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  editable={!submittingTip}
                  className="ml-1 flex-1 text-[16px] text-gray-900"
                />
              </View>
              <TouchableOpacity
                onPress={handleSendTip}
                disabled={submittingTip}
                className="ml-2.5 h-11 items-center justify-center rounded-xl px-5"
                style={{ backgroundColor: PRIMARY_BLUE, opacity: submittingTip ? 0.7 : 1 }}
              >
                {submittingTip ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-[14px] font-bold text-white">Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View className="mt-6 gap-2.5">
          {ride.canRateDriver && !showRating ? (
            <TouchableOpacity
              onPress={() => setShowRating(true)}
              className="h-12 items-center justify-center rounded-xl border-[1.5px]"
              style={{ borderColor: PRIMARY_BLUE, backgroundColor: '#eef4ff' }}
            >
              <Text className="text-[15px] font-bold" style={{ color: PRIMARY_BLUE }}>Rate driver</Text>
            </TouchableOpacity>
          ) : null}
          <View className="flex-row gap-2.5">
            <TouchableOpacity
              onPress={handleDownloadReceipt}
              disabled={downloadingReceipt}
              className="h-12 flex-1 items-center justify-center rounded-xl border border-gray-200"
              style={{ opacity: downloadingReceipt ? 0.6 : 1 }}
            >
              {downloadingReceipt ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <Text className="text-[15px] font-bold text-gray-900">View receipt</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePrintReceipt}
              disabled={printingReceipt}
              className="h-12 w-12 items-center justify-center rounded-xl border border-gray-200"
              style={{ opacity: printingReceipt ? 0.6 : 1 }}
            >
              {printingReceipt ? (
                <ActivityIndicator size="small" color={PRIMARY_BLUE} />
              ) : (
                <Ionicons name="print-outline" size={20} color="#111827" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setShowLostItem((current) => !current)}
          activeOpacity={0.7}
          className="mt-5 flex-row items-center py-3"
        >
          <Ionicons name="briefcase-outline" size={18} color="#6b7280" />
          <Text className="ml-2.5 flex-1 text-[14px] font-semibold text-gray-700">Report a lost item</Text>
          <Ionicons name={showLostItem ? 'chevron-up' : 'chevron-down'} size={18} color="#9ca3af" />
        </TouchableOpacity>
        {showLostItem ? (
          <View>
            <TextInput
              value={lostItemDescription}
              onChangeText={setLostItemDescription}
              placeholder="Describe the item you lost"
              multiline
              textAlignVertical="top"
              className="min-h-[96px] rounded-xl bg-[#f3f4f6] px-4 py-3 text-[15px] text-gray-900"
            />
            <TextInput
              value={lostItemContactPhone}
              onChangeText={setLostItemContactPhone}
              placeholder="Contact phone (optional)"
              keyboardType="phone-pad"
              className="mt-2.5 h-11 rounded-xl bg-[#f3f4f6] px-4 text-[15px] text-gray-900"
            />
            <TouchableOpacity
              onPress={handleReportLostItem}
              disabled={submittingLostItem}
              className="mt-3 h-11 items-center justify-center rounded-xl bg-gray-900"
              style={{ opacity: submittingLostItem ? 0.7 : 1 }}
            >
              {submittingLostItem ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-[14px] font-bold text-white">Send report</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

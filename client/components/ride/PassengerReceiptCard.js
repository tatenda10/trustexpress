import React from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRIMARY_BLUE } from '../../constants/colors';

const HEADER_BLUE = '#0b3f9f';
const INK = '#07153d';
const MUTED = '#667085';
const LINE = '#e5e7eb';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function cleanLocationLabel(value) {
  return String(value || '-')
    .replace(/^Pickup:\s*/i, '')
    .replace(/^Drop-?off:\s*/i, '')
    .trim() || '-';
}

function formatReceiptDate(value, includeTime = false) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    day: '2-digit',
    month: includeTime ? 'short' : 'long',
    year: includeTime ? undefined : 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(date);
}

function SectionTitle({ children }) {
  return <Text className="text-[11px] font-extrabold uppercase tracking-[1px]" style={{ color: '#52607a' }}>{children}</Text>;
}

function DetailCell({ label, value }) {
  return (
    <View className="mb-4 w-[48%]">
      <Text className="text-xs" style={{ color: MUTED }}>{label}</Text>
      <Text className="mt-1 text-[15px] font-extrabold" style={{ color: INK }}>{value || '-'}</Text>
    </View>
  );
}

function FareRow({ label, value }) {
  return (
    <View className="mt-3 flex-row items-center justify-between">
      <Text className="text-[14px]" style={{ color: INK }}>{label}</Text>
      <Text className="text-[14px] font-extrabold" style={{ color: INK }}>{value}</Text>
    </View>
  );
}

export default function PassengerReceiptCard({
  ride,
  driver,
  pickupLabel,
  dropoffLabel,
  intermediateStops = [],
  paymentLabel,
  fareAmount,
  tipAmount,
  totalAmount,
  downloading,
  onDownload,
}) {
  const passengerName = ride?.passengerName || 'Passenger';
  const driverName = driver?.driverName || ride?.driverName || 'Driver';
  const originalFare = Number(ride?.originalEstimatedAmount || fareAmount || 0);
  const discount = Number(ride?.discountAmount || 0);
  const finalFare = Number(ride?.finalEstimatedAmount || fareAmount || 0);
  const receiptNumber = `RCPT-${ride?.id || '-'}`;
  const tripReference = ride?.publicId || `TR-${String(ride?.id || '').padStart(5, '0')}`;
  const routeRows = [
    { label: 'Pickup', value: cleanLocationLabel(pickupLabel) },
    ...intermediateStops.map((stop, index) => ({
      label: `Stop ${index + 1}`,
      value: cleanLocationLabel(stop?.label),
    })),
    { label: 'Drop-off', value: cleanLocationLabel(dropoffLabel) },
  ];

  return (
    <View className="mt-6 overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: '#dbe1ea' }}>
      <View className="px-5 pb-5 pt-4" style={{ backgroundColor: HEADER_BLUE }}>
        <View className="flex-row justify-between">
          <View className="flex-[1.15] pr-2">
            <View className="h-[52px] w-[145px] overflow-hidden">
              <Image
                source={require('../../assets/logo.png')}
                resizeMode="contain"
                style={{ position: 'absolute', width: 145, height: 145, left: 0, top: -44, tintColor: '#ffffff' }}
              />
            </View>
            <Text className="mt-1 text-[11px] font-semibold text-white">Your Trusted Ride Partner</Text>
            <Text className="mt-2 text-[10px] text-white/90" numberOfLines={1}>Email: support@trustexpress.co.za</Text>
            <Text className="mt-0.5 text-[10px] text-white/90" numberOfLines={1}>Website: trustexpress.co.za</Text>
          </View>
          <View className="flex-[0.85] items-end pt-2">
            <Text className="text-[14px] font-extrabold text-white">TRIP RECEIPT</Text>
            <Text className="mt-3 text-[12px] font-semibold text-white/90">{receiptNumber}</Text>
            <Text className="mt-1 text-[11px] text-white/90">{formatReceiptDate(ride?.completedAt)}</Text>
          </View>
        </View>
      </View>

      <View className="px-4 py-4">
        <View className="flex-row items-center justify-between rounded-[10px] bg-[#eaf7ea] px-3.5 py-3">
          <Text className="text-[13px] font-extrabold text-green-700">COMPLETED</Text>
          <Text className="text-[13px] font-semibold" style={{ color: INK }}>Payment: {paymentLabel || '-'}</Text>
        </View>

        <View className="border-b py-5" style={{ borderColor: LINE }}>
          <SectionTitle>Passenger</SectionTitle>
          <Text className="mt-1 text-[20px] font-extrabold" style={{ color: INK }}>{passengerName}</Text>
        </View>

        <View className="border-b py-5" style={{ borderColor: LINE }}>
          <SectionTitle>Route</SectionTitle>
          <View className="mt-3">
            {routeRows.map((row) => (
              <View key={`${row.label}-${row.value}`} className="mb-3 flex-row items-start">
                <Text className="w-[76px] text-[13px]" style={{ color: MUTED }}>{row.label}</Text>
                <Text className="flex-1 text-[15px] font-extrabold" style={{ color: INK }}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="border-b py-5" style={{ borderColor: LINE }}>
          <SectionTitle>Trip details</SectionTitle>
          <View className="mt-4 flex-row flex-wrap justify-between">
            <DetailCell label="Driver" value={driverName} />
            <DetailCell label="Service tier" value={ride?.requestedTierName || 'Trust Express'} />
            <DetailCell label="Trip ID" value={`TR-${String(ride?.id || '').padStart(6, '0')}`} />
            <DetailCell label="Trip reference" value={tripReference} />
            <DetailCell label="Started" value={formatReceiptDate(ride?.startedAt || ride?.requestedAt, true)} />
            <DetailCell label="Completed" value={formatReceiptDate(ride?.completedAt, true)} />
          </View>
        </View>

        <View className="py-5">
          <SectionTitle>Fare breakdown</SectionTitle>
          <FareRow label="Original fare" value={money(originalFare)} />
          <FareRow label="Discount" value={`-${money(discount)}`} />
          <FareRow label="Fare" value={money(finalFare)} />
          <FareRow label="Tip" value={money(tipAmount)} />
        </View>

        <View className="flex-row items-center justify-between rounded-[10px] bg-[#edf3ff] px-4 py-4">
          <Text className="text-[14px] font-extrabold" style={{ color: HEADER_BLUE }}>TOTAL CHARGED</Text>
          <Text className="text-[30px] font-extrabold" style={{ color: HEADER_BLUE }}>{money(totalAmount)}</Text>
        </View>

        <View className="mt-5 flex-row items-center justify-between">
          <Text className="text-[12px]" style={{ color: MUTED }}>Thank you for choosing Trust Express!</Text>
          <Text className="text-[12px] font-extrabold" style={{ color: PRIMARY_BLUE }}>Your Trusted Ride Partner</Text>
        </View>

        <TouchableOpacity
          onPress={onDownload}
          disabled={downloading}
          className="mt-5 h-12 flex-row items-center justify-center rounded-[10px]"
          style={{ backgroundColor: PRIMARY_BLUE, opacity: downloading ? 0.65 : 1 }}
        >
          {downloading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color="#ffffff" />
              <Text className="ml-2 text-[14px] font-extrabold text-white">Download PDF receipt</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';
import { useDriverStatus } from '../../context/DriverStatusContext';

const DriverCarRegistrationPage = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { driverStatus: contextDriverStatus } = useDriverStatus();
  const driverStatus = contextDriverStatus ?? route.params?.driverStatus ?? {};
  const vehicle = driverStatus?.vehicle;
  const profileApproved = driverStatus?.driverProfile?.status === 'approved';
  const status = vehicle?.status; // 'pending' | 'approved' | 'rejected'
  const isApproved = status === 'approved';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';
  const canResubmit = vehicle?.canResubmit !== false;
  const notSubmitted = !vehicle;

  const statusLabel = notSubmitted
    ? 'Not yet registered'
    : isApproved
      ? 'Verified'
      : isPending
        ? 'Under review'
        : 'Rejected';

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center border-b border-gray-100 bg-white"
        style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 ml-2">Car registration</Text>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="items-center py-8">
          {isApproved ? (
            <View className="w-20 h-20 rounded-full bg-green-100 items-center justify-center mb-4">
              <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            </View>
          ) : (
            <View className={`w-20 h-20 rounded-full items-center justify-center mb-4 ${isRejected ? 'bg-red-100' : 'bg-amber-100'}`}>
              <Ionicons name="car-outline" size={40} color={isRejected ? '#dc2626' : '#d97706'} />
            </View>
          )}
          <Text className="text-xl font-semibold text-gray-900 mb-1">{statusLabel}</Text>
          <Text className="text-sm text-gray-500 text-center px-4">
            {notSubmitted && (profileApproved ? 'Register your vehicle with photos, plate and documents.' : 'Complete document verification first, then register your vehicle.')}
            {isPending && 'Your vehicle is being reviewed. We\'ll notify you once approved.'}
            {isApproved && vehicle?.numberPlate && `Your vehicle ${vehicle.numberPlate} has been verified.`}
            {isRejected && !canResubmit && 'You are not allowed to resubmit. Contact support if you believe this is an error.'}
            {isRejected && canResubmit && (vehicle?.rejectionReason || 'Your vehicle was not approved. You can resubmit below.')}
          </Text>
        </View>
        {isRejected && !canResubmit && profileApproved && (
          <View className="rounded-xl p-4 bg-gray-100 items-center">
            <Ionicons name="lock-closed-outline" size={24} color="#6b7280" />
            <Text className="text-gray-600 text-sm mt-2 text-center">Resubmission is disabled. Contact support.</Text>
          </View>
        )}
        {(notSubmitted || (isRejected && canResubmit)) && profileApproved && (
          <TouchableOpacity
            className="rounded-xl p-4 items-center flex-row justify-center gap-2"
            style={{ backgroundColor: PRIMARY_BLUE }}
            onPress={() => {
              const rootNavigation = navigation.getParent()?.getParent();
              rootNavigation?.navigate?.('DriverRegisterCar', { driverStatus });
            }}
          >
            <Text className="text-white font-semibold">{notSubmitted ? 'Register vehicle' : 'Resubmit vehicle'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

export default DriverCarRegistrationPage;

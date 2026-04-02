import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { getDriverVehicleOptions, submitVehicle, uploadFile } from '../../api';
import { useDriverStatus } from '../../context/DriverStatusContext';

const MIN_CAR_PHOTOS = 3;
const MAX_CAR_PHOTOS = 6;
const YEAR_OPTIONS = Array.from({ length: new Date().getFullYear() - 1989 }, (_, index) => String(new Date().getFullYear() - index));
const SEAT_OPTIONS = ['2', '4', '5', '6', '7', '8', '10', '14', '18'];
const DOOR_OPTIONS = ['2', '3', '4', '5'];
const UPLOAD_RETRY_COUNT = 2;

async function prepareImageForUpload(uri, { maxWidth = 1600, compress = 0.7 } = {}) {
  if (!uri || /^https?:\/\//i.test(uri) || String(uri).startsWith('/uploads/')) return uri;

  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    {
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  return manipulated?.uri || uri;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function SelectField({ label, value, placeholder, onPress }) {
  return (
    <>
      <Text className="text-sm font-medium text-gray-700 mb-2">{label} <Text className="text-red-500">*</Text></Text>
      <TouchableOpacity
        onPress={onPress}
        className="mb-4 flex-row items-center justify-between rounded-xl border border-gray-200 p-4"
      >
        <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#6b7280" />
      </TouchableOpacity>
    </>
  );
}

function askCropPreference() {
  return new Promise((resolve) => {
    Alert.alert(
      'Photo option',
      'Keep the original image size or crop it before upload?',
      [
        { text: 'Original (Recommended)', onPress: () => resolve(false) },
        { text: 'Crop', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

const DriverRegisterCarScreen = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { driverStatus: contextDriverStatus, refetchDriverStatus } = useDriverStatus();
  const driverStatus = contextDriverStatus ?? route.params?.driverStatus ?? null;
  const vehicle = driverStatus?.vehicle;
  const isPending = vehicle?.status === 'pending';
  const isRejected = vehicle?.status === 'rejected';
  const isVehicleBlocked = isRejected && vehicle?.canResubmit === false;

  const [carPhotoUris, setCarPhotoUris] = useState(Array.isArray(vehicle?.carPhotoUrls) ? vehicle.carPhotoUrls : []);
  const [numberPlate, setNumberPlate] = useState(vehicle?.numberPlate || '');
  const [make, setMake] = useState(vehicle?.make || '');
  const [model, setModel] = useState(vehicle?.model || '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [color, setColor] = useState(vehicle?.color || '');
  const [seatCount, setSeatCount] = useState(vehicle?.seatCount ? String(vehicle.seatCount) : '');
  const [doorCount, setDoorCount] = useState(vehicle?.doorCount ? String(vehicle.doorCount) : '');
  const [vehicleCategory, setVehicleCategory] = useState(vehicle?.vehicleCategory || 'sedan');
  const [hasAirConditioning, setHasAirConditioning] = useState(vehicle?.hasAirConditioning === true);
  const [hasChargingPorts, setHasChargingPorts] = useState(vehicle?.hasChargingPorts === true);
  const [hasWifi, setHasWifi] = useState(vehicle?.hasWifi === true);
  const [hasLeatherSeats, setHasLeatherSeats] = useState(vehicle?.hasLeatherSeats === true);
  const [hasLargeLuggageSpace, setHasLargeLuggageSpace] = useState(vehicle?.hasLargeLuggageSpace === true);
  const [hasSlidingDoors, setHasSlidingDoors] = useState(vehicle?.hasSlidingDoors === true);
  const [isHighEnd, setIsHighEnd] = useState(vehicle?.isHighEnd === true);
  const [regBookUri, setRegBookUri] = useState(vehicle?.vehicleRegistrationBookUrl || vehicle?.vehicleRegistrationUrl || null);
  const [insuranceUri, setInsuranceUri] = useState(vehicle?.insuranceUrl || null);
  const [zinaraUri, setZinaraUri] = useState(vehicle?.zinaraUrl || null);
  const [loading, setLoading] = useState(false);
  const [tiers, setTiers] = useState([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [selectedTierKey, setSelectedTierKey] = useState(vehicle?.vehicleTierKey || '');
  const [activeSelectField, setActiveSelectField] = useState(null);

  useEffect(() => {
    let active = true;

    const loadTiers = async () => {
      setTiersLoading(true);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not signed in');
        const data = await getDriverVehicleOptions(token);
        if (!active) return;
        const nextTiers = Array.isArray(data?.tiers) ? data.tiers.slice(0, 3) : [];
        setTiers(nextTiers);
        if (!selectedTierKey && nextTiers[0]?.tierKey) {
          setSelectedTierKey(nextTiers[0].tierKey);
        }
      } catch (error) {
        if (!active) return;
        setTiers([]);
        Alert.alert('Vehicle tiers unavailable', error?.message || 'Could not load vehicle tier options');
      } finally {
        if (active) setTiersLoading(false);
      }
    };

    loadTiers();
    return () => {
      active = false;
    };
  }, []);

  const pickCarPhotos = async () => {
    try {
      const remaining = Math.max(MAX_CAR_PHOTOS - carPhotoUris.length, 0);
      if (!remaining) {
        Alert.alert('Photo limit reached', `You can upload up to ${MAX_CAR_PHOTOS} car photos.`);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      setCarPhotoUris((current) => {
        const merged = [...current, ...result.assets.map((asset) => asset.uri).filter(Boolean)];
        return Array.from(new Set(merged)).slice(0, MAX_CAR_PHOTOS);
      });
    } catch {
      Alert.alert('Error', 'Could not open image picker');
    }
  };

  const pickSingleImage = async (setter) => {
    try {
      const allowsEditing = await askCropPreference();
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) setter(result.assets[0].uri);
    } catch {
      Alert.alert('Error', 'Could not open image picker');
    }
  };

  const removeCarPhoto = (uri) => {
    setCarPhotoUris((current) => current.filter((item) => item !== uri));
  };

  const uploadUri = async (token, uri, filename = 'upload.jpg') => {
    if (!uri) return null;
    if (/^https?:\/\//i.test(uri) || String(uri).startsWith('/uploads/')) return uri;

    let lastError = null;

    for (let attempt = 0; attempt <= UPLOAD_RETRY_COUNT; attempt += 1) {
      try {
        const uploadReadyUri = await prepareImageForUpload(uri);
        const formData = new FormData();
        formData.append('file', { uri: uploadReadyUri, name: filename, type: 'image/jpeg' });
        const { url } = await uploadFile(token, formData);
        return url;
      } catch (error) {
        lastError = error;
        if (attempt < UPLOAD_RETRY_COUNT) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Upload failed');
  };

  const handleSubmit = async () => {
    if (!selectedTierKey) {
      Alert.alert('Tier required', 'Select a vehicle tier before submitting.');
      return;
    }
    if (carPhotoUris.length < MIN_CAR_PHOTOS) {
      Alert.alert('More photos needed', `Upload at least ${MIN_CAR_PHOTOS} car photos.`);
      return;
    }
    if (!regBookUri) {
      Alert.alert('Registration book required', 'Upload the vehicle registration book.');
      return;
    }
    if (!insuranceUri) {
      Alert.alert('Insurance required', 'Upload the insurance document.');
      return;
    }
    if (!zinaraUri) {
      Alert.alert('Zinara required', 'Upload the Zinara document.');
      return;
    }
    if (!numberPlate.trim() || !make.trim() || !model.trim() || !year.trim()) {
      Alert.alert('Missing fields', 'Fill in number plate, make, model and year.');
      return;
    }
    if (!seatCount.trim() || !doorCount.trim()) {
      Alert.alert('Missing fields', 'Fill in seat count and door count.');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error('Not signed in');

      const uploadedCarPhotos = await mapWithConcurrency(
        carPhotoUris,
        3,
        async (uri, index) => uploadUri(token, uri, `car-photo-${index + 1}.jpg`)
      );
      const [registrationBookUrl, insuranceUrl, zinaraUrl] = await Promise.all([
        uploadUri(token, regBookUri, 'registration-book.jpg'),
        uploadUri(token, insuranceUri, 'insurance.jpg'),
        uploadUri(token, zinaraUri, 'zinara.jpg'),
      ]);
      const selectedTier = tiers.find((tier) => tier.tierKey === selectedTierKey) || null;

      await submitVehicle(token, {
        carPhotoUrls: uploadedCarPhotos,
        carPhotoFrontUrl: uploadedCarPhotos[0] || null,
        carPhotoRearUrl: uploadedCarPhotos[1] || null,
        numberPlate: numberPlate.trim(),
        make: make.trim(),
        model: model.trim(),
        year: Number(year),
        color: color.trim() || null,
        seatCount: Number(seatCount),
        doorCount: Number(doorCount),
        vehicleCategory,
        hasAirConditioning,
        hasChargingPorts,
        hasWifi,
        hasLeatherSeats,
        hasLargeLuggageSpace,
        hasSlidingDoors,
        isHighEnd,
        vehicleRegistrationBookUrl: registrationBookUrl,
        vehicleRegistrationUrl: registrationBookUrl,
        insuranceUrl,
        zinaraUrl,
        vehicleTierKey: selectedTierKey,
        vehicleTierName: selectedTier?.tierName || null,
      });

      await refetchDriverStatus();
      Alert.alert('Submitted', 'Your vehicle registration has been submitted for review.');
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  if (isPending) {
    return (
      <View className="flex-1 bg-white">
        <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        </View>
        <View className="flex-1 px-5 justify-center items-center">
          <Ionicons name="time-outline" size={64} color="#206EFF" />
          <Text className="text-xl font-bold text-gray-900 mt-4">Under review</Text>
          <Text className="text-gray-600 text-center mt-2">Your vehicle registration is being verified. We&apos;ll notify you once approved.</Text>
        </View>
      </View>
    );
  }

  if (isVehicleBlocked) {
    return (
      <View className="flex-1 bg-white">
        <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        </View>
        <View className="flex-1 px-5 justify-center items-center">
          <Ionicons name="lock-closed-outline" size={64} color="#6b7280" />
          <Text className="text-xl font-bold text-gray-900 mt-4">Resubmission not allowed</Text>
          <Text className="text-gray-600 text-center mt-2 px-4">
            You are not allowed to resubmit vehicle documents. Please contact support if you believe this is an error.
          </Text>
          {vehicle?.rejectionReason ? (
            <View className="mt-4 mx-4 p-3 bg-red-50 rounded-xl">
              <Text className="text-sm font-medium text-red-800">Reason</Text>
              <Text className="text-red-700 text-sm mt-1">{vehicle.rejectionReason}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-gray-900 mb-2">Register your car</Text>
        <Text className="text-sm text-gray-600 mb-4">Upload at least 3 car photos, your registration book, and choose the car tier configured by admin.</Text>

        {isRejected && vehicle?.rejectionReason && (
          <View className="mb-4 p-3 bg-red-50 rounded-xl">
            <Text className="text-red-700 font-medium">Rejected</Text>
            <Text className="text-red-600 text-sm mt-1">{vehicle.rejectionReason}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-2">Car photos <Text className="text-red-500">*</Text></Text>
        <TouchableOpacity onPress={pickCarPhotos} className="mb-3 border border-gray-200 rounded-xl p-4 items-center">
          <Ionicons name="images-outline" size={32} color="#9ca3af" />
          <Text className="text-gray-900 mt-2 font-medium">Add car photos</Text>
          <Text className="text-gray-500 mt-1 text-center">Minimum {MIN_CAR_PHOTOS}, maximum {MAX_CAR_PHOTOS}. Make sure the car and plate are clearly visible.</Text>
        </TouchableOpacity>

        <View className="mb-4">
          <Text className="text-xs text-gray-500 mb-2">{carPhotoUris.length} photo{carPhotoUris.length === 1 ? '' : 's'} selected</Text>
          <View className="flex-row flex-wrap gap-3">
            {carPhotoUris.map((uri, index) => (
              <View key={`${uri}-${index}`} className="relative">
                <Image source={{ uri }} className="h-24 w-24 rounded-xl bg-gray-100" />
                <TouchableOpacity
                  onPress={() => removeCarPhoto(uri)}
                  className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-black/75 items-center justify-center"
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        <Text className="text-sm font-medium text-gray-700 mb-2">Car tier <Text className="text-red-500">*</Text></Text>
        {tiersLoading ? (
          <View className="mb-4 rounded-xl border border-gray-200 p-4 items-center">
            <ActivityIndicator size="small" color="#206EFF" />
          </View>
        ) : tiers.length === 0 ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="text-sm text-red-700">No vehicle tiers are configured yet. Ask admin to set them up in Vehicle Tiers.</Text>
          </View>
        ) : (
          <View className="mb-4 gap-3">
            {tiers.map((tier) => {
              const selected = selectedTierKey === tier.tierKey;
              return (
                <TouchableOpacity
                  key={tier.tierKey}
                  onPress={() => setSelectedTierKey(tier.tierKey)}
                  className={`rounded-xl border p-4 ${selected ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className={`text-base font-semibold ${selected ? 'text-primary' : 'text-gray-900'}`}>{tier.tierName}</Text>
                      <Text className="text-sm text-gray-500 mt-1">
                        {tier.shortDescription || [tier.regionName, tier.city].filter(Boolean).join(', ') || 'Configured by admin'}
                      </Text>
                    </View>
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={selected ? '#206EFF' : '#9ca3af'}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-2">Number plate <Text className="text-red-500">*</Text></Text>
        <TextInput className="border border-gray-200 rounded-xl p-4 text-base mb-4" placeholder="e.g. ABC 1234" value={numberPlate} onChangeText={setNumberPlate} />
        <Text className="text-sm font-medium text-gray-700 mb-2">Make <Text className="text-red-500">*</Text></Text>
        <TextInput className="border border-gray-200 rounded-xl p-4 text-base mb-4" placeholder="e.g. Toyota" value={make} onChangeText={setMake} />
        <Text className="text-sm font-medium text-gray-700 mb-2">Model <Text className="text-red-500">*</Text></Text>
        <TextInput className="border border-gray-200 rounded-xl p-4 text-base mb-4" placeholder="e.g. Corolla" value={model} onChangeText={setModel} />
        <SelectField
          label="Year"
          value={year}
          placeholder="Select year"
          onPress={() => setActiveSelectField('year')}
        />
        <Text className="text-sm font-medium text-gray-700 mb-2">Color</Text>
        <TextInput className="border border-gray-200 rounded-xl p-4 text-base mb-4" placeholder="e.g. Silver" value={color} onChangeText={setColor} />
        <SelectField
          label="Passenger seats"
          value={seatCount}
          placeholder="Select seats"
          onPress={() => setActiveSelectField('seatCount')}
        />
        <SelectField
          label="Doors"
          value={doorCount}
          placeholder="Select doors"
          onPress={() => setActiveSelectField('doorCount')}
        />

        <Text className="text-sm font-medium text-gray-700 mb-2">Vehicle category</Text>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {['sedan', 'suv', 'mpv', 'hatchback', 'van', 'other'].map((option) => {
            const selected = vehicleCategory === option;
            return (
              <TouchableOpacity
                key={option}
                onPress={() => setVehicleCategory(option)}
                className={`rounded-full border px-4 py-2 ${selected ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}`}
              >
                <Text className={`${selected ? 'text-primary' : 'text-gray-700'} font-medium capitalize`}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="text-sm font-medium text-gray-700 mb-2">Vehicle features</Text>
        <View className="mb-6 gap-2">
          {[
            { label: 'Air conditioning', value: hasAirConditioning, setter: setHasAirConditioning },
            { label: 'Phone charging ports', value: hasChargingPorts, setter: setHasChargingPorts },
            { label: 'In-car Wi-Fi', value: hasWifi, setter: setHasWifi },
            { label: 'Leather seats', value: hasLeatherSeats, setter: setHasLeatherSeats },
            { label: 'Large luggage space', value: hasLargeLuggageSpace, setter: setHasLargeLuggageSpace },
            { label: 'Sliding doors', value: hasSlidingDoors, setter: setHasSlidingDoors },
            { label: 'High-end / executive vehicle', value: isHighEnd, setter: setIsHighEnd },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              onPress={() => item.setter(!item.value)}
              className={`flex-row items-center justify-between rounded-xl border px-4 py-3 ${item.value ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}`}
            >
              <Text className={`text-base ${item.value ? 'text-primary font-semibold' : 'text-gray-800'}`}>{item.label}</Text>
              <Ionicons
                name={item.value ? 'checkbox' : 'square-outline'}
                size={22}
                color={item.value ? '#206EFF' : '#9ca3af'}
              />
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-sm font-medium text-gray-700 mb-2">Car registration book <Text className="text-red-500">*</Text></Text>
        <TouchableOpacity onPress={() => pickSingleImage(setRegBookUri)} className="mb-6 border border-gray-200 rounded-xl p-4 items-center">
          {regBookUri ? (
            <>
              <Ionicons name="document-text-outline" size={32} color="#206EFF" />
              <Text className="text-primary mt-2 font-medium">Registration book added</Text>
            </>
          ) : (
            <>
              <Ionicons name="document-outline" size={32} color="#9ca3af" />
              <Text className="text-gray-500 mt-2">Tap to upload</Text>
            </>
          )}
        </TouchableOpacity>

        <Text className="text-sm font-medium text-gray-700 mb-2">Insurance <Text className="text-red-500">*</Text></Text>
        <TouchableOpacity onPress={() => pickSingleImage(setInsuranceUri)} className="mb-6 border border-gray-200 rounded-xl p-4 items-center">
          {insuranceUri ? (
            <>
              <Ionicons name="shield-checkmark-outline" size={32} color="#206EFF" />
              <Text className="text-primary mt-2 font-medium">Insurance added</Text>
            </>
          ) : (
            <>
              <Ionicons name="shield-outline" size={32} color="#9ca3af" />
              <Text className="text-gray-500 mt-2">Tap to upload insurance</Text>
            </>
          )}
        </TouchableOpacity>

        <Text className="text-sm font-medium text-gray-700 mb-2">Zinara <Text className="text-red-500">*</Text></Text>
        <TouchableOpacity onPress={() => pickSingleImage(setZinaraUri)} className="mb-6 border border-gray-200 rounded-xl p-4 items-center">
          {zinaraUri ? (
            <>
              <Ionicons name="document-text-outline" size={32} color="#206EFF" />
              <Text className="text-primary mt-2 font-medium">Zinara added</Text>
            </>
          ) : (
            <>
              <Ionicons name="document-outline" size={32} color="#9ca3af" />
              <Text className="text-gray-500 mt-2">Tap to upload Zinara</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className={`p-4 rounded-xl bg-primary items-center ${loading || tiersLoading || tiers.length === 0 ? 'opacity-70' : ''}`}
          onPress={handleSubmit}
          disabled={loading || tiersLoading || tiers.length === 0}
        >
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white text-lg font-semibold">Submit for review</Text>}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={!!activeSelectField} transparent animationType="slide" onRequestClose={() => setActiveSelectField(null)}>
        <TouchableOpacity className="flex-1 justify-end bg-black/40" activeOpacity={1} onPress={() => setActiveSelectField(null)}>
          <TouchableOpacity activeOpacity={1} onPress={(event) => event.stopPropagation()} className="rounded-t-[24px] bg-white px-5 pt-4">
            <Text className="text-lg font-bold text-gray-900 mb-4">
              {activeSelectField === 'year' ? 'Select year' : activeSelectField === 'seatCount' ? 'Select passenger seats' : 'Select doors'}
            </Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}>
              {(activeSelectField === 'year' ? YEAR_OPTIONS : activeSelectField === 'seatCount' ? SEAT_OPTIONS : DOOR_OPTIONS).map((option) => (
                <TouchableOpacity
                  key={option}
                  onPress={() => {
                    if (activeSelectField === 'year') setYear(option);
                    if (activeSelectField === 'seatCount') setSeatCount(option);
                    if (activeSelectField === 'doorCount') setDoorCount(option);
                    setActiveSelectField(null);
                  }}
                  className="flex-row items-center justify-between border-b border-gray-100 py-4"
                >
                  <Text className="text-base text-gray-900">{option}</Text>
                  {(activeSelectField === 'year' && year === option)
                    || (activeSelectField === 'seatCount' && seatCount === option)
                    || (activeSelectField === 'doorCount' && doorCount === option) ? (
                    <Ionicons name="checkmark" size={20} color="#206EFF" />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export default DriverRegisterCarScreen;

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  BackHandler,
  Modal,
  FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { getDriverVehicleOptions, submitVehicle, uploadFile } from '../../api';
import { useDriverStatus } from '../../context/DriverStatusContext';
import { navigationRef } from '../../navigationRef';
import { getVehicleModelsForMake, VEHICLE_MAKE_MODELS, VEHICLE_YEAR_OPTIONS } from '../../constants/vehicleCatalog';

function navigateToDriverAccountTab() {
  if (!navigationRef.isReady()) return;
  try {
    navigationRef.navigate('DriverTabs', {
      screen: 'DriverAccount',
      params: { screen: 'DriverAccountMain' },
    });
  } catch {
    try {
      navigationRef.navigate('DriverTabs');
    } catch {
      // ignore
    }
  }
}

/** When this screen is the stack root (e.g. initialRouteName), goBack() throws GO_BACK — use tabs as fallback. */
function goBackOrDriverTabs(navigation) {
  if (navigation?.canGoBack?.()) {
    navigation.goBack();
    return;
  }
  try {
    navigation.replace('DriverTabs');
  } catch {
    navigateToDriverAccountTab();
  }
}

const MIN_CAR_PHOTOS = 3;
const MAX_CAR_PHOTOS = 6;
const UPLOAD_RETRY_COUNT = 2;

function SelectionModal({
  visible,
  title,
  options,
  selectedValue,
  searchPlaceholder = 'Search...',
  onClose,
  onSelect,
}) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);

  const filteredOptions = options.filter((option) =>
    String(option || '').toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-center bg-black/40 px-5">
        <View className="max-h-[78%] rounded-[24px] bg-white p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">{title}</Text>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>

          <TextInput
            className="mt-4 rounded-xl border border-gray-200 px-4 py-3 text-base"
            placeholder={searchPlaceholder}
            value={search}
            onChangeText={setSearch}
          />

          <FlatList
            className="mt-4"
            data={filteredOptions}
            keyExtractor={(item) => String(item)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const selected = String(item) === String(selectedValue || '');
              return (
                <TouchableOpacity
                  onPress={() => onSelect(item)}
                  className={`mb-2 flex-row items-center justify-between rounded-xl border px-4 py-4 ${selected ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white'}`}
                >
                  <Text className={`text-base ${selected ? 'font-semibold text-primary' : 'text-gray-800'}`}>{item}</Text>
                  <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? '#206EFF' : '#9ca3af'} />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text className="py-8 text-center text-sm text-gray-500">No matching options.</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

function SelectField({ label, value, placeholder, onPress, disabled = false }) {
  return (
    <>
      <Text className="text-sm font-medium text-gray-700 mb-2">{label} <Text className="text-red-500">*</Text></Text>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        className={`mb-4 flex-row items-center justify-between rounded-xl border p-4 ${disabled ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'}`}
      >
        <Text className={`${value ? 'text-gray-900' : 'text-gray-400'} text-base`}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={disabled ? '#d1d5db' : '#6b7280'} />
      </TouchableOpacity>
    </>
  );
}

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

function chooseImageSource({ title, message, allowCamera = true }) {
  return new Promise((resolve) => {
    const buttons = [];

    if (allowCamera) {
      buttons.push({ text: 'Take photo', onPress: () => resolve('camera') });
    }

    buttons.push({ text: 'Choose from gallery', onPress: () => resolve('gallery') });
    buttons.push({ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) });

    Alert.alert(title, message, buttons, { cancelable: true, onDismiss: () => resolve(null) });
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
  const isChangingApprovedVehicle = route.params?.changeVehicle === true || vehicle?.status === 'approved';
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
  const [showMakeModal, setShowMakeModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showYearModal, setShowYearModal] = useState(false);
  /** When true, vehicle is pending after a successful submit — show alert before auto-redirect skips this. */
  const pendingSubmitAlertRef = useRef(false);
  const makeOptions = VEHICLE_MAKE_MODELS.map((item) => item.make);
  const modelOptions = getVehicleModelsForMake(make);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (navigation.canGoBack()) return false;
        goBackOrDriverTabs(navigation);
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => sub.remove();
    }, [navigation])
  );

  // Pending vehicle (e.g. reopened app): go to Account — use root ref so it still works after stack remounts.
  useLayoutEffect(() => {
    if (!isPending || isVehicleBlocked) return;
    if (pendingSubmitAlertRef.current) return;
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => navigateToDriverAccountTab());
    });
  }, [isPending, isVehicleBlocked]);

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

      const source = await chooseImageSource({
        title: 'Add car photos',
        message: 'Use your camera for a new car photo or choose existing ones from your gallery.',
      });
      if (!source) return;

      let result;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to take car photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.8,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Gallery permission needed', 'Allow photo library access to choose car photos from your gallery.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: remaining,
          quality: 0.8,
        });
      }

      if (result.canceled || !result.assets?.length) return;
      setCarPhotoUris((current) => {
        const merged = [...current, ...result.assets.map((asset) => asset.uri).filter(Boolean)];
        return Array.from(new Set(merged)).slice(0, MAX_CAR_PHOTOS);
      });
    } catch {
      Alert.alert('Error', 'Could not open the car photo picker');
    }
  };

  const pickSingleImage = async (setter) => {
    try {
      const source = await chooseImageSource({
        title: 'Upload document',
        message: 'Use your camera or choose an existing document photo from your gallery.',
      });
      if (!source) return;

      const allowsEditing = await askCropPreference();
      let result;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to take a document photo.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing,
          quality: 0.8,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Gallery permission needed', 'Allow photo library access to choose a document image from your gallery.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing,
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets?.[0]?.uri) setter(result.assets[0].uri);
    } catch {
      Alert.alert('Error', 'Could not open the document picker');
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

    const yearNum = Number(year);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(yearNum) || yearNum < 2010 || yearNum > currentYear + 1) {
      Alert.alert('Invalid year', `Enter a year between 2010 and ${currentYear + 1}.`);
      return;
    }
    const seatsNum = Number(seatCount);
    const doorsNum = Number(doorCount);
    if (!Number.isInteger(seatsNum) || seatsNum < 1 || seatsNum > 50) {
      Alert.alert('Invalid seats', 'Enter a whole number of passenger seats between 1 and 50.');
      return;
    }
    if (!Number.isInteger(doorsNum) || doorsNum < 1 || doorsNum > 10) {
      Alert.alert('Invalid doors', 'Enter a whole number of doors between 1 and 10.');
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
        year: yearNum,
        color: color.trim() || null,
        seatCount: seatsNum,
        doorCount: doorsNum,
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

      pendingSubmitAlertRef.current = true;
      // Do not refetch before this alert: it remounts the driver stack (`key={initialRoute}`) and invalidates
      // `navigation.replace`, which then leaves `isPending && !pendingSubmitAlertRef` → blank white view.
      let finishedAfterSubmit = false;
      const finishAfterSubmit = () => {
        if (finishedAfterSubmit) return;
        finishedAfterSubmit = true;
        void (async () => {
          try {
            await refetchDriverStatus();
          } catch {
            // User already submitted — still send them to Account.
          }
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              navigateToDriverAccountTab();
              pendingSubmitAlertRef.current = false;
            });
          });
        })();
      };
      Alert.alert(
        'Vehicle under review',
        'We are reviewing your registration. You will be notified when there is an update. Status is also shown under Account → Car registration.',
        [{ text: 'OK', onPress: finishAfterSubmit }],
        { onDismiss: finishAfterSubmit }
      );
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  if (isPending && !isVehicleBlocked && !pendingSubmitAlertRef.current) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <ActivityIndicator size="large" color="#206EFF" />
        <Text className="text-base text-gray-600 text-center mt-4">Opening your account…</Text>
      </View>
    );
  }

  if (isVehicleBlocked) {
    return (
      <View className="flex-1 bg-white">
        <View style={{ paddingTop: insets.top, paddingHorizontal: 20, paddingBottom: 12 }}>
          <TouchableOpacity onPress={() => goBackOrDriverTabs(navigation)} className="p-2 -ml-2">
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
        <TouchableOpacity onPress={() => goBackOrDriverTabs(navigation)} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 24) }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-2xl font-bold text-gray-900 mb-2">{isChangingApprovedVehicle ? 'Change your car' : 'Register your car'}</Text>
        <Text className="text-sm text-gray-600 mb-4">
          {isChangingApprovedVehicle
            ? 'Submit the new car details and documents for admin review. You will be offline until the new car is approved.'
            : 'Upload at least 3 car photos, your registration book, and choose the car tier configured by admin.'}
        </Text>

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
        <SelectField
          label="Make"
          value={make}
          placeholder="Choose a vehicle make"
          onPress={() => setShowMakeModal(true)}
        />
        <SelectField
          label="Model"
          value={model}
          placeholder={make ? 'Choose a vehicle model' : 'Select make first'}
          onPress={() => setShowModelModal(true)}
          disabled={!make}
        />
        <SelectField
          label="Year"
          value={year}
          placeholder="Choose a year from 2010 onwards"
          onPress={() => setShowYearModal(true)}
        />
        <Text className="text-sm font-medium text-gray-700 mb-2">Color</Text>
        <TextInput className="border border-gray-200 rounded-xl p-4 text-base mb-4" placeholder="e.g. Silver" value={color} onChangeText={setColor} />
        <Text className="text-sm font-medium text-gray-700 mb-2">Passenger seats <Text className="text-red-500">*</Text></Text>
        <TextInput
          className="border border-gray-200 rounded-xl p-4 text-base mb-4"
          placeholder="e.g. 5"
          value={seatCount}
          onChangeText={(text) => setSeatCount(text.replace(/[^\d]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
        />
        <Text className="text-sm font-medium text-gray-700 mb-2">Doors <Text className="text-red-500">*</Text></Text>
        <TextInput
          className="border border-gray-200 rounded-xl p-4 text-base mb-4"
          placeholder="e.g. 4"
          value={doorCount}
          onChangeText={(text) => setDoorCount(text.replace(/[^\d]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
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
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white text-lg font-semibold">{isChangingApprovedVehicle ? 'Submit change for review' : 'Submit for review'}</Text>}
        </TouchableOpacity>
      </ScrollView>

      <SelectionModal
        visible={showMakeModal}
        title="Select Vehicle Make"
        options={makeOptions}
        selectedValue={make}
        searchPlaceholder="Search vehicle make"
        onClose={() => setShowMakeModal(false)}
        onSelect={(value) => {
          setMake(value);
          if (!getVehicleModelsForMake(value).includes(model)) {
            setModel('');
          }
          setShowMakeModal(false);
        }}
      />

      <SelectionModal
        visible={showModelModal}
        title="Select Vehicle Model"
        options={modelOptions}
        selectedValue={model}
        searchPlaceholder="Search vehicle model"
        onClose={() => setShowModelModal(false)}
        onSelect={(value) => {
          setModel(value);
          setShowModelModal(false);
        }}
      />

      <SelectionModal
        visible={showYearModal}
        title="Select Vehicle Year"
        options={VEHICLE_YEAR_OPTIONS}
        selectedValue={year}
        searchPlaceholder="Search year"
        onClose={() => setShowYearModal(false)}
        onSelect={(value) => {
          setYear(value);
          setShowYearModal(false);
        }}
      />
    </View>
  );
};

export default DriverRegisterCarScreen;

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createHireVehicle, resolveUploadedMediaUrl, updateHireVehicle, uploadFile } from '../../api';
import { persistLocalImageUri, prepareImageForUpload } from '../../services/localImageUpload';
import { PRIMARY_BLUE } from '../../constants/colors';

const CATEGORIES = ['sedan', 'suv', 'van', 'bus', 'truck', 'other'];

export default function DriverHireVehicleFormScreen({ navigation, route }) {
  const existing = route.params?.vehicle || null;
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [title, setTitle] = useState(existing?.title || '');
  const [category, setCategory] = useState(existing?.category || 'sedan');
  const [make, setMake] = useState(existing?.make || '');
  const [model, setModel] = useState(existing?.model || '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [color, setColor] = useState(existing?.color || '');
  const [numberPlate, setNumberPlate] = useState(existing?.numberPlate || '');
  const [seatCount, setSeatCount] = useState(existing?.seatCount ? String(existing.seatCount) : '');
  const [dailyRate, setDailyRate] = useState(existing?.dailyRate != null ? String(existing.dailyRate) : '');
  const [description, setDescription] = useState(existing?.description || '');
  const [photoUrls, setPhotoUrls] = useState(Array.isArray(existing?.photoUrls) ? existing.photoUrls : []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const heading = useMemo(() => (existing ? 'Edit hire vehicle' : 'Add hire vehicle'), [existing]);

  const pickPhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to upload vehicle photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploading(true);
      const token = await getToken({ skipCache: true });
      const localUri = await persistLocalImageUri(result.assets[0].uri);
      const prepared = await prepareImageForUpload(localUri);
      const uploaded = await uploadFile(token, prepared);
      const url = uploaded?.url || uploaded?.path;
      if (!url) throw new Error('Upload failed');
      setPhotoUrls((prev) => [...prev, url].slice(0, 8));
    } catch (err) {
      Alert.alert('Upload failed', err?.message || 'Could not upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (!title.trim()) {
        Alert.alert('Missing title', 'Enter a vehicle title.');
        return;
      }
      if (photoUrls.length < 1) {
        Alert.alert('Photo required', 'Add at least one vehicle photo.');
        return;
      }
      setSaving(true);
      const token = await getToken({ skipCache: true });
      const payload = {
        title: title.trim(),
        category,
        make: make.trim() || null,
        model: model.trim() || null,
        year: year.trim() ? Number(year) : null,
        color: color.trim() || null,
        numberPlate: numberPlate.trim() || null,
        seatCount: seatCount.trim() ? Number(seatCount) : null,
        dailyRate: dailyRate.trim() ? Number(dailyRate) : null,
        description: description.trim() || null,
        photoUrls,
        currency: 'USD',
      };
      if (existing?.id) {
        await updateHireVehicle(token, existing.id, payload);
      } else {
        await createHireVehicle(token, payload);
      }
      Alert.alert('Submitted', 'Your hire vehicle was submitted for review.');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Save failed', err?.message || 'Could not save hire vehicle');
    } finally {
      setSaving(false);
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
        <Text className="text-[18px] font-bold text-gray-900">{heading}</Text>
        <View className="h-10 w-10" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 28 }}>
        <View className="rounded-[28px] bg-white px-5 py-5">
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Toyota Quantum for hire" />
          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Category</Text>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setCategory(item)}
                className="rounded-full px-3 py-2"
                style={{
                  backgroundColor: category === item ? PRIMARY_BLUE : '#f1f5f9',
                }}
              >
                <Text className="text-xs font-semibold capitalize" style={{ color: category === item ? '#fff' : '#334155' }}>
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" />
          <Field label="Model" value={model} onChangeText={setModel} placeholder="Quantum" />
          <Field label="Year" value={year} onChangeText={setYear} placeholder="2018" keyboardType="number-pad" />
          <Field label="Color" value={color} onChangeText={setColor} placeholder="White" />
          <Field label="Number plate" value={numberPlate} onChangeText={setNumberPlate} placeholder="ABC1234" autoCapitalize="characters" />
          <Field label="Seats" value={seatCount} onChangeText={setSeatCount} placeholder="14" keyboardType="number-pad" />
          <Field label="Daily rate (USD)" value={dailyRate} onChangeText={setDailyRate} placeholder="80" keyboardType="decimal-pad" />
          <Field label="Description" value={description} onChangeText={setDescription} placeholder="Notes for passengers" multiline />

          <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">Photos</Text>
          <View className="flex-row flex-wrap gap-2">
            {photoUrls.map((url) => (
              <View key={url} className="relative">
                <Image
                  source={{ uri: resolveUploadedMediaUrl(url) }}
                  className="h-20 w-20 rounded-xl"
                />
                <TouchableOpacity
                  onPress={() => setPhotoUrls((prev) => prev.filter((item) => item !== url))}
                  className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-rose-500"
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              onPress={pickPhoto}
              disabled={uploading || photoUrls.length >= 8}
              className="h-20 w-20 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50"
            >
              {uploading ? <ActivityIndicator color={PRIMARY_BLUE} /> : <Ionicons name="camera-outline" size={22} color="#64748b" />}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            className="mt-6 h-12 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: PRIMARY_BLUE, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text className="text-sm font-bold uppercase text-white">
                {existing ? 'Resubmit for review' : 'Submit for review'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  multiline = false,
}) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        className={`${multiline ? 'min-h-[96px] py-3' : 'h-12'} rounded-[18px] border border-gray-200 bg-[#f8fafc] px-4 text-base text-gray-900`}
      />
    </View>
  );
}

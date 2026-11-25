import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COUNTRIES, getCountry } from '../constants/countries';
import { PRIMARY_BLUE } from '../constants/colors';

export default function CountrySelectField({
  value,
  onChange,
  label = 'Country',
  supportedCountryCodes = ['ZA', 'ZW'],
  helpText = '',
  compact = false,
}) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCountry = getCountry(value) || getCountry('ZW');
  const supportedCodes = useMemo(
    () => new Set(supportedCountryCodes.map((code) => String(code).toUpperCase())),
    [supportedCountryCodes],
  );
  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return COUNTRIES;
    return COUNTRIES.filter((country) => (
      country.name.toLowerCase().includes(normalizedQuery)
      || country.code.toLowerCase().includes(normalizedQuery)
    ));
  }, [query]);

  const close = () => {
    setVisible(false);
    setQuery('');
  };

  return (
    <View>
      <Text className={compact ? 'mb-1 text-xs font-medium text-gray-800' : 'mb-2 text-sm font-medium text-gray-700'}>{label}</Text>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        activeOpacity={0.85}
        className={`h-14 flex-row items-center border border-gray-200 bg-white ${compact ? 'rounded-sm px-3' : 'rounded-xl px-4'}`}
      >
        <Text className="mr-3 text-2xl">{selectedCountry.flag}</Text>
        <Text className="flex-1 text-base font-semibold text-gray-900">{selectedCountry.name}</Text>
        <Ionicons name="chevron-down" size={20} color="#64748b" />
      </TouchableOpacity>
      {helpText ? <Text className="mt-2 text-xs leading-5 text-gray-500">{helpText}</Text> : null}

      <Modal visible={visible} animationType="slide" onRequestClose={close}>
        <View className="flex-1 bg-white px-5 pb-5 pt-14">
          <View className="mb-5 flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-2xl font-bold text-gray-900">Choose your country</Text>
            </View>
            <TouchableOpacity onPress={close} className="h-11 w-11 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="close" size={22} color="#111827" />
            </TouchableOpacity>
          </View>

          <View className="mb-4 h-12 flex-row items-center rounded-xl bg-gray-100 px-4">
            <Ionicons name="search" size={20} color="#64748b" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search countries"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              className="ml-3 flex-1 text-base text-gray-900"
            />
          </View>

          <FlatList
            data={filteredCountries}
            keyExtractor={(country) => country.code}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            renderItem={({ item }) => {
              const supported = supportedCodes.has(item.code);
              const selected = item.code === selectedCountry.code;
              return (
                <TouchableOpacity
                  onPress={() => {
                    if (!supported) return;
                    onChange(item.code);
                    close();
                  }}
                  activeOpacity={supported ? 0.75 : 1}
                  className={`mb-2 flex-row items-center rounded-2xl border px-4 py-3 ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white'} ${supported ? '' : 'opacity-55'}`}
                >
                  <Text className="mr-4 text-3xl">{item.flag}</Text>
                  <View className="flex-1">
                    <Text className={`text-base font-semibold ${selected ? 'text-blue-800' : 'text-gray-900'}`}>{item.name}</Text>
                    <Text className="mt-0.5 text-xs text-gray-500">{item.code}</Text>
                  </View>
                  {supported ? (
                    selected
                      ? <Ionicons name="checkmark-circle" size={24} color={PRIMARY_BLUE} />
                      : <Text className="text-xs font-bold uppercase text-emerald-600">Available</Text>
                  ) : (
                    <Text className="text-xs font-semibold text-gray-500">Coming soon</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

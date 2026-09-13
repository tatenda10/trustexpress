import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRIMARY_BLUE } from '../../constants/colors';

export const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
];

const MONTHS = [
  { value: 1, label: 'Jan', full: 'January' },
  { value: 2, label: 'Feb', full: 'February' },
  { value: 3, label: 'Mar', full: 'March' },
  { value: 4, label: 'Apr', full: 'April' },
  { value: 5, label: 'May', full: 'May' },
  { value: 6, label: 'Jun', full: 'June' },
  { value: 7, label: 'Jul', full: 'July' },
  { value: 8, label: 'Aug', full: 'August' },
  { value: 9, label: 'Sep', full: 'September' },
  { value: 10, label: 'Oct', full: 'October' },
  { value: 11, label: 'Nov', full: 'November' },
  { value: 12, label: 'Dec', full: 'December' },
];

const MIN_YEAR = 1940;
const MIN_AGE = 16;

function currentYear() {
  return new Date().getFullYear();
}

function maxBirthYear() {
  return currentYear() - MIN_AGE;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function parseDateOfBirth(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatDateOfBirth(value) {
  const parsed = parseDateOfBirth(value);
  if (!parsed) return '';
  return `${parsed.day} ${MONTHS[parsed.month - 1].full} ${parsed.year}`;
}

export function toDateOfBirth(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function defaultPickerDate(value) {
  return parseDateOfBirth(value) || { year: 1998, month: 1, day: 1 };
}

function genderLabel(value) {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label || '';
}

function SelectField({ label, value, placeholder, onPress, disabled }) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[1.2px] text-gray-500">{label}</Text>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
        className="h-12 flex-row items-center justify-between rounded-[18px] border border-gray-200 bg-white px-4"
        style={{ opacity: disabled ? 0.7 : 1 }}
      >
        <Text className={`text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#6b7280" />
      </TouchableOpacity>
    </View>
  );
}

function PickerColumn({ items, selectedValue, onSelect }) {
  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      {items.map((item) => {
        const selected = item.value === selectedValue;
        return (
          <TouchableOpacity
            key={String(item.value)}
            onPress={() => onSelect(item.value)}
            activeOpacity={0.8}
            className="mb-1 items-center rounded-xl py-2.5"
            style={{ backgroundColor: selected ? '#eff6ff' : 'transparent' }}
          >
            <Text
              className="text-sm"
              style={{
                color: selected ? PRIMARY_BLUE : '#374151',
                fontWeight: selected ? '700' : '500',
              }}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function DateOfBirthPickerModal({ visible, value, onClose, onConfirm }) {
  const initial = defaultPickerDate(value);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  useEffect(() => {
    if (!visible) return;
    const next = defaultPickerDate(value);
    setYear(next.year);
    setMonth(next.month);
    setDay(next.day);
  }, [visible, value]);

  const years = useMemo(
    () => Array.from({ length: maxBirthYear() - MIN_YEAR + 1 }, (_, index) => {
      const nextYear = maxBirthYear() - index;
      return { value: nextYear, label: String(nextYear) };
    }),
    []
  );

  const maxDay = daysInMonth(year, month);
  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, index) => {
      const nextDay = index + 1;
      return { value: nextDay, label: String(nextDay) };
    }),
    [maxDay]
  );

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [day, maxDay]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-5">
        <View className="w-full rounded-[28px] bg-white px-5 py-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Date of birth</Text>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>
          <View className="h-64 flex-row">
            <PickerColumn items={days} selectedValue={Math.min(day, maxDay)} onSelect={setDay} />
            <PickerColumn items={MONTHS} selectedValue={month} onSelect={setMonth} />
            <PickerColumn items={years} selectedValue={year} onSelect={setYear} />
          </View>
          <TouchableOpacity
            onPress={() => {
              onConfirm(toDateOfBirth(year, month, Math.min(day, maxDay)));
              onClose();
            }}
            className="mt-4 h-12 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: PRIMARY_BLUE }}
          >
            <Text className="text-sm font-bold uppercase text-white">Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function GenderPickerModal({ visible, value, onClose, onSelect }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-5">
        <View className="w-full rounded-[28px] bg-white px-5 py-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Gender</Text>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>
          {GENDER_OPTIONS.map((option) => {
            const selected = value === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                activeOpacity={0.8}
                className="mb-2 flex-row items-center justify-between rounded-[18px] border px-4 py-4"
                style={{
                  borderColor: selected ? PRIMARY_BLUE : '#e5e7eb',
                  backgroundColor: selected ? '#eff6ff' : '#f8fafc',
                }}
              >
                <Text className="text-base font-semibold text-gray-900">{option.label}</Text>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={selected ? PRIMARY_BLUE : '#9ca3af'}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

export default function SmileCashIdentityFields({
  dateOfBirth,
  gender,
  disabled = false,
  onDateOfBirthChange,
  onGenderChange,
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  return (
    <>
      <SelectField
        label="Date of birth"
        value={formatDateOfBirth(dateOfBirth)}
        placeholder="Select date of birth"
        disabled={disabled}
        onPress={() => setShowDatePicker(true)}
      />
      <SelectField
        label="Gender"
        value={genderLabel(gender)}
        placeholder="Select gender"
        disabled={disabled}
        onPress={() => setShowGenderPicker(true)}
      />
      <DateOfBirthPickerModal
        visible={showDatePicker}
        value={dateOfBirth}
        onClose={() => setShowDatePicker(false)}
        onConfirm={onDateOfBirthChange}
      />
      <GenderPickerModal
        visible={showGenderPicker}
        value={gender}
        onClose={() => setShowGenderPicker(false)}
        onSelect={onGenderChange}
      />
    </>
  );
}

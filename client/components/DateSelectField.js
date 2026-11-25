import React, { useEffect, useState } from 'react';
import { Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { PRIMARY_BLUE } from '../constants/colors';

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

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateValue(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateValue(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function formatDateValue(value) {
  const parsed = parseDateValue(value);
  if (!parsed) return '';
  return `${parsed.day} ${MONTHS[parsed.month - 1].full} ${parsed.year}`;
}

function clampYear(value, minYear, maxYear) {
  const year = Number(value);
  if (!Number.isFinite(year)) return maxYear;
  return Math.min(Math.max(year, minYear), maxYear);
}

function defaultPickerDate(value, minYear, maxYear, fallbackYear) {
  const parsed = parseDateValue(value);
  if (parsed) {
    const year = clampYear(parsed.year, minYear, maxYear);
    return {
      year,
      month: parsed.month,
      day: Math.min(parsed.day, daysInMonth(year, parsed.month)),
    };
  }
  return { year: clampYear(fallbackYear, minYear, maxYear), month: 1, day: 1 };
}

function pickerDate(value, minYear, maxYear, fallbackYear) {
  const selected = defaultPickerDate(value, minYear, maxYear, fallbackYear);
  return new Date(selected.year, selected.month - 1, selected.day, 12, 0, 0, 0);
}

function dateToValue(date) {
  return toDateValue(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function DatePickerModal({
  visible,
  title,
  value,
  minYear,
  maxYear,
  fallbackYear,
  onClose,
  onConfirm,
}) {
  const [selectedDate, setSelectedDate] = useState(() => pickerDate(value, minYear, maxYear, fallbackYear));

  useEffect(() => {
    if (!visible) return;
    setSelectedDate(pickerDate(value, minYear, maxYear, fallbackYear));
  }, [fallbackYear, maxYear, minYear, value, visible]);

  const minimumDate = new Date(minYear, 0, 1, 12, 0, 0, 0);
  const maximumDate = new Date(maxYear, 11, 31, 12, 0, 0, 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-5">
        <View className="w-full rounded-[28px] bg-white px-5 py-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">{title}</Text>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-gray-100">
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_event, nextDate) => {
              if (nextDate) setSelectedDate(nextDate);
            }}
            style={{ alignSelf: 'center' }}
          />
          <TouchableOpacity
            onPress={() => {
              onConfirm(dateToValue(selectedDate));
              onClose();
            }}
            className="mt-4 h-12 items-center justify-center rounded-sm"
            style={{ backgroundColor: PRIMARY_BLUE }}
          >
            <Text className="text-sm font-bold uppercase text-white">Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function DateSelectField({
  label,
  value,
  placeholder = 'Select date',
  required = false,
  minYear = 1940,
  maxYear = new Date().getFullYear(),
  fallbackYear = maxYear,
  helpText = '',
  compact = false,
  onChange,
}) {
  const [visible, setVisible] = useState(false);
  const displayValue = formatDateValue(value);
  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerDate(value, minYear, maxYear, fallbackYear),
        mode: 'date',
        display: 'calendar',
        minimumDate: new Date(minYear, 0, 1, 12, 0, 0, 0),
        maximumDate: new Date(maxYear, 11, 31, 12, 0, 0, 0),
        onChange: (event, selectedDate) => {
          if (event.type === 'set' && selectedDate) onChange(dateToValue(selectedDate));
        },
      });
      return;
    }
    setVisible(true);
  };

  return (
    <View>
      <Text className={compact ? 'mb-1 text-xs font-medium text-gray-800' : 'mb-2 text-sm font-medium text-gray-700'}>
        {label} {required ? <Text className="text-red-500">*</Text> : null}
      </Text>
      <TouchableOpacity
        onPress={openPicker}
        activeOpacity={0.85}
        className={`mb-1 h-14 flex-row items-center justify-between bg-white ${compact ? 'rounded-sm px-3' : 'rounded-2xl px-4'}`}
        style={{ borderWidth: 1, borderColor: compact ? '#D7DDE5' : '#E5E7EB' }}
      >
        <Text className={`text-base ${displayValue ? 'text-gray-900' : 'text-gray-400'}`}>
          {displayValue || placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={20} color="#6b7280" />
      </TouchableOpacity>
      {helpText ? <Text className="mb-4 text-xs text-gray-500">{helpText}</Text> : <View className="mb-4" />}
      {Platform.OS === 'ios' ? (
        <DatePickerModal
          visible={visible}
          title={label}
          value={value}
          minYear={minYear}
          maxYear={maxYear}
          fallbackYear={fallbackYear}
          onClose={() => setVisible(false)}
          onConfirm={onChange}
        />
      ) : null}
    </View>
  );
}

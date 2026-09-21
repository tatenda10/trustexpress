import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const initial = defaultPickerDate(value, minYear, maxYear, fallbackYear);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  useEffect(() => {
    if (!visible) return;
    const next = defaultPickerDate(value, minYear, maxYear, fallbackYear);
    setYear(next.year);
    setMonth(next.month);
    setDay(next.day);
  }, [fallbackYear, maxYear, minYear, value, visible]);

  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, index) => {
      const nextYear = maxYear - index;
      return { value: nextYear, label: String(nextYear) };
    }),
    [maxYear, minYear],
  );

  const maxDay = daysInMonth(year, month);
  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, index) => {
      const nextDay = index + 1;
      return { value: nextDay, label: String(nextDay) };
    }),
    [maxDay],
  );

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [day, maxDay]);

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
          <View className="h-64 flex-row">
            <PickerColumn items={days} selectedValue={Math.min(day, maxDay)} onSelect={setDay} />
            <PickerColumn items={MONTHS} selectedValue={month} onSelect={setMonth} />
            <PickerColumn items={years} selectedValue={year} onSelect={setYear} />
          </View>
          <TouchableOpacity
            onPress={() => {
              onConfirm(toDateValue(year, month, Math.min(day, maxDay)));
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

export default function DateSelectField({
  label,
  value,
  placeholder = 'Select date',
  required = false,
  minYear = 1940,
  maxYear = new Date().getFullYear(),
  fallbackYear = maxYear,
  helpText = '',
  onChange,
}) {
  const [visible, setVisible] = useState(false);
  const displayValue = formatDateValue(value);

  return (
    <View>
      <Text className="mb-2 text-sm font-medium text-gray-700">
        {label} {required ? <Text className="text-red-500">*</Text> : null}
      </Text>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        activeOpacity={0.85}
        className="mb-1 h-14 flex-row items-center justify-between rounded-xl border border-gray-200 bg-white px-4"
      >
        <Text className={`text-base ${displayValue ? 'text-gray-900' : 'text-gray-400'}`}>
          {displayValue || placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={20} color="#6b7280" />
      </TouchableOpacity>
      {helpText ? <Text className="mb-4 text-xs text-gray-500">{helpText}</Text> : <View className="mb-4" />}
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
    </View>
  );
}

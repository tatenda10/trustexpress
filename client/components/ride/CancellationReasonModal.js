import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';

export default function CancellationReasonModal({
  visible,
  reasons,
  onClose,
  onSubmit,
  submitting = false,
  subtitle = 'Select a reason to continue',
  keepLabel = 'Keep ride',
}) {
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState('');
  const [explanation, setExplanation] = useState('');
  const selectedReason = reasons.find((reason) => reason.id === selectedId) || null;
  const explanationRequired = selectedReason?.requiresExplanation === true;
  const canSubmit = Boolean(selectedReason)
    && (!explanationRequired || explanation.trim().length >= 3)
    && !submitting;

  useEffect(() => {
    if (visible) {
      setSelectedId('');
      setExplanation('');
    }
  }, [visible]);

  const submit = () => {
    if (!canSubmit) return;
    const reason = explanationRequired
      ? `Other: ${explanation.trim()}`
      : selectedReason.label;
    onSubmit(reason);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-end bg-black/50"
      >
        <TouchableOpacity activeOpacity={1} onPress={onClose} className="flex-1 justify-end">
          <TouchableOpacity
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
            className="max-h-[88%] rounded-t-3xl bg-white px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
          >
            <View className="mb-4 items-center">
              <View className="h-1 w-12 rounded-full bg-gray-200" />
            </View>
            <Text className="text-xl font-bold text-gray-900">Why are you cancelling?</Text>
            <Text className="mt-1 text-sm text-gray-500">{subtitle}</Text>

            <ScrollView
              className="mt-4"
              style={{ maxHeight: 420 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {reasons.map((reason) => {
                const selected = selectedId === reason.id;
                return (
                  <TouchableOpacity
                    key={reason.id}
                    onPress={() => {
                      setSelectedId(reason.id);
                      if (!reason.requiresExplanation) setExplanation('');
                    }}
                    className={`mb-2 flex-row items-center justify-between rounded-xl px-4 py-3.5 ${selected ? 'bg-blue-50' : 'bg-gray-50'}`}
                  >
                    <Text className={`flex-1 pr-3 text-sm font-medium ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                      {reason.label}
                    </Text>
                    <View
                      className="h-5 w-5 items-center justify-center rounded-full border-2"
                      style={{ borderColor: selected ? PRIMARY_BLUE : '#d1d5db', backgroundColor: selected ? PRIMARY_BLUE : '#fff' }}
                    >
                      {selected ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {explanationRequired ? (
                <TextInput
                  value={explanation}
                  onChangeText={setExplanation}
                  placeholder="Please explain why you are cancelling"
                  multiline
                  maxLength={250}
                  className="mt-1 min-h-24 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900"
                  textAlignVertical="top"
                />
              ) : null}
            </ScrollView>

            <TouchableOpacity
              onPress={submit}
              disabled={!canSubmit}
              className="mt-5 h-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: canSubmit ? PRIMARY_BLUE : '#bfdbfe' }}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text className="text-base font-bold text-white">Confirm cancellation</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} className="mt-2 items-center py-3">
              <Text className="text-sm font-semibold text-gray-500">{keepLabel}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

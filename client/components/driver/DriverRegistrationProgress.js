import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRIMARY_BLUE } from '../../constants/colors';

const STEPS = [
  { label: 'Personal', icon: 'person-outline' },
  { label: 'Documents', icon: 'document-text-outline' },
  { label: 'Vehicle', icon: 'car-outline' },
];

export default function DriverRegistrationProgress({
  currentStep,
  topInset = 0,
  onBack = null,
  onHelp = null,
}) {
  const activeStep = Math.min(Math.max(Number(currentStep) || 1, 1), STEPS.length);

  return (
    <View className="bg-white" style={{ paddingTop: topInset }}>
      <View className="h-14 flex-row items-center justify-between px-5">
        {onBack ? (
          <TouchableOpacity onPress={onBack} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <Ionicons name="arrow-back" size={21} color="#0f172a" />
          </TouchableOpacity>
        ) : <View className="h-10 w-10" />}
        <View className="items-center">
          <Text className="text-[17px] font-bold text-slate-950">Driver registration</Text>
          <Text className="mt-0.5 text-[11px] font-medium text-slate-400">Trust Express</Text>
        </View>
        {onHelp ? (
          <TouchableOpacity onPress={onHelp} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
            <Ionicons name="help-circle-outline" size={22} color="#475569" />
          </TouchableOpacity>
        ) : <View className="h-10 w-10" />}
      </View>

      <View className="px-5 pb-4 pt-2">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-[12px] font-bold uppercase tracking-[1.5px] text-slate-500">
            Step {activeStep} of {STEPS.length}
          </Text>
          <Text className="text-[12px] font-semibold" style={{ color: PRIMARY_BLUE }}>
            {STEPS[activeStep - 1].label}
          </Text>
        </View>
        <View className="flex-row gap-2">
          {STEPS.map((step, index) => {
            const stepNumber = index + 1;
            const complete = stepNumber < activeStep;
            const active = stepNumber === activeStep;
            return (
              <View key={step.label} className="flex-1 items-center">
                <View
                  className="h-1.5 w-full rounded-full"
                  style={{ backgroundColor: complete || active ? PRIMARY_BLUE : '#e2e8f0' }}
                />
                <View className="mt-2 flex-row items-center">
                  <Ionicons
                    name={complete ? 'checkmark-circle' : step.icon}
                    size={14}
                    color={complete || active ? PRIMARY_BLUE : '#94a3b8'}
                  />
                  <Text
                    className="ml-1 text-[10px] font-semibold"
                    style={{ color: complete || active ? '#334155' : '#94a3b8' }}
                    numberOfLines={1}
                  >
                    {step.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

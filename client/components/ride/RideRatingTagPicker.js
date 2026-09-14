import React from 'react';
import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getRatingStarLabel, isRatingTagSelected } from '../../constants/rideRatingTags';

export default function RideRatingTagPicker({
  rating,
  onChangeRating,
  groups = [],
  selectedTags = [],
  onToggleTag,
  review,
  onChangeReview,
  title,
  subtitle,
  safetyNote,
}) {
  const starLabel = getRatingStarLabel(rating);

  return (
    <View>
      {title ? <Text className="text-2xl font-bold text-gray-900">{title}</Text> : null}
      {subtitle ? <Text className="mt-2 text-sm text-gray-500">{subtitle}</Text> : null}

      <View className="mt-5 flex-row items-center justify-between">
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            onPress={() => onChangeRating?.(value)}
            hitSlop={8}
            className="h-14 w-14 items-center justify-center rounded-full bg-[#f8fafc]"
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <Ionicons
              name={value <= rating ? 'star' : 'star-outline'}
              size={28}
              color={value <= rating ? '#f59e0b' : '#9ca3af'}
            />
          </Pressable>
        ))}
      </View>
      <Text className="mt-2 text-center text-sm font-semibold text-gray-700">
        {rating > 0 ? `${rating} — ${starLabel}` : 'Tap a star to rate'}
      </Text>
      <Text className="mt-1 text-center text-xs text-gray-400">
        1 Very Poor · 2 Poor · 3 Average · 4 Good · 5 Excellent
      </Text>

      <Text className="mt-5 text-sm font-semibold text-gray-800">
        Select all options that describe your experience:
      </Text>

      {groups.map((group) => (
        <View key={group.key || group.title} className="mt-4">
          <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            {group.title}
          </Text>
          {(group.tags || []).map((tag) => {
            const selected = isRatingTagSelected(selectedTags, tag);
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => onToggleTag?.(tag)}
                activeOpacity={0.8}
                className={`mb-2 flex-row items-start rounded-2xl border px-3 py-3 ${
                  selected ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <Ionicons
                  name={selected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={selected ? '#1d4ed8' : '#9ca3af'}
                  style={{ marginTop: 1 }}
                />
                <Text className={`ml-3 flex-1 text-sm leading-5 ${selected ? 'font-semibold text-blue-800' : 'text-gray-700'}`}>
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <TextInput
        value={review}
        onChangeText={onChangeReview}
        placeholder="Write optional extra feedback"
        multiline
        textAlignVertical="top"
        className="mt-4 min-h-[110px] rounded-[22px] bg-[#f8fafc] px-4 py-4 text-base text-gray-900"
      />

      {safetyNote ? (
        <View className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-amber-700">Safety</Text>
          <Text className="mt-2 text-sm leading-5 text-amber-900">{safetyNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

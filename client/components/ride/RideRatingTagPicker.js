import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIMARY_BLUE } from '../../constants/colors';
import { getRatingStarLabel, isRatingTagSelected } from '../../constants/rideRatingTags';

const POSITIVE_STYLE = { icon: 'thumbs-up', color: '#16a34a', background: '#ecfdf5', hint: 'What went well' };
const SAFETY_STYLE = { icon: 'shield-outline', color: '#dc2626', background: '#fef2f2', hint: 'Report a safety issue' };
const CONCERN_STYLE = { icon: 'alert-circle-outline', color: '#d97706', background: '#fffbeb', hint: 'Report a problem' };
const SAFETY_GROUP_KEYS = new Set(['safety', 'prohibited', 'harassment', 'behaviour']);

function getGroupKey(group) {
  return group.key || group.title;
}

function getGroupStyle(group) {
  if (group.key === 'positive') return POSITIVE_STYLE;
  if (SAFETY_GROUP_KEYS.has(group.key)) return SAFETY_STYLE;
  return CONCERN_STYLE;
}

function FeedbackOptionsSheet({ group, selectedTags, onClose, onApply }) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => (group?.tags || []).filter((tag) => isRatingTagSelected(selectedTags, tag)));
  const style = group ? getGroupStyle(group) : POSITIVE_STYLE;

  const toggleDraft = (tag) => {
    setDraft((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  };

  return (
    <Modal visible={Boolean(group)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/30" />
      <View
        className="max-h-[80%] rounded-t-[16px] bg-white px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}
      >
        <View className="mb-3 h-1 w-10 self-center rounded-full bg-gray-200" />
        <View className="flex-row items-center">
          <View className="h-9 w-9 items-center justify-center rounded-[10px]" style={{ backgroundColor: style.background }}>
            <Ionicons name={style.icon} size={18} color={style.color} />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-base font-bold text-gray-900">{group?.title}</Text>
            <Text className="text-xs text-gray-500">Select all that apply</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} className="h-9 w-9 items-center justify-center rounded-[10px] bg-gray-100">
            <Ionicons name="close" size={18} color="#374151" />
          </TouchableOpacity>
        </View>

        <ScrollView className="mt-3" showsVerticalScrollIndicator={false}>
          {(group?.tags || []).map((tag) => {
            const selected = draft.includes(tag);
            return (
              <TouchableOpacity
                key={tag}
                onPress={() => toggleDraft(tag)}
                activeOpacity={0.8}
                className="mb-2 flex-row items-center rounded-[10px] px-3 py-3"
                style={{ backgroundColor: selected ? style.background : '#f8fafc' }}
              >
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={selected ? style.color : '#9ca3af'}
                />
                <Text className={`ml-3 flex-1 text-sm leading-5 ${selected ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          onPress={() => onApply(draft)}
          className="mt-3 h-12 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: PRIMARY_BLUE }}
        >
          <Text className="text-base font-bold text-white">
            {draft.length ? `Add ${draft.length} ${draft.length === 1 ? 'option' : 'options'}` : 'Done'}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

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
  const [openGroupKey, setOpenGroupKey] = useState(null);
  const starLabel = getRatingStarLabel(rating);
  const openGroup = groups.find((group) => getGroupKey(group) === openGroupKey) || null;

  // Low ratings lead with the problem groups; good ratings lead with positive feedback.
  const orderedGroups = useMemo(() => {
    const positive = groups.filter((group) => group.key === 'positive');
    const others = groups.filter((group) => group.key !== 'positive');
    return rating > 0 && rating <= 3 ? [...others, ...positive] : [...positive, ...others];
  }, [groups, rating]);

  const applyGroupSelection = (group, nextTags) => {
    (group.tags || []).forEach((tag) => {
      const wasSelected = isRatingTagSelected(selectedTags, tag);
      const isSelected = nextTags.includes(tag);
      if (wasSelected !== isSelected) onToggleTag?.(tag);
    });
    setOpenGroupKey(null);
  };

  return (
    <View>
      {title ? <Text className="text-center text-lg font-bold text-gray-900">{title}</Text> : null}
      {subtitle ? <Text className="mt-1 text-center text-sm text-gray-500">{subtitle}</Text> : null}

      <View className="mt-4 flex-row items-center justify-center">
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            onPress={() => onChangeRating?.(value)}
            hitSlop={6}
            className="mx-1.5"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}
          >
            <Ionicons
              name={value <= rating ? 'star' : 'star-outline'}
              size={38}
              color={value <= rating ? '#f59e0b' : '#d1d5db'}
            />
          </Pressable>
        ))}
      </View>
      <Text className="mt-2 text-center text-sm font-semibold text-gray-700">
        {rating > 0 ? starLabel : 'Tap a star to rate'}
      </Text>

      <Text className="mt-6 text-sm font-bold text-gray-900">Add feedback</Text>
      {orderedGroups.map((group) => {
        const style = getGroupStyle(group);
        const groupSelected = (group.tags || []).filter((tag) => isRatingTagSelected(selectedTags, tag));
        return (
          <View key={getGroupKey(group)} className="mt-2">
            <TouchableOpacity
              onPress={() => setOpenGroupKey(getGroupKey(group))}
              activeOpacity={0.8}
              className="flex-row items-center rounded-[10px] bg-[#f8fafc] px-3 py-3"
            >
              <View className="h-9 w-9 items-center justify-center rounded-[10px]" style={{ backgroundColor: style.background }}>
                <Ionicons name={style.icon} size={18} color={style.color} />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-semibold text-gray-900">{group.title}</Text>
                <Text className="text-xs text-gray-500">
                  {groupSelected.length ? `${groupSelected.length} selected` : style.hint}
                </Text>
              </View>
              {groupSelected.length ? (
                <View className="h-6 min-w-[24px] items-center justify-center rounded-full px-1.5" style={{ backgroundColor: style.color }}>
                  <Text className="text-xs font-bold text-white">{groupSelected.length}</Text>
                </View>
              ) : (
                <Ionicons name="add-circle-outline" size={22} color="#9ca3af" />
              )}
            </TouchableOpacity>

            {groupSelected.length ? (
              <View className="mt-2 flex-row flex-wrap">
                {groupSelected.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => onToggleTag?.(tag)}
                    activeOpacity={0.8}
                    className="mb-2 mr-2 flex-row items-center rounded-full px-3 py-1.5"
                    style={{ backgroundColor: style.background, maxWidth: '100%' }}
                  >
                    <Text className="text-xs font-semibold" style={{ color: style.color, flexShrink: 1 }} numberOfLines={1}>
                      {tag}
                    </Text>
                    <Ionicons name="close" size={13} color={style.color} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <TextInput
        value={review}
        onChangeText={onChangeReview}
        placeholder="Add a comment (optional)"
        placeholderTextColor="#9ca3af"
        multiline
        textAlignVertical="top"
        className="mt-4 min-h-[96px] rounded-[10px] bg-[#f8fafc] px-3 py-3 text-sm text-gray-900"
      />

      {safetyNote ? (
        <View className="mt-4 flex-row rounded-[10px] bg-amber-50 px-3 py-3">
          <Ionicons name="information-circle" size={18} color="#b45309" />
          <Text className="ml-2 flex-1 text-xs leading-5 text-amber-900">{safetyNote}</Text>
        </View>
      ) : null}

      {openGroup ? (
        <FeedbackOptionsSheet
          key={getGroupKey(openGroup)}
          group={openGroup}
          selectedTags={selectedTags}
          onClose={() => setOpenGroupKey(null)}
          onApply={(nextTags) => applyGroupSelection(openGroup, nextTags)}
        />
      ) : null}
    </View>
  );
}

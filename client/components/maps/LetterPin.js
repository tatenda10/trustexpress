import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Marker } from './MapViewCompat';

export const PIN_COLORS = {
  start: '#111827',
  finish: '#dc2626',
  stop: '#f59e0b',
};

export function stopLetter(index) {
  return String.fromCharCode(67 + index);
}

export default function LetterPin({ letter, color = PIN_COLORS.start }) {
  return (
    <View collapsable={false} style={{ width: 36, height: 46, alignItems: 'center' }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: color,
          borderWidth: 3,
          borderColor: '#ffffff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '800' }}>{letter}</Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          borderLeftWidth: 7,
          borderRightWidth: 7,
          borderTopWidth: 10,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
    </View>
  );
}

// Android snapshots custom marker views; tracking changes briefly lets the pin finish drawing first.
export function LetterMarker({ coordinate, letter, color, title }) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    setTracksViewChanges(true);
    const timeout = setTimeout(() => setTracksViewChanges(false), 800);
    return () => clearTimeout(timeout);
  }, [letter, color, coordinate?.latitude, coordinate?.longitude]);

  if (!coordinate) return null;

  return (
    <Marker
      coordinate={coordinate}
      title={title}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracksViewChanges}
      zIndex={10}
    >
      <LetterPin letter={letter} color={color} />
    </Marker>
  );
}

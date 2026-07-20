import React from 'react';
import { Image, View, StyleSheet } from 'react-native';

const TIER_IMAGES = {
  sedan: require('../assets/trust express.jpeg'),
  luxury: require('../assets/trust luxury.jpeg'),
  suv: require('../assets/trust xl.jpeg'),
};

export function getTierVariant(tier) {
  const key = String(tier?.tierKey || '').toLowerCase();
  const name = String(tier?.tierName || '').toLowerCase();
  if (key.includes('xl') || name.includes('xl') || name.includes('extra large') || name.includes('suv')) {
    return 'suv';
  }
  if (key.includes('lux') || name.includes('lux')) {
    return 'luxury';
  }
  return 'sedan';
}

export function getTierImageSource(tier) {
  return TIER_IMAGES[getTierVariant(tier)] || TIER_IMAGES.sedan;
}

function Wheel({ style }) {
  return (
    <View style={[styles.wheel, style]}>
      <View style={styles.hub} />
    </View>
  );
}

function DrawnTierCarIcon({ variant, size, color }) {
  const width = size * 1.45;
  const height = size;
  const scale = size / 54;

  if (variant === 'suv') {
    return (
      <View style={{ width, height, justifyContent: 'flex-end' }}>
        <View style={[styles.stage, { transform: [{ scale }] }]}>
          <View style={[styles.cabinTall, { backgroundColor: color }]}>
            <View style={[styles.windowFront, styles.windowTall]} />
            <View style={[styles.windowRear, styles.windowTall]} />
          </View>
          <View style={[styles.bodyTall, { backgroundColor: color }]}>
            <View style={styles.lightFront} />
            <View style={styles.lightRear} />
          </View>
          <Wheel style={{ left: 10 }} />
          <Wheel style={{ right: 10 }} />
        </View>
      </View>
    );
  }

  if (variant === 'luxury') {
    return (
      <View style={{ width, height, justifyContent: 'flex-end' }}>
        <View style={[styles.stage, { transform: [{ scale }] }]}>
          <View style={[styles.cabinLong, { backgroundColor: color }]}>
            <View style={styles.windowFrontLong} />
            <View style={styles.windowRearLong} />
          </View>
          <View style={[styles.bodyLong, { backgroundColor: color }]}>
            <View style={styles.lightFront} />
            <View style={styles.lightRear} />
          </View>
          <Wheel style={{ left: 12 }} />
          <Wheel style={{ right: 12 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ width, height, justifyContent: 'flex-end' }}>
      <View style={[styles.stage, { transform: [{ scale }] }]}>
        <View style={[styles.cabin, { backgroundColor: color }]}>
          <View style={styles.windowFront} />
          <View style={styles.windowRear} />
        </View>
        <View style={[styles.body, { backgroundColor: color }]}>
          <View style={styles.lightFront} />
          <View style={styles.lightRear} />
        </View>
        <Wheel style={{ left: 11 }} />
        <Wheel style={{ right: 11 }} />
      </View>
    </View>
  );
}

export default function RideTierCarIcon({ tier, size = 54, color = '#111827', useImage = true }) {
  const variant = getTierVariant(tier);
  const width = size * 1.55;
  const height = size;

  if (useImage) {
    return (
      <Image
        source={getTierImageSource(tier)}
        style={{ width, height }}
        resizeMode="contain"
        accessibilityLabel={tier?.tierName || 'Vehicle tier'}
      />
    );
  }

  return <DrawnTierCarIcon variant={variant} size={size} color={color} />;
}

const styles = StyleSheet.create({
  stage: {
    width: 72,
    height: 42,
    alignSelf: 'center',
    position: 'relative',
  },
  body: {
    position: 'absolute',
    left: 2,
    right: 2,
    bottom: 8,
    height: 14,
    borderRadius: 5,
  },
  bodyTall: {
    position: 'absolute',
    left: 2,
    right: 2,
    bottom: 8,
    height: 15,
    borderRadius: 5,
  },
  bodyLong: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    height: 13,
    borderRadius: 5,
  },
  cabin: {
    position: 'absolute',
    left: 16,
    right: 18,
    bottom: 20,
    height: 13,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 10,
    overflow: 'hidden',
  },
  cabinTall: {
    position: 'absolute',
    left: 14,
    right: 16,
    bottom: 20,
    height: 16,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  cabinLong: {
    position: 'absolute',
    left: 18,
    right: 16,
    bottom: 19,
    height: 12,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 12,
    overflow: 'hidden',
  },
  windowFront: {
    position: 'absolute',
    left: 4,
    top: 3,
    width: 14,
    height: 7,
    borderRadius: 2,
    backgroundColor: 'rgba(248,250,252,0.3)',
  },
  windowRear: {
    position: 'absolute',
    right: 4,
    top: 3,
    width: 12,
    height: 7,
    borderRadius: 2,
    backgroundColor: 'rgba(248,250,252,0.22)',
  },
  windowTall: {
    height: 9,
    top: 3,
  },
  windowFrontLong: {
    position: 'absolute',
    left: 4,
    top: 2,
    width: 16,
    height: 7,
    borderRadius: 2,
    backgroundColor: 'rgba(248,250,252,0.3)',
  },
  windowRearLong: {
    position: 'absolute',
    right: 4,
    top: 2,
    width: 14,
    height: 7,
    borderRadius: 2,
    backgroundColor: 'rgba(248,250,252,0.22)',
  },
  lightFront: {
    position: 'absolute',
    left: 3,
    top: 4,
    width: 6,
    height: 4,
    borderRadius: 1,
    backgroundColor: 'rgba(248,250,252,0.25)',
  },
  lightRear: {
    position: 'absolute',
    right: 3,
    top: 4,
    width: 5,
    height: 4,
    borderRadius: 1,
    backgroundColor: 'rgba(248,250,252,0.2)',
  },
  wheel: {
    position: 'absolute',
    bottom: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#111827',
  },
  hub: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(248,250,252,0.45)',
  },
});

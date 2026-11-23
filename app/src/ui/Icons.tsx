import { memo } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { Rarity } from '../core/types';
import { colors, holoColors } from './theme';

const STAR = 'M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.3 7.1L12 17.8l-6.3 3.4 1.3-7.1L1.8 9.2l7.1-.9z';

/** Circle common, diamond rare, star holo. Never colour alone. */
export const Shape = memo(function Shape({ rarity, size = 20, color }: { rarity: Rarity; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {rarity === 'common' && <Circle cx={12} cy={12} r={8.5} fill={color ?? colors.common} />}
      {rarity === 'rare' && (
        <Rect x={4.6} y={4.6} width={14.8} height={14.8} rx={1.5} fill={color ?? colors.rare} rotation={45} origin="12, 12" />
      )}
      {rarity === 'holo' && (
        <>
          <Defs>
            <LinearGradient id="holo" x1="0" y1="0" x2="1" y2="1">
              {holoColors.map((stop, i) => (
                <Stop key={stop} offset={i / (holoColors.length - 1)} stopColor={stop} />
              ))}
            </LinearGradient>
          </Defs>
          <Path d={STAR} fill={color ?? 'url(#holo)'} />
        </>
      )}
    </Svg>
  );
});

const PATHS = {
  check: 'M4.5 12.8l4.7 4.7L19.6 7',
  cross: 'M6 6l12 12M18 6L6 18',
  left: 'M19 12H5M11 6l-6 6 6 6',
  right: 'M5 12h14M13 6l6 6-6 6',
  up: 'M12 19V5M6 11l6-6 6 6',
  freeze: 'M12 3v18M4.200 7.500l15.600 9M4.200 16.500l15.600-9',
  back: 'M9 7l-5 5 5 5M4 12h10a5 5 0 0 1 0 10h-2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.500 2',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.8 3.8-6 7.5-6s6.700 2.200 7.500 6',
  offline: 'M3 3l18 18M5 12.500a10 10 0 0 1 4-2.300M19 12.500a10 10 0 0 0-5.500-2.700M8.500 16a5 5 0 0 1 5.500-1M12 19.500h.01',
} as const;

export const Icon = memo(function Icon({
  name,
  size = 22,
  color = colors.ink,
  weight = 2.4,
}: {
  name: keyof typeof PATHS;
  size?: number;
  color?: string;
  weight?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={PATHS[name]} stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
});

export const Flame = memo(function Flame({ size = 20, color = colors.rare }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12.500 1.500c.6 3.400-1 5.200-2.700 7.200C8 10.800 6 13 6 16.200 6 19.800 8.700 22.500 12 22.500s6-2.700 6-6.300c0-2.600-1.100-4.400-2.300-6.100-.4 1.600-1.200 2.500-2.200 3 .6-4-.1-8.300-1-11.600z"
        fill={color}
      />
    </Svg>
  );
});

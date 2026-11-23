import type { Rarity } from '../core/types';

/** A sorting mat: deep teal felt, with the slabs as the only bright thing on it. */
export const colors = {
  mat: '#0F3D3C',
  deep: '#0A2E2D',
  raised: '#17514F',
  line: '#2F706C',
  ink: '#F2F6F1',
  soft: '#A8C7C2',
  label: '#FFFFFF', // the white of a slab label
  onLabel: '#0B2C2B',
  red: '#FF6B5E', // the red of its frame, light enough to read on the mat
  green: '#8FE3A2',
  common: '#D6DDD9',
  rare: '#FFC94D',
  holo: '#C9B6FF',
} as const;

export const holoColors = ['#8BE9FF', '#C6A8FF', '#FFB0D8', '#FFF0A6'] as const;
export const rarityColor: Record<Rarity, string> = { common: colors.common, rare: colors.rare, holo: colors.holo };
export const rarityName: Record<Rarity, string> = { common: 'Common', rare: 'Rare', holo: 'Holo' };

/** Headings and numbers are set like a slab label. Everything else is the system's own font. */
export const display = { bold: 'BarlowSemiCondensed-Bold', semi: 'BarlowSemiCondensed-SemiBold' } as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const CARD_RATIO = 1.68; // height over width of nearly every slab photo

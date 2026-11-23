import type { Rarity } from '../core/types';

/** Calm, light and quiet, so the cards are the only colourful thing. Text is at least 4.5 to 1 on both. */
export const colors = {
  page: '#F4F4F4',
  panel: '#FFFFFF',
  tile: '#EDEDED', // where a picture will be
  ink: '#1A1A1A',
  soft: '#6E6E6E',
  line: '#DEDEDE',
  onInk: '#FFFFFF',
  red: '#B3261E',
  green: '#1B7A43',
  flame: '#E8750A',
  flameOff: '#A5A5A5',
  frozen: '#1F73A8',
  frozenFill: '#DCEFFA',
} as const;

/** The reveal is the one dark place. */
export const stage = {
  page: '#141414',
  panel: '#242424',
  ink: '#FFFFFF',
  soft: '#B8B8B8',
  line: '#454545',
} as const;

/** To read on white. */
export const rarityColor: Record<Rarity, string> = { common: '#5E6666', rare: '#8A5A00', holo: '#6A45C4' };
/** To read on the stage, and for what glows there. */
export const rarityBright: Record<Rarity, string> = { common: '#D6DDD9', rare: '#FFC94D', holo: '#C9B6FF' };
/** The shapes themselves. */
export const rarityFill = { common: '#9AA0A0', rare: '#D99A00' } as const;
export const holoColors = ['#4FC3E8', '#9B7BEA', '#EE7FB8', '#F3C64B'] as const;
export const holoBright = ['#8BE9FF', '#C6A8FF', '#FFB0D8', '#FFF0A6'] as const;
export const rarityName: Record<Rarity, string> = { common: 'Common', rare: 'Rare', holo: 'Holo' };

/** Titles and big numbers. Everything else is the system's own font. */
export const serif = 'InstrumentSerif-Regular';

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 32 } as const;
export const softShadow = '0px 2px 14px rgba(0, 0, 0, 0.045)';
export const CARD_RATIO = 1.68; // height over width of nearly every slab photo

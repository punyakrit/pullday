import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Card } from '../core/types';
import { type ImageWidth, imageUrl, widthFor } from '../lib/images';
import { pictures, usePicture } from '../lib/pictures';
import { Shape } from './Icons';
import { Words } from './Words';
import { hairline } from './hairline';
import { colors } from './theme';

export function describeCard(card: Card): string {
  return [card.name, card.number && `number ${card.number}`, `${card.set}, ${card.year}`, `grade ${card.grade}`].filter(Boolean).join('. ');
}

/**
 * In the place of a picture: there is none (27 of the links in the data are dead), or it could not be had.
 * Drawn as a slab with the card's own label, so it sits among the others.
 */
export const CardText = memo(function CardText({ card, width, height, why, grey = false }: { card: Card; width: number; height: number; why: 'none' | 'failed'; grey?: boolean }) {
  const small = width < 160;
  const edge = Math.max(4, width * 0.045);
  const number = card.number ? `#${card.number}` : String(card.year);
  return (
    <View style={[styles.slab, { width, height, padding: edge, gap: edge, borderRadius: width * 0.05 }]}>
      <View style={[styles.label, { minHeight: height * 0.17, paddingHorizontal: edge, borderRadius: width * 0.02 }]}>
        <Words kind="label" style={[styles.labelName, !small && styles.labelNameBig]} numberOfLines={2} maxFontSizeMultiplier={1.15}>
          {card.name}
        </Words>
        {!small && (
          <Words kind="soft" style={styles.labelLine} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {card.set}
          </Words>
        )}
        <Words kind="soft" style={styles.labelLine} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {number}, grade {card.grade}
        </Words>
      </View>
      <View style={[styles.window, { borderRadius: width * 0.02 }]}>
        <Shape rarity={card.rarity} size={width * 0.3} color={grey ? '#B9B9B9' : undefined} />
        <Words kind="soft" style={[styles.labelLine, !small && styles.windowSaid]} numberOfLines={2} maxFontSizeMultiplier={1.15}>
          {small ? (why === 'none' ? 'No picture' : 'Not loaded') : why === 'none' ? 'No picture of this card' : 'This picture could not be loaded'}
        </Words>
      </View>
    </View>
  );
});

type Props = {
  card: Card;
  width: number;
  height: number;
  grey?: boolean;
  /** Pushed back a little: in the grid, grey alone does not say enough. */
  asleep?: boolean;
  size?: ImageWidth;
  under?: ImageWidth;
  priority?: 'low' | 'normal' | 'high';
  fade?: boolean;
};

/**
 * A slab photo at the size it is shown. Its words are under it, so there is never nothing, and they
 * say so if it cannot be loaded. The whole picture is shown: 45 are not slab shaped, nearly all of them
 * stand-in photos in the data.
 */
export const CardImage = memo(function CardImage({ card, width, height, grey = false, asleep = false, size = widthFor(width), under = size === 1080 ? 400 : size, priority = 'normal', fade = true }: Props) {
  // What is already here goes under. And the large one can take the server 20 seconds to make.
  const base = imageUrl(card.id, under, grey);
  const { state } = usePicture(card.id, base);
  if (state === 'none') return <CardText card={card} width={width} height={height} why="none" grey={grey} />;
  const layer = { cardId: card.id, radius: width * 0.05, priority, fade };
  return (
    <View style={[styles.tile, { width, height, borderRadius: width * 0.05 }]}>
      <View style={styles.words}>
        <Words kind="soft" style={styles.name} numberOfLines={3} maxFontSizeMultiplier={1.2}>
          {card.name}
        </Words>
        {state === 'failed' && (
          <Words kind="soft" style={styles.name} maxFontSizeMultiplier={1.2}>
            Couldn&apos;t load
          </Words>
        )}
      </View>
      <Layer url={base} {...layer} />
      {size !== under && <Layer url={imageUrl(card.id, size, grey)} {...layer} />}
      {asleep && state !== 'failed' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.asleep, { borderRadius: width * 0.05 }]} />}
    </View>
  );
});

function Layer({ cardId, url, radius, priority, fade }: { cardId: string; url: string; radius: number; priority: 'low' | 'normal' | 'high'; fade: boolean }) {
  const { attempt } = usePicture(cardId, url);
  return (
    <Image
      key={attempt} // a new try is a new view. 0 for nearly all of them, so a list can still reuse them
      source={url}
      contentFit="contain"
      transition={fade ? FADE : null}
      priority={priority}
      recyclingKey={url}
      cachePolicy="memory-disk"
      onLoad={() => pictures.loaded(cardId, url)}
      onError={() => void pictures.failed(cardId, url)}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      accessible={false}
    />
  );
}

const FADE = { duration: 120, effect: 'cross-dissolve', skipOnCacheHit: 'memory' } as const;

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.tile, alignItems: 'center', justifyContent: 'center' },
  words: { paddingHorizontal: 6, gap: 2 },
  name: { textAlign: 'center', fontSize: 12, lineHeight: 15, color: '#2A2A2A' },
  asleep: { backgroundColor: 'rgba(244, 244, 244, 0.45)' },
  slab: { backgroundColor: colors.panel, borderWidth: hairline, borderColor: '#BDBDBD' },
  label: { justifyContent: 'center', paddingVertical: 3, borderWidth: hairline, borderColor: colors.line },
  labelName: { fontSize: 11, lineHeight: 13 },
  labelNameBig: { fontSize: 17, lineHeight: 21 },
  labelLine: { fontSize: 11, lineHeight: 14, color: '#5C5C5C' },
  window: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.page },
  windowSaid: { fontSize: 14, lineHeight: 19 },
});

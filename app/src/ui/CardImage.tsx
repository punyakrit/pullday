import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Card } from '../core/types';
import { type ImageWidth, imageUrl, widthFor } from '../lib/images';
import { pictures, usePicture } from '../lib/pictures';
import { Words } from './Words';
import { colors } from './theme';

export function describeCard(card: Card): string {
  return [card.name, card.number && `number ${card.number}`, `${card.set}, ${card.year}`, `grade ${card.grade}`].filter(Boolean).join('. ');
}

/** In the place of a picture: there is none, or it could not be had. */
export const CardText = memo(function CardText({ card, width, height, why, grey = false }: { card: Card; width: number; height: number; why: 'none' | 'failed'; grey?: boolean }) {
  const small = width < 160;
  const said = why === 'none' ? 'No picture of this card' : 'This picture could not be loaded';
  return (
    <View style={[styles.text, grey && styles.greyText, { width, height, padding: small ? 8 : 18, borderRadius: width * 0.05 }]}>
      <Words kind={small ? 'label' : 'title'} style={[styles.onText, small && styles.smallName]} numberOfLines={small ? 4 : 3} maxFontSizeMultiplier={1.2}>
        {card.name}
      </Words>
      {small ? (
        <Words kind="soft" style={styles.smallSaid} numberOfLines={3} maxFontSizeMultiplier={1.2}>
          {why === 'none' ? 'No picture' : 'Not loaded'}
        </Words>
      ) : (
        <View style={styles.gap}>
          <Words style={styles.onText} numberOfLines={3}>
            {card.set}
          </Words>
          <Words style={styles.onText}>
            {card.number ? `#${card.number}, ` : ''}
            {card.year}, grade {card.grade}
          </Words>
          <Words kind="soft" style={styles.said}>
            {said}
          </Words>
        </View>
      )}
    </View>
  );
});

type Props = {
  card: Card;
  width: number;
  height: number;
  grey?: boolean;
  size?: ImageWidth;
  priority?: 'low' | 'normal' | 'high';
  fade?: boolean;
};

/**
 * A slab photo at the size it is shown. Its words are under it, so there is never nothing, and they
 * say so if it cannot be loaded. The whole picture is shown: 45 are not slab shaped, nearly all of them
 * stand-in photos in the data.
 */
export const CardImage = memo(function CardImage({ card, width, height, grey = false, size = widthFor(width), priority = 'normal', fade = true }: Props) {
  // The large one can take the server 20 seconds to make. The middle one is under it until then.
  const base = imageUrl(card.id, size === 1080 ? 400 : size, grey);
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
      {size === 1080 && <Layer url={imageUrl(card.id, 1080, grey)} {...layer} />}
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
  tile: { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  words: { paddingHorizontal: 6, gap: 2 },
  name: { textAlign: 'center', fontSize: 12, lineHeight: 15, color: colors.soft },
  text: { backgroundColor: '#E4EBE7', justifyContent: 'space-between' },
  greyText: { backgroundColor: '#9FB0AC' },
  onText: { color: colors.onLabel },
  gap: { gap: 6 },
  said: { color: '#3F5B59' },
  smallName: { fontSize: 13, lineHeight: 16 },
  smallSaid: { fontSize: 11, lineHeight: 14, color: '#3F5B59' },
});

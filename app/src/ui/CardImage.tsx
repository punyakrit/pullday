import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Card } from '../core/types';
import { imageUrl, widthFor } from '../lib/images';
import { Words } from './Words';
import { colors } from './theme';

export function describeCard(card: Card): string {
  return [card.name, card.number && `number ${card.number}`, `${card.set}, ${card.year}`, `grade ${card.grade}`].filter(Boolean).join('. ');
}

/** For the 27 cards with no picture, and for when there is no connection. */
export const CardText = memo(function CardText({ card, width, height }: { card: Card; width: number; height: number }) {
  const small = width < 160;
  return (
    <View style={[styles.text, { width, height, padding: small ? 8 : 18, borderRadius: width * 0.05 }]}>
      <Words kind={small ? 'label' : 'title'} style={{ color: colors.onLabel }} numberOfLines={3}>
        {card.name}
      </Words>
      {!small && (
        <View style={{ gap: 6 }}>
          <Words style={{ color: colors.onLabel }}>{card.set}</Words>
          <Words style={{ color: colors.onLabel }}>
            {card.number ? `#${card.number}, ` : ''}
            {card.year}, grade {card.grade}
          </Words>
          <Words kind="soft" style={{ color: '#4C6967' }}>
            No picture of this card
          </Words>
        </View>
      )}
    </View>
  );
});

type Props = { card: Card; width: number; height: number; priority?: 'low' | 'normal' | 'high'; fade?: boolean };

/** A slab photo at the size it is shown, with the small one underneath while it loads. */
export const CardImage = memo(function CardImage({ card, width, height, priority = 'normal', fade = true }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const size = widthFor(width);
  if (failed === card.id) return <CardText card={card} width={width} height={height} />;
  return (
    <Image
      source={{ uri: imageUrl(card.id, size) }}
      placeholder={size === 400 ? null : { uri: imageUrl(card.id, 400) }}
      placeholderContentFit="cover"
      contentFit="cover"
      transition={fade ? 120 : 0}
      priority={priority}
      recyclingKey={card.id}
      cachePolicy="memory-disk"
      onError={() => setFailed(card.id)}
      style={{ width, height, borderRadius: width * 0.05, backgroundColor: colors.deep }}
      accessible={false}
    />
  );
});

const styles = StyleSheet.create({
  text: { backgroundColor: '#E4EBE7', justifyContent: 'space-between' },
});

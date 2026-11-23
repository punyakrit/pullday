import { Image, type ImageRef } from 'expo-image';
import { useEffect, useState } from 'react';
import { type Held, type Picture, pictureOf } from '../core/turn';
import { type ImageWidth, imageUrl, widthFor } from './images';
import { pictures } from './pictures';

const wait = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/**
 * The card's picture, downloaded and decoded at the size it will be shown, so turning it over
 * has nothing left to load. Falls back to the small one, then to the card's words.
 *
 * It goes by the card's id. The server's reply brings the same card in a new object, and that is
 * no reason to load it again.
 */
export function useCardRef(cardId: string | null, points: number, saved: boolean): Picture<ImageRef> {
  const [held, setHeld] = useState<Held<ImageRef> | null>(null);
  const size = points > 0 ? widthFor(points) : null;
  const picture = pictureOf(held, cardId, saved);
  const loading = picture.state === 'loading';

  // Not when `saved` changes: a load under way is left alone. If it comes to nothing, `held` is new
  // and it is asked for once more.
  useEffect(() => {
    if (cardId === null || size === null || !loading) return;
    let live = true;
    const load = (width: ImageWidth) => Image.loadAsync({ uri: imageUrl(cardId, width) }, { maxWidth: 1080 }).catch(() => null);
    void (async () => {
      const small = size === 1080 ? load(400) : null;
      const large = await Promise.race([load(size), wait(5_000)]);
      const image = large ?? (small ? await Promise.race([small, wait(3_000)]) : null);
      if (!image) void pictures.failed(cardId, imageUrl(cardId, 400)); // asks why, for the words
      if (live) setHeld({ cardId, saved, image });
    })();
    return () => {
      live = false;
    };
  }, [cardId, held, loading, size]);

  return picture;
}

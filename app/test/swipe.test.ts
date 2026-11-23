import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { give, decide, liftSpeed, pull } from '../src/today/swipe';

const W = 360;
const H = 480;
const go = (x: number, y: number, vx = 0, vy = 0) => decide(x, y, vx, vy, W, H);

describe('where a card goes', () => {
  test('by distance, held still', () => {
    assert.equal(go(-80, 0), 'common');
    assert.equal(go(80, 0), 'rare');
    assert.equal(go(0, -70), 'holo');
    for (const [x, y] of [[-60, 0], [60, 0], [0, -50], [0, 200], [0, 0]] as const) assert.equal(go(x, y), null);
  });

  test('by a quick flick, with hardly any distance', () => {
    assert.equal(go(-18, 0, -700, 0), 'common');
    assert.equal(go(18, 0, 700, 0), 'rare');
    assert.equal(go(0, -18, 0, -700), 'holo');
  });

  test('a flick back the way it came is a change of mind', () => {
    assert.equal(go(90, 0, -900, 0), null);
    assert.equal(go(-90, 0, 900, 0), null);
    assert.equal(go(0, -80, 0, 900), null);
    assert.equal(go(40, 0, -1600, 0), null); // past the middle, but it was not dragged there
  });

  test('a diagonal goes to the stronger side, and down goes nowhere', () => {
    assert.equal(go(100, -30), 'rare');
    assert.equal(go(30, -100), 'holo');
    assert.equal(go(-100, -30), 'common');
    assert.equal(go(10, 120, 0, 900), null);
    assert.equal(go(90, 120), 'rare');
  });

  test('never two directions at once', () => {
    for (let x = -200; x <= 200; x += 10) {
      for (let y = -200; y <= 200; y += 10) {
        const { left, right, up } = pull(x, y, W, H);
        assert.ok([left, right, up].filter((one) => one > 0).length <= 1, `${x} ${y}`);
      }
    }
  });
});

describe('speed when the finger lifts', () => {
  test('Android said 0, but it crossed 40 points in 60 ms', () => {
    assert.equal(Math.round(liftSpeed(0, 60, 60)), 1000);
    assert.equal(go(40, 0, liftSpeed(0, 40, 60), 0), 'rare');
  });
  test('a gentle flick counts: 24 points in 200 ms', () => {
    assert.equal(go(24, 0, liftSpeed(0, 24, 200), 0), 'rare');
    assert.equal(go(-24, 0, liftSpeed(-90, -24, 200), 0), 'common');
    assert.equal(go(0, -24, 0, liftSpeed(0, -24, 200)), 'holo');
  });
  test('a brush of the screen does not', () => {
    assert.equal(go(14, 0, liftSpeed(0, 14, 120), 0), null);
    assert.equal(go(14, 0, liftSpeed(0, 14, 8), 0), null);
  });
  test('a slow drag that stopped is not a flick', () => {
    assert.equal(liftSpeed(0, 60, 900), 0);
    assert.equal(go(60, 0, liftSpeed(0, 60, 900), 0), null);
  });
  test('turning round before lifting keeps the direction it lifted in', () => {
    assert.equal(liftSpeed(-800, 30, 200), -800);
  });
  test('a tap is not a swipe', () => {
    assert.equal(go(3, 2, liftSpeed(0, 3, 40), liftSpeed(0, 2, 40)), null);
  });
});

test('down is no direction: the card gives a little, and never reaches the piles', () => {
  assert.equal(give(-80), -80); // up it follows the finger
  assert.equal(give(0), 0);
  assert.ok(give(20) > 5 && give(20) < 20);
  assert.ok(give(100) > give(50));
  for (const y of [200, 600, 2_000]) assert.ok(give(y) <= 36);
});

// Price sanity checks. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanePrices } from '../site/assets/js/lib/prices.js';

test('a 7-day average thrown off by a few sales is replaced by the median of the daily prices', () => {
  // Charcoal Stabilizer, 18 Nov: every daily price 1.5-1.9g, the sheet's 7-day average 11.2g
  const p = sanePrices({ latest: 17117, avg7: 112084, avg30: 37666, vol1: 49586, med7: 17600, med30: 16900 });
  assert.equal(p.avg7, 17600);
  assert.equal(p.avg30, 16900);
  assert.equal(p.latest, 17117);                      // many sales: the 24h value stands
  assert.deepEqual(p.fixed, { avg7: 'outlier', avg30: 'outlier' });
  assert.equal(p.raw.avg7, 112084);
});

test('a 24h spike on a thinly traded item is replaced; a busy item keeps its 24h price', () => {
  const thin = sanePrices({ latest: 16872158, avg7: 4826464, avg30: 6203298, vol1: 4, med7: 4867100, med30: null });
  assert.equal(thin.latest, 4867100);
  assert.equal(thin.fixed.latest, 'spike');
  assert.equal(thin.avg30, 6203298);                  // no med30: compared with med7, within 1.5x
  const busy = sanePrices({ latest: 30000, avg7: 10000, avg30: 10000, vol1: 5000, med7: 10000, med30: 10000 });
  assert.equal(busy.latest, 30000);
});

test('without history nothing changes', () => {
  const p = sanePrices({ latest: 100, avg7: 5000, avg30: null, vol1: 1, med7: null, med30: null });
  assert.deepEqual([p.latest, p.avg7, p.avg30, Object.keys(p.fixed).length], [100, 5000, null, 0]);
});

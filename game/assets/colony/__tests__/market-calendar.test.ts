import { describe, expect, it } from 'vitest';
import { activeMarketEvent, planMarketEvents, releaseMarketQuota, reserveMarketQuota } from '../market-calendar.ts';
import { SPECIALISTS, type SpecialistId } from '../specialist-catalog.ts';

describe('market calendar', () => {
  it('schedules only housed merchants and preserves published requests after reload', () => {
    const ids = Object.keys(SPECIALISTS) as SpecialistId[];
    expect(planMarketEvents([], 5, [], 'town')).toEqual([]);
    const first = planMarketEvents([], 5, ['tailor'], 'town');
    const all = planMarketEvents(first, 5, ids, 'town');
    expect(all).toHaveLength(4);
    expect(all[0]).toEqual(first[0]);
    for (const event of all) {
      expect(event.startDay - event.announcedDay).toBeGreaterThanOrEqual(2);
      expect(event.endDay).toBeLessThanOrEqual(11);
      expect(event.endDay).toBe(event.startDay + 1);
      expect(event.item).toBe(SPECIALISTS[event.merchantId].request.item);
      expect(event.remaining).toBe(SPECIALISTS[event.merchantId].request.quantity);
    }
    expect(planMarketEvents(JSON.parse(JSON.stringify(all)), 6, ids, 'town')).toEqual(all);
    const next = planMarketEvents(all, 15, ['tailor'], 'town');
    expect(next.slice(0, -1)).toEqual(all);
    expect(next.at(-1)?.merchantId).toBe('tailor');
  });

  it('enforces inclusive dates, atomic reservations and cancellation against the original event', () => {
    const rows = planMarketEvents([], 1, ['tailor'], 'town');
    const e = rows[0]!;
    expect(reserveMarketQuota(rows, e.startDay - 1, e.id, 1)).toBeNull();
    expect(reserveMarketQuota(rows, e.startDay, e.id, e.limit + 1)).toBeNull();
    expect(reserveMarketQuota(rows, e.startDay, e.id, .5)).toBeNull();
    const reserved = reserveMarketQuota(rows, e.endDay, e.id, e.limit)!;
    expect(activeMarketEvent(reserved, e.endDay, 'tailor', 'cloth')?.remaining).toBe(0);
    expect(rows[0]?.remaining).toBe(e.limit);
    expect(activeMarketEvent(reserved, e.endDay + 1, 'tailor', 'cloth')).toBeUndefined();
    const next = planMarketEvents(reserved, e.endDay + 1, ['tailor'], 'town');
    const restored = releaseMarketQuota(next, e.id, 3)!;
    expect(restored.map(event => event.remaining)).toEqual([3, e.limit]);
    expect(releaseMarketQuota(restored, e.id, e.limit)).toBeNull();
  });
});

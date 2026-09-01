import {
  determineEscalationLevel,
  calculatePenalty,
} from '../../../src/services/collections/collections.service';

describe('collections — escalation levels', () => {
  describe('determineEscalationLevel', () => {
    it.each([
      [1, 0],
      [2, 0],
      [3, 1],
      [5, 1],
      [7, 2],
      [10, 2],
      [14, 3],
      [30, 3],
    ])('daysOverdue=%d → level %d', (days, expectedLevel) => {
      expect(determineEscalationLevel(days)).toBe(expectedLevel);
    });
  });
});

describe('collections — penalty calculation', () => {
  it('calculates penalty correctly for 1 day at 0.1%', () => {
    const penalty = calculatePenalty('50000000', 1, '0.001');
    expect(penalty).toBe('50000');
  });

  it('calculates penalty correctly for 14 days at 0.1%', () => {
    const penalty = calculatePenalty('50000000', 14, '0.001');
    expect(penalty).toBe('700000');
  });

  it('handles zero days', () => {
    const penalty = calculatePenalty('50000000', 0, '0.001');
    expect(penalty).toBe('0');
  });

  it('handles large face values', () => {
    const penalty = calculatePenalty('100000000', 30, '0.001');
    expect(penalty).toBe('3000000');
  });
});

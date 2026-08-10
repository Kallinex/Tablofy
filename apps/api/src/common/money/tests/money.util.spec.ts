import { Prisma } from '@prisma/client';
import { addMoney, subMoney, mulMoney, sumMoney, percentOf, roundMoney } from '../money.util';

describe('money util', () => {
  describe('roundMoney', () => {
    it('handles zero', () => {
      expect(roundMoney(0)).toBe(0);
      expect(roundMoney(undefined)).toBe(0);
      expect(roundMoney(null)).toBe(0);
    });

    it('rounds half-up to two decimal places', () => {
      expect(roundMoney(2.9985)).toBe(3.0);
      expect(roundMoney(2.9949)).toBe(2.99);
      expect(roundMoney('2.9985')).toBe(3.0);
      expect(roundMoney(new Prisma.Decimal('2.9985'))).toBe(3.0);
    });

    it('preserves exact decimal values (no binary float drift)', () => {
      expect(roundMoney(0.1 + 0.2)).toBe(0.3);
      expect(roundMoney(19.99 * 3)).toBe(59.97);
    });
  });

  describe('mulMoney', () => {
    it('computes exact line totals', () => {
      expect(mulMoney(10.99, 2)).toBe(21.98);
      expect(mulMoney('10.99', '2')).toBe(21.98);
    });

    it('rounds tax to 2dp half-up', () => {
      expect(mulMoney(19.99, 0.15)).toBe(3.0);
    });

    it('handles zero quantity', () => {
      expect(mulMoney(10.99, 0)).toBe(0);
    });
  });

  describe('addMoney / subMoney', () => {
    it('adds decimals exactly', () => {
      expect(addMoney(0.1, 0.2)).toBe(0.3);
      expect(addMoney('0.10', '0.20')).toBe(0.3);
    });

    it('subtracts to exact remaining', () => {
      expect(subMoney(100, 30)).toBe(70);
      expect(subMoney(100.0, 30.1)).toBe(69.9);
    });

    it('supports negative remainders (over-refund guard input)', () => {
      expect(subMoney(30, 100)).toBe(-70);
    });
  });

  describe('sumMoney', () => {
    it('sums repeated decimal values without drift', () => {
      const values = Array.from({ length: 100 }, () => 0.1);
      expect(sumMoney(values)).toBe(10.0);
    });

    it('sums mixed item totals', () => {
      expect(sumMoney([21.98, 5.5, 0.05])).toBe(27.53);
    });

    it('handles empty list', () => {
      expect(sumMoney([])).toBe(0);
    });
  });

  describe('percentOf', () => {
    it('computes percentage discounts', () => {
      expect(percentOf(100, 10)).toBe(10);
      expect(percentOf(19.99, 15)).toBe(3.0);
    });

    it('computes percentage service charges', () => {
      expect(percentOf(100, 10)).toBe(10);
      expect(percentOf(49.99, 5)).toBe(2.5);
    });

    it('returns zero for zero percent', () => {
      expect(percentOf(100, 0)).toBe(0);
    });
  });
});

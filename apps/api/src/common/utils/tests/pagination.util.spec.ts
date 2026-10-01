import {
  buildPaginationMeta,
  buildPrismaOrderBy,
  buildPrismaWhere,
  calculateSkip,
} from '../pagination.util';

describe('pagination.util', () => {
  describe('buildPaginationMeta', () => {
    it('computes totals, pages and navigation flags', () => {
      expect(buildPaginationMeta(45, 2, 20)).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('reports no next page on the last page', () => {
      expect(buildPaginationMeta(40, 2, 20)).toMatchObject({
        totalPages: 2,
        hasNext: false,
        hasPrevious: true,
      });
    });

    it('handles an empty result set', () => {
      expect(buildPaginationMeta(0, 1, 20)).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('never divides by zero for a zero or negative limit', () => {
      expect(buildPaginationMeta(10, 1, 0)).toMatchObject({ totalPages: 10, limit: 0 });
    });
  });

  describe('calculateSkip', () => {
    it('offsets page 2 by one page', () => {
      expect(calculateSkip(2, 20)).toBe(20);
    });

    it('returns zero for the first page', () => {
      expect(calculateSkip(1, 20)).toBe(0);
    });

    it('clamps page and limit to a minimum of one', () => {
      expect(calculateSkip(0, 0)).toBe(0);
      expect(calculateSkip(-5, 10)).toBe(0);
    });
  });

  describe('buildPrismaOrderBy', () => {
    it('defaults to newest first', () => {
      expect(buildPrismaOrderBy()).toEqual([{ createdAt: 'desc' }]);
    });

    it('sorts by a single field', () => {
      expect(buildPrismaOrderBy('name', 'asc')).toEqual([{ name: 'asc' }]);
    });

    it('defaults the direction to desc when a field is given', () => {
      expect(buildPrismaOrderBy('createdAt')).toEqual([{ createdAt: 'desc' }]);
    });

    it('supports multiple comma-separated fields and trims whitespace', () => {
      expect(buildPrismaOrderBy(' name , isActive ', 'asc')).toEqual([
        { name: 'asc' },
        { isActive: 'asc' },
      ]);
    });
  });

  describe('buildPrismaWhere', () => {
    it('always excludes soft-deleted rows', () => {
      expect(buildPrismaWhere({ restaurantId: 'r-1' })).toEqual({
        restaurantId: 'r-1',
        deletedAt: null,
      });
    });

    it('adds a case-insensitive OR search across the given fields', () => {
      expect(buildPrismaWhere({ isActive: true }, 'coffee', ['name', 'sku'])).toEqual({
        isActive: true,
        deletedAt: null,
        OR: [
          { name: { contains: 'coffee', mode: 'insensitive' } },
          { sku: { contains: 'coffee', mode: 'insensitive' } },
        ],
      });
    });

    it('ignores a search with no fields', () => {
      expect(buildPrismaWhere({}, 'coffee', [])).toEqual({ deletedAt: null });
    });

    it('ignores an empty search term', () => {
      expect(buildPrismaWhere({}, '', ['name'])).toEqual({ deletedAt: null });
    });
  });
});

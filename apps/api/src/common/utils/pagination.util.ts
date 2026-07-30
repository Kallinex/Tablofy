import { PaginationMeta } from '../interfaces';

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.ceil(total / Math.max(limit, 1));
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

export function calculateSkip(page: number, limit: number): number {
  return (Math.max(page, 1) - 1) * Math.max(limit, 1);
}

export function buildPrismaOrderBy(
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
): Record<string, 'asc' | 'desc'>[] {
  if (!sortBy) return [{ createdAt: 'desc' }];
  const order = sortOrder || 'desc';
  const fields = sortBy.split(',');
  return fields.map((f) => ({ [f.trim()]: order }));
}

export function buildPrismaWhere<T extends Record<string, unknown>>(
  filters: Record<string, unknown>,
  search?: string,
  searchFields?: string[],
): T {
  const where: Record<string, unknown> = { ...filters, deletedAt: null };

  if (search && searchFields && searchFields.length > 0) {
    where.OR = searchFields.map((field) => ({
      [field]: { contains: search, mode: 'insensitive' },
    }));
  }

  return where as T;
}

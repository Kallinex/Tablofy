import { Prisma } from '@prisma/client';

export const MONEY_PLACES = 2;

type DecimalInput = Prisma.Decimal.Value | Prisma.Decimal;

function toDecimal(value: DecimalInput | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

export function roundMoney(value: DecimalInput | null | undefined): number {
  return toDecimal(value).toDecimalPlaces(MONEY_PLACES, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function addMoney(
  a: DecimalInput | null | undefined,
  b: DecimalInput | null | undefined,
): number {
  return roundMoney(toDecimal(a).plus(toDecimal(b)));
}

export function subMoney(
  a: DecimalInput | null | undefined,
  b: DecimalInput | null | undefined,
): number {
  return roundMoney(toDecimal(a).minus(toDecimal(b)));
}

export function mulMoney(
  a: DecimalInput | null | undefined,
  b: DecimalInput | null | undefined,
): number {
  return roundMoney(toDecimal(a).times(toDecimal(b)));
}

export function sumMoney(values: Array<DecimalInput | null | undefined>): number {
  let total = new Prisma.Decimal(0);
  for (const value of values) {
    total = total.plus(toDecimal(value));
  }
  return roundMoney(total);
}

export function percentOf(
  amount: DecimalInput | null | undefined,
  percent: DecimalInput | null | undefined,
): number {
  return roundMoney(toDecimal(amount).times(toDecimal(percent)).div(100));
}

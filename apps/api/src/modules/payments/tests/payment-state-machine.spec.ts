import { PaymentStatus } from '@prisma/client';
import {
  validatePaymentTransition,
  isRefundableStatus,
  isVoidableStatus,
  isTerminalPaymentStatus,
} from '../payment-state-machine';

describe('PaymentStateMachine', () => {
  describe('validatePaymentTransition', () => {
    it('should allow PENDING to COMPLETED', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.COMPLETED),
      ).not.toThrow();
    });

    it('should allow PENDING to FAILED', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.FAILED),
      ).not.toThrow();
    });

    it('should allow COMPLETED to REFUNDED', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.COMPLETED, PaymentStatus.REFUNDED),
      ).not.toThrow();
    });

    it('should allow COMPLETED to PARTIALLY_REFUNDED', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED),
      ).not.toThrow();
    });

    it('should reject same status transition', () => {
      expect(() => validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.PENDING)).toThrow(
        'Payment is already in PENDING status',
      );
    });

    it('should reject invalid transition (FAILED to COMPLETED)', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.FAILED, PaymentStatus.COMPLETED),
      ).toThrow('Cannot transition payment from FAILED to COMPLETED');
    });

    it('should reject REFUNDED to anything', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.REFUNDED, PaymentStatus.PENDING),
      ).toThrow('Cannot transition payment from REFUNDED to PENDING');
    });

    it('should reject COMPLETED to FAILED', () => {
      expect(() =>
        validatePaymentTransition(PaymentStatus.COMPLETED, PaymentStatus.FAILED),
      ).toThrow('Cannot transition payment from COMPLETED to FAILED');
    });
  });

  describe('isRefundableStatus', () => {
    it('should return true for COMPLETED', () => {
      expect(isRefundableStatus(PaymentStatus.COMPLETED)).toBe(true);
    });

    it('should return true for PARTIALLY_REFUNDED', () => {
      expect(isRefundableStatus(PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
    });

    it('should return false for PENDING', () => {
      expect(isRefundableStatus(PaymentStatus.PENDING)).toBe(false);
    });

    it('should return false for FAILED', () => {
      expect(isRefundableStatus(PaymentStatus.FAILED)).toBe(false);
    });

    it('should return false for REFUNDED', () => {
      expect(isRefundableStatus(PaymentStatus.REFUNDED)).toBe(false);
    });
  });

  describe('isVoidableStatus', () => {
    it('should return true for PENDING', () => {
      expect(isVoidableStatus(PaymentStatus.PENDING)).toBe(true);
    });

    it('should return false for COMPLETED', () => {
      expect(isVoidableStatus(PaymentStatus.COMPLETED)).toBe(false);
    });

    it('should return false for FAILED', () => {
      expect(isVoidableStatus(PaymentStatus.FAILED)).toBe(false);
    });
  });

  describe('isTerminalPaymentStatus', () => {
    it('should return true for FAILED', () => {
      expect(isTerminalPaymentStatus(PaymentStatus.FAILED)).toBe(true);
    });

    it('should return true for REFUNDED', () => {
      expect(isTerminalPaymentStatus(PaymentStatus.REFUNDED)).toBe(true);
    });

    it('should return false for PENDING', () => {
      expect(isTerminalPaymentStatus(PaymentStatus.PENDING)).toBe(false);
    });

    it('should return false for COMPLETED', () => {
      expect(isTerminalPaymentStatus(PaymentStatus.COMPLETED)).toBe(false);
    });

    it('should return false for PARTIALLY_REFUNDED', () => {
      expect(isTerminalPaymentStatus(PaymentStatus.PARTIALLY_REFUNDED)).toBe(false);
    });
  });
});

const mongoose = require('mongoose');
const quotaService = require('../services/quota.service');
const User = require('../models/user.model');

describe('Quota Service - User Quotas & Tiered Rate Limiting (Feature G1)', () => {
  const userId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isPreviousMonth', () => {
    test('returns true for null or undefined date', () => {
      expect(quotaService.isPreviousMonth(null)).toBe(true);
      expect(quotaService.isPreviousMonth(undefined)).toBe(true);
    });

    test('returns false for date in current month', () => {
      const now = new Date();
      expect(quotaService.isPreviousMonth(now)).toBe(false);
    });

    test('returns true for date in past month', () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      expect(quotaService.isPreviousMonth(pastDate)).toBe(true);
    });
  });

  describe('checkAndConsumeQuota', () => {
    test('throws 404 if user is not found', async () => {
      jest.spyOn(User, 'findById').mockResolvedValue(null);

      await expect(
        quotaService.checkAndConsumeQuota(userId, 'upload')
      ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    });

    test('increments upload count for standard tier when under limit', async () => {
      const mockUser = {
        _id: userId,
        tier: 'standard',
        usage: {
          uploadsCount: 3,
          queriesCount: 10,
          lastResetDate: new Date(),
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      const result = await quotaService.checkAndConsumeQuota(userId, 'upload');
      expect(result.success).toBe(true);
      expect(mockUser.usage.uploadsCount).toBe(4);
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('throws 429 when upload quota is exhausted', async () => {
      const mockUser = {
        _id: userId,
        tier: 'standard',
        usage: {
          uploadsCount: 15,
          queriesCount: 10,
          lastResetDate: new Date(),
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      await expect(
        quotaService.checkAndConsumeQuota(userId, 'upload')
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'QUOTA_EXCEEDED',
        message: expect.stringContaining('upload limit reached'),
      });
    });

    test('increments query count for standard tier when under limit', async () => {
      const mockUser = {
        _id: userId,
        tier: 'standard',
        usage: {
          uploadsCount: 2,
          queriesCount: 25,
          lastResetDate: new Date(),
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      const result = await quotaService.checkAndConsumeQuota(userId, 'query');
      expect(result.success).toBe(true);
      expect(mockUser.usage.queriesCount).toBe(26);
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('throws 429 when query quota is exhausted', async () => {
      const mockUser = {
        _id: userId,
        tier: 'standard',
        usage: {
          uploadsCount: 2,
          queriesCount: 100,
          lastResetDate: new Date(),
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      await expect(
        quotaService.checkAndConsumeQuota(userId, 'query')
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'QUOTA_EXCEEDED',
        message: expect.stringContaining('query limit reached'),
      });
    });

    test('automatically resets usage when lastResetDate is from previous month', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);

      const mockUser = {
        _id: userId,
        tier: 'standard',
        usage: {
          uploadsCount: 15,
          queriesCount: 100,
          lastResetDate: pastDate,
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      const result = await quotaService.checkAndConsumeQuota(userId, 'upload');
      expect(result.success).toBe(true);
      // Reset to 0 then incremented to 1
      expect(mockUser.usage.uploadsCount).toBe(1);
      expect(mockUser.usage.queriesCount).toBe(0);
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('unlimited tier never exceeds limit', async () => {
      const mockUser = {
        _id: userId,
        tier: 'unlimited',
        usage: {
          uploadsCount: 9999,
          queriesCount: 99999,
          lastResetDate: new Date(),
        },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      const result = await quotaService.checkAndConsumeQuota(userId, 'query');
      expect(result.success).toBe(true);
      expect(mockUser.usage.queriesCount).toBe(100000);
    });
  });

  describe('getUserQuota', () => {
    test('returns usage metrics and tier limits', async () => {
      const mockUser = {
        _id: userId,
        tier: 'pro',
        usage: {
          uploadsCount: 12,
          queriesCount: 88,
          lastResetDate: new Date(),
        },
      };

      jest.spyOn(User, 'findById').mockResolvedValue(mockUser);

      const status = await quotaService.getUserQuota(userId);
      expect(status.success).toBe(true);
      expect(status.tier).toBe('pro');
      expect(status.uploadsUsed).toBe(12);
      expect(status.uploadsLimit).toBe(50);
      expect(status.queriesUsed).toBe(88);
      expect(status.queriesLimit).toBe(500);
    });
  });
});

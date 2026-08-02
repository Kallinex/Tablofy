import { RedisLockService } from '../redis-lock.service';
import { RedisService } from '../redis.service';

describe('RedisLockService', () => {
  let service: RedisLockService;
  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };
  const redisServiceMock = {
    getClient: jest.fn().mockResolvedValue(redisClient),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(1);
  });

  beforeAll(() => {
    service = new RedisLockService(redisServiceMock as unknown as RedisService);
  });

  it('acquires a lock and returns a token', async () => {
    const token = await service.acquire('job-1', 10000);
    expect(token).toBeTruthy();
    expect(redisClient.set).toHaveBeenCalledWith(
      'lock:job-1',
      expect.any(String),
      'PX',
      10000,
      'NX',
    );
  });

  it('returns null when the lock is already held', async () => {
    redisClient.set.mockResolvedValueOnce(null);
    const token = await service.acquire('job-1', 10000);
    expect(token).toBeNull();
  });

  it('releases a lock owned by the caller', async () => {
    const released = await service.release('job-1', 'token-abc');
    expect(released).toBe(true);
    expect(redisClient.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:job-1', 'token-abc');
  });

  it('does not release a lock owned by someone else', async () => {
    redisClient.eval.mockResolvedValueOnce(0);
    const released = await service.release('job-1', 'token-abc');
    expect(released).toBe(false);
  });

  it('runs the task when the lock is acquired and releases afterwards', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const ran = await service.runIfLocked('job-1', 10000, task);
    expect(ran).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });

  it('skips the task when the lock cannot be acquired', async () => {
    redisClient.set.mockResolvedValueOnce(null);
    const task = jest.fn().mockResolvedValue(undefined);
    const ran = await service.runIfLocked('job-1', 10000, task);
    expect(ran).toBe(false);
    expect(task).not.toHaveBeenCalled();
    expect(redisClient.eval).not.toHaveBeenCalled();
  });

  it('still releases the lock when the task throws', async () => {
    const task = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(service.runIfLocked('job-1', 10000, task)).rejects.toThrow('boom');
    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });
});

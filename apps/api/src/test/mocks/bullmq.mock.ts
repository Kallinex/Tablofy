export class Queue {
  static last: Queue | null = null;
  name: string;
  opts: Record<string, unknown>;
  constructor(name: string, opts?: Record<string, unknown>) {
    this.name = name;
    this.opts = opts || {};
    Queue.last = this;
  }
  add = jest.fn().mockResolvedValue({ id: 'mock-job', data: {} });
  addBulk = jest.fn().mockResolvedValue([]);
  getJob = jest.fn().mockResolvedValue(null);
  getJobs = jest.fn().mockResolvedValue([]);
  getActive = jest.fn().mockResolvedValue([]);
  getWaiting = jest.fn().mockResolvedValue([]);
  getCompleted = jest.fn().mockResolvedValue([]);
  getFailed = jest.fn().mockResolvedValue([]);
  getDelayed = jest.fn().mockResolvedValue([]);
  getWaitingCount = jest.fn().mockResolvedValue(0);
  getActiveCount = jest.fn().mockResolvedValue(0);
  getCompletedCount = jest.fn().mockResolvedValue(0);
  getFailedCount = jest.fn().mockResolvedValue(0);
  getDelayedCount = jest.fn().mockResolvedValue(0);
  getJobCounts = jest.fn().mockResolvedValue({});
  clean = jest.fn().mockResolvedValue([]);
  obliterate = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);
  removeAllListeners = jest.fn();
}

export class Worker {
  static last: Worker | null = null;
  handlers: Record<string, (job: unknown, err?: Error) => void> = {};
  constructor() {
    Worker.last = this;
  }
  on = jest.fn((event: string, cb: (job: unknown, err?: Error) => void) => {
    this.handlers[event] = cb;
  });
  close = jest.fn().mockResolvedValue(undefined);
}

export class Job {
  constructor() {
    /* noop */
  }
  static fromJSON = jest.fn();
  data = {};
  id = 'mock-job';
  updateProgress = jest.fn();
  update = jest.fn();
  remove = jest.fn();
  discard = jest.fn();
  retry = jest.fn();
  log = jest.fn();
}

export default { Queue, Worker, Job };

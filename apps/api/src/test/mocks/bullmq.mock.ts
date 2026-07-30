export class Queue {
  constructor() {
    /* noop */
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
  getJobCounts = jest.fn().mockResolvedValue({});
  clean = jest.fn().mockResolvedValue([]);
  obliterate = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);
  removeAllListeners = jest.fn();
}

export class Worker {
  constructor() {
    /* noop */
  }
  on = jest.fn();
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

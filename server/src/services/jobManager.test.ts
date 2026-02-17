// Unit tests for jobManager service
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  createJob, 
  getJob, 
  getJobForUser, 
  updateJob, 
  addJobLog, 
  addJobOrder,
  replaceJobOrders,
  setJobCurrentEmail,
  updateJobProgress,
  cleanupOldJobs 
} from './jobManager.js';

describe('jobManager', () => {
  beforeEach(() => {
    // Clean up between tests by running cleanup with old date mock
    cleanupOldJobs();
  });

  describe('createJob', () => {
    it('should create a job with correct initial state', () => {
      const job = createJob('user-123');
      
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.userId).toBe('user-123');
      expect(job.status).toBe('pending');
      expect(job.progress.total).toBe(0);
      expect(job.progress.processed).toBe(0);
      expect(job.progress.currentTask).toBe('Queued...');
      expect(job.orders).toEqual([]);
      expect(job.logs).toEqual([]);
      expect(job.currentEmail).toBeNull();
    });

    it('should generate unique job IDs', () => {
      const job1 = createJob('user-1');
      const job2 = createJob('user-2');
      
      expect(job1.id).not.toBe(job2.id);
    });

    it('should cancel previous running job when creating new one for same user', () => {
      const job1 = createJob('user-same');
      updateJob(job1.id, { status: 'running' });
      
      const job2 = createJob('user-same');
      
      const updatedJob1 = getJob(job1.id);
      expect(updatedJob1?.status).toBe('failed');
      expect(updatedJob1?.error).toBe('Cancelled - new job started');
      expect(job2.status).toBe('pending');
    });
  });

  describe('getJob', () => {
    it('should return job by ID', () => {
      const created = createJob('user-get');
      const retrieved = getJob(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent job', () => {
      const result = getJob('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getJobForUser', () => {
    it('should return latest job for user', () => {
      const _job1 = createJob('user-multi');
      const job2 = createJob('user-multi');
      
      const result = getJobForUser('user-multi');
      expect(result?.id).toBe(job2.id);
    });

    it('should return undefined for user with no jobs', () => {
      const result = getJobForUser('no-jobs-user');
      expect(result).toBeUndefined();
    });
  });

  describe('updateJob', () => {
    it('should update job properties', () => {
      const job = createJob('user-update');
      
      updateJob(job.id, { status: 'running' });
      
      const updated = getJob(job.id);
      expect(updated?.status).toBe('running');
    });

    it('should update updatedAt timestamp', () => {
      const job = createJob('user-time');
      const originalTime = job.updatedAt;
      
      // Small delay to ensure different timestamp
      updateJob(job.id, { status: 'completed' });
      
      const updated = getJob(job.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(originalTime.getTime());
    });

    it('should return undefined for non-existent job', () => {
      const result = updateJob('fake-id', { status: 'running' });
      expect(result).toBeUndefined();
    });
  });

  describe('addJobLog', () => {
    it('should add log entry to job', () => {
      const job = createJob('user-log');
      
      addJobLog(job.id, 'Test message');
      
      const updated = getJob(job.id);
      expect(updated?.logs.length).toBe(1);
      expect(updated?.logs[0]).toContain('Test message');
    });

    it('should prepend new logs (most recent first)', () => {
      const job = createJob('user-log-order');
      
      addJobLog(job.id, 'First');
      addJobLog(job.id, 'Second');
      
      const updated = getJob(job.id);
      expect(updated?.logs[0]).toContain('Second');
      expect(updated?.logs[1]).toContain('First');
    });

    it('should limit logs to 100 entries', () => {
      const job = createJob('user-log-limit');
      
      for (let i = 0; i < 110; i++) {
        addJobLog(job.id, `Log ${i}`);
      }
      
      const updated = getJob(job.id);
      expect(updated?.logs.length).toBe(100);
    });
  });

  describe('addJobOrder', () => {
    it('should add order to job', () => {
      const job = createJob('user-order');
      const order = {
        id: 'order-1',
        supplier: 'Test Supplier',
        orderDate: '2024-01-15',
        totalAmount: 100,
        items: [],
        confidence: 0.9
      };
      
      addJobOrder(job.id, order);
      
      const updated = getJob(job.id);
      expect(updated?.orders.length).toBe(1);
      expect(updated?.orders[0].supplier).toBe('Test Supplier');
    });
  });

  describe('replaceJobOrders', () => {
    it('should replace all existing orders in a job', () => {
      const job = createJob('user-replace-orders');
      addJobOrder(job.id, {
        id: 'order-1',
        supplier: 'Supplier A',
        orderDate: '2024-01-01',
        totalAmount: 10,
        items: [],
        confidence: 0.9,
      });

      replaceJobOrders(job.id, [{
        id: 'order-2',
        supplier: 'Supplier B',
        orderDate: '2024-02-01',
        totalAmount: 20,
        items: [],
        confidence: 0.95,
      }]);

      const updated = getJob(job.id);
      expect(updated?.orders).toHaveLength(1);
      expect(updated?.orders[0].id).toBe('order-2');
      expect(updated?.orders[0].supplier).toBe('Supplier B');
    });

    it('should support replacing with an empty order list', () => {
      const job = createJob('user-replace-empty');
      addJobOrder(job.id, {
        id: 'order-1',
        supplier: 'Supplier A',
        orderDate: '2024-01-01',
        totalAmount: 10,
        items: [],
        confidence: 0.9,
      });

      replaceJobOrders(job.id, []);

      const updated = getJob(job.id);
      expect(updated?.orders).toEqual([]);
    });
  });

  describe('setJobCurrentEmail', () => {
    it('should set current email being processed', () => {
      const job = createJob('user-email');
      const email = { id: 'email-1', subject: 'Test', sender: 'test@test.com' };
      
      setJobCurrentEmail(job.id, email);
      
      const updated = getJob(job.id);
      expect(updated?.currentEmail).toEqual(email);
    });

    it('should allow setting to null', () => {
      const job = createJob('user-email-null');
      setJobCurrentEmail(job.id, { id: 'e1', subject: 'S', sender: 's@s.com' });
      setJobCurrentEmail(job.id, null);
      
      const updated = getJob(job.id);
      expect(updated?.currentEmail).toBeNull();
    });
  });

  describe('updateJobProgress', () => {
    it('should update progress fields', () => {
      const job = createJob('user-progress');
      
      updateJobProgress(job.id, { total: 10, processed: 5, currentTask: 'Processing...' });
      
      const updated = getJob(job.id);
      expect(updated?.progress.total).toBe(10);
      expect(updated?.progress.processed).toBe(5);
      expect(updated?.progress.currentTask).toBe('Processing...');
    });

    it('should merge with existing progress', () => {
      const job = createJob('user-progress-merge');
      updateJobProgress(job.id, { total: 20 });
      updateJobProgress(job.id, { processed: 10 });
      
      const updated = getJob(job.id);
      expect(updated?.progress.total).toBe(20);
      expect(updated?.progress.processed).toBe(10);
    });
  });
});

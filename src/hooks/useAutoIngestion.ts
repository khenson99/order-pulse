import { useState, useEffect, useCallback, useRef } from 'react';
import { jobsApi, JobStatus } from '../services/api';
import { ExtractedOrder, GoogleUserProfile } from '../types';

interface EmailPreview {
  id: string;
  subject: string;
  sender: string;
  snippet?: string;
}

interface IngestionProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

interface UseAutoIngestionResult {
  isIngesting: boolean;
  progress: IngestionProgress;
  currentEmail: EmailPreview | null;
  orders: ExtractedOrder[];
  logs: string[];
  error: string | null;
  startIngestion: () => Promise<void>;
  resetAndRestart: () => Promise<void>;
  jobStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
}

export function useAutoIngestion(
  userProfile: GoogleUserProfile | null,
  onOrdersProcessed: (orders: ExtractedOrder[]) => void
): UseAutoIngestionResult {
  const [isIngesting, setIsIngesting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [progress, setProgress] = useState<IngestionProgress>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    currentTask: 'Waiting...',
  });
  
  const [currentEmail, setCurrentEmail] = useState<EmailPreview | null>(null);
  const [orders, setOrders] = useState<ExtractedOrder[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStartedRef = useRef(false);

  // Poll for job status
  const pollJobStatus = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      const status = await jobsApi.getStatus(currentJobId);
      
      if (!status.hasJob) {
        setIsIngesting(false);
        setJobStatus(null);
        return;
      }
      
      // Update progress
      if (status.progress) {
        setProgress({
          total: status.progress.total,
          processed: status.progress.processed,
          success: status.progress.success,
          failed: status.progress.failed,
          currentTask: status.progress.currentTask,
        });
      }
      
      if (status.currentEmail) {
        setCurrentEmail(status.currentEmail);
      }
      
      if (status.orders) {
        const convertedOrders: ExtractedOrder[] = status.orders.map((o: any) => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setOrders(convertedOrders);
        onOrdersProcessed(convertedOrders);
      }
      
      if (status.logs) {
        setLogs(status.logs);
      }
      
      setJobStatus(status.status || null);
      
      // Stop polling if complete or failed
      if (status.status === 'completed' || status.status === 'failed') {
        setIsIngesting(false);
        setCurrentEmail(null);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        
        if (status.status === 'failed' && status.error) {
          setError(status.error);
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, [currentJobId, onOrdersProcessed]);

  // Start/stop polling
  useEffect(() => {
    if (isIngesting && currentJobId) {
      pollingRef.current = setInterval(pollJobStatus, 1000);
      pollJobStatus(); // Immediate first poll
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isIngesting, currentJobId, pollJobStatus]);

  // Start ingestion
  const startIngestion = useCallback(async () => {
    if (isIngesting || !userProfile) return;
    
    setIsIngesting(true);
    setError(null);
    setProgress({ total: 0, processed: 0, success: 0, failed: 0, currentTask: 'Starting...' });
    setLogs(['[' + new Date().toLocaleTimeString() + '] Starting email analysis...']);
    
    try {
      const result = await jobsApi.startJob();
      if (result.jobId) {
        setCurrentJobId(result.jobId);
        setJobStatus('running');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start ingestion');
      setIsIngesting(false);
    }
  }, [isIngesting, userProfile]);

  // Reset all state and restart ingestion from scratch
  const resetAndRestart = useCallback(async () => {
    // Stop any current polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    // Clear all state
    setIsIngesting(false);
    setCurrentJobId(null);
    setJobStatus(null);
    setError(null);
    setProgress({ total: 0, processed: 0, success: 0, failed: 0, currentTask: 'Waiting...' });
    setCurrentEmail(null);
    setOrders([]);
    setLogs(['[' + new Date().toLocaleTimeString() + '] Reset complete. Starting fresh...']);
    
    // Notify parent to clear orders
    onOrdersProcessed([]);
    
    // Small delay then start fresh
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (userProfile) {
      setIsIngesting(true);
      setProgress({ total: 0, processed: 0, success: 0, failed: 0, currentTask: 'Starting...' });
      setLogs(prev => [...prev, '[' + new Date().toLocaleTimeString() + '] Starting email analysis...']);
      
      try {
        const result = await jobsApi.startJob();
        if (result.jobId) {
          setCurrentJobId(result.jobId);
          setJobStatus('running');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to start ingestion');
        setIsIngesting(false);
      }
    }
  }, [userProfile, onOrdersProcessed]);

  // Auto-start on first auth
  useEffect(() => {
    if (userProfile && !hasStartedRef.current) {
      hasStartedRef.current = true;
      
      // Check for existing job first
      const checkAndStart = async () => {
        try {
          const status = await jobsApi.getStatus();
          
          if (status.hasJob && status.jobId) {
            // Resume existing job
            setCurrentJobId(status.jobId);
            setIsIngesting(status.status === 'running' || status.status === 'pending');
            setJobStatus(status.status || null);
            
            // If completed, load the orders
            if (status.status === 'completed' && status.orders) {
              const convertedOrders: ExtractedOrder[] = status.orders.map((o: any) => ({
                id: o.id,
                originalEmailId: o.id,
                supplier: o.supplier,
                orderDate: o.orderDate,
                totalAmount: o.totalAmount,
                items: o.items,
                confidence: o.confidence,
              }));
              setOrders(convertedOrders);
              onOrdersProcessed(convertedOrders);
            }
          } else {
            // No existing job, start a new one
            await startIngestion();
          }
        } catch {
          // No existing job, start fresh
          await startIngestion();
        }
      };
      
      checkAndStart();
    }
  }, [userProfile, startIngestion, onOrdersProcessed]);

  return {
    isIngesting,
    progress,
    currentEmail,
    orders,
    logs,
    error,
    startIngestion,
    resetAndRestart,
    jobStatus,
  };
}

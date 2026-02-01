import { Icons } from './Icons';

interface LoadingSkeletonProps {
  type?: 'card' | 'list' | 'chart' | 'text';
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ type = 'card', count = 1 }) => {
  const items = Array.from({ length: count }, (_, i) => i);

  if (type === 'text') {
    return (
      <div className="space-y-2 animate-pulse">
        {items.map((i) => (
          <div key={i} className="h-4 bg-arda-bg-tertiary rounded w-full" style={{ width: `${60 + Math.random() * 40}%` }} />
        ))}
      </div>
    );
  }

  if (type === 'list') {
    return (
      <div className="space-y-3 animate-pulse">
        {items.map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-arda-bg-secondary rounded-lg border border-arda-border">
            <div className="w-10 h-10 bg-arda-bg-tertiary rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-arda-bg-tertiary rounded w-1/3" />
              <div className="h-3 bg-arda-bg-tertiary/60 rounded w-2/3" />
            </div>
            <div className="h-6 w-16 bg-arda-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'chart') {
    return (
      <div className="h-64 bg-arda-bg-secondary border border-arda-border rounded-lg p-6 animate-pulse">
        <div className="flex items-end justify-around h-full gap-4">
          {[40, 70, 50, 90, 60, 80, 45].map((height, i) => (
            <div 
              key={i} 
              className="w-8 bg-arda-bg-tertiary rounded-t" 
              style={{ height: `${height}%` }} 
            />
          ))}
        </div>
      </div>
    );
  }

  // Default: card
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-pulse">
      {items.map((i) => (
        <div key={i} className="bg-arda-bg-secondary border border-arda-border rounded-lg p-5">
          <div className="flex justify-between items-start mb-4">
            <div className="space-y-2">
              <div className="h-5 bg-arda-bg-tertiary rounded w-32" />
              <div className="h-3 bg-arda-bg-tertiary/60 rounded w-20" />
            </div>
            <div className="h-6 w-14 bg-arda-bg-tertiary rounded" />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-arda-bg-tertiary p-3 rounded space-y-2">
              <div className="h-3 bg-arda-bg-tertiary/60 rounded w-12" />
              <div className="h-5 bg-arda-bg-tertiary rounded w-16" />
            </div>
            <div className="bg-arda-bg-tertiary p-3 rounded space-y-2">
              <div className="h-3 bg-arda-bg-tertiary/60 rounded w-12" />
              <div className="h-5 bg-arda-bg-tertiary rounded w-16" />
            </div>
          </div>
          <div className="border-t border-arda-border pt-4 flex justify-between">
            <div className="h-4 bg-arda-bg-tertiary/60 rounded w-20" />
            <div className="h-8 bg-arda-bg-tertiary rounded w-24" />
          </div>
        </div>
      ))}
    </div>
  );
};

interface PageLoadingProps {
  message?: string;
}

export const PageLoading: React.FC<PageLoadingProps> = ({ message = 'Loading...' }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <Icons.Loader2 className="w-10 h-10 text-arda-accent animate-spin" />
      <p className="text-sm text-arda-text-muted font-medium">{message}</p>
    </div>
  );
};

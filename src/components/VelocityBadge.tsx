import React from 'react';
import { Icons } from './Icons';

interface VelocityBadgeProps {
  dailyBurnRate: number;
  averageCadenceDays: number;
  orderCount: number;
  nextPredictedOrder?: string;
  compact?: boolean;
}

/**
 * Get velocity classification based on daily burn rate
 */
const getVelocityClass = (dailyBurnRate: number): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
} => {
  if (dailyBurnRate >= 10) {
    return {
      label: 'Fast',
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/20',
      borderColor: 'border-orange-500/50',
    };
  } else if (dailyBurnRate >= 3) {
    return {
      label: 'Medium',
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      borderColor: 'border-yellow-500/50',
    };
  } else if (dailyBurnRate >= 1) {
    return {
      label: 'Slow',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/20',
      borderColor: 'border-blue-500/50',
    };
  } else {
    return {
      label: 'Rare',
      color: 'text-slate-400',
      bgColor: 'bg-slate-500/20',
      borderColor: 'border-slate-500/50',
    };
  }
};

export const VelocityBadge: React.FC<VelocityBadgeProps> = ({
  dailyBurnRate,
  averageCadenceDays,
  orderCount,
  nextPredictedOrder,
  compact = false,
}) => {
  const velocityClass = getVelocityClass(dailyBurnRate);
  
  if (compact) {
    return (
      <span 
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${velocityClass.bgColor} ${velocityClass.color} border ${velocityClass.borderColor}`}
        title={`${dailyBurnRate.toFixed(1)}/day | Cadence: ${Math.round(averageCadenceDays)} days | ${orderCount} orders`}
      >
        <Icons.Zap className="w-3 h-3" />
        {dailyBurnRate.toFixed(1)}/day
      </span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg ${velocityClass.bgColor} border ${velocityClass.borderColor}`}>
      {/* Velocity Rate */}
      <div className="flex items-center gap-1.5">
        <Icons.Zap className={`w-4 h-4 ${velocityClass.color}`} />
        <span className={`text-sm font-semibold ${velocityClass.color}`}>
          {dailyBurnRate.toFixed(1)}/day
        </span>
        <span className="text-xs text-slate-500">
          ({velocityClass.label})
        </span>
      </div>
      
      {/* Divider */}
      <div className="w-px h-4 bg-slate-600" />
      
      {/* Cadence */}
      <div className="flex items-center gap-1.5">
        <Icons.Calendar className="w-4 h-4 text-slate-400" />
        <span className="text-sm text-slate-300">
          {Math.round(averageCadenceDays)} days
        </span>
      </div>
      
      {/* Order Count */}
      <div className="flex items-center gap-1.5">
        <Icons.Package className="w-4 h-4 text-slate-400" />
        <span className="text-sm text-slate-300">
          {orderCount} order{orderCount !== 1 ? 's' : ''}
        </span>
      </div>
      
      {/* Next Predicted Order */}
      {nextPredictedOrder && (
        <>
          <div className="w-px h-4 bg-slate-600" />
          <div className="flex items-center gap-1.5">
            <Icons.Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">
              Next: {new Date(nextPredictedOrder).toLocaleDateString()}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default VelocityBadge;

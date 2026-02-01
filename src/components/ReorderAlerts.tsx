import React, { useMemo } from 'react';
import { ItemVelocityProfile } from '../types';
import { Icons } from './Icons';

interface ReorderAlertsProps {
  velocityProfiles: Map<string, ItemVelocityProfile>;
  onItemClick?: (name: string) => void;
}

interface AlertItem {
  profile: ItemVelocityProfile;
  daysUntil: number;
  urgency: 'red' | 'orange' | 'yellow';
}

export const ReorderAlerts: React.FC<ReorderAlertsProps> = ({
  velocityProfiles,
  onItemClick,
}) => {
  // Calculate days until next order and create alert items
  const alertItems = useMemo(() => {
    const items: AlertItem[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    velocityProfiles.forEach((profile) => {
      if (!profile.nextPredictedOrder) return;

      const nextOrderDate = new Date(profile.nextPredictedOrder);
      nextOrderDate.setHours(0, 0, 0, 0);
      
      const daysUntil = Math.ceil(
        (nextOrderDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Only include items that need reordering soon (within 14 days)
      if (daysUntil <= 14) {
        let urgency: 'red' | 'orange' | 'yellow';
        if (daysUntil < 3) {
          urgency = 'red';
        } else if (daysUntil < 7) {
          urgency = 'orange';
        } else {
          urgency = 'yellow';
        }

        items.push({
          profile,
          daysUntil,
          urgency,
        });
      }
    });

    // Sort by urgency (soonest first)
    return items.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [velocityProfiles]);

  const displayItems = alertItems.slice(0, 5);
  const hasMore = alertItems.length > 5;

  const getUrgencyConfig = (urgency: 'red' | 'orange' | 'yellow') => {
    switch (urgency) {
      case 'red':
        return {
          icon: Icons.AlertCircle,
          iconColor: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30',
          textColor: 'text-red-400',
        };
      case 'orange':
        return {
          icon: Icons.Clock,
          iconColor: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30',
          textColor: 'text-orange-400',
        };
      case 'yellow':
        return {
          icon: Icons.Clock,
          iconColor: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          textColor: 'text-yellow-400',
        };
    }
  };

  const formatDaysUntil = (days: number): string => {
    if (days < 0) {
      return `${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} overdue`;
    } else if (days === 0) {
      return 'Today';
    } else {
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
  };

  if (alertItems.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-2 mb-2">
          <Icons.CheckCircle2 className="w-5 h-5 text-green-400" />
          <h3 className="text-sm font-semibold text-white">Reorder Alerts</h3>
        </div>
        <p className="text-xs text-slate-400">No items need reordering in the next 14 days.</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/50">
      <div className="flex items-center gap-2 mb-3">
        <Icons.AlertCircle className="w-5 h-5 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Reorder Alerts</h3>
        <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">
          {alertItems.length}
        </span>
      </div>

      <div className="space-y-2">
        {displayItems.map((item) => {
          const config = getUrgencyConfig(item.urgency);
          const Icon = config.icon;

          return (
            <div
              key={item.profile.normalizedName}
              className={`p-3 rounded-lg border ${config.bgColor} ${config.borderColor} flex items-start gap-3 cursor-pointer hover:opacity-80 transition-opacity`}
              onClick={() => onItemClick?.(item.profile.normalizedName)}
            >
              <div className={`flex-shrink-0 mt-0.5 ${config.iconColor}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {item.profile.displayName}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {item.profile.supplier}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1.5">
                        <Icons.Calendar className={`w-3.5 h-3.5 ${config.textColor}`} />
                        <span className={`text-xs font-medium ${config.textColor}`}>
                          {formatDaysUntil(item.daysUntil)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Icons.Zap className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs text-slate-400">
                          {item.profile.dailyBurnRate.toFixed(1)}/day
                        </span>
                      </div>
                    </div>
                  </div>
                  <Icons.ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <button
            onClick={() => {
              // Could navigate to a full alerts view or expand the list
              console.log('View all alerts');
            }}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-white transition-colors py-1.5"
          >
            <span>View All {alertItems.length} Alerts</span>
            <Icons.ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ReorderAlerts;

import React from 'react';
import { InventoryItem, ItemVelocityProfile } from '../types';
import { Icons } from './Icons';

export type AlertType = 'overdue' | 'upcoming' | 'high-velocity';

export interface Alert {
  type: AlertType;
  profile: ItemVelocityProfile;
  daysUntil: number;
}

interface AlertCardProps {
  alert: Alert;
  onReorder?: (item: InventoryItem) => void;
  inventory: InventoryItem[];
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onReorder, inventory }) => {
  const { type, profile, daysUntil } = alert;
  
  // Find matching inventory item
  const matchingInventoryItem = inventory.find(
    i => i.name.toLowerCase().trim() === profile.normalizedName
  );

  const getAlertConfig = () => {
    switch (type) {
      case 'overdue':
        return {
          icon: Icons.AlertCircle,
          iconColor: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30',
          label: 'Overdue',
          timeText: daysUntil === 0 ? 'Today' : `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} ago`,
        };
      case 'upcoming':
        return {
          icon: Icons.Clock,
          iconColor: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          label: 'Upcoming',
          timeText: daysUntil === 0 ? 'Today' : `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        };
      case 'high-velocity':
        return {
          icon: Icons.Zap,
          iconColor: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30',
          label: 'High Velocity',
          timeText: `${profile.dailyBurnRate.toFixed(1)} units/day`,
        };
    }
  };

  const config = getAlertConfig();
  const Icon = config.icon;

  return (
    <div className={`p-3 rounded-lg border ${config.bgColor} ${config.borderColor} flex items-start gap-3`}>
      <div className={`flex-shrink-0 mt-0.5 ${config.iconColor}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-arda-text-primary truncate">
              {profile.displayName}
            </div>
            <div className="text-xs text-arda-text-muted mt-0.5">
              {profile.supplier}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded ${config.bgColor} ${config.iconColor} font-medium`}>
                {config.label}
              </span>
              <span className="text-xs text-arda-text-muted">
                {config.timeText}
              </span>
            </div>
          </div>
          {matchingInventoryItem && onReorder && (
            <button
              onClick={() => onReorder(matchingInventoryItem)}
              className="flex-shrink-0 px-3 py-1.5 bg-arda-accent hover:bg-arda-accent-hover text-white text-xs font-medium rounded transition-colors flex items-center gap-1.5"
              title="Create reorder email"
            >
              <Icons.Send className="w-3 h-3" />
              Reorder
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

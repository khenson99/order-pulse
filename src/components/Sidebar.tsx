import { NAV_ITEMS, APP_DESCRIPTION } from '../constants';
import { Icons } from './Icons';
import { GoogleUserProfile } from '../types';

interface IngestionProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  currentTask: string;
}

interface SidebarProps {
  activeView: string;
  onChangeView: (view: string) => void;
  userProfile?: GoogleUserProfile | null;
  onLogout?: () => void;
  onReset?: () => void;
  isIngesting?: boolean;
  ingestionProgress?: IngestionProgress;
}

// Arda logo SVG
const ArdaLogo = ({ className = "h-7 w-auto" }: { className?: string }) => (
  <svg viewBox="0 0 80 28" className={className}>
    <text x="0" y="22" fill="#FC5A29" fontSize="24" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif">
      arda
    </text>
  </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeView, 
  onChangeView,
  userProfile,
  onLogout,
  onReset,
  isIngesting,
  ingestionProgress,
}) => {
  return (
    <div className="w-64 h-screen bg-white border-r border-arda-border flex flex-col fixed left-0 top-0 z-20">
      {/* Header */}
      <div className="p-6 border-b border-arda-border">
        <div className="flex items-center gap-2">
          <ArdaLogo />
          <span className="text-xs font-medium text-arda-text-muted uppercase tracking-wider">{APP_DESCRIPTION}</span>
        </div>
        
        {/* Sync Status */}
        {isIngesting && ingestionProgress && (
          <div className="mt-3 bg-orange-50 rounded-lg p-2">
            <div className="flex items-center gap-2 text-xs text-orange-700">
              <div className="animate-spin w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full" />
              <span className="font-medium">Syncing emails...</span>
            </div>
            <div className="mt-1 text-xs text-orange-600">
              {ingestionProgress.processed}/{ingestionProgress.total} processed
            </div>
            <div className="mt-1 h-1 bg-orange-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ 
                  width: ingestionProgress.total > 0 
                    ? `${(ingestionProgress.processed / ingestionProgress.total) * 100}%` 
                    : '0%' 
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = Icons[item.icon as keyof typeof Icons];
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-orange-50 text-arda-accent'
                  : 'text-arda-text-secondary hover:text-arda-text-primary hover:bg-arda-bg-tertiary'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-arda-accent' : ''}`} />
              {item.label}
            </button>
          );
        })}
        
        {/* Divider */}
        <div className="my-3 border-t border-arda-border" />
        
        {/* Reset Button */}
        <button
          onClick={onReset}
          disabled={isIngesting}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
            isIngesting
              ? 'text-arda-text-muted cursor-not-allowed'
              : 'text-red-600 hover:text-red-700 hover:bg-red-50'
          }`}
        >
          <Icons.RefreshCw className={`w-5 h-5 ${isIngesting ? 'animate-spin' : ''}`} />
          {isIngesting ? 'Processing...' : 'Reset & Re-scan'}
        </button>
      </nav>

      {/* User Profile & Logout */}
      <div className="p-4 border-t border-arda-border">
        {userProfile ? (
          <div className="flex items-center gap-3">
            <img 
              src={userProfile.picture} 
              alt={userProfile.name}
              className="w-8 h-8 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-arda-text-primary truncate">
                {userProfile.name}
              </div>
              <div className="text-xs text-arda-text-muted truncate">
                {userProfile.email}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-arda-text-muted hover:text-arda-text-primary hover:bg-arda-bg-tertiary rounded-lg transition-colors"
              title="Sign out"
            >
              <Icons.LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button className="flex items-center gap-3 text-arda-text-secondary hover:text-arda-text-primary text-sm font-medium w-full px-4 py-2 rounded-lg hover:bg-arda-bg-tertiary transition-colors">
            <Icons.Settings className="w-5 h-5" />
            Settings
          </button>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { Icons } from './Icons';

export interface DiscoveredSupplier {
  domain: string;
  displayName: string;
  emailCount: number;
  score: number;
  category: 'industrial' | 'retail' | 'office' | 'food' | 'electronics' | 'unknown';
  sampleSubjects: string[];
  isRecommended: boolean;
}

export interface SupplierConfigProps {
  suppliers: DiscoveredSupplier[];
  enabledSuppliers: string[];
  onToggleSupplier: (domain: string) => void;
  onScanSupplier: (domain: string) => void;
  onScanAllEnabled?: () => void;
  isLoading?: boolean;
  currentlyScanning?: string;
}

const getCategoryConfig = (category: DiscoveredSupplier['category']) => {
  switch (category) {
    case 'industrial':
      return {
        label: 'Industrial',
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/20',
        borderColor: 'border-blue-500/50',
      };
    case 'retail':
      return {
        label: 'Retail',
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        borderColor: 'border-green-500/50',
      };
    case 'office':
      return {
        label: 'Office',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        borderColor: 'border-purple-500/50',
      };
    case 'food':
      return {
        label: 'Food',
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/20',
        borderColor: 'border-orange-500/50',
      };
    case 'electronics':
      return {
        label: 'Electronics',
        color: 'text-cyan-400',
        bgColor: 'bg-cyan-500/20',
        borderColor: 'border-cyan-500/50',
      };
    case 'unknown':
    default:
      return {
        label: 'Unknown',
        color: 'text-arda-text-muted',
        bgColor: 'bg-arda-bg-tertiary',
        borderColor: 'border-arda-border',
      };
  }
};

export const SupplierConfig: React.FC<SupplierConfigProps> = ({
  suppliers,
  enabledSuppliers,
  onToggleSupplier,
  onScanSupplier,
  onScanAllEnabled,
  isLoading = false,
  currentlyScanning,
}) => {
  const enabledCount = enabledSuppliers.length;
  const hasEnabledSuppliers = enabledCount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-arda-text-primary mb-2">
          Configure Your Suppliers
        </h2>
        <p className="text-arda-text-secondary text-sm">
          Start with one supplier at a time. We recommend beginning with Amazon.
        </p>
      </div>

      {/* Scan All Enabled Button */}
      {hasEnabledSuppliers && onScanAllEnabled && (
        <div className="flex items-center justify-between bg-white border border-arda-border rounded-xl shadow-arda p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-arda-accent/10 rounded-lg flex items-center justify-center">
              <Icons.ScanLine className="w-5 h-5 text-arda-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-arda-text-primary">
                Scan All Enabled Suppliers
              </p>
              <p className="text-xs text-arda-text-muted">
                {enabledCount} supplier{enabledCount !== 1 ? 's' : ''} enabled
              </p>
            </div>
          </div>
          <button
            onClick={onScanAllEnabled}
            disabled={isLoading || !!currentlyScanning}
            className="px-4 py-2 bg-arda-accent text-white rounded-lg font-medium text-sm hover:bg-arda-accent-hover flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <>
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Icons.ScanLine className="w-4 h-4" />
                Scan All Enabled
              </>
            )}
          </button>
        </div>
      )}

      {/* Suppliers List */}
      <div className="space-y-3">
        {suppliers.length === 0 ? (
          <div className="bg-white border border-arda-border rounded-xl shadow-arda p-8 text-center">
            <Icons.Building2 className="w-12 h-12 text-arda-text-muted mx-auto mb-3" />
            <p className="text-arda-text-secondary font-medium mb-1">No suppliers discovered yet</p>
            <p className="text-sm text-arda-text-muted">
              Connect your email account to discover suppliers from your order emails.
            </p>
          </div>
        ) : (
          suppliers.map((supplier) => {
            const isEnabled = enabledSuppliers.includes(supplier.domain);
            const isScanning = currentlyScanning === supplier.domain;
            const categoryConfig = getCategoryConfig(supplier.category);
            const isDisabled = isLoading || (!!currentlyScanning && !isScanning);

            return (
              <div
                key={supplier.domain}
                className={`bg-white border rounded-xl shadow-arda p-5 transition-all ${
                  supplier.isRecommended
                    ? 'border-arda-accent/50 bg-orange-50/30'
                    : 'border-arda-border'
                } ${isDisabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Supplier Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-3 mb-3">
                      {/* Supplier Icon */}
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                        supplier.isRecommended ? 'bg-arda-accent/20' : 'bg-arda-bg-tertiary'
                      }`}>
                        <Icons.Building2 className={`w-5 h-5 ${
                          supplier.isRecommended ? 'text-arda-accent' : 'text-arda-text-secondary'
                        }`} />
                      </div>

                      {/* Supplier Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold text-arda-text-primary truncate">
                            {supplier.displayName}
                          </h3>
                          {supplier.isRecommended && (
                            <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-arda-accent/20 text-arda-accent text-xs font-medium rounded-full">
                              <Icons.Sparkles className="w-3 h-3" />
                              Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-arda-text-muted mb-2">{supplier.domain}</p>

                        {/* Stats Row */}
                        <div className="flex items-center gap-4 flex-wrap">
                          {/* Email Count */}
                          <div className="flex items-center gap-1.5">
                            <Icons.Mail className="w-4 h-4 text-arda-text-muted" />
                            <span className="text-sm text-arda-text-secondary">
                              {supplier.emailCount} email{supplier.emailCount !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Category Badge */}
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${categoryConfig.bgColor} ${categoryConfig.color} ${categoryConfig.borderColor}`}
                          >
                            {categoryConfig.label}
                          </span>

                          {/* Score */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-arda-text-muted">Score:</span>
                            <div className="flex items-center gap-1.5">
                              <div 
                                className="w-20 h-1.5 bg-arda-bg-tertiary rounded-full overflow-hidden relative"
                                role="progressbar"
                                aria-valuenow={Math.min(supplier.score, 100)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Supplier confidence score: ${supplier.score}%`}
                              >
                                <div
                                  className={`h-full rounded-full transition-all absolute left-0 top-0 ${
                                    supplier.score >= 70
                                      ? 'bg-green-500'
                                      : supplier.score >= 40
                                      ? 'bg-yellow-500'
                                      : 'bg-arda-text-muted'
                                  }`}
                                  style={{ width: `${Math.min(supplier.score, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-arda-text-secondary w-8">
                                {supplier.score}%
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Sample Subjects */}
                        {supplier.sampleSubjects.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-arda-border">
                            <p className="text-xs text-arda-text-muted mb-1.5 font-medium">
                              Sample Subjects:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {supplier.sampleSubjects.slice(0, 3).map((subject, idx) => (
                                <span
                                  key={idx}
                                  className="text-xs text-arda-text-secondary bg-arda-bg-secondary px-2 py-0.5 rounded border border-arda-border truncate max-w-[200px]"
                                  title={subject}
                                >
                                  {subject}
                                </span>
                              ))}
                              {supplier.sampleSubjects.length > 3 && (
                                <span className="text-xs text-arda-text-muted">
                                  +{supplier.sampleSubjects.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Controls */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    {/* Toggle Switch */}
                    <div className="flex flex-col items-center gap-1">
                      <label className="relative inline-flex items-center cursor-pointer" aria-label={`Toggle ${supplier.displayName} supplier`}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => onToggleSupplier(supplier.domain)}
                          disabled={isDisabled}
                          className="sr-only peer"
                          aria-label={`Enable or disable ${supplier.displayName} supplier`}
                        />
                        <div className="w-11 h-6 bg-arda-bg-tertiary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-arda-accent rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-arda-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-arda-accent disabled:opacity-50 disabled:cursor-not-allowed" />
                      </label>
                      <span className="text-xs text-arda-text-muted">
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    {/* Scan Button */}
                    <button
                      onClick={() => onScanSupplier(supplier.domain)}
                      disabled={isDisabled || !isEnabled}
                      className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors ${
                        isEnabled
                          ? 'bg-arda-accent text-white hover:bg-arda-accent-hover disabled:opacity-50 disabled:cursor-not-allowed'
                          : 'bg-arda-bg-tertiary text-arda-text-muted cursor-not-allowed'
                      }`}
                    >
                      {isScanning ? (
                        <>
                          <Icons.Loader2 className="w-4 h-4 animate-spin" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <Icons.ScanLine className="w-4 h-4" />
                          Scan Now
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SupplierConfig;

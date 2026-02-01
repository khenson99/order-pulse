import React from 'react';
import { Icons } from './Icons';
import { VelocityBadge } from './VelocityBadge';
import { ReorderSparkline } from './ReorderSparkline';
import { 
  JourneyNode, 
  JourneyNodeType, 
  VelocityNodeData,
  LineItemNodeData,
  OrderNodeData,
  EmailNodeData,
  ItemVelocityProfile
} from '../types';

interface TreeNodeProps {
  node: JourneyNode;
  level: number;
  velocityProfiles?: Map<string, ItemVelocityProfile>;
  onNodeClick?: (node: JourneyNode) => void;
  onExpandToggle?: (nodeId: string, isExpanded: boolean) => void;
  expandedNodes?: Set<string>;
  focusedNodeId?: string | null;
  onFocusChange?: (nodeId: string) => void;
}

const getNodeIcon = (type: JourneyNodeType) => {
  switch (type) {
    case 'email':
      return Icons.Mail;
    case 'order':
      return Icons.Package;
    case 'lineItem':
      return Icons.Box;
    case 'velocity':
      return Icons.Activity;
    default:
      return Icons.FileText;
  }
};

const getNodeColors = (type: JourneyNodeType) => {
  switch (type) {
    case 'email':
      return {
        iconBg: 'bg-blue-500/20',
        iconColor: 'text-blue-400',
        border: 'border-blue-500/30',
      };
    case 'order':
      return {
        iconBg: 'bg-green-500/20',
        iconColor: 'text-green-400',
        border: 'border-green-500/30',
      };
    case 'lineItem':
      return {
        iconBg: 'bg-purple-500/20',
        iconColor: 'text-purple-400',
        border: 'border-purple-500/30',
      };
    case 'velocity':
      return {
        iconBg: 'bg-orange-500/20',
        iconColor: 'text-orange-400',
        border: 'border-orange-500/30',
      };
    default:
      return {
        iconBg: 'bg-slate-500/20',
        iconColor: 'text-slate-400',
        border: 'border-slate-500/30',
      };
  }
};

export const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  velocityProfiles,
  onNodeClick,
  onExpandToggle,
  expandedNodes,
  focusedNodeId,
  onFocusChange,
}) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes?.has(node.id) ?? (node.isExpanded ?? level < 2);
  const isFocused = focusedNodeId === node.id;
  const isNew = node.isNew ?? false;
  
  const Icon = getNodeIcon(node.type);
  const colors = getNodeColors(node.type);
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = !isExpanded;
    onExpandToggle?.(node.id, newExpanded);
  };
  
  const handleClick = () => {
    onFocusChange?.(node.id);
    onNodeClick?.(node);
  };

  const handleMouseEnter = () => {
    onFocusChange?.(node.id);
  };

  // Get velocity profile for line items
  const getVelocityProfileForNode = (): ItemVelocityProfile | undefined => {
    if (node.type === 'lineItem' && velocityProfiles) {
      const data = node.data as LineItemNodeData;
      return velocityProfiles.get(data.normalizedName);
    }
    return undefined;
  };

  const velocityProfile = getVelocityProfileForNode();

  return (
    <div className="select-none">
      {/* Node Row */}
      <div 
        data-node-id={node.id}
        className={`
          flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer
          transition-all duration-200 ease-in-out group
          hover:bg-slate-800/50 hover:scale-[1.01]
          ${level === 0 ? 'bg-slate-800/30' : ''}
          ${isFocused ? 'ring-2 ring-arda-accent ring-offset-2 ring-offset-slate-900 bg-slate-800/70' : ''}
          ${isNew ? 'animate-pulse ring-2 ring-green-400/50 ring-offset-2 ring-offset-slate-900' : ''}
        `}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
      >
        {/* Expand/Collapse Button */}
        <button
          onClick={handleToggle}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          className={`
            w-5 h-5 flex items-center justify-center rounded relative
            transition-all duration-200 ease-in-out
            hover:bg-slate-700 hover:scale-110
            ${hasChildren ? 'visible' : 'invisible'}
          `}
        >
          <Icons.ChevronRight 
            className={`
              w-4 h-4 text-slate-400 absolute
              transition-opacity duration-200 ease-in-out
              ${isExpanded ? 'opacity-0' : 'opacity-100'}
            `} 
          />
          <Icons.ChevronDown 
            className={`
              w-4 h-4 text-slate-400 absolute
              transition-opacity duration-200 ease-in-out
              ${isExpanded ? 'opacity-100' : 'opacity-0'}
            `} 
          />
        </button>
        
        {/* Node Icon */}
        <div className={`
          w-7 h-7 rounded-lg flex items-center justify-center
          transition-all duration-200 ease-in-out
          ${colors.iconBg}
          ${isNew ? 'animate-pulse shadow-lg shadow-green-400/30' : ''}
        `}>
          <Icon className={`w-4 h-4 transition-colors duration-200 ${colors.iconColor}`} />
        </div>
        
        {/* Node Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200 truncate">
              {node.label}
            </span>
            
            {/* Inline velocity badge for line items */}
            {node.type === 'lineItem' && velocityProfile && (
              <VelocityBadge
                dailyBurnRate={velocityProfile.dailyBurnRate}
                averageCadenceDays={velocityProfile.averageCadenceDays}
                orderCount={velocityProfile.orderCount}
                compact
              />
            )}
          </div>
          
          {node.subtitle && (
            <div className="text-xs text-slate-500 truncate">
              {node.subtitle}
            </div>
          )}
        </div>
        
        {/* Sparkline for line items */}
        {node.type === 'lineItem' && velocityProfile && velocityProfile.orders.length >= 2 && (
          <div className="hidden group-hover:block transition-opacity duration-200 ease-in-out opacity-0 group-hover:opacity-100">
            <ReorderSparkline
              orders={velocityProfile.orders.map(o => ({
                date: o.date,
                quantity: o.quantity,
              }))}
              width={80}
              height={20}
            />
          </div>
        )}
        
        {/* Order amount badge */}
        {node.type === 'order' && (node.data as OrderNodeData)?.totalAmount && (
          <span className="text-sm font-medium text-green-400">
            ${((node.data as OrderNodeData).totalAmount || 0).toFixed(2)}
          </span>
        )}
        
        {/* Date for emails */}
        {node.type === 'email' && (node.data as EmailNodeData)?.date && (
          <span className="text-xs text-slate-500">
            {new Date((node.data as EmailNodeData).date).toLocaleDateString()}
          </span>
        )}
      </div>
      
      {/* Velocity Detail Node (special rendering) */}
      {node.type === 'velocity' && (
        <div 
          className="ml-4 py-2 px-3 transition-all duration-200 ease-in-out"
          style={{ paddingLeft: `${level * 20 + 28}px` }}
        >
          <VelocityBadge
            dailyBurnRate={(node.data as VelocityNodeData).dailyBurnRate}
            averageCadenceDays={(node.data as VelocityNodeData).averageCadenceDays}
            orderCount={(node.data as VelocityNodeData).orderCount}
            nextPredictedOrder={(node.data as VelocityNodeData).nextPredictedOrder}
          />
        </div>
      )}
      
      {/* Children */}
      {hasChildren && (
        <div 
          className={`
            relative overflow-hidden transition-all duration-300 ease-in-out
            ${level > 0 ? 'ml-3' : ''}
            ${isExpanded ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'}
          `}
        >
          {/* Connecting line */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-px bg-slate-700 transition-opacity duration-300"
            style={{ left: `${level * 20 + 18}px` }}
          />
          
          <div className={`
            transition-transform duration-300 ease-in-out
            ${isExpanded ? 'translate-y-0' : '-translate-y-2'}
          `}>
            {node.children!.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                level={level + 1}
                velocityProfiles={velocityProfiles}
                onNodeClick={onNodeClick}
                onExpandToggle={onExpandToggle}
                expandedNodes={expandedNodes}
                focusedNodeId={focusedNodeId}
                onFocusChange={onFocusChange}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TreeNode;

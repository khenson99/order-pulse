import React, { memo, useCallback, useMemo } from 'react';
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

const ICONS_BY_TYPE: Record<JourneyNodeType, React.ComponentType<{ className?: string }>> = {
  email: Icons.Mail,
  order: Icons.Package,
  lineItem: Icons.Box,
  velocity: Icons.Activity,
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
        iconBg: 'bg-arda-bg-tertiary',
        iconColor: 'text-arda-text-muted',
        border: 'border-arda-border',
      };
  }
};

const TreeNodeComponent: React.FC<TreeNodeProps> = ({
  node,
  level,
  velocityProfiles,
  onNodeClick,
  onExpandToggle,
  expandedNodes,
  focusedNodeId,
  onFocusChange,
}) => {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isExpanded = expandedNodes?.has(node.id) ?? (node.isExpanded ?? level < 2);
  const isFocused = focusedNodeId === node.id;
  const isNew = node.isNew ?? false;

  const Icon = ICONS_BY_TYPE[node.type] ?? Icons.FileText;
  const colors = useMemo(() => getNodeColors(node.type), [node.type]);

  const velocityProfile = useMemo(() => {
    if (node.type !== 'lineItem' || !velocityProfiles) return undefined;
    const data = node.data as LineItemNodeData | undefined;
    if (!data?.normalizedName) return undefined;
    return velocityProfiles.get(data.normalizedName);
  }, [node.type, node.data, velocityProfiles]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExpandToggle?.(node.id, !isExpanded);
    },
    [isExpanded, node.id, onExpandToggle],
  );

  const handleClick = useCallback(() => {
    onFocusChange?.(node.id);
    onNodeClick?.(node);
  }, [node, onFocusChange, onNodeClick]);

  const handleMouseEnter = useCallback(() => {
    onFocusChange?.(node.id);
  }, [node.id, onFocusChange]);

  return (
    <div className="select-none">
      {/* Node Row */}
      <div 
        data-node-id={node.id}
        className={`
          flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer
          transition-all duration-200 ease-in-out group
          hover:bg-arda-bg-tertiary hover:scale-[1.01]
          ${level === 0 ? 'bg-arda-bg-secondary' : ''}
          ${isFocused ? 'ring-2 ring-arda-accent ring-offset-2 ring-offset-white bg-arda-bg-tertiary' : ''}
          ${isNew ? 'animate-pulse ring-2 ring-green-400/50 ring-offset-2 ring-offset-white' : ''}
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
            hover:bg-arda-bg-tertiary hover:scale-110
            ${hasChildren ? 'visible' : 'invisible'}
          `}
        >
          <Icons.ChevronRight 
            className={`
              w-4 h-4 text-arda-text-muted absolute
              transition-opacity duration-200 ease-in-out
              ${isExpanded ? 'opacity-0' : 'opacity-100'}
            `} 
          />
          <Icons.ChevronDown 
            className={`
              w-4 h-4 text-arda-text-muted absolute
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
            <span className="text-sm font-medium text-arda-text-primary truncate">
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
            <div className="text-xs text-arda-text-muted truncate">
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
          <span className="text-sm font-medium text-arda-accent">
            ${(node.data as OrderNodeData).totalAmount!.toFixed(2)}
          </span>
        )}
        
        {/* Date for emails */}
        {node.type === 'email' && (node.data as EmailNodeData)?.date && (
          <span className="text-xs text-arda-text-muted">
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
            className="absolute left-0 top-0 bottom-0 w-px bg-arda-border transition-opacity duration-300"
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

function getIsExpanded(
  node: JourneyNode,
  expandedNodes?: Set<string>,
  level = 0,
): boolean {
  return expandedNodes?.has(node.id) ?? (node.isExpanded ?? level < 2);
}

function areTreeNodePropsEqual(prev: TreeNodeProps, next: TreeNodeProps): boolean {
  if (prev.node.id !== next.node.id) return false;
  if (prev.level !== next.level) return false;
  if (prev.node.label !== next.node.label) return false;
  if (prev.node.subtitle !== next.node.subtitle) return false;
  if (prev.node.type !== next.node.type) return false;
  if (prev.node.isNew !== next.node.isNew) return false;
  if (prev.node.data !== next.node.data) return false;
  if (getIsExpanded(prev.node, prev.expandedNodes, prev.level) !== getIsExpanded(next.node, next.expandedNodes, next.level)) {
    return false;
  }
  if (prev.focusedNodeId !== next.focusedNodeId) return false;
  if (prev.velocityProfiles !== next.velocityProfiles) return false;
  if (prev.onNodeClick !== next.onNodeClick) return false;
  if (prev.onExpandToggle !== next.onExpandToggle) return false;
  if (prev.onFocusChange !== next.onFocusChange) return false;
  return true;
}

const memoizedTreeNode = memo(TreeNodeComponent, areTreeNodePropsEqual);
export const TreeNode = memoizedTreeNode;
export default TreeNode;

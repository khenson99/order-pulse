import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Icons } from './Icons';
import { TreeNode } from './TreeNode';
import { JourneyNode, ExtractedOrder, RawEmail, LineItemNodeData } from '../types';
import { buildJourneyTree, buildVelocityProfiles } from '../utils/inventoryLogic';

interface OrderTreeProps {
  orders: ExtractedOrder[];
  emails?: RawEmail[];
  onItemClick?: (itemData: LineItemNodeData) => void;
  className?: string;
}

type ViewMode = 'chronological' | 'bySupplier' | 'byItem';

export const OrderTree: React.FC<OrderTreeProps> = ({
  orders,
  emails,
  onItemClick,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('chronological');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Build the journey tree and velocity profiles
  const velocityProfiles = useMemo(() => 
    buildVelocityProfiles(orders), 
    [orders]
  );

  const journeyTree = useMemo(
    () => buildJourneyTree(orders, emails),
    [orders, emails]
  );

  const handleNodeClick = useCallback((node: JourneyNode) => {
    if (node.type === 'lineItem' && onItemClick && node.data) {
      onItemClick(node.data as LineItemNodeData);
    }
  }, [onItemClick]);

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return journeyTree;
    
    const query = searchQuery.toLowerCase();
    
    const filterNode = (node: JourneyNode): JourneyNode | null => {
      // Check if this node matches
      const labelMatch = node.label.toLowerCase().includes(query);
      const subtitleMatch = node.subtitle?.toLowerCase().includes(query);
      
      // Filter children recursively
      const filteredChildren = node.children
        ?.map(filterNode)
        .filter((n): n is JourneyNode => n !== null);
      
      // Include node if it matches or has matching children
      if (labelMatch || subtitleMatch || (filteredChildren && filteredChildren.length > 0)) {
        return {
          ...node,
          children: filteredChildren,
          isExpanded: true, // Auto-expand when filtering
        };
      }
      
      return null;
    };
    
    return journeyTree
      .map(filterNode)
      .filter((n): n is JourneyNode => n !== null);
  }, [journeyTree, searchQuery]);

  // Group by supplier view
  const supplierTree = useMemo((): JourneyNode[] => {
    const supplierMap = new Map<string, JourneyNode[]>();
    
    journeyTree.forEach(emailNode => {
      emailNode.children?.forEach(orderNode => {
        const supplier = orderNode.label.replace('Order from ', '');
        if (!supplierMap.has(supplier)) {
          supplierMap.set(supplier, []);
        }
        supplierMap.get(supplier)!.push({
          ...orderNode,
          isExpanded: false,
        });
      });
    });
    
    return Array.from(supplierMap.entries()).map(([supplier, orderNodes]) => ({
      id: `supplier-${supplier}`,
      type: 'email' as const,
      label: supplier,
      subtitle: `${orderNodes.length} order(s)`,
      isExpanded: true,
      children: orderNodes,
    }));
  }, [journeyTree]);

  // Group by item view
  const itemTree = useMemo((): JourneyNode[] => {
    return Array.from(velocityProfiles.values())
      .sort((a, b) => b.dailyBurnRate - a.dailyBurnRate)
      .map(profile => ({
        id: `item-${profile.normalizedName}`,
        type: 'lineItem' as const,
        label: profile.displayName,
        subtitle: `${profile.orderCount} orders | ${profile.dailyBurnRate.toFixed(1)}/day`,
        isExpanded: false,
        data: {
          lineItemId: profile.normalizedName,
          orderId: '',
          emailId: '',
          name: profile.displayName,
          normalizedName: profile.normalizedName,
          quantity: profile.totalQuantityOrdered,
          unit: 'total',
          sku: profile.sku,
        } as LineItemNodeData,
        children: profile.orders.map(order => ({
          id: `order-occurrence-${order.orderId}-${profile.normalizedName}`,
          type: 'order' as const,
          label: `${new Date(order.date).toLocaleDateString()}`,
          subtitle: `Qty: ${order.quantity}${order.unitPrice ? ` @ $${order.unitPrice.toFixed(2)}` : ''}`,
          data: {
            orderId: order.orderId,
            emailId: order.emailId,
            supplier: profile.supplier,
            orderDate: order.date,
            totalAmount: order.unitPrice ? order.quantity * order.unitPrice : undefined,
            itemCount: 1,
            confidence: 1,
          },
        })),
      }));
  }, [velocityProfiles]);

  // Get the tree to display based on view mode
  const displayTree = useMemo(() => {
    switch (viewMode) {
      case 'bySupplier':
        return supplierTree;
      case 'byItem':
        return itemTree;
      default:
        return filteredTree;
    }
  }, [viewMode, filteredTree, supplierTree, itemTree]);

  // Recursively set expanded state for all nodes
  const setAllNodesExpanded = useCallback((nodes: JourneyNode[], expanded: boolean) => {
    const newExpandedNodes = new Set<string>();
    
    const traverse = (nodeList: JourneyNode[]) => {
      nodeList.forEach(node => {
        if (node.children && node.children.length > 0) {
          if (expanded) {
            newExpandedNodes.add(node.id);
          }
          traverse(node.children);
        }
      });
    };
    
    traverse(nodes);
    setExpandedNodes(newExpandedNodes);
  }, []);

  // Flatten tree to get all visible nodes in order
  const getVisibleNodes = useCallback((nodes: JourneyNode[]): JourneyNode[] => {
    const visible: JourneyNode[] = [];
    
    const traverse = (nodeList: JourneyNode[]) => {
      nodeList.forEach(node => {
        visible.push(node);
        if (node.children && node.children.length > 0 && expandedNodes.has(node.id)) {
          traverse(node.children);
        }
      });
    };
    
    traverse(nodes);
    return visible;
  }, [expandedNodes]);

  const visibleNodes = useMemo(() => getVisibleNodes(displayTree), [displayTree, getVisibleNodes]);

  // Handle expand/collapse all
  const handleExpandAll = useCallback(() => {
    setAllNodesExpanded(displayTree, true);
  }, [displayTree, setAllNodesExpanded]);

  const handleCollapseAll = useCallback(() => {
    setAllNodesExpanded(displayTree, false);
  }, [displayTree, setAllNodesExpanded]);

  // Handle node expand toggle
  const handleNodeExpandToggle = useCallback((nodeId: string, isExpanded: boolean) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (isExpanded) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return next;
    });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if tree container is focused or contains focused element
      if (!treeContainerRef.current?.contains(document.activeElement)) {
        return;
      }

      // Don't handle if user is typing in search input
      if (document.activeElement?.tagName === 'INPUT') {
        return;
      }

      const currentIndex = focusedNodeId 
        ? visibleNodes.findIndex(n => n.id === focusedNodeId)
        : -1;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (visibleNodes.length > 0) {
            const nextIndex = currentIndex < visibleNodes.length - 1 
              ? currentIndex + 1 
              : 0;
            setFocusedNodeId(visibleNodes[nextIndex].id);
            // Scroll into view
            setTimeout(() => {
              const element = document.querySelector(`[data-node-id="${visibleNodes[nextIndex].id}"]`);
              element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 0);
          }
          break;
        
        case 'ArrowUp':
          e.preventDefault();
          if (visibleNodes.length > 0) {
            const prevIndex = currentIndex > 0 
              ? currentIndex - 1 
              : visibleNodes.length - 1;
            setFocusedNodeId(visibleNodes[prevIndex].id);
            // Scroll into view
            setTimeout(() => {
              const element = document.querySelector(`[data-node-id="${visibleNodes[prevIndex].id}"]`);
              element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 0);
          }
          break;
        
        case 'ArrowRight':
          e.preventDefault();
          if (focusedNodeId) {
            const node = visibleNodes.find(n => n.id === focusedNodeId);
            if (node && node.children && node.children.length > 0 && !expandedNodes.has(node.id)) {
              handleNodeExpandToggle(node.id, true);
            }
          }
          break;
        
        case 'ArrowLeft':
          e.preventDefault();
          if (focusedNodeId) {
            const node = visibleNodes.find(n => n.id === focusedNodeId);
            if (node && node.children && node.children.length > 0 && expandedNodes.has(node.id)) {
              handleNodeExpandToggle(node.id, false);
            }
          }
          break;
        
        case 'Enter':
          e.preventDefault();
          if (focusedNodeId) {
            const node = visibleNodes.find(n => n.id === focusedNodeId);
            if (node) {
              handleNodeClick(node);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedNodeId, visibleNodes, expandedNodes, handleNodeExpandToggle, handleNodeClick]);

  // Set initial focus on first node if none focused
  useEffect(() => {
    if (focusedNodeId || visibleNodes.length === 0) return;
    setTimeout(() => {
      setFocusedNodeId(visibleNodes[0].id);
    }, 0);
  }, [visibleNodes, focusedNodeId]);

  // Reset expanded nodes when view mode changes
  useEffect(() => {
    setTimeout(() => {
      setExpandedNodes(new Set());
      setFocusedNodeId(null);
    }, 0);
  }, [viewMode]);

  // Summary stats
  const stats = useMemo(() => ({
    emails: journeyTree.length,
    orders: journeyTree.reduce((sum, e) => sum + (e.children?.length || 0), 0),
    lineItems: journeyTree.reduce((sum, e) => 
      sum + (e.children?.reduce((s, o) => s + (o.children?.length || 0), 0) || 0), 0
    ),
    uniqueItems: velocityProfiles.size,
  }), [journeyTree, velocityProfiles]);

  if (orders.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
        <Icons.GitBranch className="w-12 h-12 text-arda-text-muted mb-4" />
        <p className="text-arda-text-secondary text-lg">No order data to display</p>
        <p className="text-arda-text-muted text-sm mt-1">
          Process emails from the Ingestion Engine to see your order journey
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-semibold text-arda-text-primary flex items-center gap-2">
              <Icons.GitBranch className="w-5 h-5 text-arda-accent" />
              Order Journey
            </h2>
            <p className="text-sm text-arda-text-secondary mt-1">
              Trace the flow from email to order to line items
            </p>
          </div>
          
          {/* View Mode Toggle and Expand/Collapse Controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-arda-bg-tertiary border border-arda-border rounded-lg p-1">
              <button
                onClick={() => setViewMode('chronological')}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  viewMode === 'chronological'
                    ? 'bg-arda-accent text-white'
                    : 'text-arda-text-secondary hover:text-arda-text-primary'
                }`}
              >
                Timeline
              </button>
              <button
                onClick={() => setViewMode('bySupplier')}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  viewMode === 'bySupplier'
                    ? 'bg-arda-accent text-white'
                    : 'text-arda-text-secondary hover:text-arda-text-primary'
                }`}
              >
                By Supplier
              </button>
              <button
                onClick={() => setViewMode('byItem')}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  viewMode === 'byItem'
                    ? 'bg-arda-accent text-white'
                    : 'text-arda-text-secondary hover:text-arda-text-primary'
                }`}
              >
                By Item
              </button>
            </div>
            
            {/* Expand/Collapse All Buttons */}
            <div className="flex items-center gap-1 bg-arda-bg-tertiary border border-arda-border rounded-lg p-1">
              <button
                onClick={handleExpandAll}
                className="px-3 py-1.5 rounded text-sm text-arda-text-secondary hover:text-arda-text-primary transition-colors flex items-center gap-1.5"
                title="Expand All"
              >
                <Icons.ChevronDown className="w-4 h-4" />
                Expand All
              </button>
              <button
                onClick={handleCollapseAll}
                className="px-3 py-1.5 rounded text-sm text-arda-text-secondary hover:text-arda-text-primary transition-colors flex items-center gap-1.5"
                title="Collapse All"
              >
                <Icons.ChevronRight className="w-4 h-4" />
                Collapse All
              </button>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Icons.Mail className="w-4 h-4 text-arda-accent" />
            <span className="text-arda-text-secondary">{stats.emails} emails</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icons.Package className="w-4 h-4 text-arda-accent" />
            <span className="text-arda-text-secondary">{stats.orders} orders</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icons.Box className="w-4 h-4 text-arda-accent" />
            <span className="text-arda-text-secondary">{stats.lineItems} line items</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icons.Activity className="w-4 h-4 text-arda-accent" />
            <span className="text-arda-text-secondary">{stats.uniqueItems} unique items</span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mt-3">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
          <input
            type="text"
            placeholder="Search items, suppliers, orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-arda-border rounded-lg pl-10 pr-4 py-2 text-sm text-arda-text-primary placeholder-arda-text-muted focus:outline-none focus:border-arda-accent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-arda-text-muted hover:text-arda-text-primary"
              title="Clear search"
              aria-label="Clear search"
            >
              <Icons.X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tree View */}
      <div 
        ref={treeContainerRef}
        className="flex-1 overflow-y-auto bg-white rounded-lg border border-arda-border p-2"
        tabIndex={0}
        onFocus={() => {
          // Set focus to first node if none focused
          if (!focusedNodeId && visibleNodes.length > 0) {
            setFocusedNodeId(visibleNodes[0].id);
          }
        }}
      >
        {displayTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Icons.Search className="w-8 h-8 text-arda-text-muted mb-2" />
            <p className="text-arda-text-secondary">No results match your search</p>
          </div>
        ) : (
          displayTree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              level={0}
              velocityProfiles={velocityProfiles}
              onNodeClick={handleNodeClick}
              onExpandToggle={handleNodeExpandToggle}
              expandedNodes={expandedNodes}
              focusedNodeId={focusedNodeId}
              onFocusChange={setFocusedNodeId}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default OrderTree;

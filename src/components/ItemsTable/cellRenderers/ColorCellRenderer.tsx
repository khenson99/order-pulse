import type { CustomCellRendererProps } from 'ag-grid-react';
import type { MasterListItem } from '../types';

const colorMap: Record<string, string> = {
  BLUE: 'bg-blue-500',
  GREEN: 'bg-green-500',
  YELLOW: 'bg-yellow-400',
  ORANGE: 'bg-orange-500',
  RED: 'bg-red-500',
  PINK: 'bg-pink-400',
  PURPLE: 'bg-purple-500',
  GRAY: 'bg-gray-400',
};

export const ColorCellRenderer = (props: CustomCellRendererProps<MasterListItem>) => {
  const color = (props.value as string)?.toUpperCase();
  const bgClass = color ? colorMap[color] : undefined;

  if (!bgClass) {
    return <span className="text-gray-400 text-xs italic">—</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`w-4 h-4 rounded-full ${bgClass}`} />
      <span className="text-xs">{color.charAt(0) + color.slice(1).toLowerCase()}</span>
    </div>
  );
};

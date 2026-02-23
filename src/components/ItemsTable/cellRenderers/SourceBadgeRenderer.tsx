import type { CustomCellRendererProps } from 'ag-grid-react';
import { Icons } from '../../Icons';
import type { MasterListItem } from '../types';

const sourceConfig: Record<MasterListItem['source'], { icon: keyof typeof Icons; label: string; bg: string }> = {
  email: { icon: 'Mail', label: 'Email', bg: 'bg-blue-50 text-blue-600' },
  url: { icon: 'Link', label: 'URL', bg: 'bg-purple-50 text-purple-600' },
  barcode: { icon: 'Barcode', label: 'UPC', bg: 'bg-green-50 text-green-600' },
  photo: { icon: 'Camera', label: 'Photo', bg: 'bg-orange-50 text-orange-600' },
  csv: { icon: 'FileSpreadsheet', label: 'CSV', bg: 'bg-gray-50 text-gray-600' },
};

export const SourceBadgeRenderer = (props: CustomCellRendererProps<MasterListItem>) => {
  const source = props.value as MasterListItem['source'];
  if (!source) return null;

  const config = sourceConfig[source];
  const Icon = Icons[config.icon];

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${config.bg}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

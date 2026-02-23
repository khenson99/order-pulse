import type { CustomCellRendererProps } from 'ag-grid-react';
import type { MasterListItem } from '../types';

export const UrlCellRenderer = (props: CustomCellRendererProps<MasterListItem>) => {
  const url = props.value as string | undefined;
  if (!url?.trim() || url.startsWith('data:')) {
    return <span className="text-gray-400 text-xs italic">—</span>;
  }

  let displayUrl: string;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    displayUrl = parsed.hostname + parsed.pathname.substring(0, 15);
    if (displayUrl.length > 25) displayUrl = displayUrl.substring(0, 25) + '...';
  } catch {
    displayUrl = url.substring(0, 25) + (url.length > 25 ? '...' : '');
  }

  return (
    <a
      href={url.startsWith('http') ? url : `https://${url}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#FC5A29] hover:underline text-xs truncate block"
      onClick={(e) => e.stopPropagation()}
    >
      {displayUrl}
    </a>
  );
};

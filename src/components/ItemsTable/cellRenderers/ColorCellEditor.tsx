import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { CustomCellEditorProps } from 'ag-grid-react';
import type { MasterListItem } from '../types';

const colors = [
  { id: 'BLUE', label: 'Blue', bg: 'bg-blue-500' },
  { id: 'GREEN', label: 'Green', bg: 'bg-green-500' },
  { id: 'YELLOW', label: 'Yellow', bg: 'bg-yellow-400' },
  { id: 'ORANGE', label: 'Orange', bg: 'bg-orange-500' },
  { id: 'RED', label: 'Red', bg: 'bg-red-500' },
  { id: 'PINK', label: 'Pink', bg: 'bg-pink-400' },
  { id: 'PURPLE', label: 'Purple', bg: 'bg-purple-500' },
  { id: 'GRAY', label: 'Gray', bg: 'bg-gray-400' },
];

export const ColorCellEditor = forwardRef<unknown, CustomCellEditorProps<MasterListItem>>((props, ref) => {
  const [value, setValue] = useState<string>(props.value ?? '');
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => value,
    isCancelAfterEnd: () => false,
    isPopup: () => true,
    getPopupPosition: () => 'under' as const,
  }));

  const handleSelect = (colorId: string) => {
    setValue(colorId);
    // Stop editing after selection
    props.stopEditing();
  };

  return (
    <div
      ref={containerRef}
      className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 min-w-[140px]"
    >
      {colors.map((color) => (
        <button
          key={color.id}
          type="button"
          onClick={() => handleSelect(color.id)}
          className={`w-8 h-8 rounded-full ${color.bg} hover:ring-2 ring-offset-1 ring-[#FC5A29] transition-all ${
            value?.toUpperCase() === color.id ? 'ring-2 ring-[#FC5A29]' : ''
          }`}
          title={color.label}
        />
      ))}
      <button
        type="button"
        onClick={() => handleSelect('')}
        className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 hover:border-[#FC5A29] transition-colors flex items-center justify-center text-gray-400 text-xs"
        title="No color"
      >
        ✕
      </button>
    </div>
  );
});

ColorCellEditor.displayName = 'ColorCellEditor';

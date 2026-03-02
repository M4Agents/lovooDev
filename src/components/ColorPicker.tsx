// Componente ColorPicker - Seletor de cores para tags
// Data: 2025-11-28

import React from 'react';
import { PREDEFINED_COLORS, validateHexColor } from '../types/tags';

interface ColorPaletteProps {
  colors: string[];
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({ 
  colors, 
  selectedColor, 
  onColorSelect 
}) => {
  return (
    <div className="grid grid-cols-6 gap-2">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onColorSelect(color)}
          className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-105 ${
            selectedColor === color 
              ? 'border-gray-600 scale-110 shadow-md' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          style={{ backgroundColor: color }}
          title={color}
          aria-label={`Selecionar cor ${color}`}
        />
      ))}
    </div>
  );
};

interface CustomColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export const CustomColorPicker: React.FC<CustomColorPickerProps> = ({ 
  value, 
  onChange, 
  disabled = false 
}) => {
  const handleColorChange = (newColor: string) => {
    if (validateHexColor(newColor)) {
      onChange(newColor);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    if (newColor.startsWith('#') && newColor.length <= 7) {
      onChange(newColor);
    }
  };

  return (
    <div className="flex items-center space-x-3">
      <input
        type="color"
        value={value}
        onChange={(e) => handleColorChange(e.target.value)}
        disabled={disabled}
        className="w-12 h-8 rounded border border-gray-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Seletor de cor personalizada"
      />
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        placeholder="#3B82F6"
        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
        pattern="^#[0-9A-Fa-f]{6}$"
        maxLength={7}
        aria-label="Código hexadecimal da cor"
      />
    </div>
  );
};

interface ColorPickerProps {
  selectedColor: string;
  onColorChange: (color: string) => void;
  disabled?: boolean;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ 
  selectedColor, 
  onColorChange, 
  disabled = false 
}) => {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Cores Pré-definidas
        </label>
        <ColorPalette
          colors={PREDEFINED_COLORS}
          selectedColor={selectedColor}
          onColorSelect={onColorChange}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Cor Personalizada
        </label>
        <CustomColorPicker
          value={selectedColor}
          onChange={onColorChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
};

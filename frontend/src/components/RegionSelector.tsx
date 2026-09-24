import React, { useState, useRef } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

interface Region {
  type: 'background' | 'icons' | 'quantities';
  crop: PixelCrop;
}

interface RegionSelectorProps {
  imageUrl: string;
  onComplete: (regions: Region[]) => void;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({ imageUrl, onComplete }) => {
  const [crop, setCrop] = useState<Crop>();
  const [regions, setRegions] = useState<Region[]>([]);
  const [currentMode, setCurrentMode] = useState<'background' | 'icons' | 'quantities'>('background');
  
  const imageRef = useRef<HTMLImageElement>(null);

  const handleSaveRegion = () => {
    if (!crop || crop.width === 0 || crop.height === 0) {
      alert('Please select a region first.');
      return;
    }
    
    // Using percentage crop or pixel crop. We need pixel crop for backend.
    // If we only have percentage, we calculate pixel crop using image dimensions.
    const image = imageRef.current;
    if (!image) return;

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    
    const pixelCrop: PixelCrop = {
      unit: 'px',
      x: crop.x * scaleX,
      y: crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    };

    setRegions((prev) => [
      ...prev.filter(r => r.type !== currentMode), // Replace if already exists
      { type: currentMode, crop: pixelCrop }
    ]);
    
    setCrop(undefined);
    
    // Auto advance to next mode if needed
    if (currentMode === 'background') setCurrentMode('icons');
    else if (currentMode === 'icons') setCurrentMode('quantities');
  };

  const handleFinish = () => {
    onComplete(regions);
  };

  return (
    <div className="flex flex-col items-center mt-6 w-full max-w-6xl mx-auto">
      <div className="bg-white p-6 rounded-lg shadow-md w-full">
        <h2 className="text-2xl font-bold mb-4">Select Regions</h2>
        
        <div className="flex gap-4 mb-6">
          {(['background', 'icons', 'quantities'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setCurrentMode(mode)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                currentMode === mode 
                  ? 'bg-blue-600 text-white' 
                  : regions.some(r => r.type === mode)
                    ? 'bg-green-100 text-green-800 border border-green-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {mode === 'background' && '1. Background Area'}
              {mode === 'icons' && '2. Equipment Icons'}
              {mode === 'quantities' && '3. Quantity Input (Optional)'}
              {regions.some(r => r.type === mode) && ' ✓'}
            </button>
          ))}
        </div>

        <div className="mb-4 text-sm text-gray-600">
          <p>Drag on the image to select the <strong>{currentMode}</strong> region. Then click "Save Region".</p>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={handleSaveRegion}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            Save Region
          </button>
          <button
            onClick={handleFinish}
            disabled={!regions.some(r => r.type === 'background') || !regions.some(r => r.type === 'icons')}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            次の段階に進む (ステージ配置へ)
          </button>
        </div>

        <div className="border border-gray-300 overflow-auto bg-gray-50 flex justify-center max-h-[70vh]">
          <ReactCrop 
            crop={crop} 
            onChange={c => setCrop(c)}
            className="max-w-full"
          >
            <img 
              ref={imageRef} 
              src={imageUrl} 
              alt="PDF Preview" 
              className="max-w-full h-auto object-contain"
            />
          </ReactCrop>
        </div>
        
        <div className="mt-4">
          <h3 className="font-semibold text-lg">Selected Regions (Debug Info):</h3>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto mt-2">
            {JSON.stringify(regions, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

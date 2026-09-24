import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import axios from 'axios';

interface PdfUploaderProps {
  onUploadSuccess: (data: { file_id: string; image_url: string; width: number; height: number }) => void;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({ onUploadSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/upload-pdf/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      onUploadSuccess(response.data);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.response?.data?.detail || 'Failed to upload PDF');
    } finally {
      setIsUploading(false);
    }
  }, [onUploadSuccess]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false
  });

  return (
    <div className="w-full max-w-2xl mx-auto mt-8">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        {isUploading ? (
          <p className="text-gray-600">Uploading and processing PDF...</p>
        ) : isDragActive ? (
          <p className="text-blue-500">Drop the PDF here...</p>
        ) : (
          <div>
            <p className="text-gray-700 text-lg font-medium">Drag & drop your stage setting PDF here</p>
            <p className="text-gray-500 text-sm mt-2">or click to select file</p>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}
    </div>
  );
};

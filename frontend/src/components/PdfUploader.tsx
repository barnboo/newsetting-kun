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
      setError('PDFファイル（.pdf）をアップロードしてください。');
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
      setError(err.response?.data?.detail || 'PDFのアップロードに失敗しました。');
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
    <div className="w-full max-w-2xl mx-auto mt-4">
      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 ${
          isDragActive
            ? 'border-[#007AFF] bg-blue-500/10 scale-[1.01] shadow-[0_0_30px_rgba(0,122,255,0.2)]'
            : 'border-slate-300/80 dark:border-slate-600/70 bg-white/45 dark:bg-slate-800/40 hover:bg-white/75 dark:hover:bg-slate-800/65 hover:border-blue-400/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]'
        }`}
      >
        <input {...getInputProps()} />
        <div className={`w-14 h-14 mx-auto mb-3.5 rounded-2xl flex items-center justify-center transition-all duration-300 ${
          isDragActive
            ? 'bg-[#007AFF] text-white scale-110 shadow-lg shadow-blue-500/30'
            : 'liquid-btn text-[#007AFF] dark:text-sky-400'
        }`}>
          <UploadCloud className="h-7 w-7" />
        </div>
        {isUploading ? (
          <p className="text-[#007AFF] dark:text-sky-400 font-bold text-sm animate-pulse">PDFをアップロード・処理中...</p>
        ) : isDragActive ? (
          <p className="text-[#007AFF] dark:text-sky-400 font-bold text-base">ここにPDFファイルをドロップしてください...</p>
        ) : (
          <div>
            <p className="text-slate-800 dark:text-slate-100 text-base font-bold tracking-tight">ここにステージ配置図のPDFをドラッグ＆ドロップ</p>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-1.5 font-medium">または <span className="text-[#007AFF] dark:text-sky-400 underline underline-offset-2 font-semibold">クリックしてファイルを選択</span></p>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-4 p-3.5 bg-rose-500/10 border border-rose-400/40 text-rose-700 dark:text-rose-300 rounded-2xl text-xs font-semibold backdrop-blur-md">
          {error}
        </div>
      )}
    </div>
  );
};

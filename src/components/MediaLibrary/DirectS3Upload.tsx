import React, { useEffect, useRef, useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  LIBRARY_MEDIA_ACCEPT,
  uploadLibraryMedia,
  validateLibraryMediaFile,
  type LibrarySavedFile,
} from '../../services/libraryMediaUpload';

interface DirectS3UploadProps {
  companyId: string;
  folderId?: string;
  onUploadComplete: (uploadedFile: LibrarySavedFile) => void;
  showDragDrop?: boolean;
}

export const DirectS3Upload: React.FC<DirectS3UploadProps> = ({
  companyId,
  folderId,
  onUploadComplete,
  showDragDrop = false
}) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const userId = useRef<string | null>(null);
  const busy = useRef(false);
  const scopeReady = useRef(false);
  const scope = useRef({ companyId, folderId });
  scope.current = { companyId, folderId };

  const stop = () => {
    controller.current?.abort();
    generation.current += 1;
    busy.current = false;
    setUploading(false);
    setProgress(0);
  };

  useEffect(() => {
    let ignore = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!ignore && generation.current === 0) userId.current = data.session?.user?.id ?? null;
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null;
      if (userId.current && next !== userId.current) stop();
      userId.current = next;
    });
    return () => {
      ignore = true;
      stop();
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!scopeReady.current) {
      scopeReady.current = true;
      return;
    }
    stop();
  }, [companyId, folderId]);

  const processFile = async (file: File) => {
    if (busy.current) return;
    if (!folderId) {
      setError('Selecione uma pasta.');
      return;
    }
    const media = validateLibraryMediaFile(file);
    if (!media.ok) {
      setError(media.message);
      return;
    }

    const startedAs = userId.current;
    const startedGeneration = generation.current;
    busy.current = true;
    setUploading(true);
    setError(null);
    setProgress(30);

    const current = await supabase.auth.getSession();
    if (generation.current !== startedGeneration) return;
    const nextUserId = current.data.session?.user?.id ?? null;
    if (startedAs && nextUserId !== startedAs) {
      busy.current = false;
      setUploading(false);
      setProgress(0);
      setError('A sessão mudou durante o envio.');
      return;
    }
    userId.current = nextUserId;

    const abort = new AbortController();
    controller.current = abort;
    const op = ++generation.current;
    const attemptCompany = companyId;
    const attemptFolder = folderId;
    const attemptUser = nextUserId;

    const result = await uploadLibraryMedia(file, attemptCompany, attemptFolder, abort.signal);
    const stillCurrent = generation.current === op
      && scope.current.companyId === attemptCompany
      && scope.current.folderId === attemptFolder
      && userId.current === attemptUser;
    if (!stillCurrent) return;

    busy.current = false;
    setUploading(false);
    if (!result.ok) {
      setProgress(0);
      if (!result.cancelled) setError(result.error);
      return;
    }

    setProgress(100);
    onUploadComplete(result.data);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = '';
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  if (showDragDrop) {
    return (
      <div className="w-full">
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="direct-s3-upload"
            className="hidden"
            onChange={handleFileSelect}
            disabled={uploading}
            accept={LIBRARY_MEDIA_ACCEPT}
          />

          <label htmlFor="direct-s3-upload" className="cursor-pointer">
            <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium text-gray-700 mb-2">
              {uploading ? `Enviando... ${progress}%` : 'Clique ou arraste arquivos aqui'}
            </p>
            <p className="text-sm text-gray-500">Fotos 10MB • Vídeos 25MB • Arquivos 25MB</p>
          </label>

          {uploading && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="file"
        id="direct-s3-upload"
        className="hidden"
        onChange={handleFileSelect}
        disabled={uploading}
        accept={LIBRARY_MEDIA_ACCEPT}
      />

      <label
        htmlFor="direct-s3-upload"
        className={`inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 cursor-pointer transition-colors ${
          uploading ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Upload className="w-4 h-4" />
        {uploading ? `Enviando... ${progress}%` : 'Enviar Arquivo'}
      </label>

      {uploading && (
        <div className="mt-2 w-48">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div className="bg-green-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
};

"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  file: File | null;
  onFileSelect: (file: File | null) => void;
}

const ACCEPTED_EXT = [".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a"];

export default function FileDropzone({ file, onFileSelect }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      const ext = "." + f.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED_EXT.includes(ext)) {
        alert(`지원하지 않는 파일 형식입니다: ${ext}\n(wav, mp3, flac, aiff, m4a 지원)`);
        return;
      }
      onFileSelect(f);
    },
    [onFileSelect]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
        isDragging
          ? "border-accent bg-accent/10 shadow-glow"
          : "border-surface-border bg-surface-card hover:border-accent/60 hover:bg-white/[0.02]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_EXT.join(",")}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-glow text-2xl shadow-glow">
        🎧
      </div>

      {file ? (
        <>
          <p className="text-sm font-medium text-zinc-100">{file.name}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {(file.size / 1024 / 1024).toFixed(2)} MB · 클릭 또는 드래그하여 교체
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-200">
            Suno 음원 파일을 여기로 드래그 앤 드롭
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            또는 클릭하여 파일 선택 · WAV / MP3 / FLAC / AIFF / M4A
          </p>
        </>
      )}
    </div>
  );
}

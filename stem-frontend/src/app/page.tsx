"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud,
  Music,
  FileAudio,
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Loader2,
  Zap,
  Layers,
  ShieldCheck,
  Activity
} from "lucide-react";
import axios from "axios";
import WaveSurfer from "wavesurfer.js";

// NEXT_PUBLIC_API_BASE points at an external backend if the frontend is hosted
// separately. In `npm run dev` (port 3001) the backend is the local server on 3000.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE
  || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");

// "Full" separates six stems; "Fast" (Demucs --two-stems vocals) only the
// vocals and everything else, which is all the practice player needs.
type Mode = "6stems" | "2stems";
const STEMS_FOR: Record<Mode, string[]> = {
  "6stems": ["vocals", "drums", "bass", "guitar", "piano", "other"],
  "2stems": ["vocals", "no_vocals"],
};
const STEM_LABEL: Record<string, string> = { no_vocals: "accompaniment" };

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "queued" | "processing" | "completed" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<Mode>("6stems");
  // null = still checking; false = this site has no separation server
  // (static hosting such as Vercel, or the local dev server)
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(res => setServerAvailable(res.ok), () => setServerAvailable(false));
  }, []);
  const [stems, setStems] = useState<string[]>(STEMS_FOR["6stems"]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Format file size nicely
  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (selectedFile: File) => {
    // Relaxed validation: let the backend Demucs engine probe the file directly
    // since some downloads have truncated filenames without proper extensions.
    if (selectedFile.size > 100 * 1024 * 1024) {
      setErrorMsg("File is too large. Maximum size is 100MB.");
      return;
    }
    setErrorMsg("");
    setFile(selectedFile);
  };

  const startSeparation = async () => {
    if (!file || serverAvailable === false) return;
    setStatus("uploading");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", mode);
    setStems(STEMS_FOR[mode]);

    try {
      const response = await fetch(`${API_BASE}/api/separate`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let message = `Upload failed (${response.status}).`;
        if (response.status === 413) {
          message = "File is too large. Maximum size is 100MB.";
        } else {
          try {
            const body = await response.json();
            if (body?.error) message = body.error;
          } catch {
            // not JSON — keep the generic message
          }
        }
        console.error('Upload Error:', response.status, message);
        throw new Error(message);
      }

      const data = await response.json();
      console.log('Upload successful. Job ID:', data.job_id);
      setJobId(data.job_id);
      setStatus("queued");
    } catch (err: unknown) {
      console.error('Catch Error:', err);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  // Poll Status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (jobId && (status === "queued" || status === "processing")) {
      interval = setInterval(async () => {
        try {
          console.log(`Checking status for Job ID: ${jobId}`);
          const res = await axios.get(`${API_BASE}/api/job_status/${jobId}`);
          console.log('Status Response:', res.data);
          setProgress(res.data.progress || 0);
          setStatus(res.data.status);
          if (res.data.logs) {
            setLogs(res.data.logs);
          }
          if (Array.isArray(res.data.stems) && res.data.stems.length) {
            setStems(res.data.stems);
          }
          if (res.data.status === 'completed') {
            console.log('Separation Complete!');
          }
        } catch (err) {
          console.error('Status Check Failed:', err);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [jobId, status]);

  const handleReset = async () => {
    if (jobId) {
      try {
        await fetch(`${API_BASE}/api/cleanup/${jobId}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.error("Failed to clean up job", err);
      }
    }
    setFile(null);
    setStatus("idle");
    setJobId(null);
    setProgress(0);
    setErrorMsg("");
    setStems(STEMS_FOR[mode]);
  };

  return (
    // The same page shell and hero as the main site's views (style.css)
    <div className="app-container">
      <div className="w-full max-w-5xl mx-auto flex flex-col items-center">
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="hero-section"
        >
          <h1 className="hero-title">
            AI Stem <span className="text-gradient">Separator</span>
          </h1>
          <p className="hero-subtitle">
            Extract studio-quality vocals, drums, bass, guitar, piano, and other instruments from any audio file instantly. Powered by state-of-the-art Hybrid Demucs deep learning.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {status === "idle" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-2xl flex flex-col items-center"
            >
              {serverAvailable === false && (
                <div className="glass-panel w-full flex flex-col items-center text-center gap-4 p-6 sm:p-10">
                  <Layers className="w-10 h-10 text-gold" />
                  <h3 className="font-cinzel text-xl sm:text-2xl font-bold text-ink">Not available on this site</h3>
                  <p className="text-sub max-w-md leading-relaxed">
                    Separating songs needs an AI server (Demucs), which this deployment doesn&apos;t run.
                    Everything else — the Lehra player, tuner, notation editor and Carnatic suite — works here.
                    To separate songs, run the full site on your own computer with Docker (see the README).
                  </p>
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the main site, outside this app's /separator basePath */}
                  <a href="/" className="glass-button no-underline">
                    Back to Swaralaya
                  </a>
                </div>
              )}

              {/* Premium Glass Upload Card */}
              <div
                className="glass-panel w-full flex flex-col items-center relative group p-5 sm:p-8 md:p-10"
                style={{ display: serverAvailable === false ? "none" : undefined }}
              >

                {!file ? (
                  <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`upload-drop-zone text-center ${isDragging ? 'drag-over' : ''}`}
                  >
                    <div className="upload-icon-container">
                      <UploadCloud />
                    </div>
                    <h3 className="upload-title">Drag &amp; Drop Audio</h3>
                    <p className="upload-subtitle">Supports MP3, WAV, FLAC, AAC (Max 100MB)</p>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center">
                    {/* Selected File State */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="file-selected-card w-full flex items-center gap-4 sm:gap-6 p-4 sm:p-6 rounded-2xl cursor-pointer mb-8"
                    >
                      <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-[#f5a623]/10 to-[#e8572a]/10 rounded-xl flex items-center justify-center border border-[#f5a623]/20 shrink-0">
                        <Music className="w-6 h-6 sm:w-8 sm:h-8 text-gold" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <p className="text-ink font-medium truncate text-base sm:text-lg mb-1">{file.name}</p>
                        <p className="text-sub text-sm flex items-center flex-wrap gap-x-3 gap-y-1">
                          <span>{formatBytes(file.size)}</span>
                          <span className="w-1 h-1 bg-muted rounded-full"></span>
                          <span className="text-gold">Ready to process</span>
                        </p>
                      </div>
                      <div className="hidden sm:flex w-12 h-12 rounded-full bg-white/5 items-center justify-center hover:bg-white/10 transition-colors shrink-0">
                        <Activity className="w-5 h-5 text-sub" />
                      </div>
                    </div>

                    <button
                      onClick={startSeparation}
                      className="primary-glow-btn w-full sm:w-auto flex items-center justify-center gap-3"
                    >
                      <Zap className="w-5 h-5 fill-black" />
                      <span>Separate Stems Now</span>
                    </button>
                  </div>
                )}

                <div className="mode-picker" role="radiogroup" aria-label="Separation mode">
                  {([
                    ["6stems", "Full · 6 stems", "Vocals, drums, bass, guitar, piano and other"],
                    ["2stems", "Fast · 2 stems", "Vocals + accompaniment — quicker, and all you need to practise along"],
                  ] as const).map(([value, title, sub]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      className={`mode-option ${mode === value ? "active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); setMode(value); }}
                    >
                      <span className="mode-title">{title}</span>
                      <span className="mode-sub">{sub}</span>
                    </button>
                  ))}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="audio/*,video/*,.mp3,.wav,.flac,.aac,.ogg,.m4a,.mp4,.mkv,.mov,.webm,.avi,.wma,.aiff,.alac"
                  onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
                />
              </div>

              {/* Trust Badges */}
              <div className="mt-8 flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
                <div className="feature-pill">
                  <Zap className="w-3.5 h-3.5 text-gold" />
                  <span>Hybrid Demucs Engine</span>
                </div>
                <div className="feature-pill">
                  <Layers className="w-3.5 h-3.5 text-gold" />
                  <span>6-Stem Extraction</span>
                </div>
                <div className="feature-pill">
                  <ShieldCheck className="w-3.5 h-3.5 text-gold" />
                  <span>Lossless Export</span>
                </div>
              </div>

              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 text-red-400 text-center font-medium bg-red-400/10 py-4 px-6 rounded-2xl border border-red-400/20"
                >
                  {errorMsg}
                </motion.div>
              )}
            </motion.div>
          )}

          {(status === "uploading" || status === "queued" || status === "processing") && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-xl glass-panel p-6 sm:p-10 flex flex-col items-center justify-center relative"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-[#f5a623]/10 to-transparent animate-pulse-slow" />

              <div className="relative mb-8">
                <div className="w-24 h-24 bg-[#f5a623]/20 rounded-full flex items-center justify-center animate-pulse">
                  <Loader2 className="w-10 h-10 text-gold animate-spin" />
                </div>
                {/* Simulated equalizer rings */}
                <div className="absolute inset-0 border border-[#f5a623]/30 rounded-full animate-ping" style={{ animationDuration: '3s' }}></div>
              </div>

              <h3 className="font-cinzel text-2xl sm:text-3xl font-bold text-ink mb-3 md:mb-4 text-center">
                {status === "uploading" ? "Uploading Audio..." :
                 status === "queued" ? "Waiting in Queue..." :
                 "Analyzing Frequencies"}
              </h3>

              <p className="text-sub font-medium mb-8 md:mb-10 text-center max-w-sm text-sm sm:text-base leading-relaxed">
                {status === "processing"
                  ? (stems.length === 2
                    ? "The AI is separating the vocals from the accompaniment."
                    : "The AI is isolating vocals, drums, bass, guitar, piano, and other instruments.")
                  : "Preparing your file for deep learning extraction."}
              </p>

              <div className="progress-bar-container">
                <motion.div
                  className="progress-bar-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "linear" }}
                >
                  {/* Shiny overlay on progress bar */}
                  <div className="absolute top-0 bottom-0 left-0 right-0 bg-gradient-to-b from-white/30 to-transparent"></div>
                </motion.div>
              </div>
              <div className="flex justify-between w-full px-2 mt-2 mb-8">
                <span className="text-xs text-sub font-medium uppercase tracking-wider">Processing</span>
                <span className="text-xs text-gold font-bold">{progress}%</span>
              </div>

              {/* Live Terminal Output */}
              {logs.length > 0 && (
                <div className="terminal-logs relative flex flex-col-reverse">
                  <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-[#090806] to-transparent pointer-events-none z-10"></div>
                  <div className="flex flex-col gap-1.5">
                    {logs.map((log, i) => (
                      <div key={i} className="whitespace-pre-wrap break-words opacity-80 hover:opacity-100 transition-opacity">
                        <span className="text-[#f5a623]/40 mr-3">❯</span>{log}
                      </div>
                    ))}
                    <div className="flex items-center mt-2">
                      <span className="text-[#f5a623]/40 mr-3">❯</span>
                      <div className="animate-pulse w-2 h-3.5 bg-[#f5a623] inline-block opacity-80"></div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {status === "completed" && jobId && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-5xl"
            >
              <StemPlayer jobId={jobId} stems={stems} onReset={handleReset} fileName={file?.name || "audio"} />
            </motion.div>
          )}

          {status === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-xl glass-panel p-6 sm:p-10 text-center"
            >
              <div className="w-24 h-24 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                <FileAudio className="w-12 h-12 text-red-500" />
              </div>
              <h3 className="font-cinzel text-2xl sm:text-3xl font-bold text-ink mb-4">Processing Failed</h3>
              <p className="text-red-400/90 mb-8 md:mb-10 bg-red-500/5 p-4 rounded-xl border border-red-500/10 text-sm md:text-base">{errorMsg}</p>
              <button
                onClick={handleReset}
                className="glass-button"
              >
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Separate component for the Multi-track Player
function StemPlayer({ jobId, stems, onReset, fileName }: { jobId: string, stems: string[], onReset: () => void, fileName: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const wsRefs = useRef<{ [key: string]: WaveSurfer | null }>({});
  const containerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const [volumes, setVolumes] = useState<{ [key: string]: number }>(() => Object.fromEntries(stems.map(s => [s, 1])));
  const [mutes, setMutes] = useState<{ [key: string]: boolean }>(() => Object.fromEntries(stems.map(s => [s, false])));
  const [solos, setSolos] = useState<{ [key: string]: boolean }>(() => Object.fromEntries(stems.map(s => [s, false])));

  // Pre-computed waveform peaks from server — eliminates 6 parallel browser decodes
  const [peaks, setPeaks] = useState<{ [key: string]: number[] } | null>(null);
  const [peaksLoading, setPeaksLoading] = useState(true);

  const isSoloActive = Object.values(solos).some(s => s);

  // Fetch pre-computed peaks once when the player mounts
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/stems_peaks/${jobId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Peaks fetch failed: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!cancelled) {
          setPeaks(data);
          setPeaksLoading(false);
        }
      })
      .catch(err => {
        console.warn("Peaks not available, WaveSurfer will decode client-side:", err);
        if (!cancelled) {
          // Graceful fallback: set empty peaks so WaveSurfer decodes normally
          setPeaks({});
          setPeaksLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [jobId]);

  // Initialize WaveSurfer instances once peaks are available
  useEffect(() => {
    // Wait until the peaks response arrives (even if empty) before creating instances
    if (peaksLoading) return;

    stems.forEach(stem => {
      if (containerRefs.current[stem] && !wsRefs.current[stem]) {
        const stemColor: Record<string, { wave: string; progress: string }> = {
          vocals: { wave: 'rgba(245, 166, 35, 0.2)',  progress: 'rgba(245, 166, 35, 1)' },
          drums:  { wave: 'rgba(232, 87, 42, 0.2)',   progress: 'rgba(232, 87, 42, 1)' },
          bass:   { wave: 'rgba(196, 125, 14, 0.2)',  progress: 'rgba(196, 125, 14, 1)' },
          guitar: { wave: 'rgba(46, 204, 113, 0.2)',  progress: 'rgba(46, 204, 113, 1)' },
          piano:  { wave: 'rgba(52, 152, 219, 0.2)',  progress: 'rgba(52, 152, 219, 1)' },
          other:  { wave: 'rgba(255, 209, 102, 0.2)', progress: 'rgba(255, 209, 102, 1)' },
          no_vocals: { wave: 'rgba(232, 87, 42, 0.2)', progress: 'rgba(232, 87, 42, 1)' },
        };
        const colors = stemColor[stem] ?? stemColor.other;

        const stemPeaks = peaks?.[stem];
        const hasPeaks = Array.isArray(stemPeaks) && stemPeaks.length > 0;

        const ws = WaveSurfer.create({
          container: containerRefs.current[stem]!,
          waveColor: colors.wave,
          progressColor: colors.progress,
          height: 64,
          barWidth: 3,
          barGap: 2,
          barRadius: 3,
          cursorWidth: 2,
          cursorColor: '#ffffff',
          // Use MediaElement backend when we have pre-computed peaks:
          // — delegates playback/decoding to the native <audio> element (off main thread)
          // — WaveSurfer draws the waveform instantly from the peaks array
          // — falls back to WebAudio decode if peaks unavailable (same as before)
          backend: hasPeaks ? 'MediaElement' : 'WebAudio',
        });

        // Load with pre-computed peaks to skip client-side audio decoding
        const url = `${API_BASE}/api/stems/${jobId}/${stem}.mp3`;
        if (hasPeaks) {
          // peaks is a flat array; WaveSurfer v7 expects [[peaksArray]] (2D for stereo support)
          ws.load(url, [stemPeaks]);
        } else {
          ws.load(url);
        }

        ws.on('interaction', (newTime: number) => {
          const progress = newTime / ws.getDuration();
          stems.forEach(s => {
            if (s !== stem && wsRefs.current[s]) {
              wsRefs.current[s]!.seekTo(progress);
            }
          });
        });

        ws.on('finish', () => setIsPlaying(false));
        wsRefs.current[stem] = ws;
      }
    });

    const currentWsRefs = wsRefs.current;
    return () => {
      stems.forEach(stem => {
        if (currentWsRefs[stem]) {
          currentWsRefs[stem]!.destroy();
          currentWsRefs[stem] = null;
        }
      });
    };
  // Re-run when peaks arrive (peaksLoading becomes false)
  }, [jobId, stems, peaksLoading, peaks]);

  useEffect(() => {
    stems.forEach(stem => {
      const ws = wsRefs.current[stem];
      if (ws) {
        let actualVolume = volumes[stem];
        if (mutes[stem] || (isSoloActive && !solos[stem])) actualVolume = 0;
        ws.setVolume(actualVolume);
      }
    });
  }, [stems, volumes, mutes, solos, isSoloActive]);

  const togglePlay = () => {
    const newState = !isPlaying;
    setIsPlaying(newState);
    stems.forEach(stem => {
      if (wsRefs.current[stem]) {
        if (newState) {
          wsRefs.current[stem]!.play();
        } else {
          wsRefs.current[stem]!.pause();
        }
      }
    });
  };

  const downloadZip = () => {
    window.location.href = `${API_BASE}/api/download/${jobId}`;
  };

  const toggleMute = (stem: string) => setMutes(p => ({ ...p, [stem]: !p[stem] }));
  const toggleSolo = (stem: string) => setSolos(p => ({ ...p, [stem]: !p[stem] }));
  const handleVolume = (stem: string, val: number) => setVolumes(p => ({ ...p, [stem]: val }));

  return (
    <div className="glass-panel p-5 sm:p-8 md:p-10 w-full">
      <div className="flex flex-col xl:flex-row items-center justify-between mb-8 pb-6 md:pb-8 border-b border-white/10 gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full xl:w-auto text-center sm:text-left">
          <button
            onClick={togglePlay}
            className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-[1.2rem] sm:rounded-2xl bg-gradient-to-br from-[#f5a623] to-[#e8572a] hover:-translate-y-1 flex items-center justify-center text-black transition-all shadow-[0_10px_30px_rgba(245,166,35,0.4)]"
          >
            {isPlaying ? <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-black" /> : <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-2 fill-black" />}
          </button>
          <div className="flex flex-col items-center sm:items-start w-full">
            <h2 className="font-cinzel text-2xl sm:text-3xl font-bold text-ink mb-2">Extraction Complete</h2>
            <div className="flex items-center justify-center sm:justify-start gap-3 text-sub bg-black/30 px-3 sm:px-4 py-2 rounded-lg border border-white/5 w-full sm:w-fit max-w-full">
              <FileAudio className="w-4 h-4 shrink-0 text-gold" />
              <span className="truncate max-w-[180px] sm:max-w-[200px] md:max-w-xs text-xs sm:text-sm">{fileName}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 bg-black/40 p-2 rounded-2xl border border-white/5 w-full xl:w-auto">
          {/* Play the accompaniment on the main site's Lehra engine, at your own Sa and tempo */}
          <a
            href={`${API_BASE}/practice?job=${jobId}`}
            onClick={() => {
              // The song's name for the practice page (same origin; kept out of the URL)
              try { sessionStorage.setItem(`practice-name-${jobId}`, fileName); } catch { /* storage unavailable */ }
            }}
            className="glass-button flex items-center justify-center gap-2 sm:gap-3 text-sm sm:text-base whitespace-nowrap no-underline"
            title="Play the accompaniment at your own Sa and tempo (results are kept for an hour)"
          >
            <Music className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
            Practise along
          </a>
          <button
            onClick={downloadZip}
            className="glass-button flex items-center justify-center gap-2 sm:gap-3 text-sm sm:text-base whitespace-nowrap"
          >
            <Download className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
            Download ZIP
          </button>
          <div className="hidden sm:block w-px h-8 sm:h-10 bg-white/10"></div>
          <button
            onClick={onReset}
            className="px-4 sm:px-6 py-3 rounded-xl text-sub hover:text-ink font-medium transition-colors text-sm sm:text-base whitespace-nowrap"
          >
            Start New
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 md:gap-5">
        {stems.map((stem) => {
          const isMuted = mutes[stem] || (isSoloActive && !solos[stem]);

          return (
            <div
              key={stem}
              className="stem-track-card flex flex-col lg:flex-row gap-4 lg:gap-8 items-center group"
            >
              <div className="flex flex-col gap-5 w-full lg:w-56 shrink-0 bg-black/20 p-4 rounded-xl border border-white/5">
                <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-2">
                  <span className="uppercase font-semibold text-[0.85rem] tracking-[0.1em] flex items-center gap-2 font-cinzel text-gold">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#f5a623]"></div>
                    {STEM_LABEL[stem] || stem}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleSolo(stem)}
                      className={`header-icon-btn ${solos[stem] ? 'active' : ''}`}
                    >
                      SOLO
                    </button>
                    <button
                      onClick={() => toggleMute(stem)}
                      className={`header-icon-btn ${mutes[stem] ? 'active-red' : ''}`}
                    >
                      MUTE
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {volumes[stem] === 0 || isMuted ? <VolumeX className="w-4 h-4 text-muted" /> : <Volume2 className="w-4 h-4 text-gold" />}
                  <input
                    type="range"
                    min="0" max="1" step="0.01"
                    value={volumes[stem]}
                    onChange={(e) => handleVolume(stem, parseFloat(e.target.value))}
                    className="flex-1 opacity-70 group-hover:opacity-100 transition-opacity"
                    style={{ '--val': `${volumes[stem] * 100}%` } as React.CSSProperties}
                  />
                </div>
              </div>

              <div className={`flex-1 w-full relative transition-opacity duration-300 ${isMuted ? 'opacity-30 grayscale' : 'opacity-100'}`}>
                {/* Waveform loading skeleton shown while peaks are being fetched */}
                {peaksLoading && (
                  <div className="w-full h-16 rounded-lg bg-white/5 animate-pulse" />
                )}
                <div
                  ref={el => { containerRefs.current[stem] = el; }}
                  className="w-full"
                  style={{ display: peaksLoading ? 'none' : 'block' }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

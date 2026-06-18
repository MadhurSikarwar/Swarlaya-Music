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
  Sparkles,
  Activity
} from "lucide-react";
import axios from "axios";
import WaveSurfer from "wavesurfer.js";

const API_BASE = process.env.NODE_ENV === "development" 
  ? "http://localhost:5000" 
  : (process.env.NEXT_PUBLIC_API_BASE || ""); // Allows pointing to an external backend URL if frontend is hosted separately
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "queued" | "processing" | "completed" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
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

  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
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
    if (!file) return;
    setStatus("uploading");
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE}/api/separate`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Upload Error:', errText);
        throw new Error('Upload failed: ' + errText);
      }

      const data = await response.json();
      console.log('Upload successful. Job ID:', data.job_id);
      setJobId(data.job_id);
      setStatus("queued");
    } catch (err: any) {
      console.error('Catch Error:', err);
      setStatus("error");
      setErrorMsg(err.message || "Upload failed.");
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
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 sm:p-8 md:p-12 relative">
      
      {/* Background Floating Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#f5a623]/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#e8572a]/10 rounded-full blur-[120px] pointer-events-none animate-float"></div>

      <div className="z-10 w-full max-w-5xl flex flex-col items-center pt-24 pb-16">
        {/* Premium Hero Section */}
        <motion.div 
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-24 relative flex flex-col items-center"
        >
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#f5a623]/10 border border-[#f5a623]/10 text-[#f5a623] text-sm font-medium mb-8 shadow-sm">
            <Sparkles className="w-4 h-4" />
            <span>AI Powered Audio Extraction</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tighter text-white mb-6 drop-shadow-lg font-cinzel uppercase px-2">
            AI Stem Separator
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-zinc-500 max-w-[540px] mx-auto text-center font-light leading-relaxed px-4">
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
              {/* Premium Glass Upload Card */}
              <div className="glass-panel rounded-[2rem] md:rounded-[2.5rem] p-8 sm:p-12 md:p-20 w-full flex flex-col items-center relative group transition-all hover:shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
                
                {!file ? (
                  <div 
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center cursor-pointer py-12 sm:py-16 md:py-20 rounded-[1.5rem] md:rounded-[26px] transition-all duration-300 hover:shadow-[0_0_50px_rgba(245,166,35,0.12)] px-4 text-center"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-gold)' }}
                  >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white/5 rounded-full flex items-center justify-center mb-8 sm:mb-10 group-hover:scale-105 transition-transform duration-500 shadow-sm">
                      <UploadCloud className="w-10 h-10 text-zinc-500 group-hover:text-[#f5a623] transition-colors" />
                    </div>
                    <h3 className="text-2xl font-semibold text-white mb-4">Drag & Drop Audio</h3>
                    <p className="text-zinc-500 text-sm">Supports MP3, WAV, FLAC, AAC (Max 100MB)</p>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center">
                    {/* Selected File State */}
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-6 bg-black/30 border border-white/5 p-6 rounded-2xl cursor-pointer hover:bg-black/40 transition-colors mb-10"
                    >
                      <div className="w-16 h-16 bg-gradient-to-br from-[#f5a623]/10 to-[#e8572a]/10 rounded-xl flex items-center justify-center border border-[#f5a623]/20 shrink-0">
                        <Music className="w-8 h-8 text-[#f5a623]" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <p className="text-white font-medium truncate text-lg mb-1">{file.name}</p>
                        <p className="text-zinc-500 text-sm flex items-center gap-3">
                          <span>{formatBytes(file.size)}</span>
                          <span className="w-1 h-1 bg-zinc-700 rounded-full"></span>
                          <span className="text-[#f5a623]">Ready to process</span>
                        </p>
                      </div>
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0">
                        <Activity className="w-5 h-5 text-zinc-400" />
                      </div>
                    </div>

                    <button 
                      onClick={startSeparation}
                      className="w-auto relative overflow-hidden group bg-gradient-to-r from-[#f5a623] to-[#e8572a] text-black px-12 py-3.5 rounded-xl font-semibold text-lg transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
                    >
                      <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                      <span className="relative flex items-center justify-center gap-3">
                        <Zap className="w-5 h-5 fill-black" />
                        Separate Stems Now
                      </span>
                    </button>
                  </div>
                )}

                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="audio/*,video/*,.mp3,.wav,.flac,.aac,.ogg,.m4a,.mp4,.mkv,.mov,.webm,.avi,.wma,.aiff,.alac" 
                  onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
                />
              </div>

              {/* Trust Badges */}
              <div className="mt-12 flex items-center justify-center gap-6 flex-wrap">
                <div className="flex items-center gap-2 text-[0.7rem] font-medium tracking-[0.04em] px-3 py-1.5 rounded-[20px]" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid var(--border-gold)', color: 'var(--text-sub)' }}>
                  <Zap className="w-3.5 h-3.5 text-[#f5a623]" />
                  <span>Hybrid Demucs Engine</span>
                </div>
                <div className="flex items-center gap-2 text-[0.7rem] font-medium tracking-[0.04em] px-3 py-1.5 rounded-[20px]" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid var(--border-gold)', color: 'var(--text-sub)' }}>
                  <Layers className="w-3.5 h-3.5 text-[#f5a623]" />
                  <span>6-Stem Extraction</span>
                </div>
                <div className="flex items-center gap-2 text-[0.7rem] font-medium tracking-[0.04em] px-3 py-1.5 rounded-[20px]" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid var(--border-gold)', color: 'var(--text-sub)' }}>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#f5a623]" />
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
              className="w-full max-w-xl glass-panel rounded-[2rem] md:rounded-[2.5rem] p-8 sm:p-12 md:p-16 flex flex-col items-center justify-center relative"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-[#f5a623]/10 to-transparent animate-pulse-slow" />
              
              <div className="relative mb-8">
                <div className="w-24 h-24 bg-[#f5a623]/20 rounded-full flex items-center justify-center animate-pulse">
                  <Loader2 className="w-10 h-10 text-[#f5a623] animate-spin" />
                </div>
                {/* Simulated equalizer rings */}
                <div className="absolute inset-0 border border-[#f5a623]/30 rounded-full animate-ping" style={{ animationDuration: '3s' }}></div>
              </div>

              <h3 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-white mb-4 md:mb-6 text-center">
                {status === "uploading" ? "Uploading Audio..." : 
                 status === "queued" ? "Waiting in Queue..." : 
                 "Analyzing Frequencies"}
              </h3>
              
              <p className="text-zinc-400 font-medium mb-10 md:mb-14 text-center max-w-sm text-sm sm:text-base md:text-lg leading-relaxed">
                {status === "processing" ? "The AI is isolating vocals, drums, bass, guitar, piano, and other instruments." : "Preparing your file for deep learning extraction."}
              </p>
              
              <div className="w-full bg-black/50 rounded-full h-5 mb-4 overflow-hidden p-1 border border-white/5 relative z-10 shadow-inner">
                <motion.div 
                  className="bg-gradient-to-r from-[#f5a623] to-[#e8572a] h-full rounded-full shadow-[0_0_15px_rgba(245,166,35,0.8)] relative overflow-hidden"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "linear" }}
                >
                  {/* Shiny overlay on progress bar */}
                  <div className="absolute top-0 bottom-0 left-0 right-0 bg-gradient-to-b from-white/30 to-transparent"></div>
                </motion.div>
              </div>
              <div className="flex justify-between w-full px-2 mb-8">
                <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Processing</span>
                <span className="text-xs text-[#f5a623] font-bold">{progress}%</span>
              </div>

              {/* Live Terminal Output */}
              {logs.length > 0 && (
                <div 
                  className="w-full bg-[#090806] border border-white/5 rounded-2xl p-6 h-48 overflow-y-auto font-mono text-[0.7rem] text-[#f5a623]/70 leading-loose shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)] relative flex flex-col-reverse"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  {/* Custom CSS to hide webkit scrollbar */}
                  <style dangerouslySetInnerHTML={{__html: `
                    div::-webkit-scrollbar { display: none; }
                  `}} />
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
              <StemPlayer jobId={jobId} onReset={handleReset} fileName={file?.name || "audio"} />
            </motion.div>
          )}

          {status === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-xl glass-panel rounded-[2rem] p-12 text-center"
            >
              <div className="w-24 h-24 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                <FileAudio className="w-12 h-12 text-red-500" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4">Processing Failed</h3>
              <p className="text-red-400/90 mb-8 md:mb-10 bg-red-500/5 p-4 rounded-xl border border-red-500/10 text-sm md:text-base">{errorMsg}</p>
              <button 
                onClick={handleReset}
                className="bg-white/10 hover:bg-white/15 border border-white/20 text-white px-8 py-4 rounded-xl font-semibold transition-all hover:-translate-y-1 shadow-lg"
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
function StemPlayer({ jobId, onReset, fileName }: { jobId: string, onReset: () => void, fileName: string }) {
  const stems = ["vocals", "drums", "bass", "guitar", "piano", "other"];
  
  const [isPlaying, setIsPlaying] = useState(false);
  const wsRefs = useRef<{ [key: string]: WaveSurfer | null }>({});
  const containerRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  
  const [volumes, setVolumes] = useState<{ [key: string]: number }>({ vocals: 1, drums: 1, bass: 1, guitar: 1, piano: 1, other: 1 });
  const [mutes, setMutes] = useState<{ [key: string]: boolean }>({ vocals: false, drums: false, bass: false, guitar: false, piano: false, other: false });
  const [solos, setSolos] = useState<{ [key: string]: boolean }>({ vocals: false, drums: false, bass: false, guitar: false, piano: false, other: false });

  const isSoloActive = Object.values(solos).some(s => s);

  useEffect(() => {
    stems.forEach(stem => {
      if (containerRefs.current[stem] && !wsRefs.current[stem]) {
        const ws = WaveSurfer.create({
          container: containerRefs.current[stem]!,
          waveColor: stem === 'vocals' ? 'rgba(245, 166, 35, 0.2)' : 
                     stem === 'drums' ? 'rgba(232, 87, 42, 0.2)' : 
                     stem === 'bass' ? 'rgba(196, 125, 14, 0.2)' : 
                     stem === 'guitar' ? 'rgba(46, 204, 113, 0.2)' : 
                     stem === 'piano' ? 'rgba(52, 152, 219, 0.2)' : 
                     'rgba(255, 209, 102, 0.2)',
          progressColor: stem === 'vocals' ? 'rgba(245, 166, 35, 1)' : 
                         stem === 'drums' ? 'rgba(232, 87, 42, 1)' : 
                         stem === 'bass' ? 'rgba(196, 125, 14, 1)' : 
                         stem === 'guitar' ? 'rgba(46, 204, 113, 1)' : 
                         stem === 'piano' ? 'rgba(52, 152, 219, 1)' : 
                         'rgba(255, 209, 102, 1)',
          height: 64,
          barWidth: 3,
          barGap: 2,
          barRadius: 3,
          cursorWidth: 2,
          cursorColor: '#ffffff',
          url: `${API_BASE}/api/stems/${jobId}/${stem}.mp3`
        });

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

    return () => {
      stems.forEach(stem => {
        if (wsRefs.current[stem]) {
          wsRefs.current[stem]!.destroy();
          wsRefs.current[stem] = null;
        }
      });
    };
  }, [jobId]);

  useEffect(() => {
    stems.forEach(stem => {
      const ws = wsRefs.current[stem];
      if (ws) {
        let actualVolume = volumes[stem];
        if (mutes[stem] || (isSoloActive && !solos[stem])) actualVolume = 0;
        ws.setVolume(actualVolume);
      }
    });
  }, [volumes, mutes, solos, isSoloActive]);

  const togglePlay = () => {
    const newState = !isPlaying;
    setIsPlaying(newState);
    stems.forEach(stem => {
      if (wsRefs.current[stem]) {
        newState ? wsRefs.current[stem]!.play() : wsRefs.current[stem]!.pause();
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
    <div className="glass-panel rounded-[2rem] md:rounded-[2.5rem] p-6 sm:p-10 md:p-16 w-full mt-6 md:mt-10">
      <div className="flex flex-col xl:flex-row items-center justify-between mb-10 md:mb-16 pb-8 md:pb-10 border-b border-white/10 gap-8">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full xl:w-auto text-center sm:text-left">
          <button 
            onClick={togglePlay}
            className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-[1.2rem] sm:rounded-2xl bg-gradient-to-br from-[#f5a623] to-[#e8572a] hover:-translate-y-1 flex items-center justify-center text-black transition-all shadow-[0_10px_30px_rgba(245,166,35,0.4)]"
          >
            {isPlaying ? <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-black" /> : <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-2 fill-black" />}
          </button>
          <div className="flex flex-col items-center sm:items-start w-full">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">Extraction Complete</h2>
            <div className="flex items-center justify-center sm:justify-start gap-3 text-zinc-400 bg-black/30 px-3 sm:px-4 py-2 rounded-lg border border-white/5 w-full sm:w-fit max-w-full">
              <FileAudio className="w-4 h-4 shrink-0 text-[#f5a623]" />
              <span className="truncate max-w-[180px] sm:max-w-[200px] md:max-w-xs text-xs sm:text-sm">{fileName}</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 bg-black/40 p-2 rounded-2xl border border-white/5 w-full xl:w-auto">
          <button 
            onClick={downloadZip}
            className="glass-button px-4 sm:px-6 py-3 sm:py-4 rounded-xl flex items-center justify-center gap-2 sm:gap-3 text-white font-semibold hover:shadow-[0_0_20px_rgba(245,166,35,0.2)] transition-shadow text-sm sm:text-base whitespace-nowrap"
          >
            <Download className="w-4 h-4 sm:w-5 sm:h-5 text-[#f5a623]" />
            Download ZIP
          </button>
          <div className="hidden sm:block w-px h-8 sm:h-10 bg-white/10"></div>
          <button 
            onClick={onReset} 
            className="px-4 sm:px-6 py-3 sm:py-4 rounded-xl text-zinc-400 hover:text-white font-medium transition-colors text-sm sm:text-base whitespace-nowrap"
          >
            Start New
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8 md:gap-10">
        {stems.map((stem) => {
          const isMuted = mutes[stem] || (isSoloActive && !solos[stem]);
          
          return (
            <div key={stem} className="bg-black/30 hover:bg-black/40 transition-colors rounded-2xl p-5 border border-white/5 flex flex-col lg:flex-row gap-8 items-center group">
              <div className="flex flex-col gap-5 w-full lg:w-56 shrink-0 bg-black/20 p-4 rounded-xl border border-white/5">
                <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-2">
                  <span className="uppercase font-semibold text-[0.85rem] tracking-[0.1em] flex items-center gap-2 font-cinzel text-[#f5a623]">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#f5a623]"></div>
                    {stem}
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
                  {volumes[stem] === 0 || isMuted ? <VolumeX className="w-4 h-4 text-zinc-600" /> : <Volume2 className="w-4 h-4 text-[#f5a623]" />}
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
                <div ref={el => { containerRefs.current[stem] = el; }} className="w-full" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}

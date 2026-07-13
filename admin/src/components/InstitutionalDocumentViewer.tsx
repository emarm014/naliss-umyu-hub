import { useState, useEffect, useRef, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import {
  ExternalLink, FileText, RefreshCw, AlertTriangle,
  Film, Image as ImageIcon, Music,
  ZoomIn, ZoomOut, Layers, Eye, Download
} from 'lucide-react';

interface InstitutionalDocumentViewerProps {
  url: string;
  isOffice: boolean;
}

type MediaKind = 'pdf' | 'office' | 'video' | 'image' | 'audio' | 'unknown';
type PdfEngine = 'canvas' | 'scan' | 'direct';

function detectKind(url: string, isOffice: boolean): MediaKind {
  if (isOffice) return 'office';
  const u = url.toLowerCase().split('?')[0];
  if (u.match(/\.(mp4|mov|avi|webm|mkv|m4v)$/) || u.includes('/video/upload/')) return 'video';
  if (u.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/) || (u.includes('/image/upload/') && !u.match(/\.(pdf|doc|docx|ppt|pptx|xls|xlsx)$/))) return 'image';
  if (u.match(/\.(mp3|wav|ogg|aac|m4a|flac)$/)) return 'audio';
  if (u.match(/\.(pdf)$/) || u.includes('/raw/upload/') || u.includes('/image/upload/') && u.match(/\.pdf$/)) return 'pdf';
  if (u.match(/\.(doc|docx|ppt|pptx|xls|xlsx)$/)) return 'office';
  return 'unknown';
}

// Clean URL — remove any transformation flags that cause 400 errors
function getCleanUrl(url: string): string {
  return url
    .replace('/raw/upload/fl_inline/', '/raw/upload/')
    .replace('/fl_inline/', '/');
}

// Try both raw and image upload paths for Cloudinary PDFs
function getPdfUrls(url: string): string[] {
  const clean = getCleanUrl(url);
  const urls = [clean];
  // If stored as image/upload, also try raw/upload
  if (clean.includes('/image/upload/') && clean.toLowerCase().endsWith('.pdf')) {
    urls.push(clean.replace('/image/upload/', '/raw/upload/'));
  }
  // If stored as raw/upload, also try image/upload
  if (clean.includes('/raw/upload/')) {
    urls.push(clean.replace('/raw/upload/', '/image/upload/'));
  }
  return [...new Set(urls)];
}

// Get Cloudinary page image URL for Visual Scan Engine
function getCloudinaryPageUrl(url: string, page: number): string | null {
  const clean = getCleanUrl(url);
  // Try to extract cloud name and path from any Cloudinary URL format
  const match = clean.match(/res\.cloudinary\.com\/([^/]+)\/(?:raw|image|video)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  const [, cloud, path] = match;
  const pathNoExt = path.replace(/\.[^.]+$/, '');
  return `https://res.cloudinary.com/${cloud}/image/upload/pg_${page},w_1400,c_limit,f_jpg,q_auto:best/${pathNoExt}.jpg`;
}

// ── Canvas PDF Viewer using pdfjs-dist — Scroll mode (all pages) ─────────────
function CanvasPdfViewer({ url, onFallback }: { url: string; onFallback: () => void }) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pdfRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderingRef = useRef(false);

  const pdfUrls = getPdfUrls(url);

  // Render all pages into their canvases
  const renderAllPages = useCallback(async (pdf: any, s: number) => {
    if (renderingRef.current) return;
    renderingRef.current = true;
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = pageCanvasRefs.current[i - 1];
      if (!canvas) continue;
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: s });
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch { /* skip failed page */ }
    }
    renderingRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    setNumPages(0);
    pageCanvasRefs.current = [];

    const tryLoad = async (urlsToTry: string[]) => {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      let lastError: any = null;
      for (const tryUrl of urlsToTry) {
        try {
          const pdf = await pdfjsLib.getDocument({
            url: tryUrl,
            withCredentials: false,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@latest/cmaps/',
            cMapPacked: true,
          }).promise;
          if (cancelled) return;
          pdfRef.current = pdf;
          pageCanvasRefs.current = new Array(pdf.numPages).fill(null);
          setNumPages(pdf.numPages);
          setStatus('ready');
          return;
        } catch (err) { lastError = err; }
      }
      if (!cancelled) {
        Sentry.captureException(new Error(`PDF Canvas Engine Failed: ${lastError?.message || 'Unknown error'}`), {
          extra: { url, urlsTried: urlsToTry, lastError }
        });
        setErrorMsg('Could not load PDF. Switching to Visual Scan...');
        setStatus('error');
        setTimeout(() => { if (!cancelled) onFallback(); }, 1500);
      }
    };

    tryLoad(pdfUrls);
    return () => { cancelled = true; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render all pages when scale changes or pages are ready
  useEffect(() => {
    if (status === 'ready' && pdfRef.current && numPages > 0) {
      // Small delay to let canvases mount
      setTimeout(() => renderAllPages(pdfRef.current, scale), 50);
    }
  }, [status, numPages, scale, renderAllPages]);

  // Track current page based on scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const pages = container.querySelectorAll('[data-page]');
      let closest = 1;
      let minDist = Infinity;
      pages.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerRect.top);
        if (dist < minDist) {
          minDist = dist;
          closest = parseInt((el as HTMLElement).dataset.page || '1');
        }
      });
      setCurrentPage(closest);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 bg-slate-50">
        <div className="w-16 h-16 relative">
          <div className="absolute inset-0 border-4 border-slate-200 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-primary-600 rounded-full animate-spin" />
        </div>
        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest animate-pulse">Loading PDF...</p>
        <p className="text-xs text-slate-400">Canvas Engine</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 bg-slate-50">
        <div className="w-12 h-12 relative">
          <div className="absolute inset-0 border-4 border-amber-200 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-amber-500 rounded-full animate-spin" />
        </div>
        <p className="text-sm font-bold text-slate-600 text-center">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            Page <span className="text-slate-800">{currentPage}</span> / {numPages}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}
            className="p-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all active:scale-95">
            <ZoomOut className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-xs font-black text-slate-500 min-w-[44px] text-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))}
            className="p-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-all active:scale-95">
            <ZoomIn className="w-4 h-4 text-slate-600" />
          </button>
          <button onClick={() => setScale(1.5)}
            className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] font-black text-slate-500 hover:bg-slate-100 transition-all">
            FIT
          </button>
        </div>
      </div>

      {/* Scrollable pages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto bg-slate-200 px-6 py-6 space-y-6">
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
          <div key={pageNum} data-page={pageNum} className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-slate-400/30" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Page {pageNum}</span>
              <div className="h-px w-10 bg-slate-400/30" />
            </div>
            <canvas
              ref={el => { pageCanvasRefs.current[pageNum - 1] = el; }}
              className="shadow-2xl rounded-lg bg-white max-w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Visual Scan Engine: Cloudinary page images (up to 50 pages) ───────────────
function VisualScanEngine({ url }: { url: string }) {
  const MAX_PAGES = 50;
  const [loadedPages, setLoadedPages] = useState<number[]>([1]);
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set());
  const [renderedCount, setRenderedCount] = useState(0);

  const handleImageLoad = (page: number) => {
    setRenderedCount(c => c + 1);
    if (page < MAX_PAGES) {
      setLoadedPages(prev => prev.includes(page + 1) ? prev : [...prev, page + 1]);
    }
  };

  const handleImageError = (page: number) => {
    setFailedPages(prev => {
      const next = new Set([...prev, page]);
      if (page === 1) {
        Sentry.captureMessage('Visual Scan Engine Failed to load first page', {
          level: 'warning',
          extra: { url, imgUrl: getCloudinaryPageUrl(url, 1) }
        });
      }
      return next;
    });
  };

  if (!url.includes('res.cloudinary.com')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 bg-slate-50">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <p className="text-sm font-bold text-slate-600 text-center">Visual Scan requires a Cloudinary URL</p>
        <p className="text-xs text-slate-400">Use "Direct" engine or open in new tab</p>
      </div>
    );
  }

  const visiblePages = loadedPages.filter(p => !failedPages.has(p));

  return (
    <div className="h-full overflow-y-auto bg-slate-200">
      {/* Status bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-primary-950/90 backdrop-blur-sm border-b border-white/10">
        <span className="flex items-center gap-2 text-[10px] font-black text-primary-400 uppercase tracking-widest">
          <Eye className="w-3.5 h-3.5" />
          Visual Scan — {renderedCount} page{renderedCount !== 1 ? 's' : ''} loaded
        </span>
        <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
          Max {MAX_PAGES} pages
        </span>
      </div>

      <div className="p-6 space-y-8">
        {loadedPages.map(page => {
          const imgUrl = getCloudinaryPageUrl(url, page);
          if (!imgUrl || failedPages.has(page)) return null;
          return (
            <div key={page} className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="h-px w-12 bg-slate-400/30" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Page {page}</span>
                <div className="h-px w-12 bg-slate-400/30" />
              </div>
              <img
                src={imgUrl}
                alt={`Page ${page}`}
                className="max-w-full rounded-2xl shadow-2xl bg-white border border-white/20"
                loading="lazy"
                onLoad={() => handleImageLoad(page)}
                onError={() => handleImageError(page)}
              />
            </div>
          );
        })}

        {visiblePages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 relative">
              <div className="absolute inset-0 border-4 border-slate-300 rounded-full" />
              <div className="absolute inset-0 border-4 border-t-primary-500 rounded-full animate-spin" />
            </div>
            <p className="text-sm font-bold text-slate-500">Scanning pages...</p>
          </div>
        )}

        {renderedCount >= MAX_PAGES && (
          <div className="text-center py-8 border-t border-slate-300/50">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Showing first {MAX_PAGES} pages — click "Open" to view the full document
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Viewer ──────────────────────────────────────────────────────────────
const InstitutionalDocumentViewer = ({ url, isOffice }: InstitutionalDocumentViewerProps) => {
  const kind = detectKind(url, isOffice);
  const cleanUrl = getCleanUrl(url);
  const msUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(cleanUrl)}`;

  const [pdfEngine, setPdfEngine] = useState<PdfEngine>('canvas');
  const [iframeKey, setIframeKey] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const kindIcon: Record<MediaKind, React.ReactNode> = {
    pdf: <FileText className="w-5 h-5 text-red-400" />,
    office: <FileText className="w-5 h-5 text-blue-400" />,
    video: <Film className="w-5 h-5 text-purple-400" />,
    image: <ImageIcon className="w-5 h-5 text-emerald-400" />,
    audio: <Music className="w-5 h-5 text-amber-400" />,
    unknown: <FileText className="w-5 h-5 text-gray-400" />,
  };

  const kindLabel: Record<MediaKind, string> = {
    pdf: 'PDF Document',
    office: 'Office Document',
    video: 'Video',
    image: 'Image',
    audio: 'Audio',
    unknown: 'File',
  };

  const renderViewer = () => {
    // ── PDF ────────────────────────────────────────────────────────────────
    if (kind === 'pdf') {
      if (pdfEngine === 'canvas') {
        return (
          <CanvasPdfViewer
            key={`canvas-${iframeKey}`}
            url={cleanUrl}
            onFallback={() => setPdfEngine('scan')}
          />
        );
      }
      if (pdfEngine === 'scan') {
        return <VisualScanEngine key={`scan-${iframeKey}`} url={cleanUrl} />;
      }
      // Direct embed
      return (
        <div className="flex flex-col h-full">
          <iframe key={iframeKey} src={cleanUrl} className="flex-1 w-full border-none" title="PDF Direct" />
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-amber-50 border-t border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-xs font-bold text-amber-800">
              If blank, use "Canvas" or "Visual Scan" engine, or click "Open" to view in a new tab.
            </p>
          </div>
        </div>
      );
    }

    // ── OFFICE ─────────────────────────────────────────────────────────────
    if (kind === 'office') {
      return (
        <iframe key={iframeKey} src={msUrl} className="w-full h-full border-none" title="Office Viewer" allow="fullscreen" />
      );
    }

    // ── VIDEO ──────────────────────────────────────────────────────────────
    if (kind === 'video') {
      if (videoError) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-12 bg-black">
            <AlertTriangle className="w-12 h-12 text-amber-400" />
            <p className="text-sm font-bold text-white/60 text-center">Video could not be played.</p>
            <a href={cleanUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl text-sm font-black uppercase tracking-widest hover:bg-slate-100 transition-all">
              <ExternalLink className="w-4 h-4" /> Open in New Tab
            </a>
          </div>
        );
      }
      return (
        <div className="w-full h-full flex items-center justify-center bg-black">
          <video key={iframeKey} src={cleanUrl} controls autoPlay={false} className="max-w-full max-h-full" onError={() => setVideoError(true)}>
            <source src={cleanUrl} />
          </video>
        </div>
      );
    }

    // ── IMAGE ──────────────────────────────────────────────────────────────
    if (kind === 'image') {
      if (imgError) {
        return (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-12 bg-slate-50">
            <AlertTriangle className="w-12 h-12 text-amber-400" />
            <p className="text-sm font-bold text-slate-600">Image could not be loaded.</p>
            <a href={cleanUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 bg-primary-950 text-white rounded-xl text-sm font-black uppercase tracking-widest hover:bg-black transition-all">
              <ExternalLink className="w-4 h-4" /> Open in New Tab
            </a>
          </div>
        );
      }
      return (
        <div className="w-full h-full overflow-auto flex items-center justify-center bg-slate-100 p-4">
          <img src={cleanUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" onError={() => setImgError(true)} />
        </div>
      );
    }

    // ── AUDIO ──────────────────────────────────────────────────────────────
    if (kind === 'audio') {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-8 bg-slate-50 p-12">
          <div className="w-24 h-24 bg-amber-100 rounded-3xl flex items-center justify-center shadow-xl">
            <Music className="w-12 h-12 text-amber-500" />
          </div>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Audio File</p>
          <audio key={iframeKey} src={cleanUrl} controls className="w-full max-w-md" style={{ borderRadius: 12 }}>
            Your browser does not support the audio element.
          </audio>
          <a href={cleanUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all">
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        </div>
      );
    }

    // ── UNKNOWN ────────────────────────────────────────────────────────────
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-12 bg-slate-50">
        <FileText className="w-16 h-16 text-slate-300" />
        <p className="text-sm font-bold text-slate-500 text-center">Preview not available for this file type.</p>
        <a href={cleanUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-6 py-3 bg-primary-950 text-white rounded-xl text-sm font-black uppercase tracking-widest hover:bg-black transition-all">
          <ExternalLink className="w-4 h-4" /> Open in New Tab
        </a>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950">
      {/* Header */}
      <div className="shrink-0 bg-primary-950 px-5 py-3.5 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-white/10 rounded-xl shrink-0">{kindIcon[kind]}</div>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-white uppercase tracking-[0.3em]">{kindLabel[kind]} Viewer</p>
            <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5 truncate max-w-[300px]">
              {url.split('/').pop()?.split('?')[0]?.substring(0, 50)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* PDF engine switcher */}
          {kind === 'pdf' && (
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 gap-1">
              {([
                { key: 'canvas' as PdfEngine, label: 'Canvas', icon: <FileText className="w-3 h-3" /> },
                { key: 'scan' as PdfEngine, label: 'Visual Scan', icon: <Layers className="w-3 h-3" /> },
                { key: 'direct' as PdfEngine, label: 'Direct', icon: <Eye className="w-3 h-3" /> },
              ]).map(e => (
                <button
                  key={e.key}
                  onClick={() => { setPdfEngine(e.key); setIframeKey(k => k + 1); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                    pdfEngine === e.key
                      ? 'bg-emerald-500 text-white shadow-lg'
                      : 'text-white/40 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {e.icon}{e.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => { setIframeKey(k => k + 1); setVideoError(false); setImgError(false); }}
            className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all"
            title="Reload"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <a
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open
          </a>
        </div>
      </div>

      {/* Viewer area */}
      <div className="flex-1 overflow-hidden bg-white">
        {renderViewer()}
      </div>
    </div>
  );
};

export default InstitutionalDocumentViewer;

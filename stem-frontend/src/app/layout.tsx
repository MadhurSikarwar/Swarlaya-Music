import type { Metadata } from "next";
import "./globals.css";

/* eslint-disable @next/next/no-page-custom-font, @next/next/no-css-tags, @next/next/no-html-link-for-pages, @next/next/no-sync-scripts */

export const metadata: Metadata = {
  title: "AI Stem Separator | Swaralaya",
  description: "Extract vocals and instruments from any audio file using AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* The main site's stylesheet: the header, hero and shared components look the same on both */}
        <link rel="stylesheet" href="/public/css/style.css?v=34" />
        {/* The main site's navigation script: the AI Studio menu and the phone "All tools" sheet */}
        <script type="module" src="/public/js/core/site-nav.js"></script>
      </head>
      <body className="min-h-full flex flex-col" data-nav="studio">
        {/* Ambient Background Orbs */}
        <div className="bg-orb orb-1"></div>
        <div className="bg-orb orb-2"></div>
        <div className="bg-orb orb-3"></div>

        {/* Header, tab bar and tools sheet: the same markup as the main site's (index.html),
            without its single-page links (data-target) and the tuner, which this page doesn't have */}
        <header className="site-header">
          <a className="logo" href="/" aria-label="Swaralaya — home">
            <svg className="logo-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="20" cy="20" r="18" stroke="url(#grad)" strokeWidth="2" />
              <path d="M14 28V14l14 7-14 7z" fill="url(#grad)" />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="40" y2="40">
                  <stop offset="0%" stopColor="#f5a623" />
                  <stop offset="100%" stopColor="#e8572a" />
                </linearGradient>
              </defs>
            </svg>
            <span className="logo-text">
              <span className="logo-title">Swaralaya</span>
              <span className="logo-sub">Indian Classical Practice</span>
            </span>
          </a>

          <nav className="site-nav" aria-label="Main">
            <a className="nav-btn" href="/lehra" data-nav="lehra">Lehra Player</a>
            <a className="nav-btn" href="/carnatic" data-nav="carnatic">Carnatic</a>
            <a className="nav-btn" href="/notation" data-nav="notation">Notation</a>
            <a className="nav-btn" href="/games" data-nav="games">Games</a>
            <div className="nav-menu">
              <button type="button" className="nav-btn nav-menu-btn" id="studioMenuBtn" data-nav="studio" aria-expanded="false" aria-controls="studioMenu">
                AI Studio
                <svg className="nav-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div className="nav-dropdown" id="studioMenu" hidden>
                <a className="nav-dropdown-item" href="/separator/" data-nav-item="separator">
                  <span className="nav-dropdown-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h4l2-9 5 18 4-9h5"/></svg></span>
                  <span><strong>Stem Separator</strong><small>Split a song into vocals, drums, bass and more</small></span>
                </a>
                <a className="nav-dropdown-item" href="/practice" data-nav-item="practice">
                  <span className="nav-dropdown-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
                  <span><strong>Practise Along</strong><small>A separated song at your own Sa and tempo</small></span>
                </a>
                <a className="nav-dropdown-item" href="/audio" data-nav-item="audio">
                  <span className="nav-dropdown-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg></span>
                  <span><strong>Audio Lab</strong><small>Clean up and master a tabla recording</small></span>
                </a>
              </div>
            </div>
          </nav>
          <div className="header-right">
            <a id="accountBtn" className="header-icon-btn header-labelled" href="/account" data-nav="progress" title="Your riyaz time, scores and account" aria-label="Your progress and account">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
              <span className="header-btn-label">Progress</span>
            </a>
          </div>
        </header>
        <nav className="tab-bar" aria-label="Main">
          <a className="tab-btn" href="/" data-nav="home"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg><span>Home</span></a>
          <a className="tab-btn" href="/lehra" data-nav="lehra"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>Lehra</span></a>
          <a className="tab-btn" href="/carnatic" data-nav="carnatic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8 Q12 4 19 8 V16 Q12 20 5 16 Z"/><ellipse cx="5" cy="12" rx="1.5" ry="4"/><ellipse cx="19" cy="12" rx="1.5" ry="4"/></svg><span>Carnatic</span></a>
          <a className="tab-btn" href="/games" data-nav="games"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg><span>Games</span></a>
          <button type="button" className="tab-btn" id="toolsSheetBtn" data-nav="more" aria-expanded="false" aria-controls="toolsSheet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>All tools</span></button>
        </nav>
        <div className="tools-sheet" id="toolsSheet" role="dialog" aria-modal="true" aria-labelledby="toolsSheetTitle" hidden>
          <div className="tools-sheet-panel">
            <div className="tools-sheet-head">
              <h2 className="panel-title" id="toolsSheetTitle">All tools</h2>
              <button type="button" className="modal-close" id="toolsSheetClose" aria-label="Close">×</button>
            </div>
            <p className="sheet-group-title">Daily riyaz</p>
            <div className="sheet-group">
              <a className="sheet-item" href="/lehra"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span><strong>Lehra Player</strong><small>Sarangi, harmonium, sitar, esraj</small></span></a>
              <a className="sheet-item" href="/carnatic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8 Q12 4 19 8 V16 Q12 20 5 16 Z"/><ellipse cx="5" cy="12" rx="1.5" ry="4"/><ellipse cx="19" cy="12" rx="1.5" ry="4"/></svg><span><strong>Carnatic</strong><small>Shruti box, tanpura, talam</small></span></a>
              <button type="button" className="sheet-item" data-open-tuner><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 2v7a3 3 0 0 0 6 0V2"/><path d="M12 12v10"/><path d="M9 22h6"/></svg><span><strong>Swar Tuner</strong><small>Sing or play — see the swar</small></span></button>
              <a className="sheet-item" href="/games"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="11" r="1"/><circle cx="18" cy="13" r="1"/></svg><span><strong>Riyaz Games</strong><small>Ear training and laya</small></span></a>
            </div>
            <p className="sheet-group-title">Compose &amp; produce</p>
            <div className="sheet-group">
              <a className="sheet-item" href="/notation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg><span><strong>Notation Editor</strong><small>Bhatkhande &amp; Paluskar</small></span></a>
              <a className="sheet-item" href="/separator/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12h4l2-9 5 18 4-9h5"/></svg><span><strong>Stem Separator</strong><small>Split a song with AI</small></span></a>
              <a className="sheet-item" href="/practice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span><strong>Practise Along</strong><small>A separated song at your Sa</small></span></a>
              <a className="sheet-item" href="/audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg><span><strong>Audio Lab</strong><small>Master a tabla recording</small></span></a>
            </div>
            <p className="sheet-group-title">More</p>
            <div className="sheet-group">
              <a className="sheet-item" href="/account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg><span><strong>Your Progress</strong><small>Riyaz time, scores, account</small></span></a>
              <a className="sheet-item" href="/hindustani"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 14v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4"/><ellipse cx="17" cy="14" rx="4" ry="2"/><path d="M3 13v5a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-5"/><ellipse cx="8" cy="13" rx="5" ry="2.5"/></svg><span><strong>Hindustani overview</strong><small>All Hindustani tools</small></span></a>
            </div>
          </div>
        </div>

        <main className="flex-1 relative z-10">
          {/* The AI Studio tools, in the order you use them (as on /practice and /audio) */}
          <div className="flex justify-center px-4 pt-6">
            <nav className="studio-switch" aria-label="AI Studio">
              <a href="/separator/" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12h4l2-9 5 18 4-9h5"/></svg>Separate<span className="studio-switch-step" aria-hidden="true">1</span></a>
              <a href="/practice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>Practise Along<span className="studio-switch-step" aria-hidden="true">2</span></a>
              <a href="/audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>Audio Lab</a>
            </nav>
          </div>
          {children}
        </main>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

/* eslint-disable @next/next/no-page-custom-font, @next/next/no-css-tags */

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
        <link rel="stylesheet" href="/public/css/style.css?v=24" />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Ambient Background Orbs */}
        <div className="bg-orb orb-1"></div>
        <div className="bg-orb orb-2"></div>
        <div className="bg-orb orb-3"></div>

        {/* Header */}
        <header className="site-header">
          <a href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="logo">
              <svg className="logo-icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" stroke="url(#grad)" strokeWidth="2" />
                <path d="M14 28V14l14 7-14 7z" fill="url(#grad)" />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="40" y2="40">
                    <stop offset="0%" stopColor="#f5a623" />
                    <stop offset="100%" stopColor="#e8572a" />
                  </linearGradient>
                </defs>
              </svg>
              <div>
                <span className="logo-title">Swaralaya</span>
                <span className="logo-sub">Indian Classical Practice</span>
              </div>
            </div>
          </a>
          
          <nav className="site-nav">
            <a className="nav-btn" href="/carnatic" style={{textDecoration: 'none'}}>Carnatic</a>
            <a className="nav-btn" href="/hindustani" style={{textDecoration: 'none'}}>Hindustani</a>
            <a className="nav-btn active" href="/separator/" style={{textDecoration: 'none'}}>STEM</a>
          </nav>
          <div className="header-right">
            <div className="header-badge" id="loadingBadge">Web Player</div>
          </div>
        </header>

        <main className="flex-1 relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}

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
        {/* The main site's stylesheet: the header, hero and shared components look the same on both */}
        <link rel="stylesheet" href="/public/css/style.css?v=30" />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Ambient Background Orbs */}
        <div className="bg-orb orb-1"></div>
        <div className="bg-orb orb-2"></div>
        <div className="bg-orb orb-3"></div>

        {/* Header: the same markup as the main site's (index.html) */}
        <header className="site-header">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the main site, outside this app's /separator basePath */}
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

          <nav className="site-nav" aria-label="Sections">
            <a className="nav-btn" href="/carnatic">Carnatic</a>
            <a className="nav-btn" href="/hindustani">Hindustani</a>
            <a className="nav-btn active" href="/separator/" aria-current="page">STEM</a>
            <a className="nav-btn" href="/games">Games</a>
          </nav>
        </header>

        <main className="flex-1 relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}

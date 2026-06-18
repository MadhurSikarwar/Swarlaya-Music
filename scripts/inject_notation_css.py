import pathlib

css_code = """
/* ============================================================
   NOTATION STUDIO LAYOUT
   ============================================================ */

.studio-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 0;
  padding: 0;
  overflow: hidden;
  height: 80vh; /* Adjust as needed */
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 12px;
}

/* Sidebar */
.studio-sidebar {
  border-right: 1px solid var(--border);
  background: rgba(255,255,255,0.02);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-family: 'Cinzel', serif;
  color: var(--gold);
  font-size: 1.1rem;
  margin-bottom: 12px;
}

.palette-search {
  width: 100%;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.85rem;
}

.palette-search:focus {
  outline: none;
  border-color: var(--gold);
}

.palette-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  align-content: start;
}

.palette-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 0;
  text-align: center;
  cursor: grab;
  transition: all 0.2s;
  user-select: none;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.palette-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-gold);
  color: var(--gold);
}

.palette-item:active {
  cursor: grabbing;
}

/* Main Workspace */
.studio-workspace {
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  overflow: hidden;
}

.studio-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,0.015);
}

.studio-toggles {
  display: flex;
  gap: 16px;
}

.toggle-group {
  display: flex;
  background: rgba(0,0,0,0.4);
  border-radius: 20px;
  border: 1px solid var(--border);
  padding: 3px;
}

.toggle-btn {
  background: transparent;
  border: none;
  color: var(--text-sub);
  padding: 6px 16px;
  border-radius: 16px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.toggle-btn.active {
  background: var(--bg-active);
  color: var(--gold);
}

.studio-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* Notation Toolbar */
.notation-toolbar {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  gap: 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,0.01);
}

.format-group {
  display: flex;
  gap: 8px;
}

/* Document Area */
.notation-document-wrapper {
  flex: 1;
  overflow: auto;
  padding: 32px;
  display: flex;
  justify-content: center;
  background: #050403; /* Slightly darker to contrast paper */
}

.notation-document {
  width: 100%;
  max-width: 900px;
  min-height: 1000px;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  padding: 48px;
  border-radius: 8px;
}

.doc-header {
  text-align: center;
  margin-bottom: 32px;
}

.doc-title-input {
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--border);
  color: var(--gold);
  font-family: 'Cinzel', serif;
  font-size: 2rem;
  text-align: center;
  width: 80%;
  padding-bottom: 8px;
  outline: none;
  transition: border-color 0.3s;
}

.doc-title-input:focus {
  border-bottom-color: var(--gold);
}

/* Dynamic Grid Elements */
.dynamic-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.grid-row {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.grid-vibhag {
  display: flex;
  flex: 1;
  border-right: 2px solid var(--border);
}
.grid-vibhag:last-child {
  border-right: none;
}

.grid-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  border-right: 1px dashed rgba(255,255,255,0.05);
  position: relative;
  min-height: 70px;
}
.grid-cell:last-child {
  border-right: none;
}

.matra-num {
  font-size: 0.7rem;
  color: var(--text-sub);
  margin-bottom: 8px;
}

.tali-khali {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 0.65rem;
  color: var(--orange);
  font-weight: 600;
}

.cell-content {
  font-size: 1.1rem;
  color: var(--text-primary);
  min-width: 30px;
  text-align: center;
  padding: 4px;
  outline: none;
  border-radius: 4px;
}
.cell-content:focus {
  background: rgba(255,255,255,0.05);
}

/* Modifiers */
.mod-underline {
  border-bottom: 2px solid var(--text-sub);
  padding-bottom: 2px;
}
.mod-dot-below {
  position: relative;
}
.mod-dot-below::after {
  content: '.';
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  font-weight: bold;
}
"""

target = pathlib.Path(r'c:\Users\Madhu\OneDrive\Desktop\LehraStudio\webapp\style.css')
content = target.read_text(encoding='utf-8')

# Only append if not already there
if "NOTATION STUDIO LAYOUT" not in content:
    target.write_text(content + "\n" + css_code, encoding='utf-8')
    print("Appended Notation Studio CSS.")
else:
    print("CSS already exists.")

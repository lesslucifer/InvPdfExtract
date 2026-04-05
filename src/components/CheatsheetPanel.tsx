import React from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';

interface Props {
  onBack: () => void;
}

export const CheatsheetPanel: React.FC<Props> = ({ onBack }) => {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Back">
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="settings-title">Cheatsheet</span>
      </div>

      {/* Quick Start */}
      <div className="cheatsheet-quickstart">
        <div className="cheatsheet-quickstart-item">
          <kbd>/</kbd> browse files
        </div>
        <div className="cheatsheet-quickstart-item">
          <kbd>#</kbd> search presets
        </div>
        <div className="cheatsheet-quickstart-item">
          <kbd>?</kbd> filter hints
        </div>
      </div>

      <div className="settings-divider" />

      {/* Search Filters */}
      <div className="settings-section">
        <div className="settings-section-label">Search Filters</div>
        <div className="cheatsheet-compact">
          <div className="cheatsheet-group">
            <span className="cheatsheet-group-label">Type</span>
            <code>type:bank</code> <code>type:out</code> <code>type:in</code>
          </div>
          <div className="cheatsheet-group">
            <span className="cheatsheet-group-label">Amount</span>
            <code>&gt;5tr</code> <code>&lt;100k</code> <code>5tr-10tr</code>
            <span className="cheatsheet-note">k=1K &middot; tr/m=1M &middot; t/b=1B</span>
          </div>
          <div className="cheatsheet-group">
            <span className="cheatsheet-group-label">Date</span>
            <code>2024-03</code> <code>2024-03-15</code>
          </div>
          <div className="cheatsheet-group">
            <span className="cheatsheet-group-label">Status</span>
            <code>status:conflict</code> <code>status:review</code>
          </div>
          <div className="cheatsheet-group">
            <span className="cheatsheet-group-label">Sort</span>
            <code>sort:date</code> <code>sort:amount</code> <code>sort:path</code> <code>sort:confidence</code>
            <span className="cheatsheet-note">Add <code>-asc</code> or <code>-desc</code></span>
          </div>
        </div>
        <div className="cheatsheet-hint">Space after a filter converts it to a pill.</div>
      </div>

      <div className="settings-divider" />

      {/* Keyboard Shortcuts */}
      <div className="settings-section">
        <div className="settings-section-label">Keyboard Shortcuts</div>
        <div className="cheatsheet-shortcut-list">
          <div className="cheatsheet-shortcut-row">
            <kbd>⌘D</kbd>
            <span>Save search as preset</span>
          </div>
          <div className="cheatsheet-shortcut-row">
            <kbd>⌘S</kbd>
            <span>Export to XLSX</span>
          </div>
          <div className="cheatsheet-shortcut-row">
            <kbd>↑</kbd> <kbd>↓</kbd>
            <span>Navigate list</span>
          </div>
          <div className="cheatsheet-shortcut-row">
            <kbd>Enter</kbd>
            <span>Expand / collapse, accept suggestion</span>
          </div>
          <div className="cheatsheet-shortcut-row">
            <kbd>Tab</kbd>
            <span>Accept suggestion</span>
          </div>
          <div className="cheatsheet-shortcut-row">
            <kbd>Esc</kbd>
            <span>Cascading close: detail → filters → search → scope → overlay</span>
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      {/* Click Actions */}
      <div className="settings-section">
        <div className="settings-section-label">Click Actions</div>
        <div className="cheatsheet-click-groups">
          <div className="cheatsheet-click-group">
            <span className="cheatsheet-click-modifier">Click</span>
            <span className="cheatsheet-click-desc">doc type icon <em>(toggle filter)</em>, date <em>(filter by date)</em></span>
          </div>
          <div className="cheatsheet-click-group">
            <span className="cheatsheet-click-modifier"><kbd>⌘</kbd>+Click</span>
            <span className="cheatsheet-click-desc">MST <em>(filter by tax code)</em>, date <em>(filter by month)</em>, folder <em>(open in Finder)</em>, filename <em>(open file)</em>, preset <em>(open as window)</em></span>
          </div>
          <div className="cheatsheet-click-group">
            <span className="cheatsheet-click-modifier"><kbd>⌥</kbd>+Click</span>
            <span className="cheatsheet-click-desc">folder <em>(reprocess folder)</em>, filename <em>(reprocess file)</em></span>
          </div>
        </div>
        <div className="cheatsheet-hint">Same modifiers apply in path browser: click = set scope, ⌘ = open in Finder, ⌥ = reprocess</div>
      </div>
    </div>
  );
};

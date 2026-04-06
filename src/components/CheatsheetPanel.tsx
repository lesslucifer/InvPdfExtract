import React from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useOverlayStore } from '../stores';

const kbdClass = 'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 font-mono text-2.75 font-semibold text-text bg-bg-hover border border-border rounded-sm';
const sectionLabelClass = 'text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5';
const dividerClass = 'h-[1px] bg-border mx-4 my-1';
const groupLabelClass = 'text-2.5 font-semibold text-text-secondary uppercase tracking-[0.5px] min-w-[48px]';
const clickModifierClass = 'shrink-0 min-w-[72px] font-semibold text-text flex items-baseline gap-0.5';
const clickKbdClass = 'inline-flex items-center justify-center min-w-[16px] h-4 px-[3px] font-mono text-2.5 font-medium text-text bg-bg-hover border border-border rounded-sm';

export const CheatsheetPanel: React.FC = () => {
  const goBack = useOverlayStore(s => s.goBack);
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-bg z-[1]">
        <button
          className="bg-transparent border-none text-text-secondary cursor-pointer px-1.5 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-hover"
          onClick={goBack}
          aria-label="Back"
        >
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="text-3.5 font-semibold">Cheatsheet</span>
      </div>

      <div className="flex gap-3 px-4 py-2.5 justify-center">
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>/</kbd> browse files</div>
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>#</kbd> search presets</div>
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>?</kbd> filter hints</div>
      </div>

      <div className={dividerClass} />

      <div className="px-4 py-2.5">
        <div className={sectionLabelClass}>Search Filters</div>
        <div className="flex flex-col gap-1.5 cheatsheet-compact">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>Type</span>
            <code>type:bank</code> <code>type:out</code> <code>type:in</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>Amount</span>
            <code>&gt;5tr</code> <code>&lt;100k</code> <code>5tr-10tr</code>
            <span className="cheatsheet-note text-2.5 text-text-secondary">k=1K &middot; tr/m=1M &middot; t/b=1B</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>Date</span>
            <code>2024-03</code> <code>2024-03-15</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>MST</span>
            <code>mst:0123456789</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>Status</span>
            <code>status:conflict</code> <code>status:review</code> <code>status:mismatch</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>Sort</span>
            <code>sort:date</code> <code>sort:amount</code> <code>sort:path</code> <code>sort:time</code> <code>sort:confidence</code> <code>sort:shd</code>
            <span className="cheatsheet-note text-2.5 text-text-secondary">Add <code>-asc</code> or <code>-desc</code></span>
          </div>
        </div>
        <div className="mt-2 text-2.75 text-text-secondary italic">Space after a filter converts it to a pill.</div>
      </div>

      <div className={dividerClass} />

      <div className="px-4 py-2.5">
        <div className={sectionLabelClass}>Keyboard Shortcuts</div>
        <div className="flex flex-col gap-[5px]">
          {[
            { keys: ['⌘D'], desc: 'Save search as preset' },
            { keys: ['⌘S'], desc: 'Export to XLSX' },
            { keys: ['↑', '↓'], desc: 'Navigate list' },
            { keys: ['Enter'], desc: 'Expand / collapse, accept suggestion' },
            { keys: ['Tab'], desc: 'Accept suggestion' },
            { keys: ['Esc'], desc: 'Cascading close: detail → filters → search → scope → overlay' },
          ].map(({ keys, desc }) => (
            <div key={desc} className="flex items-baseline gap-2 text-2.75 text-text">
              {keys.map(k => <kbd key={k} className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-[5px] font-mono text-2.5 font-medium text-text bg-bg-hover border border-border rounded-sm whitespace-nowrap`}>{k}</kbd>)}
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={dividerClass} />

      <div className="px-4 py-2.5">
        <div className={sectionLabelClass}>Click Actions</div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}>Click</span>
            <span className="text-text">doc type icon <em className="text-text-secondary not-italic">(toggle filter)</em></span>
          </div>
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}><kbd className={clickKbdClass}>⌘</kbd>+Click</span>
            <span className="text-text">date <em className="text-text-secondary not-italic">(filter by date)</em>, MST <em className="text-text-secondary not-italic">(filter by tax code)</em>, folder <em className="text-text-secondary not-italic">(open in Finder)</em>, filename <em className="text-text-secondary not-italic">(open file)</em>, preset <em className="text-text-secondary not-italic">(open as window)</em></span>
          </div>
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}><kbd className={clickKbdClass}>⌥</kbd>+Click</span>
            <span className="text-text">date <em className="text-text-secondary not-italic">(filter by month)</em>, folder <em className="text-text-secondary not-italic">(reprocess folder)</em>, filename <em className="text-text-secondary not-italic">(reprocess file)</em></span>
          </div>
        </div>
        <div className="mt-2 text-2.75 text-text-secondary italic">Same modifiers apply in path browser: click = set scope, ⌘ = open in Finder, ⌥ = reprocess</div>
      </div>
    </div>
  );
};

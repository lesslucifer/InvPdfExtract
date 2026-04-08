import { t } from '../lib/i18n';
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
          aria-label={t('back', 'Back')}
        >
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="text-3.5 font-semibold">{t('cheatsheet', 'Cheatsheet')}</span>
      </div>

      <div className="flex gap-3 px-4 py-2.5 justify-center">
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>/</kbd>{` ${t('browse_files', 'browse files')}`}</div>
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>#</kbd>{` ${t('search_presets', 'search presets')}`}</div>
        <div className="text-2.75 text-text flex items-center gap-1.5"><kbd className={kbdClass}>?</kbd>{` ${t('filter_hints', 'filter hints')}`}</div>
      </div>

      <div className={dividerClass} />

      <div className="px-4 py-2.5">
        <div className={sectionLabelClass}>{t('search_filters', 'Search Filters')}</div>
        <div className="flex flex-col gap-1.5 cheatsheet-compact">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('type', 'Type')}</span>
            <code>{t('typebank', 'type:bank')}</code> <code>{t('typeout', 'type:out')}</code> <code>{t('typein', 'type:in')}</code> <code>{t('typeinv', 'type:inv')}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('amount', 'Amount')}</span>
            <code>{`>5${t('tr', 'tr')}`}</code> <code>{`<100${t('k', 'k')}`}</code> <code>{`5${t('tr10tr', 'tr-10tr')}`}</code>
            <span className="cheatsheet-note text-2.5 text-text-secondary">{t('k1k_trm1m_tb1b', 'k=1K · tr/m=1M · t/b=1B')}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('date', 'Date')}</span>
            <code>2024-03</code> <code>2024-03-15</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('taxId', 'TaxID')}</span>
            <code>{`${t('taxId', 'taxId')}:0123456789`}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('invoice_code', 'Invoice Code')}</span>
            <code>{t('invoice_code_filter_example', 'code:C26TAA')}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('status', 'Status')}</span>
            <code>{t('statusconflict', 'status:conflict')}</code> <code>{t('statusreview', 'status:review')}</code> <code>{t('statusmismatch', 'status:mismatch')}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75">
            <span className={groupLabelClass}>{t('sort', 'Sort')}</span>
            <code>{t('sortdate', 'sort:date')}</code> <code>{t('sortamount', 'sort:amount')}</code> <code>{t('sortpath', 'sort:path')}</code> <code>{t('sorttime', 'sort:time')}</code> <code>{t('sortconfidence', 'sort:confidence')}</code> <code>{t('sortshd', 'sort:shd')}</code>
            <span className="cheatsheet-note text-2.5 text-text-secondary">{`${t('add', 'Add')} `}<code>{`-${t('asc', 'asc')}`}</code>{` ${t('or', 'or')} `}<code>{`-${t('desc', 'desc')}`}</code></span>
          </div>
        </div>
        <div className="mt-2 text-2.75 text-text-secondary italic">{`${t('space_after_a_filter_converts_it_to_a_pill', 'Space after a filter converts it to a pill')}.`}</div>
      </div>

      <div className={dividerClass} />

      <div className="px-4 py-2.5">
        <div className={sectionLabelClass}>{t('keyboard_shortcuts', 'Keyboard Shortcuts')}</div>
        <div className="flex flex-col gap-[5px]">
          {[
            { keys: ['⌘D'], desc: t('shortcut_save_preset', 'Save search as preset') },
            { keys: ['⌘S'], desc: t('shortcut_export', 'Export to XLSX') },
            { keys: ['↑', '↓'], desc: t('shortcut_navigate', 'Navigate list') },
            { keys: ['Enter'], desc: t('shortcut_expand_collapse', 'Expand / collapse, accept suggestion') },
            { keys: ['Tab'], desc: t('shortcut_accept_suggestion', 'Accept suggestion') },
            { keys: ['Esc'], desc: t('shortcut_esc', 'Cascading close: detail → filters → search → scope → overlay') },
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
        <div className={sectionLabelClass}>{t('click_actions', 'Click Actions')}</div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}>{t('click', 'Click')}</span>
            <span className="text-text">{`${t('doc_type_icon', 'doc type icon')} `}<em className="text-text-secondary not-italic">{`(${t('toggle_filter', 'toggle filter')})`}</em></span>
          </div>
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}><kbd className={clickKbdClass}>⌘</kbd>{`+${t('click', 'Click')}`}</span>
            <span className="text-text">{`${t('date', 'date')} `}<em className="text-text-secondary not-italic">{`(${t('filter_by_date', 'filter by date')})`}</em>{`, ${t('taxId', 'TaxID')} `}<em className="text-text-secondary not-italic">{`(${t('filter_by_tax_code', 'filter by tax code')})`}</em>{`, ${t('invoice_code', 'Invoice Code')} `}<em className="text-text-secondary not-italic">{`(${t('filter', 'filter')})`}</em>{`, ${t('invoice_number', 'Invoice #')} `}<em className="text-text-secondary not-italic">{`(${t('sort', 'sort')})`}</em>{`, ${t('folder', 'folder')} `}<em className="text-text-secondary not-italic">{`(${t('open_in_finder', 'open in Finder')})`}</em>{`, ${t('filename', 'filename')} `}<em className="text-text-secondary not-italic">{`(${t('open_file', 'open file')})`}</em>{`, ${t('preset', 'preset')} `}<em className="text-text-secondary not-italic">{`(${t('open_as_window', 'open as window')})`}</em></span>
          </div>
          <div className="flex gap-2 text-2.75 items-baseline">
            <span className={clickModifierClass}><kbd className={clickKbdClass}>⌥</kbd>{`+${t('click', 'Click')}`}</span>
            <span className="text-text">{`${t('date', 'date')} `}<em className="text-text-secondary not-italic">{`(${t('filter_by_month', 'filter by month')})`}</em>{`, ${t('folder', 'folder')} `}<em className="text-text-secondary not-italic">{`(${t('reprocess_folder', 'reprocess folder')})`}</em>{`, ${t('filename', 'filename')} `}<em className="text-text-secondary not-italic">{`(${t('reprocess_file', 'reprocess file')})`}</em></span>
          </div>
        </div>
        <div className="mt-2 text-2.75 text-text-secondary italic">{t('same_modifiers_apply_in_path_browser_click_set_scope_open_in_finder_reprocess', 'Same modifiers apply in path browser: click = set scope, ⌘ = locate in Finder, ⌥ = reprocess')}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2.75 cheatsheet-compact">
          <span className={groupLabelClass}>{t('path_status_filter_label', '/:status')}</span>
          <code>{t('path_filter_error', '/:error')}</code> <code>{t('path_filter_done', '/:done')}</code> <code>{t('path_filter_review', '/:review')}</code> <code>{t('path_filter_pending', '/:pending')}</code> <code>{t('path_filter_skipped', '/:skipped')}</code>
          <span className="cheatsheet-note text-2.5 text-text-secondary">{t('path_status_filter_hint', 'filter files by processing status in path browser')}</span>
        </div>
      </div>

    </div>
  );
};

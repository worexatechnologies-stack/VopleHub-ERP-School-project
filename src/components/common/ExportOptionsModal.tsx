import { Download, X } from 'lucide-react';

export interface ExportChoice {
  key: string;
  label: string;
}

interface ExportOptionsModalProps {
  title: string;
  description: string;
  choices: ExportChoice[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  scope: 'all' | 'filtered';
  onScopeChange: (scope: 'all' | 'filtered') => void;
  filteredDescription: string;
  busy?: boolean;
  onClose: () => void;
  onExport: () => void;
}

export default function ExportOptionsModal({
  title,
  description,
  choices,
  selectedKeys,
  onToggle,
  scope,
  onScopeChange,
  filteredDescription,
  busy = false,
  onClose,
  onExport,
}: ExportOptionsModalProps) {
  const allSelected = choices.length > 0 && selectedKeys.length === choices.length;

  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="export-options-title" className="max-h-[90dvh] w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
          <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Excel export</p><h2 id="export-options-title" className="mt-1 text-xl font-black text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Close export options" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[calc(90dvh-150px)] space-y-5 overflow-y-auto p-5 sm:p-6">
          <fieldset className="space-y-2"><legend className="mb-2 text-sm font-black text-slate-800">Which records?</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-3 hover:border-indigo-300"><input type="radio" name="export-scope" checked={scope === 'all'} onChange={() => onScopeChange('all')} className="mt-1" /><span><strong className="block text-sm text-slate-800">All records</strong><span className="text-xs text-slate-500">Export every record you are allowed to view.</span></span></label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-3 hover:border-indigo-300"><input type="radio" name="export-scope" checked={scope === 'filtered'} onChange={() => onScopeChange('filtered')} className="mt-1" /><span><strong className="block text-sm text-slate-800">Current filters</strong><span className="text-xs text-slate-500">{filteredDescription}</span></span></label>
          </fieldset>
          <fieldset><div className="mb-2 flex items-center justify-between gap-3"><legend className="text-sm font-black text-slate-800">What should be included?</legend><button type="button" onClick={() => choices.forEach((choice) => { if (allSelected === selectedKeys.includes(choice.key)) onToggle(choice.key); })} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">{allSelected ? 'Clear all' : 'Select all'}</button></div>
            <div className="grid gap-2 sm:grid-cols-2">{choices.map((choice) => <label key={choice.key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-indigo-300"><input type="checkbox" checked={selectedKeys.includes(choice.key)} onChange={() => onToggle(choice.key)} />{choice.label}</label>)}</div>
          </fieldset>
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:justify-end sm:p-5"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button><button type="button" disabled={busy || selectedKeys.length === 0} onClick={onExport} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />{busy ? 'Preparing your file…' : 'Download Excel'}</button></footer>
      </section>
    </div>
  );
}

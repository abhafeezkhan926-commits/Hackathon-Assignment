import React from 'react';
import { createPortal } from 'react-dom';
import { X, LoaderCircle, Search, ChevronDown, AlertCircle, CheckCircle2, Info } from 'lucide-react';

export function Button({ children, variant='primary', size='md', loading=false, disabled=false, block=false, className='', ...props }) {
  return <button className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${className}`} disabled={disabled || loading} {...props}>{loading ? <LoaderCircle size={16} className="spin" /> : null}{children}</button>;
}
export function InputField({ label, error, hint, className='', ...props }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span><input className={`input ${error ? 'input-error' : ''}`} {...props} />{error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}</label>;
}
export function SelectField({ label, error, children, ...props }) {
  return <label className="field"><span className="field-label">{label}</span><span className="select-wrap"><select className={`input select ${error ? 'input-error' : ''}`} {...props}>{children}</select><ChevronDown size={15}/></span>{error ? <span className="field-error">{error}</span> : null}</label>;
}
export function TextAreaField({ label, error, ...props }) {
  return <label className="field"><span className="field-label">{label}</span><textarea className={`input textarea ${error ? 'input-error' : ''}`} {...props}/>{error ? <span className="field-error">{error}</span> : null}</label>;
}
export function Modal({ title, subtitle, onClose, children, size='md' }) {
  React.useEffect(() => { const fn = (e) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', fn); document.body.style.overflow='hidden'; return () => { window.removeEventListener('keydown',fn); document.body.style.overflow=''; }; }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&onClose?.()}><section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button modal-close-button" type="button" aria-label="Close" title="Close" onClick={onClose}><X size={19}/></button></header><div className="modal-body">{children}</div></section></div>,
    document.body
  );
}
export function Toast({ toast, onDismiss }) {
  React.useEffect(() => { if (!toast) return; const timer=setTimeout(onDismiss, 4400); return()=>clearTimeout(timer); },[toast,onDismiss]);
  if (!toast) return null;
  const Icon=toast.type==='error'?AlertCircle:toast.type==='success'?CheckCircle2:Info;
  return <div className={`toast toast-${toast.type||'info'}`} role="status"><Icon size={18}/><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={onDismiss}><X size={15}/></button></div>;
}
export function SearchBox({ value, onChange, placeholder='Search records...' }) {
  return <div className="search-box"><Search size={16}/><input aria-label={placeholder} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></div>;
}
export function Avatar({ user, size='md' }) {
  const name=user?.profile?.fullName||user?.fullName||user?.username||'User';
  const initials=name.trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
  return user?.profile?.avatarUrl ? <img className={`avatar avatar-${size}`} src={user.profile.avatarUrl} alt={`${name} profile`} /> : <span className={`avatar avatar-${size} avatar-fallback`}>{initials||'U'}</span>;
}
export function StatusPill({ status }) {
  const value=String(status||'unknown').replaceAll('_',' '); const cls=String(status||'').toLowerCase().replaceAll('_','-');
  return <span className={`status-pill status-${cls}`}>{value}</span>;
}
export function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon">{Icon ? <Icon size={24}/> : <Info size={24}/>}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function StatCard({ label, value, change, icon: Icon, tone='teal', note }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon tone-${tone}`}>{Icon ? <Icon size={19}/> : null}</span></div><div className="stat-value">{value ?? '—'}</div>{change ? <div className="stat-change">{change}</div> : note ? <div className="stat-note">{note}</div> : <div className="stat-note">Based on saved records</div>}</article>;
}
export function PageHeader({ eyebrow, title, description, actions }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-actions">{actions}</div> : null}</div>;
}
export function SpinnerPage({ label='Loading your workspace…' }) { return <div className="spinner-page"><LoaderCircle size={24} className="spin"/><p>{label}</p></div>; }
export function ErrorBanner({ message, onRetry }) { return <div className="error-banner"><AlertCircle size={18}/><span>{message}</span>{onRetry ? <button onClick={onRetry}>Try again</button> : null}</div>; }
export function Table({ columns, rows, emptyTitle='Nothing here yet', emptyDescription='Records will appear here when they are added.', rowKey, loading=false }) {
  if (loading) return <div className="table-skeleton"><div/><div/><div/><div/><div/></div>;
  if (!rows?.length) return <EmptyState title={emptyTitle} description={emptyDescription}/>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c.key} className={c.align==='right'?'text-right':''}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={rowKey ? rowKey(row) : row._id||row.id||i}>{columns.map(c=><td key={c.key} className={c.align==='right'?'text-right':''}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}

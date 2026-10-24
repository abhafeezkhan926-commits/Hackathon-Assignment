import React from 'react';
import {
  ArrowRight, Bell, BookOpenText, CalendarDays, CheckCheck, Clock3, CreditCard,
  LoaderCircle
} from 'lucide-react';
import { api } from './lib/api.js';
import { createRealtimeConnection } from './lib/socket.js';
import { Button, EmptyState, Modal } from './components.jsx';

const TYPE_META = {
  announcement: { icon: BookOpenText, className: 'notification-type-announcement' },
  payslip_available: { icon: CreditCard, className: 'notification-type-payslip' },
  leave_decision: { icon: CalendarDays, className: 'notification-type-leave' },
  attendance_correction: { icon: Clock3, className: 'notification-type-attendance' },
  default: { icon: Bell, className: 'notification-type-default' }
};

function relativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function NotificationRow({ item, onOpen, compact = false }) {
  const meta = TYPE_META[item.type] || TYPE_META.default;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className={`notification-item ${item.readAt ? 'is-read' : 'is-unread'} ${compact ? 'is-compact' : ''}`}
      onClick={() => onOpen(item)}
      aria-label={`${item.title}${item.readAt ? '' : ', unread'}`}
      title={item.message || item.title}
    >
      <span className={`notification-type ${meta.className}`} aria-hidden="true"><Icon size={compact ? 15 : 17} /></span>
      <span className="notification-copy">
        <span className="notification-item-title">
          {item.title}
          {!item.readAt ? <i className="notification-unread-dot" aria-hidden="true" /> : null}
        </span>
        {item.message ? <span className="notification-item-message">{item.message}</span> : null}
        <span className="notification-item-time">{relativeTime(item.createdAt)}</span>
      </span>
      <ArrowRight size={14} className="notification-arrow" aria-hidden="true" />
    </button>
  );
}

export function NotificationCenter({ user, onNavigate, showToast }) {
  const [items, setItems] = React.useState([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [viewAll, setViewAll] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [markingAll, setMarkingAll] = React.useState(false);
  const centerRef = React.useRef(null);
  const itemsRef = React.useRef([]);

  React.useEffect(() => { itemsRef.current = items; }, [items]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api('/notifications?limit=100');
      const nextItems = result.items || [];
      setItems(nextItems);
      setUnread(Number.isFinite(result.unread) ? result.unread : nextItems.filter(item => !item.readAt).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setItems([]);
    setUnread(0);
    setOpen(false);
    setViewAll(false);
    load();
  }, [user?.id, load]);

  React.useEffect(() => {
    if (!user?.id) return undefined;
    const socket = createRealtimeConnection();

    const onNew = notification => {
      if (!notification?._id) return;
      if (itemsRef.current.some(item => item._id === notification._id)) return;
      setItems(old => [notification, ...old].slice(0, 100));
      setUnread(count => count + 1);
      showToast(notification.title || 'New notification', 'info');
    };

    const onRead = payload => {
      if (!payload?.id) return;
      const target = itemsRef.current.find(item => item._id === payload.id);
      if (!target || target.readAt) return;
      setItems(old => old.map(item => item._id === payload.id ? { ...item, readAt: payload.readAt || new Date().toISOString() } : item));
      setUnread(count => Math.max(0, count - 1));
    };

    const onReadAll = () => {
      const now = new Date().toISOString();
      setItems(old => old.map(item => item.readAt ? item : { ...item, readAt: now }));
      setUnread(0);
    };

    const onReconnect = () => load();

    socket.on('notification:new', onNew);
    socket.on('notification:read', onRead);
    socket.on('notifications:read-all', onReadAll);
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off('notification:new', onNew);
      socket.off('notification:read', onRead);
      socket.off('notifications:read-all', onReadAll);
      socket.io.off('reconnect', onReconnect);
      socket.disconnect();
    };
  }, [user?.id, load, showToast]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handlePointer = event => {
      if (centerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKey = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  async function markRead(item) {
    if (!item || item.readAt) return;
    const readAt = new Date().toISOString();
    setItems(old => old.map(entry => entry._id === item._id ? { ...entry, readAt } : entry));
    setUnread(count => Math.max(0, count - 1));
    try {
      await api(`/notifications/${item._id}/read`, { method: 'PATCH', body: {} });
    } catch (err) {
      setItems(old => old.map(entry => entry._id === item._id ? { ...entry, readAt: null } : entry));
      setUnread(count => count + 1);
      showToast(err.message, 'error');
    }
  }

  async function markAllRead() {
    if (!unread || markingAll) return;
    const previous = itemsRef.current;
    setMarkingAll(true);
    setItems(old => old.map(item => item.readAt ? item : { ...item, readAt: new Date().toISOString() }));
    setUnread(0);
    try {
      await api('/notifications/read-all', { method: 'PATCH', body: {} });
      showToast('All notifications marked as read.');
    } catch (err) {
      setItems(previous);
      setUnread(previous.filter(item => !item.readAt).length);
      showToast(err.message, 'error');
    } finally {
      setMarkingAll(false);
    }
  }

  function openItem(item) {
    if (!item.readAt) markRead(item);
    const target = String(item.link || '').replace(/^\/+/, '');
    if (target) onNavigate(target);
    setOpen(false);
    setViewAll(false);
  }

  const latest = items.slice(0, 2);
  return (
    <div className="notification-center" ref={centerRef}>
      <button
        type="button"
        className={`icon-button notification-button ${open ? 'is-active' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 ? <span className="notification-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="notification-popover" role="dialog" aria-label="Latest notifications">
          <div className="notification-popover-head">
            <div>
              <strong>Notifications</strong>
              <span>{unread ? `${unread} unread` : 'All caught up'}</span>
            </div>
            {unread ? <button type="button" className="text-action" onClick={markAllRead} disabled={markingAll}>{markingAll ? 'Saving…' : 'Mark all read'}</button> : null}
          </div>
          {error ? <div className="notification-error"><span>{error}</span><button type="button" onClick={() => load()}>Retry</button></div> : null}
          {loading && !items.length ? <div className="notification-loading"><LoaderCircle size={18} className="spin" /><span>Loading notifications…</span></div> : latest.length ? (
            <div className="notification-preview-list">
              {latest.map(item => <NotificationRow key={item._id} item={item} onOpen={openItem} compact />)}
            </div>
          ) : (
            <div className="notification-empty">
              <span><Bell size={19} /></span>
              <strong>No notifications yet</strong>
              <p>Announcements, payslips and leave updates will appear here.</p>
            </div>
          )}
          <button type="button" className="notification-view-all" onClick={() => { setOpen(false); setViewAll(true); }}>
            View all notifications <ArrowRight size={14} />
          </button>
        </div>
      ) : null}

      {viewAll ? (
        <Modal title="All notifications" subtitle="Everything sent to your account, newest first." onClose={() => setViewAll(false)} size="lg">
          <div className="notification-all">
            <div className="notification-all-toolbar">
              <div><strong>{unread ? `${unread} unread` : 'All caught up'}</strong><span>{items.length} recent notification{items.length === 1 ? '' : 's'}</span></div>
              {unread ? <Button size="sm" variant="secondary" onClick={markAllRead} loading={markingAll}><CheckCheck size={14} /> Mark all read</Button> : null}
            </div>
            {error ? <div className="notification-error"><span>{error}</span><button type="button" onClick={() => load()}>Retry</button></div> : null}
            {loading && !items.length ? <div className="notification-loading"><LoaderCircle size={18} className="spin" /><span>Loading notifications…</span></div> : items.length ? (
              <div className="notification-all-list">
                {items.map(item => <NotificationRow key={item._id} item={item} onOpen={openItem} />)}
              </div>
            ) : <EmptyState icon={Bell} title="No notifications yet" description="Announcements, payslip availability and leave decisions will appear here." />}
            <div className="notification-all-foot">Notifications stay saved to your account and update automatically.</div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

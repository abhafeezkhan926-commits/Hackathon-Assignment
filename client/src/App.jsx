import React from 'react';
import {
  Activity, ArrowUpRight, BookOpenText, CalendarDays, CheckCircle2, ChevronDown,
  ClipboardCheck, Clock3, CreditCard, FileClock, Gauge, HeartHandshake, LogOut, Menu,
  MessageCircle, Moon, PanelLeftClose, PanelLeftOpen, Radio, Settings2, ShieldCheck, Sun, Users, UserRound, UserCog, X
} from 'lucide-react';
import { api } from './lib/api.js';
import { Avatar, Button, InputField, Toast, SpinnerPage } from './components.jsx';
import { NotificationCenter } from './notifications.jsx';
import { PageContent } from './pages.jsx';

const NAV = {
  admin: [
    { id: 'dashboard', label: 'Overview', icon: Gauge, section: 'WORKSPACE' },
    { id: 'employees', label: 'People directory', icon: Users },
    { id: 'users', label: 'Access management', icon: UserCog },
    { id: 'attendance', label: 'Attendance', icon: Clock3, section: 'PEOPLE OPERATIONS' },
    { id: 'leave', label: 'Leave management', icon: CalendarDays },
    { id: 'payroll', label: 'Payroll', icon: CreditCard },
    { id: 'announcements', label: 'Announcements', icon: BookOpenText, section: 'COMMUNICATION' },
    { id: 'live', label: 'Live meetings', icon: Radio },
    { id: 'ai', label: 'AI assistant', icon: MessageCircle },
    { id: 'organization', label: 'Organization settings', icon: Settings2, section: 'ADMINISTRATION' },
    { id: 'audit', label: 'Audit trail', icon: ShieldCheck },
    { id: 'profile', label: 'My profile', icon: UserRound, section: 'ACCOUNT' }
  ],
  hr: [
    { id: 'dashboard', label: 'Overview', icon: Gauge, section: 'WORKSPACE' },
    { id: 'employees', label: 'People directory', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: Clock3, section: 'PEOPLE OPERATIONS' },
    { id: 'leave', label: 'Leave management', icon: CalendarDays },
    { id: 'payroll', label: 'Payroll drafts', icon: CreditCard },
    { id: 'announcements', label: 'Announcements', icon: BookOpenText, section: 'COMMUNICATION' },
    { id: 'live', label: 'Live meetings', icon: Radio },
    { id: 'ai', label: 'AI assistant', icon: MessageCircle },
    { id: 'profile', label: 'My profile', icon: UserRound, section: 'ACCOUNT' }
  ],
  employee: [
    { id: 'dashboard', label: 'My overview', icon: Gauge, section: 'WORKSPACE' },
    { id: 'attendance', label: 'My attendance', icon: Clock3 },
    { id: 'leave', label: 'My leave', icon: CalendarDays },
    { id: 'payroll', label: 'My payslips', icon: CreditCard },
    { id: 'announcements', label: 'Announcements', icon: BookOpenText, section: 'COMMUNICATION' },
    { id: 'ai', label: 'AI assistant', icon: MessageCircle },
    { id: 'profile', label: 'My profile', icon: UserRound, section: 'ACCOUNT' }
  ]
};

export default function App() {
  const [phase, setPhase] = React.useState('checking');
  const [user, setUser] = React.useState(null);
  const [page, setPage] = React.useState('dashboard');
  const [toast, setToast] = React.useState(null);
  const [mustChangePassword, setMustChangePassword] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => localStorage.getItem('hcm-sidebar') === 'collapsed');
  const [liveSession, setLiveSession] = React.useState(null);

  React.useEffect(() => { localStorage.setItem('hcm-sidebar', sidebarCollapsed ? 'collapsed' : 'expanded'); }, [sidebarCollapsed]);

  React.useEffect(() => {
    if (!user || !['admin', 'hr'].includes(user.role)) { setLiveSession(null); return; }
    let active = true;
    const check = async () => {
      try { const result = await api('/live/sessions/live'); if (active) setLiveSession(result.session || null); }
      catch {}
    };
    check();
    const timer = setInterval(check, 20000);
    const refresh = () => check();
    window.addEventListener('hcm-live-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false; clearInterval(timer);
      window.removeEventListener('hcm-live-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [user?.id, user?.role]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await api('/setup/status');
        if (!active) return;
        if (!status.initialized) { setPhase('setup'); return; }
        try {
          const session = await api('/auth/me');
          if (!active) return;
          setUser(session.user); setMustChangePassword(Boolean(session.mustChangePassword)); setPhase('app');
        } catch { if (active) setPhase('login'); }
      } catch (error) { if (active) { setPhase('unavailable'); setToast({ type: 'error', message: error.message }); } }
    })();
    return () => { active = false; };
  }, []);

  const showToast = React.useCallback((message, type='success') => setToast({ message, type, id: Date.now() }), []);
  const handleLogin = async (identifier, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { identifier, password } });
    setUser(result.user); setMustChangePassword(Boolean(result.mustChangePassword)); setPhase('app'); setPage('dashboard');
    showToast(`Welcome back, ${result.user.profile?.fullName || result.user.username}.`);
  };
  const handleSetup = async (form) => {
    await api('/setup/initialize', { method: 'POST', body: form });
    showToast('Company workspace initialized. Sign in with your new Admin account.'); setPhase('login');
  };
  const handleLogout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setUser(null); setMustChangePassword(false); setPage('dashboard'); setPhase('login'); showToast('You have been signed out.');
  };
  const handleUserUpdate = (nextUser) => setUser(current => ({ ...current, ...nextUser, profile: { ...(current?.profile || {}), ...(nextUser?.profile || {}) } }));

  if (phase === 'checking') return <SpinnerPage label="Preparing your secure workspace…" />;
  if (phase === 'unavailable') return <div className="auth-screen"><ThemeToggle/><div className="auth-card"><BrandMark/><h1>We can't reach HCM Lite</h1><p>Check that MongoDB is connected and the API server is running, then reload this page.</p><Button onClick={() => window.location.reload()}>Try again <ArrowUpRight size={15}/></Button><Toast toast={toast} onDismiss={() => setToast(null)}/></div></div>;
  if (phase === 'setup') return <SetupScreen onSubmit={handleSetup} toast={toast} setToast={setToast} />;
  if (phase === 'login') return <LoginScreen onSubmit={handleLogin} toast={toast} setToast={setToast} />;

  const navItems = NAV[user?.role] || NAV.employee;
  const currentNav = navItems.find(item => item.id === page) || navItems[0];
  return <div className={`app-shell ${mobileNav ? 'mobile-nav-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandMark compact/><button className="sidebar-close icon-button" aria-label="Close menu" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-chip"><span className="workspace-dot"/><div><strong>People workspace</strong><small>{user?.role === 'admin' ? 'Full access' : user?.role === 'hr' ? 'HR operations' : 'Self-service'}</small></div><ChevronDown size={14}/></div>
      <nav className="side-nav" aria-label="Main navigation">
        {navItems.map((item, index) => <React.Fragment key={item.id}>
          {item.section ? <div className={`nav-section ${index === 0 ? 'nav-section-first' : ''}`}>{item.section}</div> : null}
          <button className={`nav-link ${page === item.id ? 'active' : ''}`} title={item.label} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={17}/><span>{item.label}</span>{item.id === 'leave' ? <span className="nav-activity"/> : null}{item.id === 'live' && liveSession ? <span className="nav-live-dot"/> : null}</button>
        </React.Fragment>)}
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><HeartHandshake size={17}/></span><strong>People first, always.</strong><p>Keep your team informed and supported.</p><button onClick={() => { setPage('ai'); setMobileNav(false); }}>Ask the assistant <ArrowUpRight size={13}/></button></div>
        <div className="sidebar-user"><Avatar user={user}/><div className="sidebar-user-copy"><strong>{user?.profile?.fullName || user?.username}</strong><span>{roleLabel(user?.role)}</span></div><button className="icon-button logout-button" onClick={handleLogout} aria-label="Sign out" title="Sign out"><LogOut size={16}/></button></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20}/></button><button className="sidebar-toggle icon-button" type="button" onClick={() => setSidebarCollapsed(value => !value)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button><div className="breadcrumb"><span>HCM Lite</span><span className="crumb-slash">/</span><strong>{currentNav.label}</strong></div></div><div className="topbar-right">{liveSession ? <button className="live-topbar-pill" type="button" onClick={() => { setPage('live'); setMobileNav(false); }} title={`Live now: ${liveSession.title}`}><span className="live-dot"/><span className="live-pill-copy"><small>LIVE NOW</small><strong>{liveSession.title}</strong></span><Radio size={15}/></button> : null}<ThemeToggle/><span className="system-status"><span/>All systems operational</span><div className="topbar-divider"/><NotificationCenter user={user} onNavigate={setPage} showToast={showToast}/><button className="topbar-profile" onClick={() => setPage('profile')}><Avatar user={user} size="sm"/><span><strong>{user?.profile?.fullName || user?.username}</strong><small>{roleLabel(user?.role)}</small></span><ChevronDown size={14}/></button></div></header>
      <main className="page-content" key={page}>
        {mustChangePassword ? <ChangePassword user={user} onComplete={(nextUser) => { handleUserUpdate(nextUser); setMustChangePassword(false); showToast('Your password has been updated.'); }} showToast={showToast}/> : <PageContent page={page} user={user} onUserUpdate={handleUserUpdate} onNavigate={setPage} showToast={showToast}/>}
      </main>
      <footer className="app-footer"><span>© {new Date().getFullYear()} HCM Lite</span><span>People operations, thoughtfully organized <span className="footer-dot">·</span> <strong>{roleLabel(user?.role)}</strong> workspace</span></footer>
    </div>
    {mobileNav ? <button className="mobile-nav-scrim" aria-label="Close navigation overlay" onClick={() => setMobileNav(false)}/> : null}
    <Toast toast={toast} onDismiss={() => setToast(null)}/>
  </div>;
}

function BrandMark({ compact=false }) { return <div className={`brand-mark ${compact?'brand-compact':''}`}><span className="brand-symbol"><Activity size={20} strokeWidth={2.6}/></span>{!compact ? <span className="brand-text">HCM<span>Lite</span></span> : <span className="brand-text">HCM<span>Lite</span></span>}</div>; }
function roleLabel(role) { return role === 'admin' ? 'Administrator' : role === 'hr' ? 'Human resources' : 'Employee self-service'; }
function ThemeToggle() {
  const [theme, setTheme] = React.useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  React.useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('hcm-theme', theme); }, [theme]);
  const dark = theme === 'dark';
  return <button type="button" className="icon-button theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}

function LoginScreen({ onSubmit, toast, setToast }) {
  const [identifier,setIdentifier]=React.useState('');const [password,setPassword]=React.useState('');const [show,setShow]=React.useState(false);const [loading,setLoading]=React.useState(false);const [error,setError]=React.useState('');
  async function submit(e){e.preventDefault();setError('');if(!identifier.trim()||!password){setError('Enter your email or username and password.');return;}setLoading(true);try{await onSubmit(identifier.trim(),password);}catch(err){setError(err.message);}finally{setLoading(false);}}
  return <div className="auth-screen"><ThemeToggle/><div className="auth-decoration decor-one"/><div className="auth-decoration decor-two"/><section className="auth-layout"><div className="auth-story"><BrandMark/><div className="story-copy"><div className="eyebrow light-eyebrow">HUMAN CAPITAL MANAGEMENT</div><h1>Good work starts<br/>with <em>good people.</em></h1><p>A calmer place to manage your people, support their growth, and keep the everyday work moving.</p><div className="story-points"><div><span><Users size={18}/></span><div><strong>One people directory</strong><small>Profiles, teams and roles in one place</small></div></div><div><span><ClipboardCheck size={18}/></span><div><strong>Clear people operations</strong><small>Attendance, leave and payroll workflows</small></div></div></div></div><div className="story-footer"><span className="story-avatar-stack"><i>H</i><i>R</i><i>+</i></span><span>Designed for teams doing meaningful work.</span></div></div><div className="auth-form-wrap"><div className="auth-form-card"><div className="auth-form-heading"><span className="auth-mini-icon"><ShieldCheck size={20}/></span><div className="eyebrow">YOUR WORKSPACE</div><h2>Welcome back</h2><p>Sign in to continue to your workspace.</p></div><form onSubmit={submit} className="form-stack"><label className="field"><span className="field-label">Email or username</span><input autoComplete="username" className="input" placeholder="you@company.com or username" value={identifier} onChange={e=>setIdentifier(e.target.value)} /></label><label className="field"><span className="field-label">Password</span><span className="password-wrap"><input autoComplete="current-password" className="input" placeholder="Enter your password" type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" onClick={()=>setShow(v=>!v)}>{show?'Hide':'Show'}</button></span></label>{error?<div className="form-alert"><X size={15}/>{error}</div>:null}<Button type="submit" block loading={loading}>Sign in securely <ArrowUpRight size={16}/></Button></form><div className="auth-note"><ShieldCheck size={15}/><span>Your account role and access are verified securely.</span></div><div className="auth-bottom"><span>Forgot your password? Contact your administrator.</span><span className="secure-label"><span/> Secure session</span></div></div><p className="auth-copyright">© {new Date().getFullYear()} HCM Lite · Built for better people operations</p></div></section><Toast toast={toast} onDismiss={()=>setToast(null)}/></div>;
}

function SetupScreen({ onSubmit, toast, setToast }) {
  const [form,setForm]=React.useState({companyName:'',adminName:'',email:'',username:'',password:''});const [show,setShow]=React.useState(false);const [loading,setLoading]=React.useState(false);const [error,setError]=React.useState('');
  const update=(key,value)=>setForm(old=>({...old,[key]:value}));
  async function submit(e){e.preventDefault();setError('');if(form.companyName.trim().length<2||form.adminName.trim().length<2||!/^\S+@\S+\.\S+$/.test(form.email)||!/^[A-Za-z0-9._-]{3,30}$/.test(form.username)){setError('Please enter a valid company name, Admin name, email, and username.');return;}if(form.password.length<12||!/[A-Z]/.test(form.password)||!/[a-z]/.test(form.password)||!/[0-9]/.test(form.password)){setError('Use at least 12 characters with uppercase, lowercase, and a number.');return;}setLoading(true);try{await onSubmit(form);}catch(err){setError(err.message);}finally{setLoading(false);}}
  return <div className="auth-screen setup-screen"><ThemeToggle/><div className="auth-decoration decor-one"/><section className="setup-layout"><BrandMark/><div className="setup-card"><div className="setup-step"><span>01</span><span>Initial workspace setup</span><div/></div><span className="auth-mini-icon"><Settings2 size={20}/></span><h1>Let's set up your<br/><em>people workspace.</em></h1><p>Create your company and the first Admin account. This setup closes after initialization.</p><form className="setup-form" onSubmit={submit}><div className="form-grid"><InputField label="Company name" placeholder="e.g. Northstar Labs" value={form.companyName} onChange={e=>update('companyName',e.target.value)}/><InputField label="Admin full name" placeholder="Your name" value={form.adminName} onChange={e=>update('adminName',e.target.value)}/><InputField label="Admin email" type="email" autoComplete="email" placeholder="admin@company.com" value={form.email} onChange={e=>update('email',e.target.value)}/><InputField label="Admin username" autoComplete="username" placeholder="admin" value={form.username} onChange={e=>update('username',e.target.value)}/></div><label className="field"><span className="field-label">Create a strong password</span><span className="password-wrap"><input className="input" type={show?'text':'password'} autoComplete="new-password" placeholder="At least 12 characters" value={form.password} onChange={e=>update('password',e.target.value)}/><button type="button" onClick={()=>setShow(v=>!v)}>{show?'Hide':'Show'}</button></span><span className="field-hint">Use uppercase, lowercase, and a number. Never reuse a shared password.</span></label>{error?<div className="form-alert"><X size={15}/>{error}</div>:null}<Button type="submit" block loading={loading}>Create secure workspace <ArrowUpRight size={16}/></Button></form><div className="setup-security"><ShieldCheck size={16}/><span>No demo employees or fake business records are created.</span></div></div><p className="auth-copyright">© {new Date().getFullYear()} HCM Lite · Initial setup</p></section><Toast toast={toast} onDismiss={()=>setToast(null)}/></div>;
}

function ChangePassword({ user, onComplete, showToast }) {
  const [form,setForm]=React.useState({currentPassword:'',newPassword:'',confirm:''});const [loading,setLoading]=React.useState(false);const [error,setError]=React.useState('');const [show,setShow]=React.useState(false);
  async function submit(e){e.preventDefault();setError('');if(form.newPassword.length<12||!/[A-Z]/.test(form.newPassword)||!/[a-z]/.test(form.newPassword)||!/[0-9]/.test(form.newPassword)){setError('Use at least 12 characters with uppercase, lowercase, and a number.');return;}if(form.newPassword!==form.confirm){setError('The passwords do not match.');return;}setLoading(true);try{const result=await api('/auth/change-password',{method:'POST',body:{currentPassword:form.currentPassword,newPassword:form.newPassword}});onComplete(result.user);}catch(err){setError(err.message);}finally{setLoading(false);}}
  return <div className="mandatory-password"><div className="mandatory-password-card"><div className="auth-mini-icon"><ShieldCheck size={22}/></div><div className="eyebrow">SECURE YOUR ACCOUNT</div><h1>Set a new password</h1><p>This account was created with a temporary password. Update it before opening the rest of your workspace.</p><form className="form-stack" onSubmit={submit}>{!user?.mustChangePassword?<InputField label="Current password" type="password" value={form.currentPassword} onChange={e=>setForm({...form,currentPassword:e.target.value})}/>:<InputField label="Temporary password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={e=>setForm({...form,currentPassword:e.target.value})}/>}<label className="field"><span className="field-label">New password</span><span className="password-wrap"><input className="input" type={show?'text':'password'} autoComplete="new-password" value={form.newPassword} onChange={e=>setForm({...form,newPassword:e.target.value})}/><button type="button" onClick={()=>setShow(v=>!v)}>{show?'Hide':'Show'}</button></span></label><InputField label="Confirm new password" type={show?'text':'password'} autoComplete="new-password" value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})}/>{error?<div className="form-alert"><X size={15}/>{error}</div>:null}<Button type="submit" block loading={loading}>Update password <ArrowUpRight size={16}/></Button></form></div></div>;
}

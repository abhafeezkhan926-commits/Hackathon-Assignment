import React from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/components-react';
import {
  ArrowLeft, CalendarDays, Camera, CameraOff, ImagePlus, LoaderCircle, MessageCircle,
  Mic, MicOff, MonitorUp, PhoneOff, Radio, RefreshCw, Send, ShieldCheck, StopCircle,
  Users, Video, X
} from 'lucide-react';
import { api } from './lib/api.js';
import { Button, ErrorBanner, InputField, Modal, PageHeader, SpinnerPage } from './components.jsx';

const roleName = role => role === 'admin' ? 'Admin' : role === 'hr' ? 'HR' : 'Employee';
const initials = value => String(value || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
const timeText = value => value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
const dateTimeText = value => value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
function elapsedText(from) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function useElapsed(from) {
  const [value, setValue] = React.useState(() => elapsedText(from));
  React.useEffect(() => {
    setValue(elapsedText(from));
    const timer = setInterval(() => setValue(elapsedText(from)), 1000);
    return () => clearInterval(timer);
  }, [from]);
  return value;
}
function announceLiveChange() { window.dispatchEvent(new Event('hcm-live-changed')); }

export function LiveMeetingsPage({ user, showToast }) {
  const isAdmin = user.role === 'admin';
  const [data, setData] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [joined, setJoined] = React.useState(null);
  const [joinLoading, setJoinLoading] = React.useState('');
  const [startOpen, setStartOpen] = React.useState(false);
  const [historyChat, setHistoryChat] = React.useState(null);
  const [historyMessages, setHistoryMessages] = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const load = React.useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError('');
    try {
      const [live, list] = await Promise.all([api('/live/sessions/live'), api('/live/sessions')]);
      setData(live);
      setHistory(list.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (joined) return;
    const timer = setInterval(() => load(true), 15000);
    const refresh = () => load(true);
    window.addEventListener('hcm-live-changed', refresh);
    return () => { clearInterval(timer); window.removeEventListener('hcm-live-changed', refresh); };
  }, [joined, load]);

  async function joinSession(session) {
    setJoinLoading(session.id);
    try {
      const result = await api(`/live/sessions/${session.id}/join`, { method: 'POST' });
      setData(current => ({ configured: current?.configured ?? true, session: result.session }));
      setJoined({ session: result.session, url: result.url, token: result.token, identity: result.identity });
      announceLiveChange();
    } catch (err) {
      showToast(err.message, 'error');
      load(true);
    } finally {
      setJoinLoading('');
    }
  }

  async function startMeeting({ title, file }) {
    const form = new FormData();
    form.append('title', title);
    if (file) form.append('cover', file);
    try {
      const result = await api('/live/sessions', { method: 'POST', body: form });
      setData(current => ({ configured: current?.configured ?? true, session: result.session }));
      setStartOpen(false);
      showToast('Live meeting started. HR users can now join.');
      announceLiveChange();
      load(true);
      await joinSession(result.session);
    } catch (err) {
      load(true);
      throw err;
    }
  }

  async function endMeeting(session) {
    try {
      await api(`/live/sessions/${session.id}/end`, { method: 'POST' });
      showToast('Live meeting ended. Comments are saved in the meeting history.');
      setJoined(null);
      setData(current => ({ configured: current?.configured ?? true, session: null }));
      announceLiveChange();
      load(true);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function openHistory(session) {
    setHistoryChat(session);
    setHistoryMessages([]);
    setHistoryLoading(true);
    try {
      const result = await api(`/live/sessions/${session.id}/messages`);
      setHistoryMessages(result.messages || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setHistoryLoading(false);
    }
  }

  if (joined) {
    return <LiveRoom
      user={user}
      joined={joined}
      showToast={showToast}
      onLeave={() => { setJoined(null); load(true); announceLiveChange(); }}
      onEnd={() => endMeeting(joined.session)}
    />;
  }

  const liveSession = data?.session || null;
  const ended = history.filter(session => session.status === 'ended');

  return <>
    <PageHeader
      eyebrow="COMMUNICATION"
      title="Live meetings"
      description="Start a live video session, share your screen, and keep every comment in one saved conversation."
      actions={<>
        {isAdmin ? <Button onClick={() => setStartOpen(true)} disabled={Boolean(liveSession) || (data && !data.configured)}><Video size={16}/> Start live meeting</Button> : null}
        <Button variant="secondary" onClick={() => load()}><RefreshCw size={15}/> Refresh</Button>
      </>}
    />
    {error ? <ErrorBanner message={error} onRetry={load}/> : null}
    {loading && !data ? <SpinnerPage label="Loading live meetings…"/> : <>
      {data && !data.configured ? <div className="live-config-note"><ShieldCheck size={17}/><div><strong>Live meetings are not available yet</strong><span>The video service is not connected. Ask your administrator to finish the LiveKit setup in the server environment.</span></div></div> : null}

      {liveSession ? <section className="live-hero panel">
        <div className={`live-hero-cover ${liveSession.coverUrl ? 'has-image' : ''}`} style={liveSession.coverUrl ? { backgroundImage: `url("${liveSession.coverUrl}")` } : undefined}>
          {!liveSession.coverUrl ? <span className="live-hero-fallback"><Radio size={46}/></span> : null}
          <div className="live-hero-top">
            <span className="live-badge"><span className="live-dot"/>LIVE</span>
            <span className="live-count"><MessageCircle size={13}/> {liveSession.messageCount || 0} comments</span>
          </div>
          <div className="live-hero-copy">
            <h2>{liveSession.title}</h2>
            <p>Hosted by {liveSession.host?.name || 'Admin'} · started {timeText(liveSession.startedAt)}</p>
          </div>
        </div>
        <div className="live-hero-actions">
          <div>
            <Button onClick={() => joinSession(liveSession)} loading={joinLoading === liveSession.id}><Video size={16}/> Join live meeting</Button>
            {isAdmin ? <Button variant="secondary" onClick={() => endMeeting(liveSession)}><StopCircle size={16}/> End meeting</Button> : null}
          </div>
          <span className="live-access"><ShieldCheck size={15}/> Visible to HR and administrators</span>
        </div>
      </section> : <section className="live-empty panel">
        <span className="live-empty-icon"><Radio size={30}/></span>
        <div className="live-empty-copy">
          <h2>{isAdmin ? 'Ready when you are' : 'No live meeting right now'}</h2>
          <p>{isAdmin
            ? 'Start a live video call with a title and cover picture. Every HR user will immediately see the meeting name and a Join live meeting button.'
            : 'When an administrator goes live, the meeting name and a Join live meeting button will appear here automatically.'}</p>
        </div>
        {isAdmin
          ? <Button onClick={() => setStartOpen(true)} disabled={data && !data.configured}><Video size={16}/> Start live meeting</Button>
          : <span className="live-waiting"><span className="live-waiting-dot"/>Waiting for a live session</span>}
      </section>}

      <section className="panel live-history">
        <div className="panel-heading">
          <div><h2>Past live meetings</h2><p>Comments stay available here after a live meeting ends.</p></div>
          <button className="text-action" type="button" onClick={() => load(true)}><RefreshCw size={13}/> Refresh</button>
        </div>
        {ended.length ? <div className="live-history-list">{ended.map(session => <article className="live-history-row" key={session.id}>
          <span className="live-history-icon"><Video size={17}/></span>
          <div className="live-history-copy">
            <strong>{session.title}</strong>
            <span><CalendarDays size={12}/> {dateTimeText(session.startedAt)} · Hosted by {session.host?.name || 'Admin'} · {session.messageCount || 0} comments</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => openHistory(session)}><MessageCircle size={14}/> View chat</Button>
        </article>)}</div> : <div className="live-history-empty"><MessageCircle size={19}/><span>No past live meetings yet. Comments from finished meetings will be saved here.</span></div>}
      </section>
    </>}

    {startOpen ? <StartMeetingModal onClose={() => setStartOpen(false)} onStart={startMeeting}/> : null}
    {historyChat ? <Modal size="lg" title={historyChat.title} subtitle={`Saved live chat · ${dateTimeText(historyChat.startedAt)} · hosted by ${historyChat.host?.name || 'Admin'}`} onClose={() => setHistoryChat(null)}>
      {historyLoading ? <div className="live-chat-loading"><LoaderCircle size={19} className="spin"/> Loading saved comments…</div> : historyMessages.length
        ? <div className="live-chat-log static">{historyMessages.map(message => <ChatRow key={message.id} message={message}/>)}</div>
        : <div className="live-history-empty"><MessageCircle size={19}/><span>No comments were posted in this meeting.</span></div>}
    </Modal> : null}
  </>;
}

function StartMeetingModal({ onClose, onStart }) {
  const [title, setTitle] = React.useState('');
  const [file, setFile] = React.useState(null);
  const [preview, setPreview] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function chooseCover(event) {
    const next = event.target.files?.[0];
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError('Choose a JPG, PNG or WebP image for the cover.'); event.target.value = ''; return; }
    if (next.size > 5 * 1024 * 1024) { setError('The cover image must be smaller than 5 MB.'); event.target.value = ''; return; }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (title.trim().length < 3) { setError('Give your meeting a title of at least 3 characters.'); return; }
    setSubmitting(true);
    setError('');
    try { await onStart({ title: title.trim(), file }); }
    catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  return <Modal title="Start a live meeting" subtitle="Give your session a title and an optional cover picture. HR users will see it immediately." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <InputField label="Meeting title" placeholder="e.g. Monthly team update" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} autoFocus/>
      <label className="field">
        <span className="field-label">Cover picture <span className="live-optional">optional</span></span>
        <span className={`live-cover-picker ${preview ? 'has-preview' : ''}`}>
          {preview ? <img src={preview} alt="Meeting cover preview"/> : <><span className="live-cover-icon"><ImagePlus size={22}/></span><strong>Add a cover picture</strong><small>JPG, PNG or WebP · maximum 5 MB</small></>}
          {preview ? <span className="live-cover-change">Change picture</span> : null}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseCover} aria-label="Choose a cover picture"/>
        </span>
      </label>
      {error ? <div className="form-alert"><X size={15}/>{error}</div> : null}
      <div className="live-confirm-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={submitting}><Radio size={15}/> Go live</Button>
      </div>
    </form>
  </Modal>;
}

function LiveRoom({ user, joined, showToast, onLeave, onEnd }) {
  return <LiveKitRoom
    serverUrl={joined.url}
    token={joined.token}
    audio={user.role === 'admin'}
    video={user.role === 'admin'}
    onDisconnected={onLeave}
    onError={error => showToast(error?.message || 'The live connection could not be started.', 'error')}
    onMediaDeviceFailure={(_failure, kind) => showToast(`${kind === 'audio' ? 'Microphone' : 'Camera'} could not be started. Check your browser permissions.`, 'error')}
  >
    <RoomAudioRenderer/>
    <LiveRoomInner user={user} joined={joined} showToast={showToast} onEnd={onEnd}/>
  </LiveKitRoom>;
}

function LiveRoomInner({ user, joined, showToast, onEnd }) {
  const { session } = joined;
  const room = useRoomContext();
  const connection = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const screenTracks = useTracks([Track.Source.ScreenShare]);
  const cameraTracks = useTracks([Track.Source.Camera]);
  const [chatOpen, setChatOpen] = React.useState(() => window.innerWidth > 1080);
  const [messages, setMessages] = React.useState([]);
  const [chatLoading, setChatLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  const [ending, setEnding] = React.useState(false);
  const listRef = React.useRef(null);
  const isAdmin = user.role === 'admin';
  const elapsed = useElapsed(session.startedAt);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api(`/live/sessions/${session.id}/messages`);
        if (active) setMessages(result.messages || []);
      } catch (err) {
        if (active) showToast(err.message, 'error');
      } finally {
        if (active) setChatLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session.id]);

  React.useEffect(() => {
    const handler = payload => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data?.type !== 'chat' || !data.message?.id) return;
        setMessages(current => current.some(item => item.id === data.message.id) ? current : [...current, data.message]);
      } catch {}
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  React.useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, chatLoading, chatOpen]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    try {
      const result = await api(`/live/sessions/${session.id}/messages`, { method: 'POST', body: { text } });
      const message = result.message;
      setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      try { await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'chat', message })), { reliable: true, topic: 'hcm-live-chat' }); } catch {}
    } catch (err) {
      setDraft(text);
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }

  async function toggleMicrophone() {
    try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }
    catch { showToast('The microphone could not be started. Allow microphone access in your browser and try again.', 'error'); }
  }
  async function toggleCamera() {
    try { await localParticipant.setCameraEnabled(!isCameraEnabled); }
    catch { showToast('The camera could not be started. Allow camera access in your browser and try again.', 'error'); }
  }
  async function toggleScreenShare() {
    try { await localParticipant.setScreenShareEnabled(!isScreenShareEnabled); }
    catch (error) { if (error?.name !== 'NotAllowedError') showToast('Screen sharing could not be started. Choose a screen or window and try again.', 'error'); }
  }
  async function finishEnd() {
    setEnding(true);
    try { await onEnd(); }
    finally { setEnding(false); setConfirmEnd(false); }
  }

  const hostIdentity = session.host?.id ? `user-${session.host.id}` : '';
  const hostScreen = screenTracks.find(track => track.participant.identity === hostIdentity);
  const stageTrack = hostScreen
    || screenTracks[0]
    || cameraTracks.find(track => track.participant.identity === hostIdentity)
    || cameraTracks[0]
    || null;
  const stageName = stageTrack?.participant?.name || stageTrack?.participant?.identity || session.host?.name || 'Host';
  const stageIsScreen = stageTrack?.publication?.source === Track.Source.ScreenShare;
  const connecting = connection === ConnectionState.Connecting || connection === ConnectionState.Reconnecting;

  return <div className="live-room-page">
    <header className="live-room-head">
      <button className="icon-button" type="button" onClick={() => room.disconnect()} aria-label="Leave live meeting"><ArrowLeft size={19}/></button>
      <div className="live-room-heading">
        <div className="live-room-title-row"><span className="live-badge"><span className="live-dot"/>LIVE</span><h1>{session.title}</h1></div>
        <p>Hosted by {session.host?.name || 'Admin'} <span>·</span> {elapsed} <span>·</span> {participants.length} {participants.length === 1 ? 'person' : 'people'} in the room</p>
      </div>
      <div className="live-room-status">
        <span className={`live-connection ${connecting ? 'is-connecting' : ''}`}><span/>{connection === ConnectionState.Connected ? 'Connected' : 'Connecting…'}</span>
        {isAdmin ? <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)}><StopCircle size={15}/> End meeting</Button> : null}
      </div>
    </header>

    <div className={`live-room-body ${chatOpen ? 'chat-open' : ''}`}>
      <section className="live-stage-wrap">
        <div className={`live-stage-screen ${stageTrack ? 'has-video' : ''} ${stageIsScreen ? 'is-screen' : ''}`} style={!stageTrack && session.coverUrl ? { backgroundImage: `url("${session.coverUrl}")` } : undefined}>
          {stageTrack ? <VideoTrack trackRef={stageTrack} playsInline className="live-stage-video"/> : <div className="live-stage-placeholder">
            <span className="live-stage-icon"><Radio size={34}/></span>
            <strong>{connecting ? 'Connecting to the live room…' : 'Waiting for video'}</strong>
            <span>Video appears here as soon as someone turns on a camera or shares a screen.</span>
          </div>}
          <span className="live-badge live-badge-floating"><span className="live-dot"/>LIVE</span>
          {stageTrack ? <span className="live-stage-label">{stageIsScreen ? <><MonitorUp size={13}/>{stageName} is sharing their screen</> : <><Video size={13}/>{stageName}</>}</span> : null}
          <span className="live-viewer-count"><Users size={13}/> {participants.length}</span>
        </div>

        <div className="live-camera-strip">
          {cameraTracks.length ? cameraTracks.map(track => <CameraTile key={track.participant.identity} track={track}/>) : <div className="live-strip-note"><CameraOff size={16}/> Cameras are off</div>}
        </div>

        <div className="live-controls">
          <div className="live-controls-group">
            <button className={`live-control ${isMicrophoneEnabled ? 'is-on' : 'is-off'}`} type="button" onClick={toggleMicrophone} aria-label={isMicrophoneEnabled ? 'Turn microphone off' : 'Turn microphone on'} title={isMicrophoneEnabled ? 'Turn microphone off' : 'Turn microphone on'}>
              {isMicrophoneEnabled ? <Mic size={18}/> : <MicOff size={18}/>}<span>Mic {isMicrophoneEnabled ? 'on' : 'off'}</span>
            </button>
            <button className={`live-control ${isCameraEnabled ? 'is-on' : 'is-off'}`} type="button" onClick={toggleCamera} aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'} title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}>
              {isCameraEnabled ? <Camera size={18}/> : <CameraOff size={18}/>}<span>Camera {isCameraEnabled ? 'on' : 'off'}</span>
            </button>
            {isAdmin ? <button className={`live-control ${isScreenShareEnabled ? 'is-on' : 'is-off'}`} type="button" onClick={toggleScreenShare} aria-label={isScreenShareEnabled ? 'Stop sharing your screen' : 'Share your screen'} title={isScreenShareEnabled ? 'Stop sharing your screen' : 'Share your screen'}>
              <MonitorUp size={18}/><span>{isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}</span>
            </button> : null}
            <button className={`live-control ${chatOpen ? 'is-on' : 'is-off'}`} type="button" onClick={() => setChatOpen(value => !value)} aria-label={chatOpen ? 'Hide live chat' : 'Show live chat'} title={chatOpen ? 'Hide live chat' : 'Show live chat'}>
              <MessageCircle size={18}/><span>{chatOpen ? 'Hide chat' : 'Chat'}</span>
            </button>
          </div>
          <div className="live-controls-group">
            {isAdmin ? <button className="live-control is-danger" type="button" onClick={() => setConfirmEnd(true)} aria-label="End live meeting" title="End live meeting"><StopCircle size={18}/><span>End</span></button> : null}
            <button className="live-control is-leave" type="button" onClick={() => room.disconnect()} aria-label="Leave live meeting" title="Leave live meeting"><PhoneOff size={18}/><span>Leave</span></button>
          </div>
        </div>
      </section>

      {chatOpen ? <aside className="live-chat-panel">
        <header className="live-chat-head">
          <div><h3>Live chat</h3><p>{messages.length} {messages.length === 1 ? 'comment' : 'comments'} · saved automatically</p></div>
          <button className="icon-button" type="button" onClick={() => setChatOpen(false)} aria-label="Hide live chat"><X size={17}/></button>
        </header>
        <div className="live-chat-list" ref={listRef}>
          {chatLoading ? <div className="live-chat-loading"><LoaderCircle size={19} className="spin"/> Loading comments…</div>
            : messages.length ? messages.map(message => <ChatRow key={message.id} message={message} mine={String(message.senderId) === String(user.id)}/>)
            : <div className="live-chat-empty"><MessageCircle size={22}/><strong>Start the conversation</strong><p>Comments are shared live and saved for everyone after the meeting.</p></div>}
        </div>
        <form className="live-chat-form" onSubmit={sendMessage}>
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a comment…" maxLength={500} aria-label="Live chat comment"/>
          <Button type="submit" size="sm" loading={sending} disabled={!draft.trim()} aria-label="Send comment"><Send size={15}/></Button>
        </form>
      </aside> : null}
    </div>

    {confirmEnd ? <Modal title="End this live meeting?" subtitle="Everyone will leave the room. Saved comments stay in Past live meetings." onClose={() => setConfirmEnd(false)}>
      <div className="live-confirm-actions">
        <Button variant="secondary" onClick={() => setConfirmEnd(false)}>Keep it live</Button>
        <Button variant="danger" loading={ending} onClick={finishEnd}><StopCircle size={16}/> End for everyone</Button>
      </div>
    </Modal> : null}
  </div>;
}

function CameraTile({ track }) {
  const participant = track.participant;
  const name = participant.name || participant.identity;
  return <div className={`live-camera-tile ${participant.isLocal ? 'is-local' : ''}`}>
    <VideoTrack trackRef={track} playsInline className="live-camera-video"/>
    <div className="live-camera-meta">
      <span>{name}{participant.isLocal ? ' (you)' : ''}</span>
      {participant.isMicrophoneEnabled ? <Mic size={12}/> : <MicOff size={12}/>}
    </div>
  </div>;
}

function ChatRow({ message, mine = false }) {
  return <div className={`live-chat-message ${mine ? 'is-mine' : ''}`}>
    {message.senderAvatarUrl
      ? <img className="avatar avatar-sm" src={message.senderAvatarUrl} alt={`${message.senderName} profile`}/>
      : <span className="avatar avatar-sm avatar-fallback">{initials(message.senderName)}</span>}
    <div className="live-chat-body">
      <div className="live-chat-meta">
        <strong>{message.senderName || 'User'}</strong>
        <span className={`live-role live-role-${message.senderRole}`}>{roleName(message.senderRole)}</span>
        <time>{timeText(message.createdAt)}</time>
      </div>
      <p>{message.text}</p>
    </div>
  </div>;
}

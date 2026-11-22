import { useEffect, useRef, useState } from 'react';
import API, { errorMessage } from '../services/api';

export default function SupportChat() {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const request = useRef(null);
  const log = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, pending]);

  async function send(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(message);
    setDraft('');
    setError('');
    try {
      const history = turns.slice(-10).map(turn => ({ ...turn, text: turn.text.slice(0, 4000) }));
      const { data } = await API.post('/chat', { message, history }, { signal: controller.signal, timeout: 35000 });
      setTurns(previous => [...previous, { role: 'user', text: message }, { role: 'assistant', text: data.reply }]);
    } catch (err) {
      if (!controller.signal.aborted) {
        setDraft(message);
        setError(errorMessage(err, 'Message could not be sent.'));
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending('');
    }
  }

  return <section className="panel support-chat">
    <h2>IT support chat</h2>
    <p className="muted">Describe your IT issue for troubleshooting help. Messages are sent to Google Gemini. Leave out passwords and private details.</p>
    <div className="chat-log" role="log" aria-label="Conversation" ref={log}>
      {turns.map((turn, i) => <p key={i}><strong>{turn.role === 'user' ? 'You' : 'IT assistant'}</strong>{turn.text}</p>)}
      {pending && <><p><strong>You</strong>{pending}</p><p>Waiting for a reply…</p></>}
    </div>
    <form onSubmit={send}>
      <label>Your message<textarea maxLength={2000} rows={3} value={draft} disabled={!!pending}
        onChange={event => setDraft(event.target.value)} /></label>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" disabled={!!pending || !draft.trim()}>Send message</button>
        <button className="btn ghost" type="button" disabled={!!pending} onClick={() => {
          setTurns([]); setDraft(''); setError('');
        }}>Clear chat</button>
      </div>
    </form>
  </section>;
}

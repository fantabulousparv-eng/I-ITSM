import { useEffect, useRef, useState } from 'react';
import API from '../services/api';

export default function Chatbot() {
  const [messages, setMessages] = useState([]); // [{ role: 'user' | 'assistant', content: string }]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Scroll to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const history = messages; // everything before this new message
    setMessages([...history, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await API.post('/chat', { message: text, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not reach the chatbot.';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginTop: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>IT Support Assistant</h3>
        <button
          type="button"
          onClick={() => setMessages([])}
          style={{ padding: '5px 10px', background: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px' }}
        >
          Clear chat
        </button>
      </div>

      <div style={{ height: '300px', overflowY: 'auto', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', padding: '10px', margin: '10px 0' }}>
        {messages.length === 0 && (
          <p style={{ color: '#888' }}>Describe your IT problem and I'll help you troubleshoot it.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '8px' }}>
            <div
              style={{
                maxWidth: '75%',
                padding: '8px 12px',
                borderRadius: '8px',
                whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? '#007bff' : '#eee',
                color: m.role === 'user' ? '#fff' : '#000',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && <p style={{ color: '#888' }}>Thinking...</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          style={{ flex: 1, padding: '8px' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '8px 15px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px' }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

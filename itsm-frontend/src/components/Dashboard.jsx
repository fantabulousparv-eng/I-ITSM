import React, { useEffect, useState } from 'react';
import API from '../services/api';
import Chatbot from './Chatbot';

export default function Dashboard({ role, onLogout }) {
  const [incidents, setIncidents] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Software');
  const [impact, setImpact] = useState('Medium');
  const [urgency, setUrgency] = useState('Medium');

  const fetchIncidents = async () => {
    try {
      const { data } = await API.get('/incidents');
      setIncidents(data);
    } catch (err) {
      console.error('Error fetching incidents:', err);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  const handleCreateIncident = async (e) => {
    e.preventDefault();
    try {
      const reporter = localStorage.getItem('userId');
      // Pass a mock or placeholder service ID for now
      await API.post('/incidents', {
        title,
        description,
        category,
        affectedService: '65f1a2b3c4d5e6f7a8b9c0d1', // Replace with a valid service ID from your DB later
        reporter,
        impact,
        urgency
      });
      setTitle('');
      setDescription('');
      fetchIncidents();
      alert('Incident reported successfully!');
    } catch (err) {
      alert('Failed to create incident: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>ITSM Dashboard ({role.toUpperCase()})</h2>
        <button onClick={onLogout} style={{ padding: '5px 10px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px' }}>
          Logout
        </button>
      </div>
      <hr />

      {/* Employee Ticket Creation Form */}
      {(role === 'employee' || role === 'admin') && (
        <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
          <h3>Report New Incident</h3>
          <form onSubmit={handleCreateIncident}>
            <input 
              type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required 
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
            <textarea 
              placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required 
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: 1, padding: '8px' }}>
                <option value="Software">Software</option>
                <option value="Hardware">Hardware</option>
                <option value="Network">Network</option>
              </select>
              <select value={impact} onChange={(e) => setImpact(e.target.value)} style={{ flex: 1, padding: '8px' }}>
                <option value="Low">Impact: Low</option>
                <option value="Medium">Impact: Medium</option>
                <option value="High">Impact: High</option>
                <option value="Critical">Impact: Critical</option>
              </select>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ flex: 1, padding: '8px' }}>
                <option value="Low">Urgency: Low</option>
                <option value="Medium">Urgency: Medium</option>
                <option value="High">Urgency: High</option>
                <option value="Critical">Urgency: Critical</option>
              </select>
            </div>
            <button type="submit" style={{ padding: '10px 15px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px' }}>
              Submit Ticket
            </button>
          </form>
        </div>
      )}

      {/* Incident Queue List */}
      <h3>Active Incident Queue</h3>
      {incidents.length === 0 ? (
        <p>No incidents found in the system.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
          <thead>
            <tr style={{ background: '#eee', textAlign: 'left' }}>
              <th style={{ padding: '8px', border: '1px solid #ddd' }}>ID</th>
              <th style={{ padding: '8px', border: '1px solid #ddd' }}>Title</th>
              <th style={{ padding: '8px', border: '1px solid #ddd' }}>Priority</th>
              <th style={{ padding: '8px', border: '1px solid #ddd' }}>Status</th>
              <th style={{ padding: '8px', border: '1px solid #ddd' }}>Reporter</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => (
              <tr key={inc._id}>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{inc.incidentId}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{inc.title}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{inc.priority}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}><strong>{inc.status}</strong></td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{inc.reporter?.name || 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* IT Support Chatbot */}
      <Chatbot />
    </div>
  );
}
import { useState } from 'react';

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

function App() {
 const [form, setForm] = useState({
  item_type: '',
  delivery_number: '',
  delivery_date: '',
  storage_location: '',
  store_name: '',
});

  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResponse(null);

    try {
      const res = await fetch(`${API_BASE}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Submission failed');
      }

      setResponse(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ padding: '1rem', maxWidth: 600, margin: 'auto' }}>
      <h1>Inventory Intake</h1>
      <form onSubmit={handleSubmit}>
        {Object.keys(form).map((key) => (
          <div key={key} style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              {key.replace('_', ' ')}:
            </label>
            <input
              type={key.includes('date') ? 'date' : 'text'}
              name={key}
              value={form[key]}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: '0.5rem' }}
            />
          </div>
        ))}
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>Add Item</button>
      </form>

      {error && (
        <p style={{ color: 'red', marginTop: '1rem' }}>{error}</p>
      )}

      {response && (
        <pre style={{ background: '#f5f5f5', padding: '1rem', marginTop: '1rem' }}>
          {JSON.stringify(response, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;
import { useState } from 'react';

function App() {
  const [form, setForm] = useState({
    qr_code_id: '',
    item_type: '',
    delivery_number: '',
    delivery_date: '',
    storage_location: '',
    store_name: '',
  });

  const [response, setResponse] = useState(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch('http://localhost:3000/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setResponse(data);
  };

  return (
    <div style={{ padding: '1rem', maxWidth: 600, margin: 'auto' }}>
      <h1>Inventory Intake</h1>
      <form onSubmit={handleSubmit}>
        {Object.keys(form).map((key) => (
          <div key={key} style={{ marginBottom: '1rem' }}>
            <label>
              {key.replace('_', ' ')}:
              <input
                type={key.includes('date') ? 'date' : 'text'}
                name={key}
                value={form[key]}
                onChange={handleChange}
                required
                style={{ width: '100%' }}
              />
            </label>
          </div>
        ))}
        <button type="submit">Add Item</button>
      </form>

      {response && (
        <pre style={{ background: '#f5f5f5', padding: '1rem' }}>
          {JSON.stringify(response, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;
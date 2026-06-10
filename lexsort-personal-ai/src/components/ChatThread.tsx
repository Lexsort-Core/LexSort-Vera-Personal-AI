import { useState } from 'react';

export default function ChatThread() {
  const [data, setData] = useState('Ready.');

  const handleChat = async () => {
    setData('Connecting...');
    try {
      const response = await fetch('http://127.0.0.1:58732/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3', prompt: 'Hello' })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      
      setData('');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setData(prev => prev + chunk);
      }
    } catch (e) {
      setData("Error: " + (e as Error).message);
      console.error("Stream error:", e);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <button onClick={handleChat}>Start Engine</button>
      <pre style={{ marginTop: '20px', color: 'white', whiteSpace: 'pre-wrap' }}>{data}</pre>
    </div>
  );
}

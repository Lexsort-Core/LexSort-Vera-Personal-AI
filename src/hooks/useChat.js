import { useState } from 'react';

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = async (content) => {
    setIsStreaming(true);
    const newMessages = [...messages, { role: 'user', content }];
    setMessages(newMessages);

    const response = await fetch('http://127.0.0.1:58732/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: newMessages }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessage = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      
      for (const line of lines) {
        const json = JSON.parse(line.slice(6));
        assistantMessage += json.token;
        setMessages([...newMessages, { role: 'assistant', content: assistantMessage }]);
      }
    }
    setIsStreaming(false);
  };

  return { messages, sendMessage, isStreaming };
}

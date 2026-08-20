'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2, MessageSquare } from 'lucide-react';
import { Github } from '@/components/icons/Github';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuthStore } from '@/store/useAuthStore';
import { API_BASE_URL } from '@/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function ChatPage({ params }: { params: { repositoryId: string } }) {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, statusMessage]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    setStatusMessage('Connecting...');

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', content: '' }]);

    try {
      // Use native fetch to handle SSE streams
      const response = await fetch(`${API_BASE_URL}/api/chat/${params.repositoryId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: userMessage.content }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      if (!response.body) throw new Error('No readable stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value, { stream: true });
        
        // Parse SSE format:
        // event: xxx\ndata: yyy\n\n
        const lines = chunkValue.split('\n');
        let currentEvent = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7);
          } else if (line.startsWith('data: ')) {
            const dataStr = line.substring(6);
            if (!dataStr) continue;
            
            try {
              const data = JSON.parse(dataStr);
              
              if (currentEvent === 'status') {
                setStatusMessage(data.message);
              } else if (currentEvent === 'chunk') {
                setStatusMessage(''); // clear status when chunks start arriving
                setMessages((prev) => 
                  prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, content: msg.content + data.content } 
                      : msg
                  )
                );
              } else if (currentEvent === 'error') {
                setStatusMessage('');
                setMessages((prev) => 
                  prev.map(msg => 
                    msg.id === assistantMessageId 
                      ? { ...msg, content: msg.content + `\n\n**Error**: ${data.error}` } 
                      : msg
                  )
                );
              } else if (currentEvent === 'done') {
                setStatusMessage('');
              }
            } catch (e) {
              console.error('Failed to parse SSE data', e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat stream error:', error);
      setMessages((prev) => 
        prev.map(msg => 
          msg.id === assistantMessageId && !msg.content 
            ? { ...msg, content: '**Error**: Failed to connect to chat service.' } 
            : msg
        )
      );
    } finally {
      setIsTyping(false);
      setStatusMessage('');
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 h-16 border-b border-border bg-panel">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push('/dashboard')}
            className="p-2 -ml-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-border transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2 font-medium">
            <Github size={18} />
            <span>Chatting with Repo</span>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-24">
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-20 text-foreground-muted">
              <MessageSquare size={48} className="mb-4 opacity-50" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Ask anything about this codebase</h2>
              <p className="max-w-md">Try asking &quot;How does the authentication flow work?&quot; or &quot;Where are the database models defined?&quot;</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-5 py-4 ${
                msg.role === 'user' 
                  ? 'bg-foreground text-background rounded-br-none' 
                  : 'bg-panel border border-border shadow-sm rounded-bl-none'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
                    {msg.content === '' && isTyping ? (
                      <div className="flex items-center gap-2 h-6">
                        <span className="w-2 h-2 rounded-full bg-foreground-muted animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 rounded-full bg-foreground-muted animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 rounded-full bg-foreground-muted animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    ) : (
                      <ReactMarkdown
                        components={{
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
                          code({ inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match ? (
                              <SyntaxHighlighter
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                style={vscDarkPlus as any}
                                language={match[1]}
                                PreTag="div"
                                className="rounded-lg !my-4 !bg-zinc-900"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            ) : (
                              <code className="px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-900 font-medium text-sm" {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {statusMessage && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 text-sm text-foreground-muted px-4 py-2">
                <Loader2 size={14} className="animate-spin" />
                <span>{statusMessage}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 bg-panel border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <form 
            onSubmit={handleSendMessage}
            className="flex items-end gap-2 bg-background border border-border rounded-2xl p-2 focus-within:ring-2 focus-within:ring-foreground/10 focus-within:border-border-hover transition-all"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              placeholder="Ask a question about the repository..."
              className="flex-1 max-h-48 min-h-[44px] bg-transparent text-foreground placeholder:text-foreground-muted resize-none focus:outline-none p-3"
              rows={1}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="flex-shrink-0 h-11 w-11 flex items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed m-1"
            >
              <Send size={18} />
            </button>
          </form>
          <div className="text-center mt-3 text-xs text-foreground-muted">
            Repo-Mind AI can make mistakes. Consider verifying important information.
          </div>
        </div>
      </footer>
    </div>
  );
}

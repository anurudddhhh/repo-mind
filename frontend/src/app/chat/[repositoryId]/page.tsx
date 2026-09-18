'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2, MessageSquare, Terminal } from 'lucide-react';
import { Github } from '@/components/icons/Github';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuthStore } from '@/store/useAuthStore';
import { chatApi, repositoryApi } from '@/services/api';
import { Repository } from '@/types';

// ─────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

type SyntaxTheme = { [key: string]: React.CSSProperties };
const codeTheme = vscDarkPlus as unknown as SyntaxTheme;

// ─────────────────────────────────────────────────────────
// CHAT MARKDOWN CLEANER
// Turns AI pipe-tables into readable bullets; drops |---| rows
// ─────────────────────────────────────────────────────────
function formatChatMarkdown(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Skip markdown table separator rows: |---|---| or | --- | :---: |
    if (/^\|?[\s:|-]+ \|?$/.test(line) && line.includes('-') && !/[A-Za-z0-9]/.test(line.replace(/[|\s:-]/g, ''))) {
      continue;
    }
    if (/^\|(\s*:?-+:?\s*\|)+\s*$/.test(line)) {
      continue;
    }

    // Convert table row | a | b | c | → bullet
    if (line.includes('|') && (line.startsWith('|') || /\|\s*\S/.test(line))) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && !/^:?-+:?$/.test(c));

      if (cells.length >= 2) {
        const head = cells[0];
        const rest = cells.slice(1).join(' — ');
        // Skip pure header-looking single-word rows that are only "Layer" style if next was separator (already skipped)
        out.push(`- **${head}**: ${rest}`);
        continue;
      }
      if (cells.length === 1 && cells[0].length > 0) {
        out.push(`- ${cells[0]}`);
        continue;
      }
    }

    // Soften long runs of dashes used as dividers (not code fences)
    if (/^-{3,}$/.test(line) || /^_{3,}$/.test(line)) {
      out.push('');
      continue;
    }

    out.push(raw);
  }

  // Collapse excessive blank lines
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────
// MERMAID DIAGRAM (lazy + suppressErrorRendering)
// ─────────────────────────────────────────────────────────
function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(true);
  const chartIdRef = useRef(`chat-mermaid-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      const cleanChart = chart.trim();
      if (!cleanChart) return;

      // While the stream is still mid-diagram, syntax is often incomplete — wait
      if (!/graph|flowchart|sequenceDiagram|classDiagram|stateDiagram/i.test(cleanChart)) {
        if (isMounted) setIsRendering(true);
        return;
      }

      try {
        setIsRendering(true);
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'loose',
          fontFamily: 'inherit',
          suppressErrorRendering: true,
        });

        // Quote unquoted node labels for safer parse
        let safe = cleanChart.replace(/```mermaid/gi, '').replace(/```/g, '').trim();
        safe = safe.replace(/([a-zA-Z0-9_]+)\[(?!")([^\]]+)\]/g, (_, id, label) => {
          return `${id}["${label.replace(/"/g, "'")}"]`;
        });

        const { svg: renderedSvg } = await mermaid.render(chartIdRef.current, safe);
        if (isMounted) {
          setSvg(renderedSvg);
          setIsRendering(false);
        }
      } catch {
        // Incomplete stream or bad syntax — keep loading state until next chunk
        if (isMounted) setIsRendering(true);
      }
    };

    renderChart();
    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (isRendering && !svg) {
    return (
      <div className="p-3 my-3 bg-panel border border-border rounded-xl text-xs text-foreground-muted flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-foreground-muted" />
        <span>Generating interactive diagram...</span>
      </div>
    );
  }

  return (
    <div className="my-4 p-4 bg-white dark:bg-zinc-900 border border-border rounded-2xl overflow-x-auto flex justify-center items-center shadow-sm">
      <div
        className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN CHAT PAGE
// ─────────────────────────────────────────────────────────
export default function ChatPage({ params }: { params: { repositoryId: string } }) {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  const [repository, setRepository] = useState<Repository | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
      return;
    }

    const loadRepoMetadata = async () => {
      try {
        const repos = await repositoryApi.getRepositories();
        const currentRepo = repos.find((r) => r.id === params.repositoryId);
        if (currentRepo) {
          setRepository(currentRepo);
        } else {
          router.replace('/dashboard');
        }
      } catch (err) {
        console.error('Failed to load repository metadata:', err);
        router.replace('/dashboard');
      }
    };

    loadRepoMetadata();
  }, [isAuthenticated, params.repositoryId, router]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, statusMessage, scrollToBottom]);

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
    setStatusMessage('Searching vectors...');

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', content: '' }]);

    try {
      await chatApi.streamChat(
        params.repositoryId,
        userMessage.content,
        (content) => {
          setStatusMessage('');
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: msg.content + content }
                : msg
            )
          );
        },
        (status) => {
          setStatusMessage(status);
        },
        (errorMsg) => {
          setStatusMessage('');
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: msg.content + `\n\n**Error**: ${errorMsg}` }
                : msg
            )
          );
        }
      );
    } catch (error) {
      console.error('Chat stream error:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId && !msg.content
            ? {
                ...msg,
                content:
                  '**Error**: Failed to connect to chat service. Please check your network connection.',
              }
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
      <header className="flex-shrink-0 flex items-center justify-between px-6 h-16 border-b border-border bg-panel shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-2 -ml-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-border transition-all"
            title="Back to Dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 font-semibold text-sm sm:text-base text-foreground">
              <Github size={16} />
              <span>{repository ? repository.fullName : 'Loading repository...'}</span>
            </div>
            {repository?.defaultBranch && (
              <span className="text-xs text-foreground-muted font-mono mt-0.5">
                branch: {repository.defaultBranch}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth bg-background">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-24">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-20 text-foreground-muted">
              <div className="h-14 w-14 bg-panel border border-border flex items-center justify-center rounded-2xl shadow-premium mb-4 text-foreground">
                <MessageSquare size={24} />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-1.5">Ask Repo-Mind AI</h2>
              <p className="text-sm max-w-sm mx-auto mb-6">
                Ask questions, generate flowcharts, search symbols, or trace functions across your
                codebase.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg text-left">
                {[
                  'How does the auth flow work?',
                  'Draw a flowchart of the system architecture',
                  'Explain the main backend folders as a short list',
                  'Are there any memory leaks or bugs?',
                ].map((suggestedQuery) => (
                  <button
                    key={suggestedQuery}
                    onClick={() => setInput(suggestedQuery)}
                    className="p-3 text-xs sm:text-sm bg-panel border border-border rounded-xl text-foreground hover:border-border-hover hover:shadow-premium transition-all flex items-center gap-2"
                  >
                    <Terminal size={14} className="text-foreground-muted flex-shrink-0" />
                    <span className="line-clamp-1 font-medium">{suggestedQuery}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-5 py-4 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-none'
                    : 'bg-panel border border-border rounded-bl-none'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="text-foreground leading-relaxed text-sm sm:text-[15px]">
                    {msg.content === '' && isTyping ? (
                      <div className="flex items-center gap-1.5 h-6">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                    ) : (
                      <ReactMarkdown
                        components={{
                          h1({ children }) {
                            return (
                              <h1 className="text-lg font-bold text-foreground mt-3 mb-2 first:mt-0">
                                {children}
                              </h1>
                            );
                          },
                          h2({ children }) {
                            return (
                              <h2 className="text-base font-bold text-foreground mt-4 mb-2 border-b border-border/60 pb-1 first:mt-0">
                                {children}
                              </h2>
                            );
                          },
                          h3({ children }) {
                            return (
                              <h3 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">
                                {children}
                              </h3>
                            );
                          },
                          p({ children }) {
                            return (
                              <p className="text-sm sm:text-[15px] leading-relaxed text-foreground mb-3 last:mb-0">
                                {children}
                              </p>
                            );
                          },
                          ul({ children }) {
                            return (
                              <ul className="list-disc pl-5 space-y-1.5 mb-3 text-sm text-foreground">
                                {children}
                              </ul>
                            );
                          },
                          ol({ children }) {
                            return (
                              <ol className="list-decimal pl-5 space-y-1.5 mb-3 text-sm text-foreground">
                                {children}
                              </ol>
                            );
                          },
                          li({ children }) {
                            return <li className="leading-relaxed pl-0.5">{children}</li>;
                          },
                          strong({ children }) {
                            return (
                              <strong className="font-semibold text-foreground">{children}</strong>
                            );
                          },
                          a({ href, children }) {
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="text-foreground underline underline-offset-2 hover:opacity-80"
                              >
                                {children}
                              </a>
                            );
                          },
                          blockquote({ children }) {
                            return (
                              <blockquote className="border-l-4 border-border pl-3 my-3 text-foreground-muted italic">
                                {children}
                              </blockquote>
                            );
                          },
                          hr() {
                            return <hr className="my-4 border-border" />;
                          },
                          code({ inline, className, children }: CodeBlockProps) {
                            const match = /language-(\w+)/.exec(className || '');
                            const language = match ? match[1] : '';

                            if (!inline && language === 'mermaid') {
                              return (
                                <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
                              );
                            }

                            if (!inline && language) {
                              return (
                                <div className="relative my-3 rounded-xl overflow-hidden border border-border">
                                  <div className="bg-zinc-800 text-zinc-400 text-[10px] uppercase tracking-wide px-3 py-1.5 font-mono border-b border-zinc-700/50 select-none">
                                    {language}
                                  </div>
                                  <SyntaxHighlighter
                                    style={codeTheme}
                                    language={language}
                                    PreTag="div"
                                    className="!m-0 !bg-zinc-900 !p-3.5 font-mono text-xs sm:text-sm overflow-x-auto"
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                </div>
                              );
                            }

                            return (
                              <code className="px-1.5 py-0.5 rounded bg-border text-foreground font-mono text-[11px] sm:text-xs font-semibold">
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {formatChatMarkdown(msg.content)}
                      </ReactMarkdown>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                    {msg.content}
                  </p>
                )}
              </div>
            </div>
          ))}

          {statusMessage && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 text-xs sm:text-sm text-foreground-muted px-4 py-2 bg-panel border border-border rounded-xl shadow-sm">
                <Loader2 size={12} className="animate-spin text-foreground-muted" />
                <span>{statusMessage}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="flex-shrink-0 bg-panel border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={handleSendMessage}
            className="flex items-end gap-2 bg-background border border-border rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-foreground/5 focus-within:border-border-hover transition-all"
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
              placeholder={`Ask about ${repository ? repository.name : 'this codebase'}...`}
              className="flex-1 max-h-36 min-h-[40px] bg-transparent text-foreground placeholder:text-foreground-muted/50 resize-none focus:outline-none px-3 py-2 text-sm sm:text-base"
              rows={1}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed m-0.5 shadow-sm"
            >
              <Send size={16} />
            </button>
          </form>
          <div className="text-center mt-2.5 text-xs text-foreground-muted">
            Ask for flowcharts or sequence diagrams to visualize the architecture.
          </div>
        </div>
      </footer>
    </div>
  );
}
'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, MessageSquare, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import mermaid from 'mermaid';
import { chatApi, repositoryApi, type CitationEntry } from '@/services/api';
import { useAuthStore } from '@/store/useAuthStore';
import { Repository } from '@/types';

// ─── Mermaid Initialization ──────────────────────────────────────────────────

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  suppressErrorRendering: true,
});

// ─── Mermaid Chart Sanitizer Helper ──────────────────────────────────────────

function sanitizeMermaidChart(chart: string): string {
  if (!chart) return '';

  let clean = chart.trim();

  // 1. Strip markdown code fences if present
  clean = clean.replace(/```mermaid/gi, '').replace(/```/g, '').trim();

  // 2. Ensure diagram header exists
  if (!/^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|gantt|stateDiagram|pie)/i.test(clean)) {
    clean = `graph TD\n${clean}`;
  }

  // 3. Fix unquoted edge pipe labels with parens or special chars:
  // e.g. -->|HTTP Request (with token)| -> -->|"HTTP Request (with token)"|
  clean = clean.replace(/-->\|([^|"]+)\|/g, (_, label) => {
    const safeLabel = label.replace(/"/g, "'");
    return `-->|"${safeLabel}"|`;
  });

  // 4. Quote unquoted node labels: ID[Label with (special) / chars] -> ID["Label with (special) / chars"]
  clean = clean.replace(/([a-zA-Z0-9_]+)\[(?!\")([^\]]+)\]/g, (_, id, label) => {
    const safeLabel = label.replace(/"/g, "'");
    return `${id}["${safeLabel}"]`;
  });

  // 5. Remove trailing semicolons
  clean = clean
    .split('\n')
    .map((line) => line.trim().replace(/;$/, ''))
    .join('\n');

  return clean;
}

// ─── Local UI Message Type ───────────────────────────────────────────────────

interface UIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Citation Badge Component ────────────────────────────────────────────────

function CitationBadge({ entry }: { entry: CitationEntry }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const shortPath = entry.filePath.split('/').slice(-2).join('/');

  return (
    <span
      className="relative inline-block ml-0.5 align-super cursor-pointer select-none"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-bold border border-blue-300 dark:border-blue-800 hover:bg-blue-200 transition-colors">
        {entry.ref}
      </span>

      {showTooltip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-72 p-3 rounded-xl bg-gray-900 text-white shadow-2xl text-xs text-left pointer-events-none border border-gray-700">
          <span className="block text-blue-400 font-mono font-semibold truncate">
            {shortPath}
          </span>
          <span className="block text-gray-300 mt-0.5">
            Lines {entry.startLine}–{entry.endLine} · {entry.language}
          </span>
          {entry.snippetPreview && (
            <span className="block text-gray-400 mt-1.5 font-mono text-[10px] line-clamp-3 bg-gray-950 p-2 rounded-lg border border-gray-800">
              {entry.snippetPreview}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ─── Text Renderer with Citation Parsing ─────────────────────────────────────

function renderTextWithCitations(
  text: string,
  citations: Record<number, CitationEntry>
): ReactNode {
  const parts = text.split(/(\[\d+\])/g);

  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const ref = parseInt(match[1], 10);
      const entry = citations[ref];
      if (entry) {
        return <CitationBadge key={index} entry={entry} />;
      }
    }
    return part;
  });
}

// ─── Mermaid Diagram Component ───────────────────────────────────────────────

function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    const renderDiagram = async () => {
      try {
        const sanitized = sanitizeMermaidChart(chart);
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, sanitized);

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<div className="text-left font-mono text-xs text-amber-600 dark:text-amber-400 space-y-1">' +
            '<p className="font-sans font-semibold">⚠️ Architecture Flowchart Code Preview:</p>' +
            `<pre className="p-3 bg-gray-100 dark:bg-zinc-800 rounded-xl overflow-x-auto text-gray-800 dark:text-zinc-200">${chart}</pre>` +
            '</div>';
        }
      }
    };

    renderDiagram();
  }, [chart]);

  return (
    <div
      ref={containerRef}
      className="my-4 p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-x-auto flex justify-center shadow-sm"
    />
  );
}

// ─── Main Chat Page Component ────────────────────────────────────────────────

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const repositoryId = params.repositoryId as string;
  const { isAuthenticated, token } = useAuthStore();

  const [repo, setRepo] = useState<Repository | null>(null);
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [citations, setCitations] = useState<Record<number, CitationEntry>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusMessage]);

  // Auth redirect & repository info load
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    const loadRepo = async () => {
      try {
        const repos = await repositoryApi.getRepositories();
        const current = repos.find((r) => r.id === repositoryId);
        if (current) setRepo(current);
      } catch {
        // Fallback silently if single repo lookup fails
      }
    };

    loadRepo();
  }, [isAuthenticated, repositoryId, router]);

  // ─── Send Message & Handle SSE Stream ────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Direct token validation check
    const activeToken = token || useAuthStore.getState().token;
    if (!activeToken) {
      router.push('/');
      return;
    }

    const userMessage: UIChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStatusMessage('Connecting to AI assistant...');
    setCitations({});

    const assistantIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await chatApi.streamChat(repositoryId, trimmed, {
        onStatus: (data: { message: string }) => {
          setStatusMessage(data.message);
        },
        onCitations: (data: { citations: CitationEntry[] }) => {
          const map: Record<number, CitationEntry> = {};
          data.citations.forEach((c) => {
            map[c.ref] = c;
          });
          setCitations(map);
        },
        onChunk: (data: { content: string }) => {
          setStatusMessage('');
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                content: updated[assistantIndex].content + data.content,
              };
            }
            return updated;
          });
        },
        onError: (data: { error: string }) => {
          setStatusMessage('');
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[assistantIndex]) {
              updated[assistantIndex] = {
                ...updated[assistantIndex],
                content: updated[assistantIndex].content + `\n\n❌ Error: ${data.error}`,
              };
            }
            return updated;
          });
        },
        onDone: () => {
          setStatusMessage('');
          setIsLoading(false);
        },
      });
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : 'Failed to connect to chat service.';
      setStatusMessage('');
      setIsLoading(false);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex] = {
            ...updated[assistantIndex],
            content: updated[assistantIndex].content || `❌ ${errText}`,
          };
        }
        return updated;
      });
    }
  }, [input, isLoading, messages.length, repositoryId, router, token]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQueries = [
    'How does the auth flow work?',
    'Draw a flowchart of the system architecture',
    'Explain the main backend services',
    'Are there any memory leaks or performance risks?',
  ];

  if (!isAuthenticated) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-50/50 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100">
      {/* ── Top Header ── */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/repositories/${repositoryId}`)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all"
            title="Back to repository"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span>{repo ? repo.fullName : repositoryId}</span>
            </h1>
            <span className="text-[11px] text-gray-400 font-mono">
              branch: {repo?.defaultBranch || 'main'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Messages & Hero Body Area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-8 max-w-4xl w-full mx-auto space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-6">
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-sm text-gray-700 dark:text-zinc-300">
              <MessageSquare size={28} />
            </div>

            <div className="space-y-2 max-w-md">
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                Ask Repo-Mind AI
              </h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                Ask questions, generate flowcharts, search symbols, or trace functions across your codebase.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl w-full pt-2">
              {suggestedQueries.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="flex items-center gap-2 p-3 text-xs bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800/80 rounded-xl border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 transition-all shadow-sm text-left group"
                >
                  <Terminal size={14} className="text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white flex-shrink-0" />
                  <span className="line-clamp-1">{q}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-2xl sm:max-w-3xl rounded-2xl px-5 py-4 ${
                  msg.role === 'user'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium text-sm shadow-sm'
                    : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-sm text-gray-800 dark:text-zinc-200 text-sm'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-slate dark:prose-invert max-w-none text-xs sm:text-sm">
                    <ReactMarkdown
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const codeString = String(children).replace(/\n$/, '');

                          if (match?.[1] === 'mermaid') {
                            return <MermaidDiagram chart={codeString} />;
                          }

                          if (!match) {
                            return (
                              <code
                                className="bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono text-gray-900 dark:text-zinc-100 font-semibold"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          }

                          return (
                            <div className="relative my-3 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-800">
                              <SyntaxHighlighter
                                style={vscDarkPlus as unknown as { [key: string]: React.CSSProperties }}
                                language={match[1]}
                                PreTag="div"
                                className="!m-0 !bg-zinc-900 !p-3.5 font-mono text-xs overflow-x-auto"
                              >
                                {codeString}
                              </SyntaxHighlighter>
                            </div>
                          );
                        },
                        p({ children }) {
                          return (
                            <p className="mb-3 leading-relaxed">
                              {Array.isArray(children)
                                ? children.map((child, i) => {
                                    if (typeof child === 'string') {
                                      return (
                                        <span key={i}>
                                          {renderTextWithCitations(child, citations)}
                                        </span>
                                      );
                                    }
                                    return <span key={i}>{child}</span>;
                                  })
                                : typeof children === 'string'
                                  ? renderTextWithCitations(children, citations)
                                  : children}
                            </p>
                          );
                        },
                        li({ children }) {
                          return (
                            <li className="mb-1">
                              {Array.isArray(children)
                                ? children.map((child, i) => {
                                    if (typeof child === 'string') {
                                      return (
                                        <span key={i}>
                                          {renderTextWithCitations(child, citations)}
                                        </span>
                                      );
                                    }
                                    return <span key={i}>{child}</span>;
                                  })
                                : typeof children === 'string'
                                  ? renderTextWithCitations(children, citations)
                                  : children}
                            </li>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}

        {/* Status Indicator */}
        {statusMessage && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-2 text-xs text-gray-500 dark:text-zinc-400 animate-pulse shadow-sm">
              ⏳ {statusMessage}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Sources Panel (Citations) ── */}
      {Object.keys(citations).length > 0 && (
        <div className="px-6 py-2 border-t border-gray-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm max-w-4xl w-full mx-auto">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1.5">
            Retrieved Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.values(citations).map((c) => {
              const shortPath = c.filePath.split('/').slice(-2).join('/');
              return (
                <span
                  key={c.ref}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs text-gray-700 dark:text-zinc-300 font-medium"
                >
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                    {c.ref}
                  </span>
                  <span className="font-mono">{shortPath}</span>
                  <span className="text-gray-400">:{c.startLine}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom Pill Input Bar ── */}
      <div className="p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-t border-gray-200 dark:border-zinc-800">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="relative flex items-center bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700/60 rounded-full px-4 py-1.5 focus-within:border-gray-400 dark:focus-within:border-zinc-500 transition-all shadow-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${repo?.name || 'repo-mind'}...`}
              rows={1}
              className="flex-1 resize-none bg-transparent py-2 px-2 text-xs sm:text-sm focus:outline-none placeholder-gray-400 text-gray-900 dark:text-white"
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="p-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-30 rounded-full transition-all flex-shrink-0 ml-1"
            >
              <Send size={15} />
            </button>
          </div>
          <p className="text-[11px] text-center text-gray-400">
            Ask for flowcharts or sequence diagrams to visualize the architecture.
          </p>
        </div>
      </div>
    </div>
  );
}
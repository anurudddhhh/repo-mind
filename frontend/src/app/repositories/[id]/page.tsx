'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Layers,
  Bug,
  FileText,
  GitCommit,
  FolderTree,
  RefreshCw,
  Loader2,
  ExternalLink,
  ShieldAlert,
  Code2,
  Users,
  TrendingUp,
  MessageSquare,
  List,
} from 'lucide-react';
import { Github } from '@/components/icons/Github';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuthStore } from '@/store/useAuthStore';
import {
  analysisApi,
  searchApi,
  repositoryApi,
  RepositoryTreeResponse,
} from '@/services/api';
import {
  Repository,
  ArchitectureSummary,
  BugDetectionResult,
  DocumentationResult,
  CommitAnalysis,
} from '@/types';
import {
  ArchitectureSkeleton,
  BugsSkeleton,
  DocsSkeleton,
} from '@/components/SkeletonLoaders';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// ─────────────────────────────────────────────────────────
// TYPES & THEME
// ─────────────────────────────────────────────────────────
type TabType = 'architecture' | 'bugs' | 'docs' | 'commits' | 'tree';
const VALID_TABS: TabType[] = ['architecture', 'bugs', 'docs', 'commits', 'tree'];

type SyntaxTheme = { [key: string]: React.CSSProperties };
const codeTheme = vscDarkPlus as unknown as SyntaxTheme;

export interface ModuleInfo {
  name: string;
  path: string;
  description: string;
  exports: string[];
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────
// MARKDOWN FORMATTER HELPER
// Converts raw unparsed pipe tables into clean bulleted lists
// ─────────────────────────────────────────────────────────
function formatMarkdownContent(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // If line looks like a markdown table separator (|---|---|), skip it
    if (/^\|?\s*:?-+:?\s*\|/i.test(line)) {
      continue;
    }

    // If line looks like a raw table row (| item | description |), convert to clean bullet point
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);

      if (cells.length >= 2) {
        formattedLines.push(`- **${cells[0]}**: ${cells.slice(1).join(' — ')}`);
        continue;
      }
    }

    formattedLines.push(lines[i]);
  }

  return formattedLines.join('\n');
}

// ─────────────────────────────────────────────────────────
// MERMAID SYNTAX SANITIZER & FALLBACK GENERATOR
// ─────────────────────────────────────────────────────────
function sanitizeMermaidChart(chart: string): string {
  if (!chart) return '';

  let clean = chart.trim();

  // 1. Strip markdown fences if present
  clean = clean.replace(/```mermaid/gi, '').replace(/```/g, '').trim();

  // 2. Ensure graph/flowchart header
  if (!/^(graph|flowchart)\s+(TD|LR|TB|RL)/i.test(clean)) {
    clean = `graph TD\n${clean}`;
  }

  // 3. Remove trailing semicolons
  clean = clean
    .split('\n')
    .map((line) => line.trim().replace(/;$/, ''))
    .join('\n');

  // 4. Quote unquoted node labels: ID[Label with (special) / chars] -> ID["Label with (special) / chars"]
  clean = clean.replace(/([a-zA-Z0-9_]+)\[(?!\")([^\]]+)\]/g, (_, id, label) => {
    const safeLabel = label.replace(/"/g, "'");
    return `${id}["${safeLabel}"]`;
  });

  return clean;
}

function generateDynamicFallbackChart(modules?: ModuleInfo[], techStack?: string[]): string {
  const lines: string[] = ['graph TD'];

  if (techStack && techStack.length > 0) {
    const stackLabel = techStack.slice(0, 4).join(' + ');
    lines.push(`  Client["Client Application (${stackLabel})"]`);
  } else {
    lines.push('  Client["Client Application"]');
  }

  if (modules && modules.length > 0) {
    modules.slice(0, 4).forEach((m, idx) => {
      const nodeId = `Mod${idx}`;
      const safeName = m.name.replace(/"/g, "'");
      lines.push(`  ${nodeId}["${safeName}"]`);
      if (idx === 0) {
        lines.push(`  Client --> ${nodeId}`);
      } else {
        lines.push(`  Mod${idx - 1} --> ${nodeId}`);
      }
    });
  } else {
    lines.push('  API["Backend API Layer"]');
    lines.push('  DB[("Database / Store")]');
    lines.push('  Client --> API');
    lines.push('  API --> DB');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// BULLETPROOF MERMAID DIAGRAM COMPONENT
// ─────────────────────────────────────────────────────────
function MermaidDiagram({
  chart,
  modules,
  techStack,
}: {
  chart: string;
  modules?: ModuleInfo[];
  techStack?: string[];
}) {
  const [svg, setSvg] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(true);
  const chartIdRef = useRef(`arch-mermaid-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
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

        // First attempt: Render sanitized AI chart
        const sanitized = sanitizeMermaidChart(chart);
        try {
          const { svg: renderedSvg } = await mermaid.render(chartIdRef.current, sanitized);
          if (isMounted) {
            setSvg(renderedSvg);
            setIsRendering(false);
            return;
          }
        } catch (firstErr) {
          console.warn('Sanitized Mermaid render failed, attempting dynamic fallback:', firstErr);
        }

        // Second attempt: Render dynamic guaranteed fallback chart
        const fallbackChart = generateDynamicFallbackChart(modules, techStack);
        const fallbackId = `${chartIdRef.current}-fallback`;
        const { svg: fallbackSvg } = await mermaid.render(fallbackId, fallbackChart);

        if (isMounted) {
          setSvg(fallbackSvg);
          setIsRendering(false);
        }
      } catch (finalErr) {
        console.error('All Mermaid rendering attempts failed:', finalErr);
        if (isMounted) setIsRendering(false);
      }
    };

    renderChart();
    return () => {
      isMounted = false;
    };
  }, [chart, modules, techStack]);

  if (isRendering && !svg) {
    return (
      <div className="p-8 bg-panel border border-border rounded-2xl flex items-center justify-center gap-2 text-foreground-muted text-sm">
        <Loader2 size={16} className="animate-spin" />
        <span>Rendering Architecture Flowchart...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white dark:bg-zinc-900 border border-border rounded-2xl overflow-x-auto flex justify-center items-center shadow-sm">
      <div
        className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN REPOSITORY ANALYSIS DASHBOARD PAGE
// ─────────────────────────────────────────────────────────
export default function RepositoryAnalysisPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuthStore();

  const tabFromUrl = searchParams.get('tab') as TabType | null;
  const initialTab: TabType = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'architecture';

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [repository, setRepository] = useState<Repository | null>(null);

  // Analysis State
  const [archData, setArchData] = useState<ArchitectureSummary | null>(null);
  const [bugsData, setBugsData] = useState<BugDetectionResult | null>(null);
  const [docsData, setDocsData] = useState<DocumentationResult | null>(null);
  const [commitsData, setCommitsData] = useState<CommitAnalysis | null>(null);
  const [treeData, setTreeData] = useState<RepositoryTreeResponse | null>(null);

  // Refs to prevent useCallback infinite re-render loops
  const stateRef = useRef({ archData, bugsData, docsData, commitsData, treeData });
  useEffect(() => {
    stateRef.current = { archData, bugsData, docsData, commitsData, treeData };
  }, [archData, bugsData, docsData, commitsData, treeData]);

  // Loading States
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Table of Contents Active Heading Tracker
  const [activeSection, setActiveSection] = useState<string>('');

  // ─────────────────────────────────────────────────────────
  // Fetch Active Tab Data
  // ─────────────────────────────────────────────────────────
  const fetchTabData = useCallback(
    async (tab: TabType, forceRefresh = false) => {
      setError('');
      if (forceRefresh) setIsRefreshing(true);

      const current = stateRef.current;

      try {
        if (tab === 'architecture' && (!current.archData || forceRefresh)) {
          setLoading(true);
          const data = await analysisApi.getArchitectureSummary(params.id, forceRefresh);
          setArchData(data);
        } else if (tab === 'bugs' && (!current.bugsData || forceRefresh)) {
          setLoading(true);
          const data = await analysisApi.detectBugs(params.id, forceRefresh);
          setBugsData(data);
        } else if (tab === 'docs' && (!current.docsData || forceRefresh)) {
          setLoading(true);
          const data = await analysisApi.generateDocumentation(params.id, undefined, forceRefresh);
          setDocsData(data);
        } else if (tab === 'commits' && (!current.commitsData || forceRefresh)) {
          setLoading(true);
          const data = await analysisApi.analyzeCommits(params.id, forceRefresh);
          setCommitsData(data);
        } else if (tab === 'tree' && (!current.treeData || forceRefresh)) {
          setLoading(true);
          const data = await searchApi.getRepositoryTree(params.id);
          setTreeData(data);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch analysis data';
        setError(msg);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [params.id]
  );

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    router.replace(`/repositories/${params.id}?tab=${tab}`, { scroll: false });
    fetchTabData(tab);
  };

  // Initial Load & Auth Check
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
      return;
    }

    const initPage = async () => {
      try {
        const repos = await repositoryApi.getRepositories();
        const current = repos.find((r) => r.id === params.id);
        if (!current) {
          router.replace('/dashboard');
          return;
        }
        setRepository(current);
        fetchTabData(initialTab);
      } catch (err) {
        console.error(err);
        router.replace('/dashboard');
      }
    };

    initPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, params.id, router]);

  // Synchronize tab state if user clicks browser Back/Forward buttons
  useEffect(() => {
    const currentTabParam = searchParams.get('tab') as TabType | null;
    if (currentTabParam && VALID_TABS.includes(currentTabParam) && currentTabParam !== activeTab) {
      setActiveTab(currentTabParam);
      fetchTabData(currentTabParam);
    }
  }, [searchParams, activeTab, fetchTabData]);

  // Parse Headings from Documentation Markdown for ToC Sidebar
  const docHeadings = useMemo(() => {
    if (!docsData?.documentation) return [];
    const formatted = formatMarkdownContent(docsData.documentation);
    const lines = formatted.split('\n');
    const headings: { id: string; text: string; level: number }[] = [];

    lines.forEach((line) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim().replace(/[*_`]/g, '');
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        headings.push({ id, text, level });
      }
    });

    return headings;
  }, [docsData]);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Header Navbar ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-panel/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 -ml-2 rounded-lg text-foreground-muted hover:text-foreground hover:bg-border transition-all"
              title="Back to Dashboard"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 font-bold text-base text-foreground">
                <Github size={18} />
                <span>{repository ? repository.fullName : 'Repository Analysis'}</span>
                {repository && (
                  <a
                    href={`https://github.com/${repository.fullName}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground-muted hover:text-foreground transition-colors ml-1"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <span className="text-xs text-foreground-muted">AI Codebase Intelligence Dashboard</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/chat/${params.id}`)}
              className="inline-flex h-9 items-center gap-1.5 px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-foreground/90 transition-all shadow-sm"
            >
              <MessageSquare size={14} />
              <span>Chat Assistant</span>
            </button>
          </div>
        </div>

        {/* ── Navigation Tabs ── */}
        <div className="container mx-auto px-4 flex items-center gap-2 overflow-x-auto border-t border-border/50 text-xs sm:text-sm font-medium scrollbar-none">
          {[
            { id: 'architecture', label: 'Architecture', icon: Layers },
            { id: 'bugs', label: 'Bugs & Security', icon: Bug },
            { id: 'docs', label: 'Documentation', icon: FileText },
            { id: 'commits', label: 'Commit History', icon: GitCommit },
            { id: 'tree', label: 'AST Symbols', icon: FolderTree },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id as TabType)}
                className={`flex items-center gap-2 py-3 px-3.5 border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-foreground text-foreground font-semibold'
                    : 'border-transparent text-foreground-muted hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Main Body ── */}
      <main className="container mx-auto px-4 py-8 max-w-6xl flex-1">
        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-error/10 text-error border border-error/20 rounded-2xl text-sm flex items-center gap-3">
            <ShieldAlert size={18} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Refresh Header Control */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold tracking-tight text-foreground capitalize flex items-center gap-2">
            <span>{activeTab.replace('-', ' ')} Overview</span>
          </h2>
          <button
            onClick={() => fetchTabData(activeTab, true)}
            disabled={loading || isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-panel text-xs font-medium text-foreground-muted hover:text-foreground hover:border-border-hover transition-all disabled:opacity-50"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Regenerate Analysis</span>
          </button>
        </div>

        {/* ── Tab-Specific Shimmering Skeleton Loaders ── */}
        {loading ? (
          <div>
            {activeTab === 'architecture' && <ArchitectureSkeleton />}
            {activeTab === 'bugs' && <BugsSkeleton />}
            {activeTab === 'docs' && <DocsSkeleton />}
            {(activeTab === 'commits' || activeTab === 'tree') && (
              <div className="flex flex-col items-center justify-center py-20 text-foreground-muted gap-3 bg-panel rounded-2xl border border-border shadow-premium animate-pulse">
                <Loader2 size={24} className="animate-spin text-foreground" />
                <p className="text-sm font-medium text-foreground">Parsing {activeTab} data structures...</p>
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* TAB 1: ARCHITECTURE SUMMARY & MERMAID */}
            {activeTab === 'architecture' && archData && (
              <ErrorBoundary fallbackTitle="Architecture Section Error">
                <div className="space-y-6">
                  <div className="bg-panel p-6 rounded-2xl border border-border shadow-premium space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">System Overview</h3>
                    <p className="text-sm sm:text-base leading-relaxed text-foreground whitespace-pre-line">
                      {archData.overview}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Architecture Flowchart</h3>
                    <MermaidDiagram
                      chart={archData.diagram}
                      modules={archData.modules as ModuleInfo[]}
                      techStack={archData.techStack}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-panel p-5 rounded-2xl border border-border shadow-premium space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Detected Tech Stack</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {archData.techStack.map((tech) => (
                          <span key={tech} className="px-2.5 py-1 bg-border rounded-lg text-xs font-medium text-foreground">
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-panel p-5 rounded-2xl border border-border shadow-premium space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Key Dependencies</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {archData.dependencies.map((dep) => (
                          <span key={dep} className="px-2.5 py-1 bg-border rounded-lg text-xs font-medium text-foreground">
                            {dep}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Core Modules & Roles</h3>
                    <div className="grid grid-cols-1 gap-3">
                      {archData.modules.map((mod) => (
                        <div key={mod.name} className="bg-panel p-5 rounded-2xl border border-border shadow-premium space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-base text-foreground">{mod.name}</h4>
                            <code className="text-xs bg-border px-2 py-0.5 rounded font-mono text-foreground">
                              {mod.path}
                            </code>
                          </div>
                          <p className="text-sm text-foreground-muted">{mod.description}</p>
                          {mod.exports && mod.exports.length > 0 && (
                            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                              <span className="text-xs font-medium text-foreground-muted">Exports:</span>
                              {mod.exports.map((exp) => (
                                <span key={exp} className="px-2 py-0.5 bg-border rounded font-mono text-xs text-foreground font-medium">
                                  {exp}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* TAB 2: BUG DETECTION & SECURITY ISSUES */}
            {activeTab === 'bugs' && bugsData && (
              <ErrorBoundary fallbackTitle="Bug Scan Section Error">
                <div className="space-y-6">
                  <div className="bg-panel p-5 rounded-2xl border border-border shadow-premium flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-base text-foreground">Code Quality Scan Summary</h3>
                      <p className="text-sm text-foreground-muted">{bugsData.summary}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-black text-foreground">{bugsData.totalIssues}</span>
                      <span className="block text-xs text-foreground-muted uppercase font-medium">Issues Detected</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {bugsData.bugs.length === 0 ? (
                      <div className="p-12 text-center bg-panel border border-border rounded-2xl shadow-premium space-y-2">
                        <div className="inline-flex p-3 rounded-full bg-success/10 text-success mb-2">
                          <ShieldAlert size={24} />
                        </div>
                        <h4 className="font-semibold text-foreground">No Critical Bugs Found</h4>
                        <p className="text-sm text-foreground-muted">Your sampled functions passed AST and security analysis cleanly.</p>
                      </div>
                    ) : (
                      bugsData.bugs.map((bug, index) => {
                        const severityColors = {
                          critical: 'bg-red-500/10 text-red-600 border-red-500/20',
                          high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
                          medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
                          low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                        };

                        return (
                          <div key={index} className="bg-panel p-5 sm:p-6 rounded-2xl border border-border shadow-premium space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${severityColors[bug.severity] || severityColors.low}`}>
                                  {bug.severity}
                                </span>
                                <code className="text-xs font-mono text-foreground font-semibold">
                                  {bug.filePath} {bug.line ? `(Line ${bug.line})` : ''}
                                </code>
                              </div>
                            </div>

                            <p className="text-sm text-foreground font-medium">{bug.description}</p>

                            <div className="p-3.5 bg-background rounded-xl border border-border text-xs text-foreground-muted space-y-1">
                              <span className="font-bold text-foreground block">Suggested Fix:</span>
                              <p>{bug.suggestion}</p>
                            </div>

                            {bug.codeSnippet && (
                              <div className="relative rounded-xl overflow-hidden border border-border">
                                <SyntaxHighlighter
                                  style={codeTheme}
                                  language="typescript"
                                  PreTag="div"
                                  className="!m-0 !bg-zinc-900 !p-3.5 font-mono text-xs overflow-x-auto"
                                >
                                  {bug.codeSnippet}
                                </SyntaxHighlighter>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* TAB 3: CONSTELLATION-STYLE DOCUMENTATION VIEWER */}
            {activeTab === 'docs' && docsData && (
              <ErrorBoundary fallbackTitle="Documentation Viewer Error">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                  <div className="lg:col-span-1 bg-panel border border-border p-4 rounded-2xl shadow-premium sticky top-24 space-y-3 max-h-[calc(100vh-8rem)] overflow-y-auto hidden lg:block">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground-muted">
                      <List size={14} />
                      <span>Documentation Index</span>
                    </div>
                    <nav className="space-y-1 text-xs">
                      {docHeadings.map((h) => (
                        <a
                          key={h.id}
                          href={`#${h.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveSection(h.id);
                            const el = document.getElementById(h.id);
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className={`block py-1.5 px-2 rounded-lg transition-colors line-clamp-1 ${
                            h.level === 1
                              ? 'font-bold text-foreground hover:bg-border'
                              : h.level === 2
                              ? 'pl-4 text-foreground-muted hover:text-foreground hover:bg-border'
                              : 'pl-6 text-foreground-muted/70 hover:text-foreground hover:bg-border'
                          } ${activeSection === h.id ? 'bg-border font-semibold text-foreground' : ''}`}
                        >
                          {h.text}
                        </a>
                      ))}
                    </nav>
                  </div>

                  <div className="lg:col-span-3 bg-panel p-6 sm:p-10 rounded-2xl border border-border shadow-premium space-y-6">
                    <ReactMarkdown
                      components={{
                        h1({ children }) {
                          const text = String(children);
                          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                          return (
                            <h1 id={id} className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight border-b border-border pb-3 mb-6 pt-2">
                              {children}
                            </h1>
                          );
                        },
                        h2({ children }) {
                          const text = String(children);
                          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                          return (
                            <h2 id={id} className="text-xl font-bold text-foreground tracking-tight border-b border-border/60 pb-2 mt-8 mb-4">
                              {children}
                            </h2>
                          );
                        },
                        h3({ children }) {
                          const text = String(children);
                          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                          return (
                            <h3 id={id} className="text-base font-bold text-foreground mt-6 mb-3">
                              {children}
                            </h3>
                          );
                        },
                        p({ children }) {
                          return <p className="text-sm sm:text-base leading-relaxed text-foreground-muted mb-4">{children}</p>;
                        },
                        ul({ children }) {
                          return <ul className="list-disc pl-6 space-y-2 mb-4 text-sm sm:text-base text-foreground-muted">{children}</ul>;
                        },
                        ol({ children }) {
                          return <ol className="list-decimal pl-6 space-y-2 mb-4 text-sm sm:text-base text-foreground-muted">{children}</ol>;
                        },
                        table({ children }) {
                          return (
                            <div className="my-6 overflow-x-auto rounded-xl border border-border">
                              <table className="w-full text-left text-xs sm:text-sm border-collapse">{children}</table>
                            </div>
                          );
                        },
                        thead({ children }) {
                          return <thead className="bg-border text-foreground font-semibold border-b border-border">{children}</thead>;
                        },
                        th({ children }) {
                          return <th className="p-3 font-semibold text-foreground">{children}</th>;
                        },
                        td({ children }) {
                          return <td className="p-3 border-t border-border/50 text-foreground-muted">{children}</td>;
                        },
                        blockquote({ children }) {
                          return (
                            <blockquote className="border-l-4 border-foreground pl-4 py-2 italic my-4 text-foreground-muted bg-border/30 rounded-r-lg">
                              {children}
                            </blockquote>
                          );
                        },
                        code({ inline, className, children }: CodeBlockProps) {
                          const match = /language-(\w+)/.exec(className || '');
                          const language = match ? match[1] : '';

                          if (!inline && language === 'mermaid') {
                            return (
                              <MermaidDiagram
                                chart={String(children).replace(/\n$/, '')}
                                modules={archData?.modules as ModuleInfo[]}
                                techStack={archData?.techStack}
                              />
                            );
                          }

                          if (!inline && language) {
                            return (
                              <div className="relative my-4 rounded-xl overflow-hidden border border-border font-mono">
                                <SyntaxHighlighter
                                  style={codeTheme}
                                  language={language}
                                  PreTag="div"
                                  className="!m-0 !bg-zinc-900 !p-4 font-mono text-xs sm:text-sm overflow-x-auto"
                                >
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              </div>
                            );
                          }

                          return (
                            <code className="px-2 py-0.5 rounded bg-border text-foreground font-mono text-xs font-semibold">
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {formatMarkdownContent(docsData.documentation)}
                    </ReactMarkdown>
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* TAB 4: COMMIT HISTORY & CONTRIBUTORS */}
            {activeTab === 'commits' && commitsData && (
              <ErrorBoundary fallbackTitle="Commit Analytics Section Error">
                <div className="space-y-6">
                  <div className="bg-panel p-6 rounded-2xl border border-border shadow-premium space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={18} className="text-foreground" />
                        <h3 className="font-bold text-base text-foreground">Development Velocity</h3>
                      </div>
                      <span className="px-3 py-1 bg-border text-foreground text-xs font-bold uppercase rounded-full">
                        {commitsData.activityLevel} Activity
                      </span>
                    </div>
                    <p className="text-sm sm:text-base leading-relaxed text-foreground-muted whitespace-pre-line">
                      {commitsData.summary}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-foreground" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Top Contributors</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {commitsData.contributors.map((c) => (
                        <div key={c.username} className="bg-panel p-4 rounded-2xl border border-border shadow-premium flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.avatarUrl} alt={c.username} className="w-10 h-10 rounded-full border border-border" />
                          <div>
                            <h4 className="font-semibold text-sm text-foreground">{c.username}</h4>
                            <span className="text-xs text-foreground-muted">{c.commits} commits recorded</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">Recent Commit Timeline</h3>
                    <div className="bg-panel rounded-2xl border border-border shadow-premium divide-y divide-border overflow-hidden">
                      {commitsData.recentCommits.map((c) => (
                        <div key={c.sha} className="p-4 hover:bg-background/50 transition-colors flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium text-foreground">{c.message}</p>
                            <span className="text-xs text-foreground-muted">
                              {c.author} • {new Date(c.date).toLocaleDateString()}
                            </span>
                          </div>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 bg-border rounded-lg text-xs font-mono font-semibold text-foreground hover:bg-border-hover transition-colors"
                          >
                            {c.sha}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* TAB 5: AST SYMBOL & FILE EXPLORER */}
            {activeTab === 'tree' && treeData && (
              <ErrorBoundary fallbackTitle="AST Symbol Tree Error">
                <div className="space-y-4">
                  <div className="bg-panel p-4 rounded-2xl border border-border shadow-premium flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Total Parsed Files: {treeData.totalFiles}</span>
                  </div>

                  <div className="bg-panel rounded-2xl border border-border shadow-premium divide-y divide-border overflow-hidden">
                    {treeData.files.map((f) => (
                      <div key={f.filePath} className="p-4 hover:bg-background/40 transition-colors space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Code2 size={16} className="text-foreground-muted" />
                            <span className="font-mono text-xs sm:text-sm font-semibold text-foreground">{f.filePath}</span>
                          </div>
                          <span className="px-2 py-0.5 bg-border rounded text-xs font-mono text-foreground">
                            {f.language}
                          </span>
                        </div>

                        {f.symbols && f.symbols.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1 pl-6">
                            {f.symbols.map((s, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 bg-border rounded text-[11px] font-mono text-foreground flex items-center gap-1.5"
                              >
                                <span className="font-bold text-foreground">{s.type}:</span>
                                <span>{s.name}</span>
                                <span className="text-foreground-muted">({s.lines})</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </ErrorBoundary>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
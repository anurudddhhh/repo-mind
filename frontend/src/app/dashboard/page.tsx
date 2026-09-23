'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Search,
  MessageSquare,
  Loader2,
  Database,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  Bug,
  FileText,
  GitCommit,
  FolderTree,
  Sparkles,
  Shield,
  GitBranch,
  Code2,
} from 'lucide-react';
import { Github } from '@/components/icons/Github';
import { useAuthStore } from '@/store/useAuthStore';
import { repositoryApi, indexingApi } from '@/services/api';
import { Repository, IndexingProgress } from '@/types';
import { useToast } from '@/components/Toast';
import { DeleteModal } from '@/components/DeleteModal';

// ─────────────────────────────────────────────────────────
// Feature quick-action definition (one card row per repo)
// ─────────────────────────────────────────────────────────
interface FeatureAction {
  id: string;
  label: string;
  description: string;
  icon: typeof MessageSquare;
  getHref: (repoId: string) => string;
  accent: string;
}

const FEATURE_ACTIONS: FeatureAction[] = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Ask the codebase',
    icon: MessageSquare,
    getHref: (id) => `/chat/${id}`,
    accent: 'hover:border-violet-500/40 hover:bg-violet-500/5',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'System map + Mermaid',
    icon: Layers,
    getHref: (id) => `/repositories/${id}?tab=architecture`,
    accent: 'hover:border-blue-500/40 hover:bg-blue-500/5',
  },
  {
    id: 'bugs',
    label: 'Bugs',
    description: 'Security & quality',
    icon: Bug,
    getHref: (id) => `/repositories/${id}?tab=bugs`,
    accent: 'hover:border-red-500/40 hover:bg-red-500/5',
  },
  {
    id: 'docs',
    label: 'Docs',
    description: 'AI documentation',
    icon: FileText,
    getHref: (id) => `/repositories/${id}?tab=docs`,
    accent: 'hover:border-emerald-500/40 hover:bg-emerald-500/5',
  },
  {
    id: 'commits',
    label: 'Commits',
    description: 'History & velocity',
    icon: GitCommit,
    getHref: (id) => `/repositories/${id}?tab=commits`,
    accent: 'hover:border-amber-500/40 hover:bg-amber-500/5',
  },
  {
    id: 'tree',
    label: 'AST Tree',
    description: 'Symbols & structure',
    icon: FolderTree,
    getHref: (id) => `/repositories/${id}?tab=tree`,
    accent: 'hover:border-cyan-500/40 hover:bg-cyan-500/5',
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { addToast } = useToast();

  const [repoUrl, setRepoUrl] = useState('');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingStatus, setIndexingStatus] = useState<IndexingProgress | null>(null);
  const [error, setError] = useState('');

  // Ref to hold smooth-progress interval timer (Task 7)
  const connectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Custom Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [repoToDelete, setRepoToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingRepo, setIsDeletingRepo] = useState(false);

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  const fetchRepositories = useCallback(async () => {
    try {
      const data = await repositoryApi.getRepositories();
      setRepositories(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch repositories:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRepositories();
    }
  }, [isAuthenticated, fetchRepositories]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (connectionIntervalRef.current) {
        clearInterval(connectionIntervalRef.current);
      }
    };
  }, []);

  const handleLogout = () => {
    logout();
    router.replace('/');
  };

  const clearConnectionTimer = () => {
    if (connectionIntervalRef.current) {
      clearInterval(connectionIntervalRef.current);
      connectionIntervalRef.current = null;
    }
  };

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.includes('github.com')) {
      setError('Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo).');
      return;
    }

    // Extract target repo full name for resilience matching
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
    const targetFullName = match ? `${match[1]}/${match[2].replace(/\.git$/, '')}`.toLowerCase() : '';

    setError('');
    setIsIndexing(true);

    // Initial Stage: 5% (Connecting)
    setIndexingStatus({
      stage: 'fetching',
      message: 'Connecting to GitHub API...',
      progress: 5,
    });

    // Task 7 Polish: Start smooth stage progression while waiting for GitHub API response
    clearConnectionTimer();
    const connectionSteps = [
      { progress: 7, message: 'Requesting repository file tree...' },
      { progress: 9, message: 'Resolving file manifests...' },
      { progress: 10, message: 'Downloading repository files...' },
    ];
    let stepIndex = 0;

    connectionIntervalRef.current = setInterval(() => {
      if (stepIndex < connectionSteps.length) {
        const step = connectionSteps[stepIndex];
        setIndexingStatus((prev) =>
          prev && prev.progress < step.progress
            ? { ...prev, progress: step.progress, message: step.message }
            : prev
        );
        stepIndex++;
      } else {
        clearConnectionTimer();
      }
    }, 1200);

    try {
      await indexingApi.startIndexing(repoUrl, (progressEvent) => {
        // As soon as real backend progress reaches >= 10%, cancel simulated interval
        if (progressEvent.progress >= 10) {
          clearConnectionTimer();
        }
        setIndexingStatus(progressEvent);
      });

      clearConnectionTimer();
      await fetchRepositories();
      addToast('Repository indexed successfully!', 'success');
      setRepoUrl('');
    } catch (err: unknown) {
      clearConnectionTimer();
      
      // Task 6 Resilience: Check if repository was actually created and indexed despite proxy SSE disconnect
      if (targetFullName) {
        try {
          const freshRepos = await repositoryApi.getRepositories();
          const indexedRepo = freshRepos.find(
            (r) => r.fullName.toLowerCase() === targetFullName
          );

          if (indexedRepo && (indexedRepo.isIndexed || Boolean(indexedRepo.indexedAt) || Boolean(indexedRepo.id))) {
            setRepositories(freshRepos);
            addToast('Repository indexed successfully!', 'success');
            setRepoUrl('');
            setError('');
            return;
          }
        } catch {
          // If verification query fails, fall back to showing error banner
        }
      }

      const errMessage = err instanceof Error ? err.message : 'Failed to index repository';
      setError(errMessage);
      addToast(errMessage, 'error');
    } finally {
      clearConnectionTimer();
      setIsIndexing(false);
      setIndexingStatus(null);
    }
  };

  const handleOpenDeleteModal = (id: string, fullName: string) => {
    setRepoToDelete({ id, name: fullName });
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!repoToDelete) return;

    setIsDeletingRepo(true);
    try {
      await repositoryApi.deleteRepository(repoToDelete.id);
      setRepositories((prev) => prev.filter((repo) => repo.id !== repoToDelete.id));
      addToast(`Repository "${repoToDelete.name}" deleted successfully.`, 'success');
      setIsDeleteModalOpen(false);
      setRepoToDelete(null);
    } catch (err) {
      console.error('Failed to delete repository:', err);
      addToast('Failed to delete repository. Please try again.', 'error');
    } finally {
      setIsDeletingRepo(false);
    }
  };

  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top Navbar ── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-panel/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-bold text-lg text-foreground">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center rounded-lg">
              <Github size={18} />
            </div>
            <span>Repo-Mind</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 text-sm text-foreground-muted">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="w-8 h-8 rounded-full border border-border"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center text-xs font-bold">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="hidden sm:inline-block font-medium text-foreground">{user.username}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-foreground-muted hover:text-foreground transition-colors rounded-lg hover:bg-border"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-5xl">
        {/* ── Hero Section ── */}
        <section className="mb-10 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-border text-xs font-medium text-foreground-muted">
              <Sparkles size={12} className="text-foreground" />
              <span>AI-powered GitHub intelligence</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Understand any codebase in minutes
            </h1>
            <p className="text-foreground-muted text-sm sm:text-base max-w-2xl leading-relaxed">
              Index a GitHub repository once. Then chat with its architecture, search symbols,
              detect bugs, generate docs, and explore commit history — all grounded in real AST-parsed code.
            </p>
          </div>

          {/* Capability chips */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { icon: MessageSquare, label: 'RAG Chat' },
              { icon: Layers, label: 'Architecture' },
              { icon: Shield, label: 'Bug Scan' },
              { icon: FileText, label: 'AI Docs' },
              { icon: GitBranch, label: 'Commits' },
              { icon: Code2, label: 'AST Symbols' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-panel text-xs font-medium text-foreground"
                >
                  <Icon size={14} className="text-foreground-muted flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
              );
            })}
          </div>

          {/* Stats strip */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-panel border border-border">
              <Database size={14} className="text-foreground-muted" />
              <span className="text-foreground-muted">Indexed repos</span>
              <span className="font-bold text-foreground tabular-nums">{repositories.length}</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-panel border border-border">
              <CheckCircle2 size={14} className="text-success" />
              <span className="text-foreground-muted">Status</span>
              <span className="font-medium text-foreground">Ready</span>
            </div>
          </div>
        </section>

        {/* ── Add Repository Card ── */}
        <div className="bg-panel rounded-2xl p-2 shadow-premium border border-border mb-8 transition-all focus-within:shadow-premium-hover focus-within:border-border-hover">
          <form onSubmit={handleAddRepo} className="flex flex-col sm:flex-row gap-2 relative">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-foreground-muted">
                <Search size={18} />
              </div>
              <input
                type="url"
                placeholder="https://github.com/owner/repository"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={isIndexing}
                className="w-full h-13 pl-12 pr-4 bg-transparent text-foreground placeholder:text-foreground-muted/50 focus:outline-none text-sm sm:text-base"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isIndexing || !repoUrl.trim()}
              className="h-12 px-6 bg-primary text-primary-foreground font-medium rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed m-1 text-sm sm:text-base shadow-sm"
            >
              {isIndexing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Indexing...</span>
                </>
              ) : (
                <>
                  <Database size={16} />
                  <span>Index Repository</span>
                </>
              )}
            </button>
          </form>

          {isIndexing && indexingStatus && (
            <div className="p-4 border-t border-border mt-2 space-y-2.5">
              <div className="flex items-center justify-between text-xs sm:text-sm font-medium">
                <div className="flex items-center gap-2 text-foreground">
                  <Loader2 size={14} className="animate-spin text-foreground" />
                  <span>{indexingStatus.message}</span>
                </div>
                <span className="text-foreground-muted">{indexingStatus.progress}%</span>
              </div>
              <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${indexingStatus.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 mb-6 bg-error/10 text-error rounded-xl text-sm border border-error/20 flex items-center gap-2.5">
            <AlertCircle size={16} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Section heading ── */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground tracking-tight">Your repositories</h2>
          {!isLoading && repositories.length > 0 && (
            <span className="text-xs text-foreground-muted">
              {repositories.length} indexed
            </span>
          )}
        </div>

        {/* ── Repositories List ── */}
        <div className="space-y-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-foreground-muted gap-2">
              <Loader2 size={24} className="animate-spin" />
              <p className="text-sm">Loading your repositories...</p>
            </div>
          ) : repositories.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl bg-panel/50">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-border text-foreground mb-3">
                <Github size={22} />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">No repositories indexed yet</h3>
              <p className="text-foreground-muted text-sm max-w-sm mx-auto">
                Paste any GitHub URL above to parse its AST structure and generate semantic code vectors.
              </p>
            </div>
          ) : (
            repositories.map((repo) => (
              <div
                key={repo.id}
                className="group bg-panel p-5 sm:p-6 rounded-2xl shadow-premium border border-border space-y-5 transition-all hover:shadow-premium-hover hover:border-border-hover"
              >
                {/* Repo header row */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base sm:text-lg text-foreground truncate">
                        {repo.fullName}
                      </h3>
                      <a
                        href={`https://github.com/${repo.fullName}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground-muted hover:text-foreground transition-colors p-1 flex-shrink-0"
                        title="Open on GitHub"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </div>

                    {repo.description && (
                      <p className="text-sm text-foreground-muted line-clamp-2">{repo.description}</p>
                    )}

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-border text-foreground">
                        <CheckCircle2 size={12} className="text-success" />
                        Indexed
                      </span>
                      {repo.defaultBranch && (
                        <span className="text-xs text-foreground-muted">
                          Branch:{' '}
                          <code className="text-xs bg-border px-1.5 py-0.5 rounded">
                            {repo.defaultBranch}
                          </code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete only in header */}
                  <button
                    onClick={() => handleOpenDeleteModal(repo.id, repo.fullName)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-error/10 hover:text-error flex-shrink-0 self-start"
                    title="Delete Repository"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* ── Unbundled feature quick-actions ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {FEATURE_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => router.push(action.getHref(repo.id))}
                        className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border border-border bg-background/60 text-left transition-all ${action.accent}`}
                        title={action.description}
                      >
                        <Icon size={16} className="text-foreground" />
                        <span className="text-xs font-semibold text-foreground leading-none">
                          {action.label}
                        </span>
                        <span className="text-[10px] text-foreground-muted leading-tight line-clamp-1">
                          {action.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Custom Delete Confirmation Modal */}
      <DeleteModal
        isOpen={isDeleteModalOpen}
        repoName={repoToDelete?.name || ''}
        isDeleting={isDeletingRepo}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!isDeletingRepo) {
            setIsDeleteModalOpen(false);
            setRepoToDelete(null);
          }
        }}
      />
    </div>
  );
}
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Search, MessageSquare, Loader2, Database, Trash2 } from 'lucide-react';
import { Github } from '@/components/icons/Github';
import { useAuthStore } from '@/store/useAuthStore';
import { api } from '@/lib/api';

interface Repository {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  indexingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [repoUrl, setRepoUrl] = useState('');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Protect route
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  const fetchRepositories = async () => {
    try {
      const response = await api.get('/api/repositories');
      if (response.data.success) {
        setRepositories(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch repositories', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchRepositories();
    }
  }, [isAuthenticated]);

  const handleLogout = () => {
    logout();
    router.replace('/');
  };

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.includes('github.com')) {
      setError('Please enter a valid GitHub repository URL.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      // Start indexing via API
      await api.post('/api/indexing/start', { repoUrl: repoUrl }, { responseType: 'stream' });
      // Actually, SSE stream response from Axios is tricky in browser. 
      // Standard way is to use native EventSource for SSE.
      // But the endpoint creates the repo. Let's just create it and redirect to a specific progress page or chat page.
      
      // Since our POST /api/indexing/start keeps the connection open for SSE, we should probably
      // use the native EventSource or fetch API to read the stream.
      // For MVP UI simplicity, we can navigate to the chat page which will handle the SSE loading state,
      // or we handle it here. 
      
      // Refresh the repositories list to get the new repo ID
      const reposResponse = await api.get('/api/repositories');
      if (reposResponse.data.success && reposResponse.data.data.length > 0) {
        setRepositories(reposResponse.data.data);
        const newRepo = reposResponse.data.data[0]; // Since it's ordered by lastIndexedAt desc
        
        // Navigate directly to the chat page!
        setRepoUrl('');
        router.push(`/chat/${newRepo.id}`);
      }
    } catch (err: unknown) {
      setError((err as any).response?.data?.error || 'Failed to start indexing.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRepo = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this repository? This will remove all indexed data.')) {
      return;
    }
    
    try {
      const response = await api.delete(`/api/repositories/${id}`);
      if (response.data.success) {
        setRepositories(prev => prev.filter(repo => repo.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete repository', err);
      alert('Failed to delete repository');
    }
  };

  if (!isAuthenticated || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-panel/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-foreground">
            <Github size={24} />
            <span>Repo-Mind</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={user.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full bg-border" />
              <span className="hidden sm:inline-block">{user.username}</span>
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

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-12">
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Your Repositories</h1>
          <p className="text-foreground-muted">Index a GitHub repository to start chatting with its codebase.</p>
        </div>

        {/* Add Repo Form */}
        <div className="bg-panel rounded-2xl p-1 shadow-premium border border-border mb-10 transition-all focus-within:shadow-premium-hover focus-within:border-border-hover">
          <form onSubmit={handleAddRepo} className="flex flex-col sm:flex-row gap-2 relative">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-foreground-muted">
                <Search size={18} />
              </div>
              <input
                type="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-transparent text-foreground placeholder:text-foreground-muted/50 focus:outline-none rounded-xl"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-14 px-8 bg-primary text-primary-foreground font-medium rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-foreground/90 disabled:opacity-70 disabled:cursor-not-allowed m-1"
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
              <span>Index Repository</span>
            </button>
          </form>
        </div>

        {error && (
          <div className="p-4 mb-8 bg-error/10 text-error rounded-xl text-sm border border-error/20">
            {error}
          </div>
        )}

        {/* Repo List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-foreground-muted">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : repositories.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-border rounded-2xl">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-border text-foreground-muted mb-4">
                <Github size={24} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">No repositories indexed</h3>
              <p className="text-foreground-muted max-w-sm mx-auto">
                Paste a GitHub URL above to securely index your codebase and start chatting.
              </p>
            </div>
          ) : (
            repositories.map((repo) => (
              <div key={repo.id} className="group bg-panel p-6 rounded-2xl shadow-premium border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:shadow-premium-hover">
                <div>
                  <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
                    {repo.fullName}
                  </h3>
                  {repo.description && (
                    <p className="text-sm text-foreground-muted mt-1 line-clamp-1">{repo.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-border text-foreground-muted">
                      {repo.indexingStatus === 'COMPLETED' ? (
                         <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                      ) : (
                         <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                      )}
                      {repo.indexingStatus}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDeleteRepo(repo.id)}
                    className="inline-flex h-10 items-center justify-center rounded-xl p-2.5 text-error/80 transition-colors hover:bg-error/10 hover:text-error"
                    title="Delete Repository"
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    onClick={() => router.push(`/chat/${repo.id}`)}
                    disabled={repo.indexingStatus !== 'COMPLETED'}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-border-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <MessageSquare size={16} />
                    Chat
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

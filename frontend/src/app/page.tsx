'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Github } from '@/components/icons/Github';
import { useAuthStore } from '@/store/useAuthStore';
import { API_BASE_URL } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleLogin = () => {
    // Redirect to backend OAuth flow
    window.location.href = `${API_BASE_URL}/api/auth/github`;
  };

  if (isAuthenticated) {
    return null; // Prevent flash of login page while redirecting
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24 bg-background">
      <div className="z-10 max-w-5xl w-full items-center justify-center flex flex-col gap-12">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="h-16 w-16 bg-foreground text-background flex items-center justify-center rounded-2xl shadow-premium mb-4">
            <Github size={32} />
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground">
            Repo-Mind
          </h1>
          <p className="text-lg text-foreground-muted max-w-xl text-balance">
            Your codebase is talking. Are you listening? Chat directly with your GitHub repositories using advanced RAG and Llama-3 AI.
          </p>
        </div>

        <button
          onClick={handleLogin}
          className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full bg-primary px-8 font-medium text-primary-foreground shadow-premium transition-all hover:bg-foreground/90 hover:shadow-premium-hover focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2"
        >
          <span className="flex items-center gap-2">
            <Github size={18} />
            Continue with GitHub
          </span>
        </button>

        <div className="mt-24 text-sm text-foreground-muted">
          Minimalistic. Fast. Open Source.
        </div>
      </div>
    </main>
  );
}

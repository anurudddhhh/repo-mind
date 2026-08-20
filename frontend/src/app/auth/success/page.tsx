'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

function AuthSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    const token = searchParams.get('token');
    const userStr = searchParams.get('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(decodeURIComponent(userStr));
        setAuth(token, user);
        router.replace('/dashboard');
      } catch (error) {
        console.error('Failed to parse user data from URL', error);
        router.replace('/');
      }
    } else {
      // Missing token or user data, send back to home
      router.replace('/');
    }
  }, [searchParams, router, setAuth]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground-muted">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground"></div>
        <p>Authenticating...</p>
      </div>
    </div>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background"></div>}>
      <AuthSuccessContent />
    </Suspense>
  );
}

'use client';

import { create } from 'zustand';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (message: string, type: ToastType) => void;
  removeToast: (id: string) => void;
}

// ─────────────────────────────────────────────────────────
// ZUSTAND STORE (Global Toast State)
// ─────────────────────────────────────────────────────────
// Why a store? So ANY component can call addToast() without
// needing to pass callbacks through props (prop drilling).
const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type) => {
    // Generate a unique ID for each toast using random string
    const id = Math.random().toString(36).substring(2, 9);

    // Add the new toast to the array
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));

    // Auto-remove after 4 seconds (4000ms)
    // Why setTimeout? So the user doesn't have to manually close every toast.
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  },

  removeToast: (id) => {
    // Manual close (when user clicks the X button)
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// ─────────────────────────────────────────────────────────
// PUBLIC HOOK — Use this in any component to show toasts
// ─────────────────────────────────────────────────────────
// Example: const { addToast } = useToast();
//          addToast("Repository deleted!", "success");
export const useToast = () => {
  const addToast = useToastStore((s) => s.addToast);
  return { addToast };
};

// ─────────────────────────────────────────────────────────
// TOAST CONTAINER — Mount ONCE in layout.tsx
// ─────────────────────────────────────────────────────────
// Why fixed positioning? So toasts float above all content
// regardless of scroll position.
// Why z-[100]? To render ABOVE modals (which use z-50).
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  // Don't render anything if there are no active toasts
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// INDIVIDUAL TOAST CARD
// ─────────────────────────────────────────────────────────
function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem;
  onClose: () => void;
}) {
  // Map each toast type to its icon and color scheme
  const config: Record<
    ToastType,
    { icon: typeof CheckCircle2; bg: string; border: string; text: string }
  > = {
    success: {
      icon: CheckCircle2,
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      text: 'text-emerald-500',
    },
    error: {
      icon: AlertCircle,
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      text: 'text-red-500',
    },
    info: {
      icon: Info,
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30',
      text: 'text-blue-500',
    },
  };

  const { icon: Icon, bg, border, text } = config[toast.type];

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-md ${bg} ${border} ${text}`}
    >
      {/* Status Icon */}
      <Icon size={18} className="flex-shrink-0" />

      {/* Message Text */}
      <span className="text-sm font-medium flex-1 text-foreground">
        {toast.message}
      </span>

      {/* Manual Close Button */}
      <button
        onClick={onClose}
        className="p-1 rounded-lg hover:bg-white/10 transition-colors text-foreground-muted hover:text-foreground"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
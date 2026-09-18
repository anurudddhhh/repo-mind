'use client';

import { useEffect } from 'react';
import { AlertTriangle, Trash2, Loader2, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────
interface DeleteModalProps {
  isOpen: boolean;
  repoName: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────
// CUSTOM DELETE CONFIRMATION MODAL
// ─────────────────────────────────────────────────────────
export function DeleteModal({
  isOpen,
  repoName,
  isDeleting,
  onConfirm,
  onClose,
}: DeleteModalProps) {
  // Listen for 'Escape' key press to close modal cleanly
  // Why useEffect? Gives users a fast, keyboard-accessible way to cancel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDeleting, onClose]);

  // Don't render anything if modal is closed
  if (!isOpen) return null;

  return (
    // Backdrop Overlay (z-50 guarantees it renders on top of page content, but below z-100 toasts)
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Backdrop click handler — closes modal when clicking outside the box */}
      <div
        className="absolute inset-0"
        onClick={() => !isDeleting && onClose()}
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-md bg-panel border border-border rounded-2xl p-6 shadow-2xl z-10 space-y-5 animate-in zoom-in-95 duration-200">
        
        {/* Header & Close Button */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">Delete Repository</h3>
              <p className="text-xs text-foreground-muted">This action cannot be undone</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 rounded-lg text-foreground-muted hover:text-foreground hover:bg-border transition-colors disabled:opacity-50"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Warning Body */}
        <div className="p-4 bg-background rounded-xl border border-border space-y-2 text-sm text-foreground-muted">
          <p>
            Are you sure you want to delete <span className="font-semibold text-foreground break-all">&quot;{repoName}&quot;</span>?
          </p>
          <p className="text-xs text-foreground-muted/80">
            This will permanently erase all indexed code vectors, AST symbols, and cached AI analyses from Pinecone, Upstash Redis, and PostgreSQL.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          {/* Cancel Button */}
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-border transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          {/* Confirm Delete Button */}
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium flex items-center gap-2 hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 size={16} />
                <span>Delete Repository</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
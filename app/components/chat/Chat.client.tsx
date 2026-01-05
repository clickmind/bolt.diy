/**
 * ChatHeader.client.tsx - Production v3.0
 *
 * Premium chat header combining Claude aesthetics with full functionality
 * ============================================================================
 * ✅ Claude-style title + dropdown button group with hover states
 * ✅ Inline rename with input field in dropdown
 * ✅ UserMenu integration (avatar dropdown)
 * ✅ Star, Rename, Add to project, Share, Delete actions
 * ✅ Visibility indicator (Public/Private)
 * ✅ View toggle (Preview/Code) when files exist
 * ✅ Upgrade button
 * ✅ Clean #ffffff background
 * ============================================================================
 */

'use client';

import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { workbenchStore } from '~/lib/stores/workbench';
import { themeStore } from '~/lib/stores/theme';
import {
  chatDescriptionStore,
  updateChatDescriptionStore,
  currentChatIdStore,
} from '~/lib/stores/chatDescription';
import { AuthAwareDB } from '~/lib/supabase/auth-sync';
import { createScopedLogger } from '~/utils/logger';
import UserDropdown from '~/components/header/UserDropdown';
import { useAuthState } from '~/components/auth/AuthManager.client';

const logger = createScopedLogger('ChatHeader');

// ════════════════════════════════════════════════════════════════════════════
//  TYPES
// ════════════════════════════════════════════════════════════════════════════

interface ChatHeaderProps {
  chatId?: string | null;
  chatTitle?: string;
  isPublic?: boolean;
  isStarred?: boolean;
  onBack?: () => void;
  onRename?: (newName: string) => Promise<boolean>;
  onToggleStar?: () => Promise<void>;
  onToggleVisibility?: () => Promise<void>;
  onShare?: () => void;
  onDelete?: () => Promise<void>;
  onAddToProject?: () => void;
  onUpgrade?: () => void;
  onSignOut?: () => void;
  showViewToggle?: boolean;
  currentView?: 'preview' | 'code';
  onViewChange?: (view: 'preview' | 'code') => void;
  className?: string;
}

// ════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const HEADER_HEIGHT = 52;

// ════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
//  HOOKS
// ════════════════════════════════════════════════════════════════════════════

function useTheme() {
  const currentTheme = useStore(themeStore);

  const isDarkTheme = useMemo(() => {
    if (currentTheme === 'dark') return true;
    if (currentTheme === 'light') return false;
    if (typeof window !== 'undefined') {
      try {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      } catch {
        // Ignore media query errors
      }
    }
    return false;
  }, [currentTheme]);

  return { isDarkTheme };
}

function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: () => void,
  isActive: boolean
) {
  useEffect(() => {
    if (!isActive) return;

    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [ref, handler, isActive]);
}

// ════════════════════════════════════════════════════════════════════════════
//  SVG ICONS
// ════════════════════════════════════════════════════════════════════════════

const ChevronDownIcon = memo(({ className = '' }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <path d="M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z" />
  </svg>
));
ChevronDownIcon.displayName = 'ChevronDownIcon';

const StarIcon = memo(({ filled = false }: { filled?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.5} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 2L12.09 7.26L18 7.97L13.82 11.64L15.18 17.52L10 14.27L4.82 17.52L6.18 11.64L2 7.97L7.91 7.26L10 2Z" />
  </svg>
));
StarIcon.displayName = 'StarIcon';

const PencilIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14.8536 3.14645C14.6583 2.95118 14.3417 2.95118 14.1464 3.14645L3.5 13.7929V16.5H6.20711L16.8536 5.85355C17.0488 5.65829 17.0488 5.34171 16.8536 5.14645L14.8536 3.14645ZM13.0858 2.08579C13.8668 1.30474 15.1332 1.30474 15.9142 2.08579L17.9142 4.08579C18.6953 4.86684 18.6953 6.13316 17.9142 6.91421L7.20711 17.6213C7.01957 17.8089 6.76522 17.9142 6.5 17.9142H3C2.44772 17.9142 2 17.4665 2 16.9142V13.4142C2 13.149 2.10536 12.8946 2.29289 12.7071L13.0858 2.08579Z" />
  </svg>
));
PencilIcon.displayName = 'PencilIcon';

const FolderPlusIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M2 5C2 3.89543 2.89543 3 4 3H7.58579C7.851 3 8.10536 3.10536 8.29289 3.29289L9.70711 4.70711C9.89464 4.89464 10.149 5 10.4142 5H16C17.1046 5 18 5.89543 18 7V15C18 16.1046 17.1046 17 16 17H4C2.89543 17 2 16.1046 2 15V5ZM10 8.5C10 8.22386 9.77614 8 9.5 8C9.22386 8 9 8.22386 9 8.5V11H6.5C6.22386 11 6 11.2239 6 11.5C6 11.7761 6.22386 12 6.5 12H9V14.5C9 14.7761 9.22386 15 9.5 15C9.77614 15 10 14.7761 10 14.5V12H12.5C12.7761 12 13 11.7761 13 11.5C13 11.2239 12.7761 11 12.5 11H10V8.5Z" />
  </svg>
));
FolderPlusIcon.displayName = 'FolderPlusIcon';

const ShareIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M13 3.5C13 2.11929 14.1193 1 15.5 1C16.8807 1 18 2.11929 18 3.5C18 4.88071 16.8807 6 15.5 6C14.6925 6 13.9752 5.60661 13.5258 5.00082L7.11565 8.20588C7.20154 8.45592 7.25 8.72257 7.25 9C7.25 9.27743 7.20154 9.54408 7.11565 9.79412L13.5258 12.9992C13.9752 12.3934 14.6925 12 15.5 12C16.8807 12 18 13.1193 18 14.5C18 15.8807 16.8807 17 15.5 17C14.1193 17 13 15.8807 13 14.5C13 14.2226 13.0485 13.9559 13.1344 13.7059L6.72424 10.5008C6.27476 11.1066 5.55752 11.5 4.75 11.5C3.36929 11.5 2.25 10.3807 2.25 9C2.25 7.61929 3.36929 6.5 4.75 6.5C5.55752 6.5 6.27476 6.89339 6.72424 7.49918L13.1344 4.29412C13.0485 4.04408 13 3.77743 13 3.5Z" />
  </svg>
));
ShareIcon.displayName = 'ShareIcon';

const CopyIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 2C6.89543 2 6 2.89543 6 4V12C6 13.1046 6.89543 14 8 14H14C15.1046 14 16 13.1046 16 12V4C16 2.89543 15.1046 2 14 2H8ZM7 4C7 3.44772 7.44772 3 8 3H14C14.5523 3 15 3.44772 15 4V12C15 12.5523 14.5523 13 14 13H8C7.44772 13 7 12.5523 7 12V4ZM4 6C4 5.44772 4.44772 5 5 5V14C5 14.5523 5.44772 15 6 15H13C13 15.5523 12.5523 16 12 16H6C4.89543 16 4 15.1046 4 14V6Z" />
  </svg>
));
CopyIcon.displayName = 'CopyIcon';

const TrashIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8.5 4C8.5 3.17157 9.17157 2.5 10 2.5C10.8284 2.5 11.5 3.17157 11.5 4H14.5C14.7761 4 15 4.22386 15 4.5C15 4.77614 14.7761 5 14.5 5H14V15C14 16.1046 13.1046 17 12 17H8C6.89543 17 6 16.1046 6 15V5H5.5C5.22386 5 5 4.77614 5 4.5C5 4.22386 5.22386 4 5.5 4H8.5ZM7 5V15C7 15.5523 7.44772 16 8 16H12C12.5523 16 13 15.5523 13 15V5H7ZM9 7.5C9 7.22386 8.77614 7 8.5 7C8.22386 7 8 7.22386 8 7.5V13.5C8 13.7761 8.22386 14 8.5 14C8.77614 14 9 13.7761 9 13.5V7.5ZM11.5 7C11.7761 7 12 7.22386 12 7.5V13.5C12 13.7761 11.7761 14 11.5 14C11.2239 14 11 13.7761 11 13.5V7.5C11 7.22386 11.2239 7 11.5 7Z" />
  </svg>
));
TrashIcon.displayName = 'TrashIcon';

const GlobeIcon = memo(() => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 2C14.4183 2 18 5.58172 18 10C18 14.4183 14.4183 18 10 18C5.58172 18 2 14.4183 2 10C2 5.58172 5.58172 2 10 2ZM13.0289 12H6.97108C7.32342 14.1214 8.29698 16 10 16C11.703 16 12.6766 14.1214 13.0289 12ZM5.94999 12H3.25879C3.77338 13.797 5.03719 15.2758 6.6845 16.0454C6.09642 15.0103 5.94999 13.528 5.94999 12ZM16.7412 12H14.05C14.05 13.528 13.9036 15.0103 13.3155 16.0454C14.9628 15.2758 16.2266 13.797 16.7412 12ZM6.6845 3.95462C5.03719 4.72424 3.77338 6.20299 3.25879 8H5.94999C5.94999 6.47203 6.09642 4.98971 6.6845 3.95462ZM10 4C8.29698 4 7.32342 5.87857 6.97108 8H13.0289C12.6766 5.87857 11.703 4 10 4ZM13.3155 3.95462C13.9036 4.98971 14.05 6.47203 14.05 8H16.7412C16.2266 6.20299 14.9628 4.72424 13.3155 3.95462Z" />
  </svg>
));
GlobeIcon.displayName = 'GlobeIcon';

const LockIcon = memo(() => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 2C12.2091 2 14 3.79086 14 6V7H15C16.1046 7 17 7.89543 17 9V16C17 17.1046 16.1046 18 15 18H5C3.89543 18 3 17.1046 3 16V9C3 7.89543 3.89543 7 5 7H6V6C6 3.79086 7.79086 2 10 2ZM15 8H5C4.44772 8 4 8.44772 4 9V16C4 16.5523 4.44772 17 5 17H15C15.5523 17 16 16.5523 16 16V9C16 8.44772 15.5523 8 15 8ZM10 11C10.5523 11 11 11.4477 11 12V14C11 14.5523 10.5523 15 10 15C9.44772 15 9 14.5523 9 14V12C9 11.4477 9.44772 11 10 11ZM10 3C8.34315 3 7 4.34315 7 6V7H13V6C13 4.34315 11.6569 3 10 3Z" />
  </svg>
));
LockIcon.displayName = 'LockIcon';

const PreviewIcon = memo(() => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 4C14.0285 4 16.6432 7.30578 17.6602 8.86621L17.7402 8.99902C18.0858 9.62459 18.0858 10.3754 17.7402 11.001L17.6602 11.1338C16.6432 12.6942 14.0285 16 10 16C6.22298 16 3.68865 13.0942 2.54883 11.4453L2.33985 11.1338C1.88802 10.4404 1.88802 9.55955 2.33985 8.86621L2.54883 8.55469C3.68865 6.90581 6.22298 4 10 4ZM10 5C6.74739 5 4.47588 7.53 3.38086 9.11035L3.17774 9.41211C2.94217 9.77359 2.94217 10.2264 3.17774 10.5879L3.38086 10.8896C4.47588 12.47 6.74739 15 10 15C13.4691 15 15.8223 12.1222 16.8223 10.5879L16.8994 10.4482C17.0321 10.1621 17.0321 9.83791 16.8994 9.55176L16.8223 9.41211C15.8223 7.87782 13.4691 5 10 5ZM10 7C11.6569 7 13 8.34315 13 10C13 11.6569 11.6569 13 10 13C8.34315 13 7 11.6569 7 10C7 8.34315 8.34315 7 10 7ZM10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8Z" />
  </svg>
));
PreviewIcon.displayName = 'PreviewIcon';

const CodeIcon = memo(() => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M11.6318 4.01757C11.898 4.09032 12.055 4.36555 11.9824 4.63183L8.98242 15.6318C8.90966 15.8981 8.63449 16.0551 8.36816 15.9824C8.10193 15.9097 7.94495 15.6345 8.01758 15.3682L11.0176 4.36816C11.0904 4.102 11.3656 3.94497 11.6318 4.01757ZM13.124 6.17089C13.3059 5.96325 13.6213 5.9423 13.8291 6.12402L17.8291 9.62402L17.9014 9.70215C17.9647 9.78754 18 9.89182 18 10C18 10.1441 17.9375 10.281 17.8291 10.376L13.8291 13.876L13.7471 13.9346C13.5449 14.0498 13.2833 14.011 13.124 13.8291C12.9649 13.6472 12.9606 13.3824 13.1016 13.1973L13.1709 13.124L16.7412 10L13.1709 6.87597C12.9632 6.69411 12.9422 6.37866 13.124 6.17089ZM6.25293 6.06542C6.45509 5.95025 6.71675 5.98908 6.87598 6.17089C7.03513 6.35279 7.03933 6.6176 6.89844 6.80273L6.8291 6.87597L3.25879 10L6.8291 13.124C7.03682 13.3059 7.05771 13.6213 6.87598 13.8291C6.69413 14.0369 6.37869 14.0578 6.1709 13.876L2.1709 10.376L2.09863 10.2979C2.03528 10.2124 2 10.1082 2 10C2.00005 9.85591 2.06247 9.71893 2.1709 9.62402L6.1709 6.12402L6.25293 6.06542Z" />
  </svg>
));
CodeIcon.displayName = 'CodeIcon';

const ZapIcon = memo(() => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M11.9835 1.00696C12.2152 1.05665 12.3918 1.24547 12.4253 1.48007L13.1667 7H17.5C17.7087 7 17.8987 7.11164 17.9966 7.29157C18.0944 7.47151 18.0848 7.69082 17.9722 7.86179L10.4722 18.8618C10.3365 19.0606 10.0893 19.1477 9.86073 19.0794C9.63214 19.0112 9.47419 18.8023 9.46428 18.5629L9.16667 11H4.5C4.28735 11 4.09439 10.8847 3.99817 10.7001C3.90194 10.5155 3.91694 10.2918 4.03717 10.1227L11.5372 0.122734C11.6787 -0.0703619 11.9298 -0.0491431 12.0835 1.00696H11.9835ZM5.72863 10H9.5C9.63868 10 9.77179 10.0555 9.87003 10.1545C9.96828 10.2535 10.0236 10.3884 10.0219 10.5282L10.2561 16.5156L16.2192 8H12.5C12.3534 8 12.2138 7.93808 12.1157 7.83046C12.0175 7.72284 11.9699 7.57976 11.984 7.43648L11.8118 2.66193L5.72863 10Z" />
  </svg>
));
ZapIcon.displayName = 'ZapIcon';

const LoaderIcon = memo(() => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg" className="animate-spin" aria-hidden="true">
    <path d="M10 2V6M10 14V18M4 10H2M18 10H16M5.17 5.17L7.29 7.29M12.71 12.71L14.83 14.83M5.17 14.83L7.29 12.71M12.71 7.29L14.83 5.17" />
  </svg>
));
LoaderIcon.displayName = 'LoaderIcon';

// ════════════════════════════════════════════════════════════════════════════
//  TOOLTIP COMPONENT
// ════════════════════════════════════════════════════════════════════════════

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  placement?: 'top' | 'bottom';
  disabled?: boolean;
}

const Tooltip = memo(({ children, content, placement = 'bottom', disabled = false }: TooltipProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showTooltip = useCallback(() => {
    if (disabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsVisible(true), 600);
  }, [disabled]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (disabled) return <>{children}</>;

  return (
    <div className="relative inline-flex" onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: placement === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: placement === 'top' ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            className={classNames(
              'absolute z-[10001] px-2 py-1 text-xs font-medium rounded-md whitespace-nowrap pointer-events-none',
              'bg-gray-900 text-white shadow-lg',
              placement === 'top'
                ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
                : 'top-full mt-2 left-1/2 -translate-x-1/2'
            )}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

Tooltip.displayName = 'Tooltip';

// ════════════════════════════════════════════════════════════════════════════
//  GHOST BUTTON
// ════════════════════════════════════════════════════════════════════════════

interface GhostButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
}

const GhostButton = memo(({ onClick, children, disabled = false, tooltip, className = '' }: GhostButtonProps) => {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'inline-flex items-center justify-center relative shrink-0',
        'select-none disabled:pointer-events-none disabled:opacity-40',
        'border-transparent transition-all duration-200',
        'ease-[cubic-bezier(0.165,0.85,0.45,1)]',
        'h-8 w-8 rounded-lg active:scale-95',
        'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        className
      )}
    >
      {children}
    </button>
  );

  if (tooltip) {
    return <Tooltip content={tooltip} disabled={disabled}>{button}</Tooltip>;
  }

  return button;
});

GhostButton.displayName = 'GhostButton';

// ════════════════════════════════════════════════════════════════════════════
//  LOGO COMPONENT
// ════════════════════════════════════════════════════════════════════════════

const SupaLogo = memo(({ className = '' }: { className?: string }) => (
  <svg
    fill="currentColor"
    viewBox="0 0 694 469"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={classNames('inline-block', className)}
  >
    <title>SupaCoder</title>
    <path d="M174.1 1.1C133.3 5.4 97.3 23.3 69.4 53.3c-22.3 24-34.7 53.2-37.3 87.7-2.8 37.4 7.8 69 30.8 92.1 14.2 14.1 36.7 26.8 59.4 33.3 4.9 1.4 33 8 62.5 14.6 53 12 96.8 22.1 102.7 23.8 8.3 2.5 16.3 8.8 18.4 14.5 3.2 8.4-.9 22.3-8.5 28.5-5.9 4.9-16.5 10-25.1 12.3-7.2 1.8-12.1 2-59.8 2.6-83.9.9-92.1-.7-102.3-20.2-2.2-4.1-4.7-7.5-6.2-8.2-3.5-1.8-92.7-1.9-96.5-.1-4.1 1.9-5.6 6-6.7 19.5-1.3 14.4-.1 30.1 3.2 42.1 9.7 35 40.5 60.1 85 69.3 16.4 3.4 38.2 4.1 105.9 3.6 57.7-.4 64.8-.6 76.6-2.5 44.3-7 77.5-22.4 110-51.1 25.8-22.7 44.2-53.8 51.1-86.1 2.5-12.1 3-34.7.9-47.1-4.7-28.6-19.2-50.8-43-66.1-19.6-12.6-28.3-15.3-116-35.3-23.1-5.3-55.7-12.8-72.5-16.6-32.9-7.5-39-9.7-44.3-16-5.6-6.4-6.8-12.8-4.2-21.6 3-10 11.4-17.6 23.9-21.6l7.1-2.2h242l6.1 2.8c3.4 1.6 7.9 4.7 10.1 7s16.4 19 31.5 37.2c15.1 18.1 34.8 41.5 43.7 52 23.6 27.6 27.2 32.6 27.8 37.8l.5 4.4-20.3 23.9c-45.2 53.3-81.6 96.2-101.4 119.9-11.5 13.7-27.5 32.6-35.5 41.9s-15.5 18.2-16.8 19.9c-2.6 3.6-2.8 8.5-.7 12.7 3.1 6.1 2.7 6 56.2 6.1 30.1 0 50.9-.4 54.3-1.1 13.1-2.5 23-6.5 30.3-12.3 2.1-1.6 10.2-10.4 18-19.6 65.5-76.5 137.3-159.8 149.8-173.8 14-15.6 15.5-18.6 12.7-24.7-1.8-3.6-6.2-8.9-106-128.6-43.4-52.1-76.5-90.9-79.1-92.7C497.9 8 483 2.8 466.8 1c-10.5-1.2-281.1-1.1-292.7.1" />
  </svg>
));

SupaLogo.displayName = 'SupaLogo';

// ════════════════════════════════════════════════════════════════════════════
//  CLAUDE-STYLE CHAT TITLE WITH DROPDOWN
// ════════════════════════════════════════════════════════════════════════════

interface ChatTitleDropdownProps {
  chatId: string | null | undefined;
  title: string;
  isStarred?: boolean;
  isPublic?: boolean;
  onRename?: (newName: string) => Promise<boolean>;
  onToggleStar?: () => Promise<void>;
  onToggleVisibility?: () => Promise<void>;
  onAddToProject?: () => void;
  onShare?: () => void;
  onDelete?: () => Promise<void>;
}

const ChatTitleDropdown = memo(({
  chatId,
  title,
  isStarred = false,
  isPublic = false,
  onRename,
  onToggleStar,
  onToggleVisibility,
  onAddToProject,
  onShare,
  onDelete,
}: ChatTitleDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with stores
  const description = useStore(chatDescriptionStore);
  const currentChatId = useStore(currentChatIdStore);

  const displayTitle = description || title || 'New Chat';

  // Update rename value when title changes
  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(displayTitle);
    }
  }, [displayTitle, isRenaming]);

  // Close handler
  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setIsRenaming(false);
  }, []);

  useClickOutside(dropdownRef, closeDropdown, isOpen);

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleTitleClick = useCallback(() => {
    setIsRenaming(true);
    setIsOpen(true);
  }, []);

  const handleDropdownToggle = useCallback(() => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setIsRenaming(false);
    }
  }, [isOpen]);

  const handleRenameSave = useCallback(async () => {
    if (!renameValue.trim() || renameValue.trim() === displayTitle) {
      setIsRenaming(false);
      return;
    }

    const targetChatId = chatId || currentChatId;
    if (!targetChatId) {
      toast.error('No chat selected');
      return;
    }

    setIsLoading(true);

    try {
      let success = false;

      if (onRename) {
        success = await onRename(renameValue.trim());
      } else {
        try {
          await updateChatDescriptionStore(targetChatId, renameValue.trim());
          currentChatIdStore.set(targetChatId);

          const result = await AuthAwareDB.update('supa_chats', targetChatId, {
            description: renameValue.trim(),
            updated_at: new Date().toISOString(),
          });

          success = !!result;
        } catch (e) {
          logger.error('Failed to update chat description:', e);
          success = false;
        }
      }

      if (success) {
        setIsRenaming(false);

        window.dispatchEvent(
          new CustomEvent('chatDescriptionUpdated', {
            detail: {
              chatId: targetChatId,
              description: renameValue.trim(),
              timestamp: Date.now(),
              source: 'chat-header-rename',
            },
          })
        );

        toast.success('Chat renamed');
      } else {
        toast.error('Failed to rename');
      }
    } catch (error) {
      logger.error('Rename error:', error);
      toast.error('Failed to rename');
    } finally {
      setIsLoading(false);
    }
  }, [renameValue, displayTitle, chatId, currentChatId, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsRenaming(false);
        setRenameValue(displayTitle);
      }
    },
    [handleRenameSave, displayTitle]
  );

  const handleDelete = useCallback(async () => {
    if (!onDelete || isDeleting) return;

    const confirmed = window.confirm('Are you sure you want to delete this chat? This action cannot be undone.');
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete();
      setIsOpen(false);
    } catch (error) {
      logger.error('Delete failed:', error);
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, isDeleting]);

  const handleCopyLink = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast.success('Link copied');
    setIsOpen(false);
  }, []);

  return (
    <div className="relative flex min-w-0 shrink items-center" ref={dropdownRef}>
      {/* Claude-style button group */}
      <div className="flex items-center group [&:hover>button]:bg-gray-100">
        {/* Title Button */}
        <button
          type="button"
          onClick={handleTitleClick}
          className={classNames(
            'inline-flex items-center justify-center',
            'shrink min-w-0 px-2.5 py-0 h-8',
            'rounded-lg rounded-r-none',
            'transition-all duration-200 ease-[cubic-bezier(0.165,0.85,0.45,1)]',
            'select-none whitespace-nowrap',
            'text-gray-700 hover:text-gray-900',
            'active:scale-[0.98]'
          )}
          data-testid="chat-title-button"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm max-w-[180px] sm:max-w-[280px]">
              {displayTitle}
            </div>
          </div>
        </button>

        {/* Spacer */}
        <div className="w-px h-4 bg-gray-200" />

        {/* Dropdown Trigger */}
        <button
          type="button"
          onClick={handleDropdownToggle}
          className={classNames(
            'inline-flex items-center justify-center',
            'h-8 w-7 rounded-lg rounded-l-none',
            'transition-all duration-200 ease-[cubic-bezier(0.165,0.85,0.45,1)]',
            'text-gray-500 hover:text-gray-700',
            'active:scale-[0.98]'
          )}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="chat-menu-trigger"
        >
          <ChevronDownIcon className={classNames('transition-transform duration-200', isOpen && 'rotate-180')} />
        </button>
      </div>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="absolute left-0 top-full mt-2 z-50 min-w-[220px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
            role="menu"
          >
            {/* Rename Input (when active) */}
            {isRenaming && (
              <div className="px-1 py-1.5 mb-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRenameSave}
                  disabled={isLoading}
                  className={classNames(
                    'w-full px-2.5 py-2 text-sm rounded-lg border outline-none',
                    'transition-colors bg-gray-50 border-gray-200 text-gray-900',
                    'focus:border-gray-300 focus:bg-white',
                    isLoading && 'opacity-50 cursor-not-allowed'
                  )}
                  placeholder="Chat name..."
                  maxLength={100}
                />
              </div>
            )}

            {/* Star */}
            {onToggleStar && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await onToggleStar();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
              >
                <StarIcon filled={isStarred} />
                <span className="flex-1 truncate">{isStarred ? 'Unstar' : 'Star'}</span>
                {isStarred && <span className="text-yellow-500">★</span>}
              </button>
            )}

            {/* Rename */}
            {!isRenaming && (
              <button
                type="button"
                role="menuitem"
                onClick={() => setIsRenaming(true)}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
              >
                <PencilIcon />
                <span className="flex-1 truncate">Rename</span>
              </button>
            )}

            {/* Toggle Visibility */}
            {onToggleVisibility && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await onToggleVisibility();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
              >
                {isPublic ? <LockIcon /> : <GlobeIcon />}
                <span className="flex-1 truncate">{isPublic ? 'Make private' : 'Make public'}</span>
              </button>
            )}

            {/* Add to Project */}
            {onAddToProject && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onAddToProject();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
              >
                <FolderPlusIcon />
                <span className="flex-1 truncate">Add to project</span>
              </button>
            )}

            {/* Share */}
            {onShare && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onShare();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
              >
                <ShareIcon />
                <span className="flex-1 truncate">Share</span>
              </button>
            )}

            {/* Copy Link */}
            <button
              type="button"
              role="menuitem"
              onClick={handleCopyLink}
              className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-gray-700 hover:bg-gray-100"
            >
              <CopyIcon />
              <span className="flex-1 truncate">Copy link</span>
            </button>

            {/* Divider */}
            {onDelete && (
              <div role="separator" className="h-px my-1.5 mx-1 bg-gray-200" />
            )}

            {/* Delete */}
            {onDelete && (
              <button
                type="button"
                role="menuitem"
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full flex items-center gap-2.5 min-h-9 px-2.5 py-2 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors outline-none select-none text-red-600 hover:bg-red-50"
              >
                {isDeleting ? <LoaderIcon /> : <TrashIcon />}
                <span className="flex-1 truncate">Delete</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

ChatTitleDropdown.displayName = 'ChatTitleDropdown';

// ════════════════════════════════════════════════════════════════════════════
//  VISIBILITY BADGE
// ════════════════════════════════════════════════════════════════════════════

interface VisibilityBadgeProps {
  isPublic: boolean;
}

const VisibilityBadge = memo(({ isPublic }: VisibilityBadgeProps) => (
  <Tooltip content={isPublic ? 'Public chat' : 'Private chat'}>
    <div
      className={classNames(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
        isPublic
          ? 'bg-emerald-50 text-emerald-600'
          : 'bg-gray-100 text-gray-600'
      )}
    >
      {isPublic ? <GlobeIcon /> : <LockIcon />}
      <span className="hidden md:inline">{isPublic ? 'Public' : 'Private'}</span>
    </div>
  </Tooltip>
));

VisibilityBadge.displayName = 'VisibilityBadge';

// ════════════════════════════════════════════════════════════════════════════
//  VIEW TOGGLE (Segmented Control)
// ════════════════════════════════════════════════════════════════════════════

interface ViewToggleProps {
  currentView: 'preview' | 'code';
  onViewChange: (view: 'preview' | 'code') => void;
}

const ViewToggle = memo(({ currentView, onViewChange }: ViewToggleProps) => {
  const isPreview = currentView === 'preview';

  return (
    <div className="inline-flex h-8 p-0.5 rounded-lg bg-gray-100">
      <Tooltip content="Preview">
        <button
          type="button"
          onClick={() => onViewChange('preview')}
          className={classNames(
            'flex items-center justify-center h-7 w-7 rounded-md transition-all duration-200',
            isPreview
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <PreviewIcon />
        </button>
      </Tooltip>

      <Tooltip content="Code">
        <button
          type="button"
          onClick={() => onViewChange('code')}
          className={classNames(
            'flex items-center justify-center h-7 w-7 rounded-md transition-all duration-200',
            !isPreview
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <CodeIcon />
        </button>
      </Tooltip>
    </div>
  );
});

ViewToggle.displayName = 'ViewToggle';

// ════════════════════════════════════════════════════════════════════════════
//  MAIN CHAT HEADER COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export const ChatHeader = memo(({
  chatId,
  chatTitle = 'New Chat',
  isPublic = false,
  isStarred = false,
  onBack,
  onRename,
  onToggleStar,
  onToggleVisibility,
  onShare,
  onDelete,
  onAddToProject,
  onUpgrade,
  onSignOut,
  showViewToggle = false,
  currentView = 'preview',
  onViewChange,
  className = '',
}: ChatHeaderProps) => {
  const navigate = useNavigate();
  const authState = useAuthState();
  const files = useStore(workbenchStore.files);

  const hasFiles = Object.keys(files || {}).length > 0;

  const handleViewChange = useCallback((view: 'preview' | 'code') => {
    onViewChange?.(view);

    try {
      workbenchStore.currentView.set(view);
      localStorage.setItem('workbench.selectedView', view);
    } catch (e) {
      logger.warn('Failed to persist view preference:', e);
    }
  }, [onViewChange]);

  const handleSignOut = useCallback(() => {
    if (onSignOut) {
      onSignOut();
    }
  }, [onSignOut]);

  return (
    <header
      className={classNames(
        'flex items-center justify-between gap-3',
        'px-3 sm:px-4',
        'border-b border-gray-200',
        className
      )}
      style={{
        height: HEADER_HEIGHT,
        backgroundColor: '#ffffff',
      }}
    >
      {/* ═══════════════════════════════════════════════════════════════════
          LEFT SECTION: User Menu + Logo + Chat Title
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        {/* User Dropdown */}
        {authState.isAuthenticated && onSignOut && (
          <UserDropdown
            userEmail={authState.user?.email}
            onSignOut={handleSignOut}
            position="below"
            context="header"
          />
        )}

        {/* Logo */}
        <Link
          to="/"
          className="hidden sm:flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <SupaLogo className="w-5 h-5 text-gray-900" />
        </Link>

        {/* Separator */}
        <span className="hidden sm:block text-lg text-gray-300 select-none">/</span>

        {/* Claude-style Chat Title with Dropdown */}
        <ChatTitleDropdown
          chatId={chatId}
          title={chatTitle}
          isStarred={isStarred}
          isPublic={isPublic}
          onRename={onRename}
          onToggleStar={onToggleStar}
          onToggleVisibility={onToggleVisibility}
          onAddToProject={onAddToProject}
          onShare={onShare}
          onDelete={onDelete}
        />

        {/* Visibility Badge */}
        <div className="hidden sm:flex">
          <VisibilityBadge isPublic={isPublic} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          RIGHT SECTION: Actions
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* View Toggle */}
        {showViewToggle && hasFiles && (
          <div className="hidden sm:block">
            <ViewToggle
              currentView={currentView}
              onViewChange={handleViewChange}
            />
          </div>
        )}

        {/* Star Button (quick action) */}
        {onToggleStar && (
          <GhostButton
            onClick={onToggleStar}
            tooltip={isStarred ? 'Unstar' : 'Star'}
            className="hidden sm:inline-flex"
          >
            <StarIcon filled={isStarred} />
          </GhostButton>
        )}

        {/* Share Button */}
        {onShare && (
          <GhostButton
            onClick={onShare}
            tooltip="Share"
            className="hidden sm:inline-flex"
          >
            <ShareIcon />
          </GhostButton>
        )}

        {/* Upgrade Button */}
        {onUpgrade && (
          <button
            type="button"
            onClick={onUpgrade}
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ZapIcon />
            <span className="hidden lg:inline">Upgrade</span>
          </button>
        )}
      </div>
    </header>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;

// app/components/chat/Chat.client.tsx - FINAL FIXED VERSION

'use client';

import React, { 
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  Suspense,
} from 'react';
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { toast } from 'sonner';

// Core utilities
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { cubicEasingFn } from '~/utils/easings';
import { debounce } from '~/utils/debounce';

// Constants
const FIXED_MODEL = 'claude-sonnet-4-20250514';
const FIXED_PROVIDER_NAME = 'Anthropic';
const PROMPT_COOKIE_KEY = 'prompt';

// Types
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';

// External libraries
import Cookies from 'js-cookie';
import { useNavigate, useLocation, useParams } from '@remix-run/react';

// Store imports
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { inspectorStore, inspectorManager } from '~/lib/stores/inspector';
import { profileStore } from '~/lib/stores/profile';
import { 
  chatDescriptionStore, 
  updateChatDescriptionStore,
  currentChatIdStore,
} from '~/lib/stores/chatDescription';

// Component-specific utilities
import { filesToArtifacts } from '~/utils/fileUtils';

// Template selection utilities
import { selectStarterTemplate, getTemplates } from '~/utils/selectStarterTemplate';

// Use the persistence system
import {
  useChatHistory,
  description as chatDescriptionAtom,
} from '~/lib/persistence';

// Hook imports
import {
  useMessageParser,
  usePromptEnhancer,
  useShortcuts,
} from '~/lib/hooks';
import { useSettings } from '~/lib/hooks/useSettings';

// Import the URL prompt hook
import { useUrlPrompt } from '~/lib/urlPrompt';

// Import the deployment hook
import { useDeployment } from '~/lib/hooks/useDeployment';

// Import the credit utilities
import { 
  useCredits, 
  UltraFastCreditUtils
} from '~/lib/hooks/useCredits';
import { useAuthState } from '~/components/auth/AuthManager.client';

// Components
import { BaseChat } from './BaseChat';

const logger = createScopedLogger('Chat');

// ========== PERFORMANCE ERROR HANDLER ==========
const errorHandler = {
  handleError: (error: unknown, context: string): boolean => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[Chat] ${context}:`, errorMessage);
    return true;
  }
};

// ========== CRITICAL FIX: OPTIMIZED MESSAGE FILTERING ==========
const processedMessageIds = new Set<string>();

const shouldDisplayMessage = (message: any): boolean => {
  if (!message?.content) return true;
  
  // CRITICAL: Only process each message ID once
  if (processedMessageIds.has(message.id)) {
    return !message._isHidden;
  }
  
  let contentStr = '';
  
  // Handle different content structures properly
  if (typeof message.content === 'string') {
    contentStr = message.content;
  } else if (Array.isArray(message.content)) {
    // Extract text from content array
    contentStr = message.content
      .map(item => typeof item === 'string' ? item : item?.text || '')
      .join(' ');
  } else if (message.content?.text) {
    contentStr = message.content.text;
  } else {
    contentStr = JSON.stringify(message.content);
  }
  
  const hasHiddenPrompt = contentStr.includes('[HIDDEN_URL_PROMPT]') || 
                         contentStr.includes('[Model: claude-3-7-sonnet-latest]');
  
  // Mark message as processed and store result
  processedMessageIds.add(message.id);
  message._isHidden = hasHiddenPrompt;
  
  if (hasHiddenPrompt) {
    logger.debug('Hiding URL prompt message:', message.id);
  }
  
  return !hasHiddenPrompt;
};

// Clear processed IDs periodically to prevent memory leaks
setInterval(() => {
  if (processedMessageIds.size > 200) {
    processedMessageIds.clear();
  }
}, 60000);

// ========== FILE ATTACHMENT UTILITIES ==========
// Helper function to convert File[] to Attachment[] for AI SDK (from old working code)
const filesToAttachments = async (files: File[]): Promise<any[] | undefined> => {
  if (files.length === 0) {
    return undefined;
  }

  const attachments = await Promise.all(
    files.map(
      (file) =>
        new Promise<any>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              name: file.name,
              contentType: file.type,
              url: reader.result as string,
            });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );

  return attachments;
};
const cookieOperations = {
  get: (key: string): string | undefined => {
    try {
      return typeof window !== 'undefined' ? Cookies.get(key) : undefined;
    } catch {
      return undefined;
    }
  },
  set: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined') {
        Cookies.set(key, value, { expires: 1 });
      }
    } catch {}
  },
  remove: (key: string): void => {
    try {
      if (typeof window !== 'undefined') {
        Cookies.remove(key);
      }
    } catch {}
  }
};

// ========== CHAT ID MANAGEMENT ==========
const generateChatId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  }
};

const isValidChatId = (chatId: string | null | undefined): chatId is string => {
  return Boolean(chatId && typeof chatId === 'string' && chatId.length > 5);
};

// ========== ENHANCED TITLE EXTRACTION ==========
const extractTitle = (message: string): string => {
  if (!message || message.length < 3) return 'New Project';

  const cleanMessage = message
    .replace(/^\[(?:Model|Provider|HIDDEN_URL_PROMPT|URL_PROMPT):.*?\]\s*/gi, '')
    .replace(/^(create|build|make|write|help|can\s+you|please)\s+/i, '')
    .trim();

  if (!cleanMessage) return 'New Project';

  const firstPhrase = cleanMessage.split(/[.!?;,]/)[0].substring(0, 40).trim();
  if (firstPhrase.length < 3) return 'New Project';

  const title = firstPhrase.charAt(0).toUpperCase() + firstPhrase.slice(1);
  return cleanMessage.length > 40 ? title + '...' : title;
};

// ========== CHAT ID HOOK ==========
const useChatId = () => {
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  
  const getCurrentChatIdFromUrl = useCallback((): string | null => {
    try {
      const pathname = location.pathname;
      const patterns = [
        /\/chat\/([^\/\?#]+)/,
        /\/c\/([^\/\?#]+)/,
      ];
      
      for (const pattern of patterns) {
        const match = pathname.match(pattern);
        if (match?.[1] && match[1] !== 'new') {
          const chatId = decodeURIComponent(match[1]);
          if (chatId.length >= 8) {
            return chatId;
          }
        }
      }
      return null;
    } catch (error) {
      logger.warn('Error extracting chat ID from URL:', error);
      return null;
    }
  }, [location.pathname]);
  
  useEffect(() => {
    const pathChatId = params.id;
    const urlChatId = getCurrentChatIdFromUrl();
    
    let targetChatId: string | null = null;
    
    if (pathChatId && isValidChatId(pathChatId)) {
      targetChatId = pathChatId;
    } else if (urlChatId && isValidChatId(urlChatId)) {
      targetChatId = urlChatId;
    }
    
    if (targetChatId && targetChatId !== currentChatId) {
      logger.info('Chat ID detected from route:', {
        targetChatId: targetChatId.substring(0, 8),
        source: 'route-detection'
      });
      
      setCurrentChatId(targetChatId);
      currentChatIdStore.set(targetChatId);
    }
  }, [params.id, location.pathname, currentChatId, getCurrentChatIdFromUrl]);

  const createNewChat = useCallback(() => {
    const newChatId = generateChatId();
    logger.info('Creating new chat:', newChatId.substring(0, 8));
    
    setCurrentChatId(newChatId);
    navigate(`/chat/${newChatId}`, { replace: true });
    currentChatIdStore.set(newChatId);
    
    return newChatId;
  }, [navigate]);

  return { 
    chatId: currentChatId, 
    isValid: isValidChatId(currentChatId), 
    createNewChat
  };
};

// ========== STREAMING STATE ==========
const useStreaming = () => {
  const [isStreaming, setIsStreaming] = useState(false);
  
  const setStreaming = useCallback((streaming: boolean) => {
    logger.info(`Setting streaming state: ${streaming}`);
    setIsStreaming(streaming);
  }, []);

  const forceStopStreaming = useCallback(() => {
    logger.info('Force stopping streaming');
    setIsStreaming(false);
  }, []);

  return { isStreaming, setStreaming, forceStopStreaming };
};

// ========== MAIN CHAT COMPONENT ==========
export const Chat = memo(function Chat() {
  renderLogger.trace('Chat');
  
  const [isHydrated, setIsHydrated] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  
  const selectedElement = useStore(inspectorStore.selectedElement);
  const title = useStore(chatDescriptionAtom);

  // Use the persistence hook
  const {
    ready,
    initialMessages,
    storeMessageHistory,
    importChat,
    exportChat,
    hasError,
    errorMessage,
    retryInitialization,
    isConnected = true,
    chatInitialized = true,
    isNavigating = false,
  } = useChatHistory();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (hasError && isHydrated) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <h2 className="text-lg font-semibold text-red-700 mb-2">Chat Loading Error</h2>
          <p className="text-sm text-red-600 mb-4">{errorMessage}</p>
          <div className="space-x-2">
            <button 
              onClick={retryInitialization} 
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    }>      
      <ChatImpl
        description={title}
        initialMessages={initialMessages || []}
        exportChat={exportChat}
        storeMessageHistory={storeMessageHistory}
        importChat={importChat}
        isHydrated={isHydrated}
        navigate={navigate}
        location={location}
        selectedElement={selectedElement}
        onElementSelect={(element) => inspectorStore.setSelectedElement(element)}
        isConnected={isConnected}
        chatInitialized={chatInitialized}
        isNavigating={isNavigating}
      />
    </Suspense>
  );
});

// ========== CHAT IMPLEMENTATION ==========
interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  isHydrated: boolean;
  navigate: any;
  location: any;
  selectedElement: ElementInfo | null;
  onElementSelect: (element: ElementInfo | null) => void;
  isConnected: boolean;
  chatInitialized: boolean;
  isNavigating?: boolean;
}

const ChatImpl = memo(function ChatImpl(props: ChatProps) {
  useShortcuts();
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [animationScope, animate] = useAnimate();
  
  const [chatStarted, setChatStarted] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [imageDataList, setImageDataList] = useState<string[]>([]);
  const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
  const [apiKeys] = useState<Record<string, string>>({});
  const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
  const [sendAttempts, setSendAttempts] = useState(0);
  
  // CRITICAL FIX: Better template state management
  const [templateState, setTemplateState] = useState({
    isProcessing: false,
    hasProcessed: false,
    lastProcessedInput: '',
  });
  
  const { chatId: currentChatId, createNewChat } = useChatId();
  
  // Enhanced authentication and credit systems
  const authState = useAuthState();
  const {
    creditsAvailable,
    creditCount,
    creditLimit,
    accountStatus,
    dailyRemaining,
    monthlyRemaining,
    consumeCredits,
    refreshCredits,
    showUpgradeModal,
    isReady: creditsReady,
    isLoading: creditsLoading,
    error: creditsError,
  } = useCredits();
  
  const { isStreaming, setStreaming, forceStopStreaming } = useStreaming();
  
  // URL prompt with hook
  const {
    promptData: urlPromptData,
    isProcessed: hasProcessedUrlPrompt,
    processPrompt,
    clearPrompt: clearUrlPrompt
  } = useUrlPrompt();

  // Auto-deploy with hook
  const {
    isDeploying,
    currentPreviewUrl,
    deploymentError,
    triggerManualDeploy,
    canDeploy,
    isUsingNetlify,
    hasNetlifyUrl,
    hasWebcontainerUrl,
    markDeploymentReady,
  } = useDeployment(currentChatId, {
    userId: authState.userId,
    autoDeployEnabled: true,
    onDeploySuccess: (url, version) => {
      logger.info('Deployment succeeded:', { url, version, chatId: currentChatId?.substring(0, 8) });
    },
    onDeployError: (error) => {
      logger.error('Deployment failed:', { error, chatId: currentChatId?.substring(0, 8) });
    },
  });

  // Store subscriptions
  const { showChat } = useStore(chatStore);
  const files = useStore(workbenchStore.files);
  const actionAlert = useStore(workbenchStore.alert);

  // Settings
  const { contextOptimizationEnabled = false } = useSettings() || {};

  // Enhanced useChat hook with better error handling
  const {
    messages,
    isLoading,
    input,
    handleInputChange,
    setInput,
    stop,
    append,
    setMessages,
    reload,
    error,
    data: chatData,
  } = useChat({
    api: '/api/chat',
    body: {
      apiKeys,
      files,
      contextOptimization: contextOptimizationEnabled,
      chatMode,
      designScheme,
      model: FIXED_MODEL,
      provider: FIXED_PROVIDER_NAME,
      chatId: currentChatId,
      resumable: true,
    },
    sendExtraMessageFields: true,
    onError: (e) => {
      errorHandler.handleError(e, 'chatRequest');
      setStreaming(false);
      forceStopStreaming();
      
      logger.error('Chat request error:', {
        message: e.message,
        chatId: currentChatId?.substring(0, 8),
        stack: e.stack
      });
      
      if (e.message?.includes('API key')) {
        toast.error('API configuration error. Please contact support.');
      } else {
        toast.error('Request failed. Please try again.');
      }
    },
    onFinish: async (message) => {
      logger.info('Chat response finished:', {
        messageId: message.id,
        chatId: currentChatId?.substring(0, 8)
      });
      setStreaming(false);
      setSendAttempts(0); // Reset send attempts on successful completion
      setTimeout(markDeploymentReady, 1000);
    },
    onResponse: async (response) => {
      if (!response.ok) {
        logger.error('Chat API response error:', {
          status: response.status,
          statusText: response.statusText,
          chatId: currentChatId?.substring(0, 8)
        });
      } else {
        logger.info('Chat API response received:', {
          status: response.status,
          chatId: currentChatId?.substring(0, 8)
        });
      }
    },
    initialMessages: props.initialMessages,
    initialInput: cookieOperations.get(PROMPT_COOKIE_KEY) || '',
  });

  // CRITICAL FIX: Better chat started state management
  useEffect(() => {
    const hasInitialMessages = props.initialMessages && props.initialMessages.length > 0;
    const hasActiveMessages = messages && messages.length > 0;
    
    if (hasInitialMessages || hasActiveMessages) {
      if (!chatStarted) {
        logger.info('Setting chatStarted to true (has messages)', {
          initialCount: props.initialMessages?.length || 0,
          activeCount: messages?.length || 0,
          chatId: currentChatId?.substring(0, 8)
        });
        setChatStarted(true);
        chatStore.setKey('started', true);
        workbenchStore.setShowWorkbench(true);
      }
    }
  }, [
    props.initialMessages?.length, 
    messages?.length, 
    chatStarted, 
    currentChatId
  ]);

  // Streaming state synchronization
  useEffect(() => {
    if (isStreaming !== isLoading) {
      setStreaming(isLoading);
    }
  }, [isLoading, setStreaming, isStreaming]);

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const runAnimation = useCallback(async () => {
    if (chatStarted) return;
    
    try {
      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);
      
      chatStore.setKey('started', true);
      setChatStarted(true);
    } catch {
      setChatStarted(true);
    }
  }, [chatStarted, animate]);

  // ========== CRITICAL FIX: COMPLETELY REWRITTEN SEND MESSAGE ==========
  const sendMessage = useCallback(async (_event: React.UIEvent, messageInput?: string) => {
    const messageContent = messageInput || input;
    if (!messageContent?.trim()) {
      logger.warn('No message content provided');
      return;
    }

    // CRITICAL: Prevent rapid double submissions
    if (isLoading || isStreaming) {
      logger.info('Already processing, stopping current stream...');
      stop();
      setStreaming(false);
      forceStopStreaming();
      return;
    }

    // Prevent multiple rapid submissions
    if (sendAttempts > 0) {
      logger.warn('Send already in progress, ignoring duplicate call');
      return;
    }

    setSendAttempts(prev => prev + 1);

    // Auth check
    if (!authState.isAuthenticated) {
      setSendAttempts(0);
      toast.error('Please sign in to send messages');
      authState.redirectToLogin?.();
      return;
    }

    // Credit check
    if (!creditsReady || !UltraFastCreditUtils.hasCreditsInstant()) {
      setSendAttempts(0);
      if (!creditsReady) {
        toast.error('Credit system loading. Please wait...');
        return;
      }
      toast.error('Credit limit reached. Please upgrade to continue.');
      showUpgradeModal();
      return;
    }

    try {
      logger.info('Starting message send process...', {
        messageLength: messageContent.length,
        isNewChat: !chatStarted,
        chatId: currentChatId?.substring(0, 8)
      });

      // Set streaming state
      setStreaming(true);
      
      // CRITICAL FIX: Template processing only for truly new chats
      const isNewChat = !chatStarted && messages.length === 0;
      const shouldCheckTemplate = isNewChat && 
                                 messageContent.length > 10 && 
                                 !templateState.isProcessing && 
                                 templateState.lastProcessedInput !== messageContent;
      
      if (shouldCheckTemplate) {
        logger.info('Checking template for new chat...', { messageLength: messageContent.length });
        setTemplateState(prev => ({ 
          ...prev, 
          isProcessing: true, 
          lastProcessedInput: messageContent 
        }));
        
        try {
          const templateResult = await selectStarterTemplate({ 
            message: messageContent, 
            model: FIXED_MODEL, 
            provider: { name: FIXED_PROVIDER_NAME } 
          });
          
          if (templateResult && templateResult.template !== 'blank') {
            logger.info('Template selected:', templateResult.template);
            
            const templateResponse = await getTemplates(templateResult.template, templateResult.title);
            
            if (templateResponse?.assistantMessage) {
              logger.info('Template loaded successfully, executing template flow...');
              
              // Create chat if needed
              let effectiveChatId = currentChatId;
              if (!isValidChatId(effectiveChatId)) {
                effectiveChatId = createNewChat();
              }

              // Set up UI state for new chat
              setChatStarted(true);
              chatStore.setKey('started', true);
              runAnimation();
              workbenchStore.setShowWorkbench(true);

              // Clear inputs
              setInput('');
              cookieOperations.remove(PROMPT_COOKIE_KEY);
              setUploadedFiles([]);
              setImageDataList([]);
              resetEnhancer();

              // Update description
              updateChatDescriptionStore(templateResult.title || extractTitle(messageContent));
              
              // CRITICAL: Create the 3-message pattern like the working code
              const userMessageText = `[Model: ${FIXED_MODEL}]\n\n[Provider: ${FIXED_PROVIDER_NAME}]\n\n${messageContent}`;
              
              const messages: Message[] = [
                {
                  id: `1-${Date.now()}`,
                  role: 'user',
                  content: userMessageText,
                },
                {
                  id: `2-${Date.now()}`,
                  role: 'assistant', 
                  content: templateResponse.assistantMessage,
                },
                {
                  id: `3-${Date.now()}`,
                  role: 'user',
                  content: `[Model: ${FIXED_MODEL}]\n\n[Provider: ${FIXED_PROVIDER_NAME}]\n\n${templateResponse.userMessage || 'Continue building this application.'}`,
                  annotations: ['hidden'],
                },
              ];

              // Set all messages at once
              setMessages(messages);
              
              // Mark template as processed
              setTemplateState(prev => ({
                ...prev,
                isProcessing: false,
                hasProcessed: true
              }));
              
              // Use reload to process the message sequence
              logger.info('Starting template AI response...');
              
              // Wait for state to settle then reload
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Handle file attachments if any (like the old code)
              const reloadOptions = uploadedFiles.length > 0 
                ? { experimental_attachments: await filesToAttachments(uploadedFiles) } 
                : undefined;
              
              reload(reloadOptions);
              
              logger.info('Template processing completed successfully');
              setSendAttempts(0);
              return;
            }
          }
          
          logger.info('No template selected or template failed, proceeding with normal flow');
        } catch (templateError) {
          logger.warn('Template processing failed:', templateError);
        } finally {
          setTemplateState(prev => ({ ...prev, isProcessing: false }));
        }
      }

      // NORMAL MESSAGE FLOW
      logger.info('Executing normal message flow...');

      // Handle URL prompt marker
      let finalMessageContent = messageContent;
      const isUrlPromptSubmission = urlPromptData?.isValid && messageContent.trim() === urlPromptData.prompt.trim();
      if (isUrlPromptSubmission) {
        finalMessageContent = `[HIDDEN_URL_PROMPT] ${messageContent}`;
        logger.info('Added URL prompt marker');
      }

      // Consume credits
      const creditConsumed = await consumeCredits(1);
      if (!creditConsumed) {
        setSendAttempts(0);
        toast.error('Unable to process message. Please try again or upgrade.');
        showUpgradeModal();
        return;
      }

      // Add element info if selected
      if (props.selectedElement) {
        const elementInfo = `<div class="__boltSelectedElement__" data-element='${JSON.stringify(props.selectedElement)}'>${JSON.stringify(props.selectedElement.displayText)}</div>`;
        finalMessageContent = finalMessageContent + elementInfo;
      }

      // Handle new vs existing chat
      if (!chatStarted) {
        // NEW CHAT FLOW
        logger.info('Processing new chat...');
        
        let effectiveChatId = currentChatId;
        if (!isValidChatId(effectiveChatId)) {
          effectiveChatId = createNewChat();
        }

        // Set up new chat state
        workbenchStore.setShowWorkbench(true);
        setChatStarted(true);
        chatStore.setKey('started', true);
        runAnimation();

        // Create new message with proper format
        const newMessages: Message[] = [{
          id: `${Date.now()}`,
          role: 'user',
          content: `[Model: ${FIXED_MODEL}]\n\n[Provider: ${FIXED_PROVIDER_NAME}]\n\n${finalMessageContent}`,
        }];

        setMessages(newMessages);
        
        // Clear inputs
        setInput('');
        cookieOperations.remove(PROMPT_COOKIE_KEY);
        setUploadedFiles([]);
        setImageDataList([]);
        resetEnhancer();
        textareaRef.current?.blur();
        
        // Start reload after short delay
        setTimeout(() => {
          reload();
          setSendAttempts(0);
        }, 100);

        return;
      }

      // EXISTING CHAT FLOW
      logger.info('Processing existing chat...');
      
      if (error) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();
      chatStore.setKey('aborted', false);

      // Create message content based on file modifications
      const baseContent = `[Model: ${FIXED_MODEL}]\n\n[Provider: ${FIXED_PROVIDER_NAME}]\n\n`;
      
      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const fullContent = baseContent + userUpdateArtifact + finalMessageContent;
        
        await append({
          role: 'user',
          content: fullContent,
        });
        workbenchStore.resetAllFileModifications();
      } else {
        await append({
          role: 'user',
          content: baseContent + finalMessageContent,
        });
      }

      // Clear inputs
      setInput('');
      cookieOperations.remove(PROMPT_COOKIE_KEY);
      setUploadedFiles([]);
      setImageDataList([]);
      resetEnhancer();
      textareaRef.current?.blur();
      
      setSendAttempts(0);

    } catch (err) {
      errorHandler.handleError(err, 'sendMessage');
      setStreaming(false);
      forceStopStreaming();
      setSendAttempts(0);
      logger.error('Chat error:', err, { chatId: currentChatId?.substring(0, 8) });
      toast.error('Failed to send message. Please try again.');
    }
  }, [
    input, isLoading, isStreaming, messages, error, chatStarted, imageDataList, 
    props.selectedElement, currentChatId, createNewChat, templateState, sendAttempts,
    append, setInput, setMessages, reload, resetEnhancer, stop, setStreaming, 
    forceStopStreaming, runAnimation, authState.isAuthenticated,
    authState.redirectToLogin, creditsReady, consumeCredits,
    showUpgradeModal, urlPromptData, updateChatDescriptionStore, extractTitle
  ]);

  // Enhanced URL prompt auto-submission
  useEffect(() => {
    const attemptUrlPromptAutoSubmission = async () => {
      if (!urlPromptData?.isValid || hasProcessedUrlPrompt || chatStarted) {
        return;
      }

      logger.info('URL Prompt Auto-Submit Check:', {
        hasUrlPrompt: urlPromptData?.isValid,
        promptLength: urlPromptData?.prompt?.length,
        isAuthenticated: authState.isAuthenticated,
        authReady: authState.isReady,
        creditsAvailable,
        creditsReady,
        hasProcessedUrlPrompt,
        chatStarted
      });

      if (!authState.isReady || authState.isLoading) {
        logger.info('Waiting for auth to be ready...');
        return;
      }

      if (authState.isAuthenticated && creditsReady && creditsAvailable) {
        logger.info('Auto-submitting URL prompt for authenticated user');
        
        try {
          await processPrompt(
            async (prompt) => {
              await sendMessage({} as any, prompt);
            },
            (prompt) => {
              setInput(prompt);
              if (textareaRef.current) {
                textareaRef.current.focus();
                textareaRef.current.setSelectionRange(prompt.length, prompt.length);
              }
            },
            authState.isAuthenticated,
            textareaRef
          );
          
          logger.info('URL prompt auto-submitted successfully');
          
          try {
            const cleanUrl = new URL(window.location.href);
            if (cleanUrl.pathname.startsWith('/c/')) {
              cleanUrl.pathname = '/';
            }
            cleanUrl.search = '';
            cleanUrl.hash = '';
            window.history.replaceState({}, '', cleanUrl.toString());
          } catch (error) {
            logger.warn('URL cleaning failed:', error);
          }
          
        } catch (error) {
          logger.error('URL prompt auto-submission failed:', error);
          toast.error('Failed to process shared prompt');
        }
      } 
      else if (!authState.isAuthenticated) {
        logger.info('Populating input for unauthenticated user');
        
        await processPrompt(
          async (prompt) => {
            await sendMessage({} as any, prompt);
          },
          (prompt) => {
            setInput(prompt);
            if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(prompt.length, prompt.length);
            }
          },
          authState.isAuthenticated,
          textareaRef
        );
        
        try {
          const cleanUrl = new URL(window.location.href);
          if (cleanUrl.pathname.startsWith('/c/')) {
            cleanUrl.pathname = '/';
          }
          cleanUrl.search = '';
          cleanUrl.hash = '';
          window.history.replaceState({}, '', cleanUrl.toString());
        } catch (error) {
          logger.warn('URL cleaning failed:', error);
        }
      }
      else {
        logger.info('Waiting for credits/auth system...', {
          authReady: authState.isReady,
          creditsReady,
          creditsAvailable
        });
      }
    };

    const timer = setTimeout(attemptUrlPromptAutoSubmission, 1000);
    return () => clearTimeout(timer);
  }, [
    urlPromptData?.isValid,
    urlPromptData?.prompt,
    authState.isAuthenticated,
    authState.isReady,
    authState.isLoading,
    creditsAvailable,
    creditsReady,
    hasProcessedUrlPrompt,
    chatStarted,
    sendMessage,
    textareaRef,
    setInput,
    processPrompt
  ]);

  // Message processing with optimized filtering
  useEffect(() => {
    try {
      parseMessages(messages, isLoading);
      
      if (messages.length > props.initialMessages.length && !isLoading && currentChatId) {
        const storeMessages = () => {
          const filteredMessages = messages.filter(shouldDisplayMessage);
          props.storeMessageHistory(filteredMessages).catch((error) => {
            logger.debug('Message storage error (non-critical):', error);
          });
        };
        
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(storeMessages);
        } else {
          debounce(storeMessages, 1000)();
        }
      }
    } catch (error) {
      errorHandler.handleError(error, 'messageProcessing');
    }
  }, [messages, isLoading, parseMessages, props.initialMessages.length, props.storeMessageHistory, currentChatId]);

  // Memoize filtered messages to prevent excessive recalculation
  const filteredMessages = useMemo(() => {
    return messages.filter(shouldDisplayMessage);
  }, [messages.length, messages.map(m => m.id).join(',')]);

  const deploymentInfo = useMemo(() => ({
    url: currentPreviewUrl,
    isDeploying,
    error: deploymentError,
    history: [],
    currentVersion: 1,
    canDeploy,
    isAutoEnabled: true,
    onManualDeploy: triggerManualDeploy,
    debugInfo: { isUsingNetlify, hasNetlifyUrl, hasWebcontainerUrl },
    siteId: undefined,
    lastDeployedAt: undefined,
    totalVersions: 1,
    netlifyData: undefined,
  }), [currentPreviewUrl, isDeploying, deploymentError, canDeploy, triggerManualDeploy, isUsingNetlify, hasNetlifyUrl, hasWebcontainerUrl]);

  return (
    <div className="relative h-full">
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isStreaming}
        onStreamingChange={setStreaming}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={FIXED_MODEL}
        setModel={() => {}}
        provider={{ name: FIXED_PROVIDER_NAME }}
        setProvider={() => {}}
        providerList={[{ name: FIXED_PROVIDER_NAME }]}
        handleInputChange={(e) => {
          handleInputChange(e);
          debounce(() => cookieOperations.set(PROMPT_COOKIE_KEY, e.target.value.trim()), 1000)();
        }}
        handleStop={() => {
          stop();
          setStreaming(false);
          forceStopStreaming();
          setSendAttempts(0);
        }}
        description={props.description}
        importChat={props.importChat}
        exportChat={props.exportChat}
        messages={filteredMessages.map((message, i) => 
          message.role === 'user' ? message : { ...message, content: parsedMessages[i] || '' }
        )}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (enhanced) => setInput(enhanced),
            FIXED_MODEL,
            { name: FIXED_PROVIDER_NAME },
            apiKeys
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={null}
        clearSupabaseAlert={() => {}}
        deployAlert={null}
        clearDeployAlert={() => {}}
        data={chatData}
        isAuthenticated={authState.isAuthenticated}
        isAuthLoading={authState.isLoading}
        redirectToLogin={authState.redirectToLogin}
        creditsAvailable={creditsAvailable}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        allMessages={filteredMessages}
        currentChatId={currentChatId}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={props.selectedElement}
        setSelectedElement={props.onElementSelect}
        onRetryFromMessage={() => {}}
        onFork={() => {}}
        onEditMessage={() => {}}
        onDeleteMessage={() => {}}
        creditInfo={{
          available: creditsAvailable,
          count: creditCount,
          limit: creditLimit,
          accountStatus: accountStatus,
          dailyRemaining: dailyRemaining,
          monthlyRemaining: monthlyRemaining
        }}
        connectionStatus={{ isConnected: props.isConnected, chatInitialized: props.chatInitialized }}
        deploymentInfo={deploymentInfo}
        seamlessDeployState={{
          isReady: !!currentPreviewUrl,
          hasActivePreview: !!currentPreviewUrl,
          previewUrl: currentPreviewUrl,
          isDeployingToNetlify: isDeploying,
          hasNetlifyDeployment: hasNetlifyUrl,
          localPreviewUrl: hasWebcontainerUrl ? currentPreviewUrl : null,
          netlifyUrl: hasNetlifyUrl ? currentPreviewUrl : null,
          deploymentFailed: !!deploymentError,
          lastError: deploymentError,
          debugInfo: { deploymentAttempted: true, deploymentSuccess: hasNetlifyUrl, usingNetlify: isUsingNetlify }
        }}
        versionContext={{
          currentVersion: null,
          versions: [],
          isVersioning: true,
          canCreateVersion: filteredMessages.length > 0,
          createManualVersion: async () => {},
          loadVersionHistory: async () => {}
        }}
        currentChatVersion={null}
        versioningEnabled={true}
        urlPromptData={urlPromptData}
        isProcessingUrlPrompt={templateState.isProcessing}
        hasAutoSubmitted={hasProcessedUrlPrompt}
        onUrlPromptProcess={clearUrlPrompt}
        userName={authState.userDisplayName}
        userEmail={authState.userEmail}
        reasoningData={{}}
        enableReasoning={true}
        onReasoningUpdate={() => {}}
        resumableStreamData={{
          currentStreamId: null,
          streamContent: '',
          isResuming: false,
          canResume: false,
        }}
      />
    </div>
  );
});

Chat.displayName = 'Chat';
export default Chat;

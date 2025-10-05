// app/lib/.server/llm/stream-text.ts
import {
  convertToCoreMessages,
  streamText as _streamText,
  type CoreMessage,
} from 'ai';
import {
  MAX_TOKENS,
  PROVIDER_COMPLETION_LIMITS,
  isReasoningModel,
  type FileMap,
} from './constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  MODIFICATIONS_TAG_NAME,
  PROVIDER_LIST,
  WORK_DIR,
} from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';

export type Messages = CoreMessage[];

export interface StreamingOptions
  extends Omit<Parameters<typeof _streamText>[0], 'model' | 'messages' | 'system' | 'maxTokens'> {
  supabaseConnection?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: {
      anonKey?: string;
      supabaseUrl?: string;
    };
  };
}

const logger = createScopedLogger('stream-text');

function getCompletionTokenLimit(modelDetails: any): number {
  // 1) Model-specific completion limit
  if (modelDetails.maxCompletionTokens && modelDetails.maxCompletionTokens > 0) {
    return modelDetails.maxCompletionTokens;
  }
  // 2) Provider default
  const providerDefault = PROVIDER_COMPLETION_LIMITS[modelDetails.provider];
  if (providerDefault) return providerDefault;

  // 3) Fallback
  return Math.min(MAX_TOKENS, 16384);
}

function sanitizeText(text: string): string {
  if (typeof text !== 'string') return '';
  let sanitized = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/gs, '');
  sanitized = sanitized.replace(/<think(?:\s+[^>]*)?>[\s\S]*?<\/think>/gs, '');
  sanitized = sanitized.replace(
    /<boltAction type="file" filePath="package-lock\.json">[\s\S]*?<\/boltAction>/g,
    '',
  );
  return sanitized.trim();
}

function sanitizeContent(content: CoreMessage['content']): CoreMessage['content'] {
  if (typeof content === 'string') return sanitizeText(content);

  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return { ...part, text: sanitizeText(part.text) };
      }
      return part;
    });
  }

  // Unknown content shape → stringify then sanitize
  return sanitizeText(String((content as any) ?? ''));
}

export async function streamText(props: {
  messages: Omit<CoreMessage, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatMode?: 'discuss' | 'build';
  designScheme?: DesignScheme;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    chatMode = 'build',
    designScheme,
  } = props;

  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  // Sanitize + extract potential model/provider hints from user messages
  let processedMessages: Omit<CoreMessage, 'id'>[] = messages.map((message) => {
    const next: any = { ...message };

    // normalize/sanitize content
    next.content = sanitizeContent(message.content);

    if (message.role === 'user') {
      try {
        const { model, provider } = extractPropertiesFromMessage(message as any);
        if (model) currentModel = model;
        if (provider) currentProvider = provider;
      } catch {
        // ignore if hints not present
      }
    }
    // AI SDK v5 doesn't use `parts`; it uses message.content array. If you had
    // legacy `parts`, they’re already handled via sanitizeContent above.
    delete (next as any).parts;

    return next as CoreMessage;
  });

  const provider =
    PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;

  const llm = LLMManager.getInstance();
  const staticModels = llm.getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await llm.getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      if (provider.name === 'Google' && currentModel.includes('2.5')) {
        throw new Error(
          `Model "${currentModel}" not found. Gemini 2.5 Pro doesn't exist. Valid Gemini models include gemini-1.5-pro, gemini-2.0-flash, gemini-1.5-flash.`,
        );
      }

      logger.warn(
        `MODEL [${currentModel}] not found for provider [${provider.name}]. Falling back to: ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const dynamicMaxTokens = modelDetails
    ? getCompletionTokenLimit(modelDetails)
    : Math.min(MAX_TOKENS, 16384);

  // v5: always pass `maxTokens` (there is no `maxCompletionTokens` in streamText options)
  const safeMaxTokens = dynamicMaxTokens;

  logger.info(
    `Token limits for model ${modelDetails.name}: maxTokens=${safeMaxTokens}, maxTokenAllowed=${modelDetails.maxTokenAllowed}, maxCompletionTokens=${modelDetails.maxCompletionTokens}`,
  );

  // Build system prompt
  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      designScheme,
      supabase: {
        isConnected: options?.supabaseConnection?.isConnected || false,
        hasSelectedProject:
          options?.supabaseConnection?.hasSelectedProject || false,
        credentials: options?.supabaseConnection?.credentials || undefined,
      },
    }) ?? getSystemPrompt();

  if (chatMode === 'build' && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);

    systemPrompt = `${systemPrompt}

Below is the artifact containing the context loaded into the context buffer for you to have knowledge of and might need changes to fulfill the current user request.

CONTEXT BUFFER:
---
${codeContext}
---
`;

    if (summary) {
      systemPrompt = `${systemPrompt}
Below is the chat history till now.

CHAT SUMMARY:
---
${summary}
---
`;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const last = processedMessages.pop();
        if (last) processedMessages = [last];
      }
    }
  }

  // Locked files banner
  const effectiveLockedFilePaths = new Set<string>();
  if (files) {
    for (const [filePath, fileDetails] of Object.entries(files)) {
      if ((fileDetails as any)?.isLocked) effectiveLockedFilePaths.add(filePath);
    }
  }

  if (effectiveLockedFilePaths.size > 0) {
    const lockedFilesList = Array.from(effectiveLockedFilePaths)
      .map((p) => `- ${p}`)
      .join('\n');
    systemPrompt = `${systemPrompt}

IMPORTANT: The following files are locked and MUST NOT be modified:
${lockedFilesList}
---`;
  } else {
    logger.debug('No locked files found for prompt.');
  }

  logger.info(
    `Sending LLM call to ${provider.name} with model ${modelDetails.name}`,
  );

  const isReasoning = isReasoningModel(modelDetails.name);
  logger.info(
    `Model "${modelDetails.name}" is reasoning model: ${isReasoning}. Using maxTokens=${safeMaxTokens}`,
  );

  if (safeMaxTokens > (modelDetails.maxTokenAllowed || 128000)) {
    logger.warn(
      `Token limit warning: requesting ${safeMaxTokens} tokens but model supports max ${modelDetails.maxTokenAllowed || 128000}`,
    );
  }

  // Filter out sampling params if you want stricter reasoning behavior.
  // (Not strictly necessary for v5, but keeps your older intent intact.)
  const filteredOptions =
    isReasoning && options
      ? Object.fromEntries(
          Object.entries(options).filter(
            ([key]) =>
              ![
                'temperature',
                'topP',
                'presencePenalty',
                'frequencyPenalty',
                'logprobs',
                'topLogprobs',
                'logitBias',
              ].includes(key),
          ),
        )
      : options || {};

  // Compose final call
  const streamParams: Parameters<typeof _streamText>[0] = {
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    system: chatMode === 'build' ? systemPrompt : discussPrompt(),
    messages: convertToCoreMessages(processedMessages as any),
    maxTokens: safeMaxTokens,
    // If you need to pass provider-specific reasoning flags, attach here via providerOptions:
    // providerOptions: { openai: { reasoning: { effort: 'medium' } } }
    ...(filteredOptions as any),
    ...(isReasoning ? { temperature: 1 } : {}), // optional: keep your old behavior
  };

  logger.info(
    `DEBUG STREAM: Final streaming params for model "${modelDetails.name}":`,
    JSON.stringify(
      {
        hasTemperature: 'temperature' in streamParams,
        hasMaxTokens: 'maxTokens' in streamParams,
        paramKeys: Object.keys(streamParams).filter(
          (k) => !['model', 'messages', 'system'].includes(k),
        ),
      },
      null,
      2,
    ),
  );

  return _streamText(streamParams);
}

// app/lib/persistence/chats.ts - SUPABASE ONLY: Complete chat management functions
import { createScopedLogger } from '~/utils/logger';
import type { Message } from 'ai';

const logger = createScopedLogger('Chats');

export interface IChatMetadata {
  gitUrl?: string;
  gitBranch?: string;
  netlifySiteId?: string;
  [key: string]: any;
}

export interface Chat {
  id: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  urlId?: string;
  metadata?: IChatMetadata;
}

// Get Supabase client with enhanced error handling
async function getSupabaseClient(): Promise<{ client: any; userId: string }> {
  try {
    const { getSupabaseClient } = await import('~/lib/supabase/client');
    const client = await getSupabaseClient();
    
    if (!client) {
      throw new Error('Supabase client not available');
    }

    const { data: { session }, error } = await client.auth.getSession();
    
    if (error || !session?.user?.id) {
      throw new Error('No valid user session found');
    }

    return { client, userId: session.user.id };
  } catch (error) {
    logger.error('Failed to get Supabase client:', error);
    throw error;
  }
}

// Timeout wrapper for operations
async function withTimeout<T>(operation: Promise<T>, operationType: string, timeoutMs: number = 10000): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error(`${operationType} timeout (${timeoutMs}ms)`)), timeoutMs)
  );
  return Promise.race([operation, timeoutPromise]);
}

// Get all chats for the current user
export async function getAllChats(): Promise<Chat[]> {
  try {
    logger.debug('Loading all chats from Supabase...');
    
    const { client, userId } = await getSupabaseClient();

    const operation = client
      .from('supa_chats')
      .select(`
        id,
        url_id,
        description,
        title,
        created_at,
        updated_at,
        metadata,
        message_count,
        last_activity_at
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .eq('archived', false)
      .order('last_activity_at', { ascending: false })
      .limit(100);

    const { data: chatData, error } = await withTimeout(operation, 'getAllChats');
    
    if (error) {
      throw new Error(`Failed to load chats: ${error.message}`);
    }

    const chats: Chat[] = (chatData || []).map((chat: any) => ({
      id: chat.id,
      description: chat.description || chat.title || 'Untitled Chat',
      messages: [], // Messages loaded separately for performance
      timestamp: chat.created_at,
      urlId: chat.url_id || chat.id,
      metadata: {
        ...chat.metadata,
        messageCount: chat.message_count || 0,
        updatedAt: chat.updated_at,
        lastActivity: chat.last_activity_at
      }
    }));

    logger.info(`Loaded ${chats.length} chats successfully`);
    return chats;

  } catch (error: any) {
    logger.error('Error in getAllChats:', error);
    throw error;
  }
}

// Get chat by ID with messages
export async function getChatById(id: string): Promise<Chat | null> {
  try {
    if (!id || typeof id !== 'string') {
      logger.warn('Invalid chat ID provided:', id);
      return null;
    }

    logger.debug(`Loading chat ${id.substring(0, 8)} from Supabase...`);
    
    const { client, userId } = await getSupabaseClient();

    // Load chat metadata
    const chatOperation = client
      .from('supa_chats')
      .select(`
        id,
        url_id,
        description,
        title,
        created_at,
        updated_at,
        metadata,
        message_count
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .eq('archived', false)
      .or(`id.eq.${id},url_id.eq.${id}`)
      .single();

    const { data: chatData, error: chatError } = await withTimeout(chatOperation, 'getChatById');
    
    if (chatError) {
      if (chatError.code === 'PGRST116') {
        logger.debug(`Chat ${id.substring(0, 8)} not found`);
        return null;
      }
      throw new Error(`Failed to load chat: ${chatError.message}`);
    }

    if (!chatData) {
      logger.debug(`No chat data returned for ${id.substring(0, 8)}`);
      return null;
    }

    // Load messages for this chat
    const messagesOperation = client
      .from('supa_messages')
      .select(`
        id,
        message_id,
        role,
        content,
        annotations,
        created_at
      `)
      .eq('chat_id', chatData.id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    const { data: messagesData, error: messagesError } = await withTimeout(messagesOperation, 'getMessages');
    
    if (messagesError) {
      logger.warn(`Failed to load messages for chat ${id.substring(0, 8)}:`, messagesError);
    }

    const messages: Message[] = (messagesData || []).map((msg: any) => ({
      id: msg.message_id,
      role: msg.role,
      content: msg.content,
      annotations: msg.annotations || [],
      createdAt: msg.created_at
    }));

    const chat: Chat = {
      id: chatData.id,
      description: chatData.description || chatData.title || 'Untitled Chat',
      messages,
      timestamp: chatData.created_at,
      urlId: chatData.url_id || chatData.id,
      metadata: chatData.metadata || {}
    };

    logger.debug(`Loaded chat ${id.substring(0, 8)}: ${messages.length} messages`);
    return chat;

  } catch (error: any) {
    logger.error(`Error in getChatById for ${id?.substring(0, 8)}:`, error);
    return null;
  }
}

// Save chat to Supabase
export async function saveChat(chat: Chat): Promise<void> {
  try {
    if (!chat || typeof chat !== 'object') {
      throw new Error('Invalid chat object provided');
    }

    if (!chat.id || typeof chat.id !== 'string') {
      throw new Error('Invalid chat ID');
    }

    if (!Array.isArray(chat.messages)) {
      throw new Error('Invalid messages array');
    }

    logger.debug(`Saving chat ${chat.id.substring(0, 8)}: ${chat.messages.length} messages`);
    
    const { client, userId } = await getSupabaseClient();
    const now = new Date().toISOString();
    const sanitizedDescription = chat.description?.trim() || 'New Chat';

    // Check if chat exists
    const { data: existingChat } = await client
      .from('supa_chats')
      .select('id, created_at')
      .eq('id', chat.id)
      .eq('user_id', userId)
      .single();

    const baseData = {
      id: chat.id,
      user_id: userId,
      url_id: chat.urlId || chat.id,
      description: sanitizedDescription,
      title: sanitizedDescription,
      metadata: chat.metadata || {},
      status: 'active',
      updated_at: now,
      message_count: chat.messages.length,
      last_activity_at: now,
      archived: false
    };

    if (existingChat) {
      // Update existing chat
      const { error: updateError } = await client
        .from('supa_chats')
        .update(baseData)
        .eq('id', chat.id)
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`Failed to update chat: ${updateError.message}`);
      }
      logger.debug(`Updated existing chat: ${chat.id.substring(0, 8)}`);
    } else {
      // Create new chat
      const insertData = {
        ...baseData,
        created_at: chat.timestamp || now
      };

      const { error: insertError } = await client
        .from('supa_chats')
        .insert(insertData);

      if (insertError) {
        throw new Error(`Failed to insert chat: ${insertError.message}`);
      }
      logger.debug(`Created new chat: ${chat.id.substring(0, 8)}`);
    }

    // Handle messages
    if (chat.messages.length > 0) {
      // Delete existing messages first
      const { error: deleteError } = await client
        .from('supa_messages')
        .delete()
        .eq('chat_id', chat.id)
        .eq('user_id', userId);

      if (deleteError) {
        logger.warn(`Failed to delete existing messages: ${deleteError.message}`);
      }

      // Prepare new messages
      const messageData = chat.messages
        .filter(msg => msg && msg.role && msg.content)
        .map((msg, index) => ({
          message_id: msg.id || `${Date.now()}-${index}`,
          chat_id: chat.id,
          user_id: userId,
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          annotations: Array.isArray(msg.annotations) ? msg.annotations : [],
          status: 'active',
          created_at: msg.createdAt || new Date(Date.now() + index * 100).toISOString(),
          updated_at: now
        }));

      if (messageData.length > 0) {
        // Insert messages in batches
        const batchSize = 50;
        for (let i = 0; i < messageData.length; i += batchSize) {
          const batch = messageData.slice(i, i + batchSize);
          
          const { error: messagesError } = await client
            .from('supa_messages')
            .insert(batch);

          if (messagesError) {
            throw new Error(`Failed to insert message batch: ${messagesError.message}`);
          }
        }
        logger.debug(`Inserted ${messageData.length} messages in ${Math.ceil(messageData.length / batchSize)} batches`);
      }
    }

    logger.info(`Saved chat ${chat.id.substring(0, 8)} successfully`);

  } catch (error: any) {
    logger.error(`Error in saveChat for ${chat?.id?.substring(0, 8)}:`, error);
    throw error;
  }
}

// Delete chat from Supabase
export async function deleteChat(id: string): Promise<void> {
  try {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid chat ID provided');
    }

    logger.debug(`Deleting chat ${id.substring(0, 8)}...`);
    
    const { client, userId } = await getSupabaseClient();

    // Soft delete - mark as deleted and archived
    const operation = client
      .from('supa_chats')
      .update({
        status: 'deleted',
        archived: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', userId);

    const { error } = await withTimeout(operation, 'deleteChat');
    
    if (error) {
      throw new Error(`Failed to delete chat: ${error.message}`);
    }

    logger.info(`Deleted chat ${id.substring(0, 8)} successfully`);

  } catch (error: any) {
    logger.error(`Error in deleteChat for ${id?.substring(0, 8)}:`, error);
    throw error;
  }
}

// Delete all chats for current user
export async function deleteAllChats(): Promise<void> {
  try {
    logger.warn('Deleting ALL chats for current user...');
    
    const { client, userId } = await getSupabaseClient();

    const operation = client
      .from('supa_chats')
      .update({ 
        status: 'deleted',
        archived: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('status', 'active');

    const { error, count } = await withTimeout(operation, 'deleteAllChats');
    
    if (error) {
      throw new Error(`Failed to delete all chats: ${error.message}`);
    }

    logger.info(`All chats deleted successfully for user ${userId.substring(0, 8)}`, { 
      deletedCount: count || 'unknown'
    });

  } catch (error: any) {
    logger.error('Error in deleteAllChats:', error);
    throw error;
  }
}

// Additional utility functions

// Search chats by content
export async function searchChats(query: string, options: {
  limit?: number;
  includeMessages?: boolean;
  caseSensitive?: boolean;
} = {}): Promise<Chat[]> {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      logger.warn('Invalid search query provided');
      return [];
    }

    const { limit = 20, includeMessages = true, caseSensitive = false } = options;
    const searchTerm = caseSensitive ? query.trim() : query.trim().toLowerCase();
    
    logger.debug(`Searching chats for: "${searchTerm.substring(0, 50)}..."`);

    const allChats = await getAllChats();
    
    const matchingChats = allChats.filter(chat => {
      // Search in description
      const description = chat.description || '';
      const descMatch = caseSensitive 
        ? description.includes(searchTerm)
        : description.toLowerCase().includes(searchTerm);
      
      if (descMatch) return true;
      
      // Search in messages if enabled
      if (includeMessages && chat.messages) {
        return chat.messages.some(message => {
          const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          return caseSensitive 
            ? content.includes(searchTerm)
            : content.toLowerCase().includes(searchTerm);
        });
      }
      
      return false;
    });

    const limitedResults = matchingChats.slice(0, limit);

    logger.info(`Search completed: ${limitedResults.length} results for "${searchTerm.substring(0, 30)}..."`);
    return limitedResults;

  } catch (error: any) {
    logger.error('Error in searchChats:', error);
    return [];
  }
}

// Get chat statistics
export async function getChatStatistics(): Promise<{
  totalChats: number;
  totalMessages: number;
  averageMessagesPerChat: number;
  oldestChat: string | null;
  newestChat: string | null;
} | null> {
  try {
    logger.debug('Getting chat statistics...');
    
    const { client, userId } = await getSupabaseClient();

    const { data: stats, error } = await client
      .from('supa_chats')
      .select('id, created_at, message_count')
      .eq('user_id', userId)
      .eq('status', 'active')
      .eq('archived', false);
    
    if (error) {
      throw new Error(`Failed to get statistics: ${error.message}`);
    }

    if (!stats || stats.length === 0) {
      return {
        totalChats: 0,
        totalMessages: 0,
        averageMessagesPerChat: 0,
        oldestChat: null,
        newestChat: null
      };
    }

    const totalMessages = stats.reduce((sum, chat) => sum + (chat.message_count || 0), 0);
    const averageMessagesPerChat = Math.round(totalMessages / stats.length);
    
    const sortedChats = stats
      .filter(chat => chat.created_at)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
    const result = {
      totalChats: stats.length,
      totalMessages,
      averageMessagesPerChat,
      oldestChat: sortedChats.length > 0 ? sortedChats[0].created_at : null,
      newestChat: sortedChats.length > 0 ? sortedChats[sortedChats.length - 1].created_at : null
    };

    logger.info('Chat statistics calculated:', result);
    return result;

  } catch (error: any) {
    logger.error('Error in getChatStatistics:', error);
    return null;
  }
}

// Export all functions as default
export default {
  getAllChats,
  getChatById,
  saveChat,
  deleteChat,
  deleteAllChats,
  searchChats,
  getChatStatistics
};

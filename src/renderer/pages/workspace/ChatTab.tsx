import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, User, Loader, ChevronDown, Sparkles } from 'lucide-react';
import type { OnChainWorkspace } from '../../context/Web3Context';

const API_BASE = 'http://localhost:8080/api/v1';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
}

interface OllamaModel {
  name: string;
  size: number;
  parameterSize?: string;
  family?: string;
}

// Persist conversations across tab switches (module-level)
const conversationCache: Map<string, ChatMessage[]> = new Map();

interface Props {
  workspace: OnChainWorkspace;
  workspaceId: string;
}

export function ChatTab({ workspace, workspaceId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    conversationCache.get(workspaceId) || []
  );
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cache conversations
  useEffect(() => {
    if (messages.length > 0) conversationCache.set(workspaceId, messages);
  }, [messages, workspaceId]);

  // Load models
  useEffect(() => {
    fetch(`${API_BASE}/ollama/models`)
      .then(r => r.json())
      .then(data => {
        const modelList = Array.isArray(data) ? data : [];
        setModels(modelList);
        if (modelList.length > 0 && !selectedModel) {
          // Prefer smaller models for chat
          const preferred = modelList.find((m: OllamaModel) =>
            m.name.includes('qwen') || m.name.includes('gemma') || m.name.includes('llama')
          );
          setSelectedModel(preferred?.name || modelList[0].name);
        }
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const buildSystemPrompt = (): string => {
    return `You are an AI assistant for the "${workspace.name}" workspace on OtherThing, a decentralized dev platform. ${workspace.description ? `Workspace description: ${workspace.description}. ` : ''}This workspace has ${Number(workspace.memberCount)} members. Help the team with development tasks, code questions, architecture decisions, and project planning. Be concise and technical.`;
  };

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isStreaming || !selectedModel) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText('');
    setIsStreaming(true);
    setStreamingContent('');

    // Build messages for Ollama
    const ollamaMessages = [
      { role: 'system', content: buildSystemPrompt() },
      ...updatedMessages.map(m => ({ role: m.role, content: m.content })),
    ];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/ollama/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, messages: ollamaMessages }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start chat stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.error) throw new Error(chunk.error);
            if (chunk.message?.content) {
              fullContent += chunk.message.content;
              setStreamingContent(fullContent);
            }
            if (chunk.done) break;
          } catch {}
        }
      }

      // Finalize
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: fullContent || '(No response)',
        timestamp: Date.now(),
        model: selectedModel,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  }, [inputText, isStreaming, selectedModel, messages, workspace]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Model selector */}
      <div style={{
        padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          style={{
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
            padding: '0.35rem 0.5rem', fontSize: '0.8rem', outline: 'none',
          }}
        >
          {models.length === 0 && <option value="">No models available</option>}
          {models.map(m => (
            <option key={m.name} value={m.name}>
              {m.name} {m.parameterSize ? `(${m.parameterSize})` : ''}
            </option>
          ))}
        </select>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {messages.length} messages
        </span>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); conversationCache.delete(workspaceId); }}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <Bot size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '1rem' }} />
            <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', fontWeight: 600 }}>
              AI Chat for {workspace.name}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 400, margin: '0 auto' }}>
              Chat with local LLM models. The AI has context about your workspace.
              Select a model above and start typing.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex', gap: '0.75rem', marginBottom: '1rem',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: msg.role === 'user' ? 'rgba(0,212,255,0.15)' : 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${msg.role === 'user' ? 'rgba(0,212,255,0.3)' : 'var(--border-subtle)'}`,
            }}>
              {msg.role === 'user' ? <User size={14} style={{ color: 'var(--primary)' }} /> : <Bot size={14} style={{ color: 'var(--secondary)' }} />}
            </div>
            <div style={{
              maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)',
              background: msg.role === 'user' ? 'rgba(0,212,255,0.1)' : 'var(--bg-elevated)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(0,212,255,0.2)' : 'var(--border-subtle)'}`,
            }}>
              <div style={{
                fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
              {msg.model && (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  {msg.model}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
            }}>
              <Bot size={14} style={{ color: 'var(--secondary)' }} />
            </div>
            <div style={{
              maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {streamingContent || <Loader size={14} className="spin" style={{ color: 'var(--primary)' }} />}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedModel ? `Message ${selectedModel}...` : 'Select a model first...'}
            disabled={!selectedModel || isStreaming}
            rows={1}
            style={{
              flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
              resize: 'none', fontFamily: 'inherit', minHeight: 38, maxHeight: 120,
              overflow: 'auto',
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!inputText.trim() || isStreaming || !selectedModel}
            style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)',
              background: inputText.trim() && selectedModel ? 'var(--primary)' : 'var(--bg-tertiary)',
              border: 'none', cursor: inputText.trim() && selectedModel ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: inputText.trim() && selectedModel ? 'var(--bg-primary)' : 'var(--text-muted)',
              flexShrink: 0, transition: 'all 0.15s',
            }}
          >
            <Send size={16} />
          </button>
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          Enter to send, Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}

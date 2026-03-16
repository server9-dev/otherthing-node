import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, User, Loader, ChevronDown, Sparkles, Users, MessageSquare, Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { OnChainWorkspace } from '../../context/Web3Context';
import { useWeb3 } from '../../context/Web3Context';
import { useVoiceVideo, Participant } from '../../hooks/useVoiceVideo';

const API_BASE = 'http://localhost:8080/api/v1';

type ChatMode = 'ai' | 'team';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
}

interface TeamMessage {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
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
  const { address } = useWeb3();
  const [chatMode, setChatMode] = useState<ChatMode>('ai');
  const displayName = localStorage.getItem('ott-display-name') || '';

  const {
    inCall, participants: callParticipants, localStream,
    audioEnabled, videoEnabled,
    joinCall, leaveCall, toggleAudio, toggleVideo,
  } = useVoiceVideo({ workspaceId, displayName: displayName || address?.slice(0, 8) || 'Anonymous' });

  // Team chat state
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [teamInput, setTeamInput] = useState('');
  const teamEndRef = useRef<HTMLDivElement>(null);

  // Load team messages + poll
  useEffect(() => {
    if (chatMode !== 'team') return;
    const load = () => {
      fetch(`${API_BASE}/workspaces/${workspaceId}/chat`, { headers: { Authorization: 'Bearer local-token' } })
        .then(r => r.json()).then(d => setTeamMessages(d.messages || [])).catch(() => {});
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [chatMode, workspaceId]);

  useEffect(() => {
    teamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [teamMessages]);

  const sendTeamMessage = async () => {
    if (!teamInput.trim()) return;
    try {
      await fetch(`${API_BASE}/workspaces/${workspaceId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-token' },
        body: JSON.stringify({ content: teamInput, senderAddress: address, displayName: displayName || undefined }),
      });
      setTeamInput('');
      // Immediate refresh
      const r = await fetch(`${API_BASE}/workspaces/${workspaceId}/chat`, { headers: { Authorization: 'Bearer local-token' } });
      const d = await r.json();
      setTeamMessages(d.messages || []);
    } catch {}
  };

  // AI chat state
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
      {/* Mode toggle + controls */}
      <div style={{
        padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        {/* AI / Team toggle */}
        <div style={{
          display: 'flex', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)', overflow: 'hidden',
        }}>
          {([['ai', 'AI Chat', Sparkles], ['team', 'Team', Users]] as const).map(([mode, label, Icon]) => (
            <button
              key={mode}
              onClick={() => setChatMode(mode as ChatMode)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.3rem 0.6rem', border: 'none', cursor: 'pointer',
                background: chatMode === mode ? 'var(--primary)' : 'transparent',
                color: chatMode === mode ? 'var(--bg-primary)' : 'var(--text-muted)',
                fontSize: '0.75rem', fontWeight: 500, transition: 'all 0.15s',
              }}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {/* AI-specific controls */}
        {chatMode === 'ai' && (
          <>
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
          </>
        )}
        {chatMode === 'team' && (
          <>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {teamMessages.length} messages
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
              {inCall && (
                <>
                  <button onClick={toggleAudio} title={audioEnabled ? 'Mute' : 'Unmute'} style={{
                    width: 30, height: 30, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                    background: audioEnabled ? 'rgba(0,212,255,0.15)' : 'rgba(255,0,128,0.2)',
                    color: audioEnabled ? 'var(--primary)' : 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {audioEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                  </button>
                  <button onClick={toggleVideo} title={videoEnabled ? 'Turn off camera' : 'Turn on camera'} style={{
                    width: 30, height: 30, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                    background: videoEnabled ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: videoEnabled ? 'var(--primary)' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
                  </button>
                </>
              )}
              <button
                onClick={() => inCall ? leaveCall() : joinCall(false)}
                title={inCall ? 'Leave call' : 'Join voice call'}
                style={{
                  width: 30, height: 30, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                  background: inCall ? 'rgba(255,0,128,0.2)' : 'rgba(0,212,255,0.15)',
                  color: inCall ? 'var(--accent)' : 'var(--primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {inCall ? <PhoneOff size={14} /> : <Phone size={14} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Team Chat View */}
      {chatMode === 'team' && (
        <>
          {/* Voice/Video Call Panel */}
          {inCall && (
            <div style={{
              padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(0, 212, 255, 0.03)', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)',
                  animation: 'pulse 2s infinite',
                }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>
                  In Call
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {callParticipants.length + 1} participant{callParticipants.length !== 0 ? 's' : ''}
                </span>

                {/* Participant avatars */}
                <div style={{ display: 'flex', gap: '0.3rem', marginLeft: '0.5rem' }}>
                  {/* Local user */}
                  <div title={`You${!audioEnabled ? ' (muted)' : ''}`} style={{
                    width: 24, height: 24, borderRadius: '50%', fontSize: '0.6rem', fontWeight: 600,
                    background: 'rgba(0,212,255,0.2)', border: '1px solid rgba(0,212,255,0.4)',
                    color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: audioEnabled ? 1 : 0.5,
                  }}>
                    {(displayName || 'You').slice(0, 2).toUpperCase()}
                  </div>
                  {callParticipants.map(p => (
                    <div key={p.peerId} title={p.displayName} style={{
                      width: 24, height: 24, borderRadius: '50%', fontSize: '0.6rem', fontWeight: 600,
                      background: 'rgba(155,89,182,0.2)', border: '1px solid rgba(155,89,182,0.4)',
                      color: 'var(--secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {p.displayName.slice(0, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Video feeds */}
              {(videoEnabled || callParticipants.some(p => p.stream?.getVideoTracks().length)) && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {videoEnabled && localStream && (
                    <div style={{ position: 'relative' }}>
                      <video
                        autoPlay muted playsInline
                        ref={el => { if (el && localStream) el.srcObject = localStream; }}
                        style={{
                          width: 160, height: 120, borderRadius: 'var(--radius-sm)',
                          objectFit: 'cover', background: 'var(--bg-void)',
                          border: '1px solid rgba(0,212,255,0.3)',
                        }}
                      />
                      <span style={{
                        position: 'absolute', bottom: 4, left: 4, fontSize: '0.6rem',
                        background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 3,
                        color: 'var(--text-primary)',
                      }}>You</span>
                    </div>
                  )}
                  {callParticipants.filter(p => p.stream?.getVideoTracks().length).map(p => (
                    <div key={p.peerId} style={{ position: 'relative' }}>
                      <video
                        autoPlay playsInline
                        ref={el => { if (el && p.stream) el.srcObject = p.stream; }}
                        style={{
                          width: 160, height: 120, borderRadius: 'var(--radius-sm)',
                          objectFit: 'cover', background: 'var(--bg-void)',
                          border: '1px solid rgba(155,89,182,0.3)',
                        }}
                      />
                      <span style={{
                        position: 'absolute', bottom: 4, left: 4, fontSize: '0.6rem',
                        background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 3,
                        color: 'var(--text-primary)',
                      }}>{p.displayName}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Audio-only remote streams (hidden audio elements) */}
              {callParticipants.filter(p => p.stream).map(p => (
                <audio
                  key={`audio-${p.peerId}`}
                  autoPlay
                  ref={el => { if (el && p.stream) el.srcObject = p.stream; }}
                  style={{ display: 'none' }}
                />
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
            {teamMessages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <Users size={48} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: '1rem' }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', fontWeight: 600 }}>Team Chat</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Chat with workspace members. Messages are visible to all members.
                </p>
              </div>
            )}
            {teamMessages.map(msg => {
              const isMe = msg.sender === address || msg.senderName === 'local';
              return (
                <div key={msg.id} style={{
                  display: 'flex', gap: '0.75rem', marginBottom: '0.75rem',
                  flexDirection: isMe ? 'row-reverse' : 'row',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: isMe ? 'rgba(0,212,255,0.15)' : 'rgba(155,89,182,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${isMe ? 'rgba(0,212,255,0.3)' : 'rgba(155,89,182,0.3)'}`,
                  }}>
                    <User size={14} style={{ color: isMe ? 'var(--primary)' : 'var(--secondary)' }} />
                  </div>
                  <div style={{ maxWidth: '75%' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                      {msg.senderName && msg.senderName !== 'local' ? msg.senderName : msg.sender?.startsWith('0x') ? `${msg.sender.slice(0, 6)}...${msg.sender.slice(-4)}` : 'Unknown'}
                      <span style={{ marginLeft: '0.5rem' }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style={{
                      padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-lg)',
                      background: isMe ? 'rgba(0,212,255,0.1)' : 'var(--bg-elevated)',
                      border: `1px solid ${isMe ? 'rgba(0,212,255,0.2)' : 'var(--border-subtle)'}`,
                      fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={teamEndRef} />
          </div>
          <div style={{
            padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <input
                type="text" value={teamInput}
                onChange={e => setTeamInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTeamMessage(); } }}
                placeholder="Message the team..."
                style={{
                  flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                  padding: '0.6rem 0.75rem', fontSize: '0.85rem', outline: 'none',
                }}
              />
              <button
                onClick={sendTeamMessage}
                disabled={!teamInput.trim()}
                style={{
                  width: 38, height: 38, borderRadius: 'var(--radius-md)',
                  background: teamInput.trim() ? 'var(--primary)' : 'var(--bg-tertiary)',
                  border: 'none', cursor: teamInput.trim() ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: teamInput.trim() ? 'var(--bg-primary)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* AI Messages */}
      {chatMode === 'ai' && <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
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
      </div>}

      {/* AI Input */}
      {chatMode === 'ai' && <div style={{
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
      </div>}
    </div>
  );
}

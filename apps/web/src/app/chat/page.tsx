'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../../lib/auth';
import { chatApi, ChatConversation, ChatMessageData } from '../../../lib/api';

type DisplayMessage = {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
};

const SUGGESTED_QUESTIONS = [
  'What policies do I have?',
  'What are my coverage gaps?',
  'Am I covered for flood damage?',
  'When do my policies renew?',
];

export default function ChatPage() {
  return <Suspense><ChatPageInner /></Suspense>;
}

function ChatPageInner() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [policySeeded, setPolicySeeded] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    loadConversations();
  }, [token]);

  // Handle deep-link from policy detail: ?policy=123&carrier=State+Farm
  useEffect(() => {
    if (policySeeded) return;
    const policyId = searchParams.get('policy');
    const carrier = searchParams.get('carrier');
    if (policyId && carrier) {
      setPolicySeeded(true);
      setInput(`Tell me about my ${carrier} policy — what are the key details, coverage limits, and anything I should know?`);
      router.replace('/chat', { scroll: false });
    }
  }, [searchParams, policySeeded]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const loadConversations = useCallback(async () => {
    try {
      const list = await chatApi.listConversations();
      setConversations(list);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (convoId: number) => {
    try {
      const msgs = await chatApi.getMessages(convoId);
      setMessages(msgs.map(m => ({ id: m.id, role: m.role, content: m.content })));
      setActiveConvoId(convoId);
      setSidebarOpen(false);
    } catch { /* ignore */ }
  }, []);

  const startNewChat = useCallback(() => {
    setActiveConvoId(null);
    setMessages([]);
    setInput('');
    setStreamingText('');
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }, []);

  const deleteConversation = useCallback(async (convoId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatApi.deleteConversation(convoId);
      setConversations(prev => prev.filter(c => c.id !== convoId));
      if (activeConvoId === convoId) {
        startNewChat();
      }
    } catch { /* ignore */ }
  }, [activeConvoId, startNewChat]);

  const sendMessage = useCallback((text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isStreaming) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsStreaming(true);
    setStreamingText('');

    const controller = chatApi.sendMessageStream(
      msg,
      activeConvoId,
      (chunk) => {
        setStreamingText(prev => prev + chunk);
      },
      (id) => {
        setActiveConvoId(id);
        loadConversations();
      },
      () => {
        setStreamingText(prev => {
          if (prev) {
            setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
          }
          return '';
        });
        setIsStreaming(false);
      },
      (err) => {
        setStreamingText('');
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
        setIsStreaming(false);
      },
    );

    abortRef.current = controller;
  }, [input, isStreaming, activeConvoId, loadConversations]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // Capture the input value at the time dictation starts
    const baseText = input.trimEnd();

    recognition.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }
      const prefix = baseText ? baseText + ' ' : '';
      setInput(prefix + final + interim);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      textareaRef.current?.focus();
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, [isListening, input]);

  const [hasSpeechRecognition, setHasSpeechRecognition] = useState(false);
  useEffect(() => {
    setHasSpeechRecognition(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  }, []);

  const showEmptyState = messages.length === 0 && !isStreaming;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 49 }}
          className="chat-overlay"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`chat-sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: 260,
          minWidth: 260,
          backgroundColor: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <button
            onClick={startNewChat}
            style={{
              width: '100%',
              padding: '10px 16px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            + New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {conversations.map(c => (
            <button
              key={c.id}
              onClick={() => loadMessages(c.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '10px 12px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                backgroundColor: c.id === activeConvoId ? 'var(--color-primary-bg)' : 'transparent',
                color: 'var(--color-text)',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                marginBottom: 2,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {c.title || 'Untitled'}
              </span>
              <span
                onClick={(e) => deleteConversation(c.id, e)}
                style={{ opacity: 0.4, fontSize: 14, padding: '0 4px', flexShrink: 0 }}
                title="Delete conversation"
              >
                x
              </span>
            </button>
          ))}
          {conversations.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              No conversations yet
            </div>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Chat header */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}>
          <button
            className="chat-menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              padding: '4px 8px',
              color: 'var(--color-text)',
            }}
          >
            &#9776;
          </button>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>
            Policy Insights
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Insights generated directly from your uploaded policy documents
          </span>
        </div>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 0' }}>
          {showEmptyState && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, paddingBottom: 60 }}>
              <div style={{ fontSize: 48 }}>📄</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                Ask about your policies
              </h2>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0, textAlign: 'center', maxWidth: 440 }}>
                Get answers about your coverage, limits, deductibles, and gaps — extracted directly from the documents you&apos;ve uploaded. No external data. No assumptions.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500 }}>
                {SUGGESTED_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 20,
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  maxWidth: '75%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  backgroundColor: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: msg.role === 'user' ? '#fff' : 'var(--color-text)',
                  border: msg.role === 'assistant' ? '1px solid var(--color-border)' : 'none',
                  fontSize: 14,
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                }}
              >
                {msg.role === 'assistant' ? (
                  <>
                    <div className="chat-markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 8, opacity: 0.7 }}>
                      Based on your uploaded policy documents
                    </div>
                  </>
                ) : msg.content}
              </div>
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
              <div
                style={{
                  maxWidth: '75%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  fontSize: 14,
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                }}
              >
                {streamingText ? (
                  <div className="chat-markdown"><ReactMarkdown>{streamingText}</ReactMarkdown></div>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)' }}>Thinking...</span>
                )}
                <span style={{ display: 'inline-block', width: 6, height: 16, backgroundColor: 'var(--color-primary)', marginLeft: 2, animation: 'blink 1s infinite', verticalAlign: 'text-bottom' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Source-bound trust line */}
        <div style={{ padding: '4px 20px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            Insights are extracted from your uploaded policy documents. Review against your original documents before making decisions.
          </span>
        </div>

        {/* Input area */}
        <div style={{ padding: '12px 20px 20px', flexShrink: 0 }}>
          <div style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '8px 12px',
            backgroundColor: 'var(--color-surface)',
          }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your coverage..."
              disabled={isStreaming}
              rows={1}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontSize: 14,
                lineHeight: 1.5,
                padding: '4px 0',
                backgroundColor: 'transparent',
                color: 'var(--color-text)',
                maxHeight: 120,
                overflow: 'auto',
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            {hasSpeechRecognition && (
              <button
                onClick={toggleVoice}
                disabled={isStreaming}
                aria-label={isListening ? 'Stop dictation' : 'Start voice dictation'}
                title={isListening ? 'Stop dictation' : 'Dictate your question'}
                style={{
                  padding: '6px',
                  border: 'none',
                  borderRadius: 8,
                  backgroundColor: isListening ? 'var(--color-danger)' : 'transparent',
                  color: isListening ? '#fff' : 'var(--color-text-muted)',
                  fontSize: 18,
                  cursor: isStreaming ? 'default' : 'pointer',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  transition: 'background-color 0.15s, color 0.15s',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor"/>
                  <path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.92V22H13V18.92C16.39 18.43 19 15.53 19 12H17Z" fill="currentColor"/>
                </svg>
              </button>
            )}
            <button
              onClick={() => sendMessage()}
              disabled={isStreaming || !input.trim()}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: 8,
                backgroundColor: isStreaming || !input.trim() ? 'var(--color-border)' : 'var(--color-primary)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: isStreaming || !input.trim() ? 'default' : 'pointer',
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Blink animation + markdown styles */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .chat-markdown p { margin: 0 0 8px; }
        .chat-markdown p:last-child { margin-bottom: 0; }
        .chat-markdown ul, .chat-markdown ol { margin: 4px 0 8px; padding-left: 20px; }
        .chat-markdown li { margin-bottom: 2px; }
        .chat-markdown h3 { font-size: 15px; font-weight: 700; margin: 12px 0 4px; }
        .chat-markdown h4 { font-size: 14px; font-weight: 600; margin: 8px 0 4px; }
        .chat-markdown strong { font-weight: 700; }
        .chat-markdown table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
        .chat-markdown th, .chat-markdown td { border: 1px solid var(--color-border); padding: 4px 10px; text-align: left; }
        .chat-markdown th { font-weight: 600; background: rgba(0,0,0,0.03); }
        .chat-markdown code { background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px; font-size: 13px; }
        .chat-markdown hr { border: none; border-top: 1px solid var(--color-border); margin: 12px 0; }
        @media (max-width: 768px) {
          .chat-sidebar {
            position: fixed !important;
            left: -280px;
            top: 0;
            bottom: 0;
            z-index: 50;
            transition: left 0.2s ease;
          }
          .chat-sidebar.open {
            left: 0 !important;
          }
          .chat-menu-btn {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';

// --- Use REAL Firebase Services ---
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';

// --- 1. Firebase Configuration (User Provided) ---
const firebaseConfig = {
  apiKey: "AIzaSyD6kMYzvTY7KTl4OAbNwlG9Riudoq2mAYE",
  authDomain: "emd-ai-assist.firebaseapp.com",
  databaseURL: "https://emd-ai-assist-default-rtdb.firebaseio.com",
  projectId: "emd-ai-assist",
  storageBucket: "emd-ai-assist.appspot.com",
  messagingSenderId: "327202754237",
  appId: "1:327202754237:web:2c517e70d4a0d676a171d4",
  measurementId: "G-471FPVCG16"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);
const storage = getStorage(app);


// --- 2. Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        signInAnonymously(auth).catch(console.error);
      }
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);
  
  useEffect(() => {
    const styleTag = document.createElement('style');
    styleTag.innerHTML = chatbotStyles;
    document.head.appendChild(styleTag);
    return () => {
      document.head.removeChild(styleTag);
    };
  }, []);


  if (isInitializing) {
    return <div className="loading-screen">Initializing Assistant...</div>;
  }

  return (
    <div className="chatbot-container">
      {user ? <ChatRoom user={user} /> : <div className="loading-screen">Authenticating...</div>}
    </div>
  );
}

// --- 3. UI Components ---

const ChatRoom = ({ user }) => {
  const [messages, setMessages] = useState([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Hello! I'm your EMD maintenance assistant. My knowledge base is powered by the documents you upload. Please upload a PDF to begin.`,
      }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Message Handling ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (input.trim() === '' || isTyping) return;

    const userInput = input;
    const currentHistory = messages.filter(m => m.role !== 'system');
    setInput('');
    
    const userMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: userInput,
    };
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);
    
    // --- FINAL: CALL THE LIVE CLOUD FUNCTION ---
    try {
        const getAiResponse = httpsCallable(functions, 'getAiResponse');
        const result = await getAiResponse({ 
            question: userInput,
            history: currentHistory.slice(-6) // Send last 6 messages for context
        });

        const aiResponseText = result.data.response;

        const assistantMessage = {
            id: `msg_${Date.now() + 1}`,
            role: 'assistant',
            content: aiResponseText,
        };
        setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
        console.error("Error calling getAiResponse function:", error);
        const errorMessage = {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: `Sorry, I encountered an error calling the backend: ${error.message}`,
        };
        setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsTyping(false);
    }
  };

  // --- Voice Recognition ---
  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in your browser.");
      return;
    }

    if (!recognitionRef.current) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = 'en-US';

        recognitionRef.current.onstart = () => setIsListening(true);
        recognitionRef.current.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };
        recognitionRef.current.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };
        
        recognitionRef.current.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          setTimeout(() => document.getElementById('send-button-ref')?.click(), 100);
        };
    }
    
    recognitionRef.current.start();
  };

  return (
    <div className="chatbot-container">
        <div className="chat-header">
            <div className="header-left">
                <h2>EMD Maintenance Assistant</h2>
            </div>
        </div>
        <div className="chat-main">
            <div className="chat-content">
                <MessageList messages={messages} isTyping={isTyping} />
                <div ref={messagesEndRef} />
                <MessageInput 
                    onSendMessage={handleSendMessage}
                    input={input}
                    setInput={setInput}
                    disabled={isTyping}
                    toggleVoiceInput={toggleVoiceInput}
                    isListening={isListening}
                    user={user}
                />
            </div>
        </div>
    </div>
  );
};

const MessageList = ({ messages, isTyping }) => (
    <div className="message-list">
        {messages.map(msg => <ChatMessage key={msg.id} message={msg} />)}
        {isTyping && <TypingIndicator />}
    </div>
);

const ChatMessage = ({ message }) => {
  const { content, role } = message;
  const messageClass = role === 'user' ? 'user' : 'assistant';
  
  const formatContent = (text) => {
      const html = text
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\[(.*?)\]/g, '<span class="doc-ref-inline">$1</span>')
          .replace(/\n/g, '<br />');
      return { __html: html };
  };

  return (
    <div className={`message ${messageClass}`}>
      <div className="message-content" dangerouslySetInnerHTML={formatContent(content)} />
    </div>
  );
};

const TypingIndicator = () => (
    <div className="message assistant">
        <div className="message-content">
            <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
            </div>
        </div>
    </div>
);

const MessageInput = ({ onSendMessage, input, setInput, disabled, toggleVoiceInput, isListening, user }) => {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !user) return;

        if (file.type !== 'application/pdf') {
            alert("Please upload PDF files only.");
            return;
        }

        const uniqueFileName = `${user.uid}-${Date.now()}-${file.name}`;
        const storageRef = ref(storage, `uploads/${uniqueFileName}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on('state_changed', 
            (snapshot) => {
                setUploading(true);
                const prog = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setProgress(prog);
            }, 
            (error) => {
                console.error("Upload failed:", error);
                alert(`Upload failed: ${error.message}`);
                setUploading(false);
            }, 
            () => {
                setUploading(false);
                alert(`Upload of "${file.name}" complete! The backend will now process and index it. This may take a few minutes.`);
            }
        );
    };

    return (
        <div className="message-input-container">
            <div className="message-input-wrapper">
                <label htmlFor="file-upload" className={`file-upload-button ${uploading ? 'uploading' : ''}`}>
                    {uploading ? `${progress}%` : '📄'}
                </label>
                <input 
                    id="file-upload" 
                    type="file" 
                    accept=".pdf" 
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                    disabled={uploading}
                />
                <form onSubmit={onSendMessage} style={{display: 'contents'}}>
                    <textarea
                        className="input-area"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask about maintenance, parts, or troubleshooting..."
                        disabled={disabled}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                onSendMessage(e);
                            }
                        }}
                    />
                    <button id="send-button-ref" type="submit" className="send-button" disabled={!input || disabled}>
                        ➤
                    </button>
                </form>
                 <button onClick={toggleVoiceInput} className={`voice-button ${isListening ? 'listening' : ''}`}>
                    🎤
                </button>
            </div>
        </div>
    );
};


// --- 4. CSS Styles ---
const chatbotStyles = `
/* ChatbotInterface.css */
.chatbot-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  background: #0a0a0a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  box-shadow: 0 0 20px rgba(0,0,0,0.5);
}

.chat-header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  padding: 1rem 1.5rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.header-left h2 {
  color: #ff6b00;
  margin: 0;
  font-size: 1.5rem;
}

.chat-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.chat-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
}

/* Message List Styles */
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  scroll-behavior: smooth;
}

.message {
  margin-bottom: 1.5rem;
  display: flex;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-content {
  max-width: 80%;
  padding: 0.8rem 1.2rem;
  border-radius: 18px;
  background: #1a1a1a;
  border: 1px solid #333;
  line-height: 1.6;
}

.message.user .message-content {
  background: linear-gradient(135deg, #ff6b00 0%, #ff8533 100%);
  color: white;
  border: none;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
    background: #2a2a3a;
    border-bottom-left-radius: 4px;
}

.doc-ref-inline {
    background-color: rgba(255, 153, 51, 0.2);
    color: #ff9933;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
}

/* Typing indicator */
.typing-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 0.5rem 0;
}

.typing-dot {
  width: 8px;
  height: 8px;
  background: #ff6b00;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-8px); opacity: 1; }
}

/* Message Input Styles */
.message-input-container {
  padding: 1rem;
  background: #111;
  border-top: 1px solid #333;
}

.message-input-wrapper {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.input-area {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 0.8rem 1rem;
  color: #e0e0e0;
  min-height: 48px;
  max-height: 150px;
  overflow-y: auto;
  resize: none;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  transition: border-color 0.2s;
}

.input-area:focus {
  outline: none;
  border-color: #ff6b00;
}

.send-button, .voice-button, .file-upload-button {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #e0e0e0;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1.2rem;
}

.send-button:hover:not(:disabled), .voice-button:hover, .file-upload-button:hover {
  border-color: #ff6b00;
  color: #ff6b00;
}

.send-button {
    background: #ff6b00;
    border-color: #ff6b00;
    color: white;
    font-size: 1.5rem;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #555;
  border-color: #555;
}

.voice-button.listening {
    background-color: #ff6b00;
    color: white;
    animation: pulse 1.5s infinite;
}

.file-upload-button.uploading {
    color: #ff6b00;
    border-color: #ff6b00;
    font-weight: bold;
    font-size: 0.9rem;
}

@keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(255, 107, 0, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(255, 107, 0, 0); }
    100% { box-shadow: 0 0 0 0 rgba(255, 107, 0, 0); }
}

/* Responsive Design */
@media (max-width: 768px) {
  .chat-header { padding: 0.8rem 1rem; }
  .header-left h2 { font-size: 1.2rem; }
  .message-content { max-width: 90%; }
}
`;


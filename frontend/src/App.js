import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = '8.137.70.68:8000';

function App() {
  // 从URL参数获取初始角色
  const urlParams = new URLSearchParams(window.location.search);
  const initialRole = urlParams.get('role') || 'elder'; // 默认为长辈视图
  const pairId = urlParams.get('pair_id') ;

  const [clientId, setClientId] = useState(initialRole);
  const [otherClientId, setOtherClientId] = useState(initialRole === 'elder' ? 'young' : 'elder');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [socket, setSocket] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [emojiPackages, setEmojiPackages] = useState([]); // 新增：存储表情包
  const [showEmojiPanel, setShowEmojiPanel] = useState(false); // 新增：控制表情面板显示

  // 新增：获取表情包函数
  const fetchEmojiPackages = async () => {
    if (!message.trim()) return;

    try {
      const response = await fetch(`http://${API_BASE_URL}/api/search_emojis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          limit: 5
        })
      });

      if (response.ok) {
        const data = await response.json();
        setEmojiPackages(data.emojis);
        setShowEmojiPanel(true);
      }
    } catch (error) {
      console.error('获取表情包失败:', error);
      alert('获取表情包失败，请重试');
    }
  };

  // 新增：发送表情包消息
  const sendEmoji = (emojiUrl) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const newMessage = {
        to: otherClientId,
        type: "emoji",
        image_data: emojiUrl,
        from: clientId,
        role: clientId,
        id: Date.now()
      };
      socket.send(JSON.stringify(newMessage));
      setMessages(prev => [...prev, newMessage]);
      setShowEmojiPanel(false);
    }
  };
  // 从localStorage加载消息历史
  useEffect(() => {
    const storedMessages = localStorage.getItem('messages');
    if (storedMessages) {
      setMessages(JSON.parse(storedMessages));
    }
  }, []);

  // 保存消息到localStorage
  useEffect(() => {
    localStorage.setItem('messages', JSON.stringify(messages));
  }, [messages]);

  // WebSocket连接管理
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const response = await fetch(`http://${API_BASE_URL}/api/get_messages?pair_id=${pairId}`);
        if (response.ok) {
          const history = await response.json();
          setMessages(history);
        }
      } catch (error) {
        console.error('加载历史消息失败:', error);
      }
    };
    
    loadHistory();

    const ws = new WebSocket(`ws://${API_BASE_URL}/ws/${clientId}`);
    setSocket(ws);

    ws.onopen = () => console.log(`WebSocket connected for ${clientId}`);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (!data.id) {
        data.id = `${data.from || 'unknown'}_${Date.now()}`;
      }
      if (!data.from) {
        data.from = 'unknown';
      }
      // 添加role字段设置
      if (!data.role) {
        data.role = data.from === 'elder' ? 'elder' : 'young';
      }
      setMessages(prev => [...prev, data]);
    };
    ws.onclose = () => console.log('WebSocket closed');
    ws.onerror = (err) => console.error('WebSocket error:', err);

    return () => ws.close();
  }, [clientId, pairId]);



  const sendMessage = () => {
      if (!message.trim()) return;
      
      const newMessage = {
          id: Date.now(),
          message: message,
          from: clientId,
        to: otherClientId,
        type: "text",
          pair_id: Number(pairId)  // 确保pair_id是数字
      };

    // 通过WebSocket发送消息
    if (socket) {
      socket.send(JSON.stringify(newMessage));
    }
    
    // 不再使用localStorage
    setMessages(prev => [...prev, newMessage]);
    setMessage("");
  };

  // 处理图片上传
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
    }

    // 检查文件大小（可选）
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert(`图片大小超过限制（${(maxSize / 1024 / 1024).toFixed(1)}MB）`);
        return;
    }

    setUploading(true);

    try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(`http://${API_BASE_URL}/api/upload_image`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const imageUrl = result.image_url;

        if (socket && socket.readyState === WebSocket.OPEN) {
            const newMessage = {
                to: otherClientId,
                type: "image",
                image_data: imageUrl,
                from: clientId,
                role: clientId === 'elder' ? 'elder' : 'young',
                id: `${clientId}_${Date.now()}`
            };

            socket.send(JSON.stringify(newMessage));
            setMessages(prev => [...prev, newMessage]);
        }
    } catch (error) {
        console.error('图片上传失败:', error);
        alert('图片上传失败，请重试');
    } finally {
        setUploading(false);
    }
  };

  // 文本分析
  const analyzeTextMessage = async (msg) => {
    if (msg.analysis || analysisInProgress) return;

    // 检查文本是否为空
    if (!msg.message.trim()) {
      alert("请选择非空的文本消息进行分析");
      return;
    }

    setAnalysisInProgress(true);

    // 更新状态为分析中
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, analysis: { type: "pending", message: "分析中..." } } : m
    ));

    try {
      // 获取最近5条消息作为上下文
      const context = messages
        .slice(-5)
        .filter(m => m.id !== msg.id)
        .map(m => m.message || (m.type === 'image' ? '[图片]' : ''));

      const response = await fetch(`http://${API_BASE_URL}/api/analyze_text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg.message,
          role: clientId === 'elder' ? 'elder' : 'young',
          context
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.status === "success") {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? {
            ...m, analysis: {
              type: "analysis_result",
              content: result.analysis
            }
          } : m
        ));
      } else {
        throw new Error(result.message || "分析失败");
      }
    } catch (error) {
      console.error('文本分析失败:', error);
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, analysis: { type: "error", error: error.message } } : m
      ));
    } finally {
      setAnalysisInProgress(false);
    }
  };

  // 网络表情包分析
  const analyzeEmojiMessage = async (msg) => {
    if (analysisInProgress) return;

    setAnalysisInProgress(true);

    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, analysis: { type: "pending", message: "分析中..." } } : m
    ));

    try {
      // 获取最近5条消息作为上下文
      const context = messages
        .slice(-5)
        .filter(m => m.id !== msg.id)
        .map(m => m.message || (m.type === 'image' ? '[图片]' : ''));

      const response = await fetch(`http://${API_BASE_URL}/api/analyze_emoji`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: msg.image_data,
          role: clientId === 'elder' ? 'elder' : 'young',
          context
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.status === "success") {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? {
            ...m,
            analysis: {
              type: "analysis_result",
              content: result.analysis
            }
          } : m
        ));
      } else {
        throw new Error(result.message || "分析失败");
      }
    } catch (error) {
      console.error('表情包分析失败:', error);
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? {
          ...m,
          analysis: {
            type: "error",
            error: error.message
          }
        } : m
      ));
    } finally {
      setAnalysisInProgress(false);
    }
  };

  return (
    <div className="App">
      <h1 className="app-title">智能聊天助手</h1>

      <div className="user-selector">
        <label>选择用户: </label>
        <select onChange={(e) => {
          const newClientId = e.target.value;
          setClientId(newClientId);
          setOtherClientId(newClientId === 'elder' ? 'young' : 'elder');

          // 更新URL参数但不刷新页面
          const newUrl = new URL(window.location);
          newUrl.searchParams.set('role', newClientId);
          window.history.pushState({}, '', newUrl);
        }} value={clientId}>
          <option value="elder">长辈👴</option>
          <option value="young">年轻人👱</option>
        </select>
      </div>

      <div className="chat-container">
        <div className="messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.from === clientId ? 'sent' : 'received'}`}>
              <div className="sender">
                {msg.from === clientId ? '你' : (msg.role === 'elder' ? '长辈👴' : '年轻人👱')}
              </div>

              {msg.type === "text" && (
                <div className="content text-content">{msg.message}</div>
              )}

              {msg.type === "image" && (
                <div className="content image-content">
                  {uploading && msg.id === Date.now() && <div className="uploading">上传中...</div>}
                  <img
                    src={msg.image_data}
                    alt="发送的图片"
                    style={{
                      maxWidth: '200px',
                      maxHeight: '200px',
                      objectFit: 'contain'
                    }}
                  />
                </div>
              )}

              {msg.type === "emoji" && (
                <div className="content image-content">
                  <img
                    src={msg.image_data}
                    alt="网络表情包"
                    style={{
                      maxWidth: '200px',
                      maxHeight: '200px',
                      objectFit: 'contain'
                    }}
                  />
                </div>
              )}

              {/* 只对接收的消息显示分析按钮 */}
              {msg.from !== clientId && (
                <div className="analysis-buttons">
                  {msg.type === "text" && (
                    <button
                      className="analysis-button"
                      onClick={() => analyzeTextMessage(msg)}
                      disabled={msg.analysis && msg.analysis.type === "pending"}
                    >
                      {msg.analysis ?
                        (msg.analysis.type === "pending" ? '分析中...' : '🔄重新分析') :
                        '📝分析文本'
                      }
                    </button>
                  )}

                  {msg.type === "image" && (
                    <button
                      className="analysis-button"
                      onClick={() => analyzeEmojiMessage(msg)}
                      disabled={analysisInProgress}  // 修改为只检查analysisInProgress状态
                    >
                      {msg.analysis ?
                        (msg.analysis.type === "pending" ? '分析中...' : '🔄重新分析') :
                        '📷分析图片'
                      }
                    </button>
                  )}
                  {msg.type === "emoji" && (
                    <button
                      className="analysis-button"
                      onClick={() => analyzeEmojiMessage(msg)}
                      disabled={analysisInProgress}  // 修改为只检查analysisInProgress状态
                    >
                      {msg.analysis ?
                        (msg.analysis.type === "pending" ? '分析中...' : '🔄重新分析') :
                        '🙂分析表情包'
                      }
                    </button>
                  )}
                </div>
              )}

              {msg.from !== clientId && msg.analysis && (
                <div className="analysis-result">
                  <div className="analysis-header">
                    <span className="analysis-title">分析结果：</span>
                  </div>
                  <div className="analysis-content">
                    {msg.analysis.type === "pending" ? (
                      <span className="analysis-pending">{msg.analysis.message}</span>
                    ) : msg.analysis.type === "error" ? (
                      <span className="analysis-error">分析失败：{msg.analysis.error}</span>
                    ) : (
                      <div className="analysis-text" style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.analysis.content}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="input-area">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="输入消息..."
            className="message-input"
          />
          <button onClick={sendMessage} className="send-button">
            发送
          </button>
          <button
            onClick={fetchEmojiPackages}
            className="emoji-button"
            disabled={!message.trim()}
          >
            🔍
          </button>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
            id="fileInput"
          />
          <label htmlFor="fileInput" className="file-upload-button">
            📷
          </label>

          {showEmojiPanel && (
            <div className="emoji-panel">
              {emojiPackages.map((emoji, index) => (
                <img
                  key={index}
                  src={emoji}
                  alt="表情包"
                  onClick={() => sendEmoji(emoji)}
                  className="emoji-item"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [clientId, setClientId] = useState('elder');  // 默认设为长辈
  const [otherClientId, setOtherClientId] = useState('young'); // 默认设为年轻人
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [socket, setSocket] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);

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
    const ws = new WebSocket(`ws://localhost:8000/ws/${clientId}`);
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
  }, [clientId]);

  // 发送文本消息
  const sendMessage = () => {
    if (socket && socket.readyState === WebSocket.OPEN && message.trim()) {
      const newMessage = {
        to: otherClientId,
        type: "text",
        message: message,
        from: clientId,
        role: clientId, // 确保使用当前用户角色
        id: Date.now()
      };
      socket.send(JSON.stringify(newMessage));
      setMessages(prev => [...prev, newMessage]);
      setMessage('');
    }
  };

  // 处理图片上传
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
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
    
    // 创建临时URL显示图片
    const imageUrl = URL.createObjectURL(file);
    
    // 创建图片预览对象
    const imagePreview = new Image();
    imagePreview.onload = () => {
      console.log(`图片预览加载成功: ${imagePreview.width}x${imagePreview.height}`);
      
      // 发送消息（包含原始Blob和临时URL）
      if (socket && socket.readyState === WebSocket.OPEN) {
        const newMessage = {
          to: otherClientId,
          type: "image",
          image_data: imageUrl,    // 临时URL用于显示
          image_blob: file,        // 存储原始Blob用于分析
          from: clientId,
          role: clientId === 'user1' ? 'elder' : 'young', // 添加角色参数
          id: `${clientId}_${Date.now()}`
        };
        
        // 注意：不能直接通过WebSocket发送Blob对象
        socket.send(JSON.stringify({
          ...newMessage,
          image_blob: undefined    // 不通过WebSocket发送Blob
        }));
        
        setMessages(prev => [...prev, newMessage]);
        setUploading(false);
      }
    };
    
    imagePreview.onerror = (err) => {
      console.error('图片预览加载失败:', err);
      alert('图片加载失败，请尝试其他图片');
      setUploading(false);
    };
    
    imagePreview.src = imageUrl;
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
      
      const response = await fetch('/api/analyze_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: msg.message,
          role: clientId === 'elder' ? 'young' : 'elder',
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
          m.id === msg.id ? { ...m, analysis: { 
            type: "analysis_result", 
            content: result.analysis 
          } } : m
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

  // 图片分析
  const analyzeImageMessage = async (msg) => {
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
      
      const formData = new FormData();
      formData.append('image', msg.image_blob);
      formData.append('role', clientId === 'elder' ? 'young' : 'elder');  // 添加角色参数
      formData.append('context', JSON.stringify(context));
      
      const response = await fetch('/api/analyze_image', {
        method: 'POST',
        body: formData,
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
        console.error('图片分析失败:', error);
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
          // 修复：根据新选择的用户ID动态设置对方ID
          setOtherClientId(newClientId === 'elder' ? 'young' : 'elder');
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
                      onClick={() => analyzeImageMessage(msg)}
                      disabled={analysisInProgress}  // 修改为只检查analysisInProgress状态
                    >
                      {msg.analysis ? 
                        (msg.analysis.type === "pending" ? '分析中...' : '🔄重新分析') : 
                        '📷分析图片'
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
        </div>
      </div>
    </div>
  );
}

export default App;
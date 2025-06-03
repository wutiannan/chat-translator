from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import io
import base64
import logging
import imghdr
import os
from typing import Dict, List
from dotenv import load_dotenv
from dashscope import MultiModalConversation, Generation

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 加载环境变量
load_dotenv()

app = FastAPI()

# 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 存储活跃的WebSocket连接
active_connections: Dict[str, WebSocket] = {}

# 文本分析请求模型
class TextAnalysisRequest(BaseModel):
    text: str
    role: str = "elder"  # 新增角色字段，默认为老人
    context: List[str] = []  # 新增上下文字段

class TextAnalyzer:
    def __init__(self):
        self.api_key = os.getenv("DASHSCOPE_API_KEY")
        self.model = "qwen-max"
    
    async def analyze_text(self, text: str, role: str = "elder", context: List[str] = None) -> str:
        try:
            context_str = "\n".join([f"上下文消息 {i+1}: {msg}" for i, msg in enumerate(context or [])])
            
            if role == "elder":
                prompt = f"""请结合以下聊天上下文，用简单易懂的方式解释年轻人说的话：
                
                聊天上下文:
                {context_str}
                
                需要解释的话:
                {text}
                
                要求：
                1. 解释含义(10字内)
                2. 智能转换👴(15字内)
                3. 原因(10字内)"""
            else:
                prompt = f"""请结合以下聊天上下文，用年轻人易懂的方式解释老人说的话：
                
                聊天上下文:
                {context_str}
                
                需要解释的话:
                {text}
                
                要求：
                1. 解释含义(10字内)
                2. 智能转换👱(15字内)
                3. 原因(10字内)"""
            
            response = Generation.call(
                model=self.model,
                prompt=prompt,
                api_key=self.api_key
            )
            
            if response.status_code == 200:
                return response.output.text
            else:
                logger.error(f"文本分析API错误: {response.message}")
                raise ValueError(f"文本分析失败: {response.message}")
                
        except Exception as e:
            logger.error(f"调用文本分析模型出错: {str(e)}")
            raise

class ImageAnalyzer:
    def __init__(self):
        self.api_key = os.getenv("DASHSCOPE_API_KEY")
        self.model = "qwen-vl-plus"
    
    async def analyze_image(self, image_base64: str, role: str = "elder", context: List[str] = None) -> str:
        context_str = "\n".join([f"上下文消息 {i+1}: {msg}" for i, msg in enumerate(context or [])])
        
        if role == "elder":
            prompt = f"""请结合以下聊天上下文，用老年人易懂的方式解释这个表情包：
            
            聊天上下文:
            {context_str}
            
            表情包分析要求:
            1. 表情含义(10字内)
            2. 适合长辈的说法(10字内)
            
            格式:
            含义→说法
            原因:..."""
        else:
            prompt = f"""请结合以下聊天上下文，用年轻人易懂的方式解释这个表情包：
            
            聊天上下文:
            {context_str}
            
            表情包分析要求:
            1. 表情含义(10字内)
            2. 适合年轻人的说法(10字内)
            
            格式:
            含义→说法
            原因:..."""
        
        messages = [
            {
                "role": "user",
                "content": [
                    {"image": image_base64},
                    {"text": prompt}
                ]
            }
        ]
        
        try:
            response = MultiModalConversation.call(
                model=self.model,
                messages=messages,
                api_key=self.api_key,
            )
            
            if response.status_code == 200:
                return response.output.choices[0].message.content[0]["text"]
            else:
                logger.error(f"通义千问API错误: {response.message}")
                raise ValueError(f"大模型分析失败: {response.message}")
                
        except Exception as e:
            logger.error(f"调用大模型出错: {str(e)}")
            raise

# WebSocket连接
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    active_connections[client_id] = websocket
    logger.info(f"用户 {client_id} 已连接")
    try:
        while True:
            data = await websocket.receive_json()
            recipient = data.get("to")
            if recipient in active_connections:
                await active_connections[recipient].send_json(data)
    except WebSocketDisconnect:
        del active_connections[client_id]
        logger.info(f"用户 {client_id} 已断开")


# 文本分析接口
@app.post("/api/analyze_text")
async def analyze_text_api(request: TextAnalysisRequest):
    try:
        if not request.text.strip():
            raise ValueError("文本内容不能为空")
            
        logger.info(f"收到文本分析请求: {request.text[:30]}... (角色: {request.role}, 上下文长度: {len(request.context)})")
        analyzer = TextAnalyzer()
        result = await analyzer.analyze_text(request.text, request.role, request.context)
        return {"status": "success", "analysis": result}
    except ValueError as ve:
        logger.error(f"文本分析参数错误: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"文本分析错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# 图片分析接口 - 增强错误处理
@app.post("/api/analyze_image")
async def analyze_image_api(image: UploadFile = File(...), role: str = Form(...), context: List[str] = Form(...)):
    try:
        logger.info(f"收到图片分析请求: {image.filename}, 大小: {image.size} 字节, 上下文长度: {len(context)}")
        
        # 直接使用FastAPI的UploadFile对象
        contents = await image.read()
        
        # 检查文件类型
        if not image.content_type.startswith('image/'):
            raise ValueError("请上传有效的图片文件")
            
        # 检查文件大小
        max_size = 10 * 1024 * 1024  # 10MB
        if len(contents) > max_size:
            raise ValueError(f"图片大小超过限制({max_size/1024/1024}MB)")
            
        # 修改这里：添加数据URI前缀
        image_base64 = f"data:{image.content_type};base64," + base64.b64encode(contents).decode('utf-8')
        
        analyzer = ImageAnalyzer()
        result = await analyzer.analyze_image(image_base64, role, context)
        return {"status": "success", "analysis": result}
    except ValueError as ve:
        logger.error(f"图片分析参数错误: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"图片分析错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"服务器处理图片时出错: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
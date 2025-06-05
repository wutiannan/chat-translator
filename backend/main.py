from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import io
import base64
import logging
import imghdr
import os
import oss2
from fastapi import UploadFile, File
import uuid

import os
from typing import Dict, List
from dotenv import load_dotenv
from dashscope import MultiModalConversation, Generation
import httpx  

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

class EmojiAnalysisRequest(BaseModel):
    image_url: str
    role: str = "elder"
    context: List[str] = []

@app.post("/api/analyze_emoji")
async def analyze_emoji_api(request: EmojiAnalysisRequest):
    try:
        if not request.image_url.strip():
            raise ValueError("表情包URL不能为空")
            
        logger.info(f"收到网络表情包分析请求: {request.image_url[:50]}... (角色: {request.role}, 上下文长度: {len(request.context)})")
        
        # 验证URL格式
        if not request.image_url.startswith(('http://', 'https://')):
            raise ValueError("URL必须以http://或https://开头")
            
        analyzer = ImageAnalyzer()
        result = await analyzer.analyze_image(request.image_url, request.role, request.context)
        return {"status": "success", "analysis": result}
        
    except ValueError as ve:
        logger.error(f"表情包分析参数错误: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"表情包分析错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}


class EmojiSearchRequest(BaseModel):
    text: str
    limit: int = 5

@app.post("/api/search_emojis")
async def search_emojis(request: EmojiSearchRequest):
    try:
        if not request.text.strip():
            raise ValueError("搜索文本不能为空")
            
        logger.info(f"收到表情包搜索请求: {request.text}")
        
        # 从环境变量获取ID和Key
        emoji_id = os.getenv("EMOJI_API_ID")
        emoji_key = os.getenv("EMOJI_API_KEY")
        
        if not emoji_id or not emoji_key:
            raise ValueError("表情包API配置缺失")
        
        params = {
            "id": emoji_id,
            "key": emoji_key,
            "words": request.text,
            "limit": request.limit
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://cn.apihz.cn/api/img/apihzbqbbaidu.php",
                params=params
            )
            
            if response.status_code == 200:
                data = response.json()
                if data["code"] == 200:
                    return {
                        "status": "success",
                        "emojis": data["res"][:request.limit]  # 返回指定数量的表情包
                    }
                else:
                    raise ValueError(data.get("msg", "表情包API返回错误"))
            else:
                raise ValueError("表情包API请求失败")
                
    except ValueError as ve:
        logger.error(f"表情包搜索参数错误: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"获取表情包失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# 阿里云 OSS 配置信息，需要替换为你的实际信息
# 加载环境变量
load_dotenv()

# 从环境变量中获取阿里云 OSS 配置信息
aliyun_access_key_id = os.getenv("ALIYUN_ACCESS_KEY_ID")
aliyun_access_key_secret = os.getenv("ALIYUN_ACCESS_KEY_SECRET")
aliyun_oss_endpoint = os.getenv("ALIYUN_OSS_ENDPOINT")
aliyun_oss_bucket_name = os.getenv("ALIYUN_OSS_BUCKET_NAME")

# 检查环境变量是否存在
if not aliyun_access_key_id or not aliyun_access_key_secret or not aliyun_oss_endpoint or not aliyun_oss_bucket_name:
    raise ValueError("阿里云 OSS 配置信息缺失，请检查 .env 文件")

# 阿里云 OSS 配置
auth = oss2.Auth(aliyun_access_key_id, aliyun_access_key_secret)
bucket = oss2.Bucket(auth, aliyun_oss_endpoint, aliyun_oss_bucket_name)

@app.post("/api/upload_image")
async def upload_image(image: UploadFile = File(...)):
    try:
        # 检查文件类型
        logger.info(f"开始处理图片上传请求，文件名: {image.filename}")
        if not image.content_type.startswith('image/'):
            logger.error(f"文件类型错误，文件 {image.filename} 不是有效的图片文件")
            raise ValueError("请上传有效的图片文件")

        # 生成唯一的文件名
        file_ext = image.filename.split('.')[-1] if '.' in image.filename else 'jpg'
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        logger.info(f"生成的唯一文件名: {unique_filename}")

        # 读取文件内容
        file_content = await image.read()
        logger.info(f"成功读取文件 {image.filename}，文件大小: {len(file_content)} 字节")

        # 上传到阿里云 OSS
        logger.info(f"开始上传文件 {unique_filename} 到阿里云 OSS")
        result = bucket.put_object(unique_filename, file_content)
        logger.info(f"阿里云 OSS 上传响应状态码: {result.status}")

        if result.status == 200:
            # 生成图片的网络地址
            image_url = f"https://{aliyun_oss_bucket_name}.{aliyun_oss_endpoint}/{unique_filename}"
            return {"image_url": image_url}
        else:
            logger.error(f"图片 {unique_filename} 上传到 OSS 失败，状态码: {result.status}")
            raise Exception("图片上传到 OSS 失败")
    except Exception as e:
        logger.error(f"处理图片上传请求时发生错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
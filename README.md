# chat-translator

## 后端启动
使用虚拟环境管理项目依赖

```
pip install virtualenv
```

创建虚拟环境

```
python -m venv venv
```

激活虚拟环境

```
venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/MacOS
```
安装后端依赖

```
cd backend
pip install -r requirements.txt
```

启动应用

```
uvicorn main:app --reload
```

## 前端启动
```
cd frontend
npm install
npm start
```
打开浏览器
```
晚辈端：http://localhost:3000/?role=young&pair_id=1
长辈端：http://localhost:3000/?role=elder&pair_id=1
pair_id可以是任意数字，数字相同的晚辈和长辈进入一个聊天室
```

## 连接DASHSCOPE_API_KEY大模型
再最外层新建.env文件，在.env文件中配置DASHSCOPE_API_KEY，可前往通义千问[API-KEY](https://bailian.console.aliyun.com/?spm=a2c4g.11186623.0.0.ad377980KudS5Q&tab=model#/api-key) 创建一个API_KEY，然后在.env文件中配置，详细可参考[阿里云文档-获取API-KEY](https://help.aliyun.com/zh/model-studio/get-api-key)
```
DASHSCOPE_API_KEY=你的API_KEY
```

## 连接接口盒子API
登录https://www.apihz.cn/，然后在.env文件中配置
```
EMOJI_API_ID=你的API盒子ID
EMOJI_API_KEY=你的API盒子KEY
```
不想登录可以设置EMOJI_API_ID=88888888、EMOJI_API_KEY=88888888 这是通用的测试接口，调用速度可能不佳

## 阿里云对象存储
在.env文件中配置
```
ALIYUN_ACCESS_KEY_ID=你的OSS_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET=你的OSS_ACCESS_KEY_SECRET
ALIYUN_OSS_ENDPOINT=你的OSS_ENDPOINT
ALIYUN_OSS_BUCKET_NAME=你的OSS_BUCKET_NAME
```
## 数据库连接
在.env文件中配置
```
DB_HOST=你的数据库IP
DB_USER=你的数据库用户名
DB_PASSWORD=你的数据库密码
DB_NAME=你的数据库名
```
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
安装依赖

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
http://localhost:3000
```

## 连接DASHSCOPE_API_KEY大模型
```
在.env文件中配置DASHSCOPE_API_KEY
再最外层新建.env文件，写上DASHSCOPE_API_KEY=你的API_KEY
```

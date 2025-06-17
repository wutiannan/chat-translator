import mysql.connector
from mysql.connector import Error
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

class DatabaseManager:
    def __init__(self):
        self.connection = None
        try:
            self.connect()
        except Exception as e:
            print(f"数据库连接失败: {e}")
            raise

    def connect(self):
        try:
            self.connection = mysql.connector.connect(
                host=os.getenv('DB_HOST'),
                user=os.getenv('DB_USER'),
                password=os.getenv('DB_PASSWORD'),
                database=os.getenv('DB_NAME')
            )
            print("MySQL数据库连接成功")
        except Error as e:
            print(f"数据库连接错误: {e}")

    def init_db(self):
        # 先删除可能存在的旧表（仅用于开发环境）
        self.execute_query("DROP TABLE IF EXISTS users")
        for i in range(1, 11):
            self.execute_query(f"DROP TABLE IF EXISTS chat_records_pair_{i}")
        
        # 创建新的用户表（添加pair_id字段）
        self.execute_query("""
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            role ENUM('elder', 'young') NOT NULL,
            pair_id VARCHAR(36) NOT NULL, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")

        # 创建10对用户
        for i in range(1, 11):
            pair_id = f"{i}"
            # 创建长辈用户
            self.execute_query(
                "INSERT INTO users (id, role, pair_id) VALUES (%s, %s, %s)",
                (f"elder_{i}", "elder", pair_id)
            )
            # 创建晚辈用户
            self.execute_query(
                "INSERT INTO users (id, role, pair_id) VALUES (%s, %s, %s)",
                (f"young_{i}", "young", pair_id)
            )
            
            # 为每对用户创建聊天记录表
            self.execute_query(f"""
            CREATE TABLE IF NOT EXISTS chat_records_pair_{pair_id} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message_id BIGINT NOT NULL,
                from_role VARCHAR(10) NOT NULL,
                to_role VARCHAR(10) NOT NULL,
                message_type VARCHAR(10) NOT NULL,
                message_content TEXT NOT NULL,
                pair_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_message_id (message_id),
                INDEX idx_pair_id (pair_id)
            )""")

    def execute_query(self, query, params=None):
        cursor = self.connection.cursor()
        try:
            cursor.execute(query, params or ())
            self.connection.commit()
            return cursor
        except Error as e:
            print(f"执行查询错误: {e}")
            raise
        finally:
            cursor.close()

    def save_message(self, message_id, from_role, to_role, message_type, message_content, pair_id):
        try:
            # 检查数据库连接
            if not self.connection or not self.connection.is_connected():
                print("数据库连接已断开，尝试重新连接...")
                self.connect()
                
            # 检查表是否存在
            cursor = self.connection.cursor()
            cursor.execute(f"SHOW TABLES LIKE 'chat_records_pair_{pair_id}'")
            if not cursor.fetchone():
                print(f"表chat_records_pair_{pair_id}不存在，尝试创建...")
                self.execute_query(f"""
                CREATE TABLE IF NOT EXISTS chat_records_pair_{pair_id} (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id BIGINT NOT NULL,
                    from_role VARCHAR(10) NOT NULL,
                    to_role VARCHAR(10) NOT NULL,
                    message_type VARCHAR(10) NOT NULL,
                    message_content TEXT NOT NULL,
                    pair_id INT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""")
                
            # 保存消息
            query = f"""
            INSERT INTO chat_records_pair_{pair_id} 
            (message_id, from_role, to_role, message_type, message_content, pair_id) 
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            params = (message_id, from_role, to_role, message_type, message_content, pair_id)
            print(f"执行SQL: {query % params}")
            self.execute_query(query, params)
            print(f"消息成功保存到chat_records_pair_{pair_id}表")
            return True
        except Exception as e:
            print(f"保存消息失败: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def get_messages(self, pair_id, limit=100):
        query = f"""
        SELECT * FROM chat_records_pair_{pair_id}
        ORDER BY created_at DESC
        LIMIT %s
        """
        cursor = self.execute_query(query, (limit,))
        return cursor.fetchall()

    def close(self):
        if self.connection:
            self.connection.close()
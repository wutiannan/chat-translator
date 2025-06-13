from db_manager import DatabaseManager
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    try:
        logger.info("开始初始化数据库...")
        db = DatabaseManager()
        logger.info("数据库初始化完成")
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
    except Exception as e:
        logger.error(f"初始化失败: {e}")

if __name__ == "__main__":
    main()

import os
import json
import tempfile
import logging
from datetime import datetime, timedelta
from pathlib import Path

class HistoryManager:
    def __init__(self):
        # 使用系统临时目录，跨平台兼容
        temp_dir = tempfile.gettempdir()
        self.history_dir = Path(temp_dir) / "aiocr" / "history"
        self.history_dir.mkdir(parents=True, exist_ok=True)

    def get_history_file(self, session_id):
        """获取会话对应的历史文件路径"""
        return self.history_dir / f"aiocr_history_{session_id}.json"

    def load_history(self, session_id):
        """加载指定会话的历史记录"""
        history_file = self.get_history_file(session_id)
        if history_file.exists():
            try:
                with open(history_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                logging.error(f"Failed to load history file {history_file}: {e}")
                return []
        return []

    def save_history(self, session_id, history):
        """保存会话历史记录"""
        history_file = self.get_history_file(session_id)
        try:
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except IOError as e:
            logging.error(f"Failed to save history to {history_file}: {e}")

    def add_record(self, session_id, text):
        """添加新历史记录"""
        history = self.load_history(session_id)
        record = {
            'id': len(history),
            'timestamp': datetime.now().isoformat(),  # ISO格式时间戳
            'time': datetime.now().strftime('%H:%M:%S'),  # 兼容现有格式
            'text': text
        }
        history.insert(0, record)  # 最新记录在前
        # 保持最多1000条记录防止文件过大
        if len(history) > 1000:
            history = history[:1000]
        self.save_history(session_id, history)

    def get_paginated_history(self, session_id, page=1, per_page=10):
        """获取分页历史记录"""
        history = self.load_history(session_id)
        total = len(history)
        start = (page - 1) * per_page
        end = start + per_page
        paginated = history[start:end]

        return {
            'page': page,
            'per_page': per_page,
            'total': total,
            'total_pages': (total + per_page - 1) // per_page,
            'history': paginated
        }

    def cleanup_old_records(self, session_id, days=30):
        """清理指定天数前的历史记录"""
        history = self.load_history(session_id)
        cutoff_date = datetime.now() - timedelta(days=days)

        filtered_history = []
        for record in history:
            try:
                record_date = datetime.fromisoformat(record['timestamp'])
                if record_date >= cutoff_date:
                    filtered_history.append(record)
            except (KeyError, ValueError):
                # 如果时间戳格式错误，保留记录（向后兼容）
                filtered_history.append(record)

        # 重新生成ID以保持连续
        for i, record in enumerate(filtered_history):
            record['id'] = i

        self.save_history(session_id, filtered_history)
        return len(history) - len(filtered_history)
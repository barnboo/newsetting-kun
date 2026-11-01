import json
import os
from typing import List, Dict, Any, Tuple

DEFAULT_CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "legend_config.json")

class Config:
    def __init__(self, config_path: str = DEFAULT_CONFIG_PATH):
        self.config_path = config_path
        self._data: Dict[str, Any] = {}
        self.load()

    def load(self):
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except Exception as e:
                print(f"[legend_extractor] Warning: failed to load {self.config_path}: {e}")
                self._data = {}
        else:
            self._data = {}

    @property
    def equipment_keywords(self) -> List[str]:
        return self._data.get("equipment_keywords", [
            "椅子", "イス", "いす", "譜面台", "長机", "机", "指揮台", "ピアノ",
            "ティンパニ", "バスドラム", "スネアドラム", "シロフォン", "マリンバ",
            "ビブラフォン", "チャイム", "シンバル", "コントラバス", "ひな段"
        ])

    @property
    def exclude_instruction_prefixes(self) -> List[str]:
        return self._data.get("exclude_instruction_prefixes", ["※", "＊", "*", "注", "注意", "備考"])

    @property
    def exclude_instruction_keywords(self) -> List[str]:
        return self._data.get("exclude_instruction_keywords", [
            "下さい", "ください", "お願いします", "こと", "厳守", "固定", "提出", "記入", "禁止"
        ])

    @property
    def exclude_table_headers(self) -> List[str]:
        return self._data.get("exclude_table_headers", [
            "ひな壇", "ひな段", "1列目", "2列目", "上段", "下段", "する・しない", "要・不要", "有・無"
        ])

    @property
    def column_header_hints(self) -> Dict[str, List[str]]:
        return self._data.get("column_header_hints", {
            "no": ["no", "no.", "№", "番号", "連番"],
            "name": ["品名", "名称", "備品名", "備品", "楽器名", "楽器", "内容"],
            "symbol": ["記号", "マーク", "図記号", "シンボル", "印", "凡例"],
            "quantity": ["数量", "数", "個数", "台数", "脚数", "要不要", "備考"]
        })

    @property
    def delimiters(self) -> List[str]:
        return self._data.get("delimiters", ["…", "‥", "...", "..", "・", "＝", "=", "：", ":", "－", "-", " "])

    @property
    def bracket_pairs(self) -> List[List[str]]:
        return self._data.get("bracket_pairs", [["(", ")"], ["（", "）"], ["[", "]"], ["［", "］"]])

    @property
    def normalization_map(self) -> Dict[str, str]:
        return self._data.get("normalization_map", {
            "◯": "○", "〇": "○",
            "●": "●", "⚫": "●",
            "✕": "×", "✖": "×",
            "□": "□", "■": "■",
            "△": "△", "▲": "▲",
            "☆": "☆", "★": "★",
            "◎": "◎"
        })

    @property
    def standard_symbols(self) -> List[str]:
        return self._data.get("standard_symbols", [
            "○", "●", "×", "□", "■", "△", "▲", "☆", "★", "◎", "◇", "◆",
            "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"
        ])

    @property
    def thresholds(self) -> Dict[str, Any]:
        return self._data.get("thresholds", {
            "min_symbol_size_pt": 2.0,
            "max_symbol_size_pt": 85.0,
            "max_symbol_aspect_ratio": 5.0,
            "vector_cluster_distance_pt": 1.8,
            "render_dpi": 300,
            "line_removal_penetration_ratio": 0.88,
            "tight_crop_margin_ratio": 0.08,
            "tight_crop_min_margin_pt": 1.5,
            "iou_dedup_threshold": 0.40
        })

cfg = Config()

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
            "椅子", "イス", "いす", "合奏用椅子", "合奏椅子", "パイプ椅子", "折りたたみ椅子",
            "ピアノ椅子", "背もたれ椅子", "高低自在椅子", "演奏用椅子", "丸椅子", "譜めくり椅子", "コントラバス椅子",
            "譜面台", "卓上譜面台", "指揮者用譜面台", "木製譜面台", "合奏用譜面台",
            "長机", "机", "会議机", "受付机", "作業台", "折りたたみ机",
            "指揮台", "指揮者台", "演台", "司会台", "花台",
            "ピアノ", "グランドピアノ", "アップライトピアノ", "電子ピアノ",
            "ティンパニ", "バスドラム", "大太鼓", "スネアドラム", "小太鼓",
            "シロフォン", "木琴", "マリンバ", "グロッケン", "鉄琴", "ビブラフォン", "ヴィブラフォン", "チャイム",
            "ドラ", "タムタム", "ゴング", "シンバル", "サスペンドシンバル", "合わせシンバル",
            "ひな段", "山台", "平台", "箱馬",
            "マイク", "マイクスタンド", "ワイヤレスマイク",
            "電源", "コンセント", "延長コード", "案内板", "看板", "時計", "スピーカー",
            "Timp", "Timpani", "B.D", "BD", "S.D", "SD", "Dr.Set", "DrumSet", "Drums",
            "Chime", "Gong", "Xylo", "Glocken", "Glock", "Marimba", "Marinba", "Vib", "Cym"
        ])

    @property
    def circulation_keywords(self) -> List[str]:
        return self._data.get("circulation_keywords", [
            "入場", "退場", "花道", "搬入", "搬出", "客席", "動線", "袖"
        ])

    @property
    def selection_table_keywords(self) -> List[str]:
        return self._data.get("selection_table_keywords", [
            "使う・使わない", "借用する・借用しない", "する・しない", "要・不要", "有・無", "有り・無し", "全開", "半開", "全開・半開", "閉じる"
        ])

    @property
    def exclude_instruction_prefixes(self) -> List[str]:
        return self._data.get("exclude_instruction_prefixes", ["※", "＊", "*", "注", "注意", "備考"])

    @property
    def exclude_instruction_keywords(self) -> List[str]:
        return self._data.get("exclude_instruction_keywords", [
            "下さい", "ください", "お願いします", "こと", "厳守", "固定", "提出", "記入", "禁止",
            "囲む", "囲んで", "つける", "つけ,", "つけ", "丸で囲む", "〇で囲む", "○で囲む", "○をつける", "〇をつける"
        ])

    @property
    def exclude_table_headers(self) -> List[str]:
        return self._data.get("exclude_table_headers", [
            "ひな壇", "ひな段", "1段目", "一段目", "2段目", "二段目", "1列目", "2列目", "上段", "下段",
            "する・しない", "要・不要", "有・無", "借・持", "借持", "使う・使わない", "全開", "半開"
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
        return self._data.get("delimiters", [
            "→", "⇒", "➡", "＝", "=", "…", "‥", "...", "..", "：", ":", "ー", "―", "－", "-", "—"
        ])

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
            "min_symbol_size_pt": 1.2,
            "max_symbol_size_pt": 85.0,
            "max_symbol_aspect_ratio": 5.0,
            "min_vector_line_len_pt": 1.2,
            "vector_cluster_distance_pt": 1.8,
            "max_char_gap_for_justified_pt": 55.0,
            "max_line_chunk_gap_pt": 42.0,
            "max_pair_search_dist_pt": 80.0,
            "render_dpi": 300,
            "line_removal_penetration_ratio": 0.88,
            "tight_crop_margin_ratio": 0.08,
            "tight_crop_min_margin_pt": 1.2,
            "iou_dedup_threshold": 0.40
        })

cfg = Config()

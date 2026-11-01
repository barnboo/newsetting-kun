from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any
import fitz

class SymbolType(str, Enum):
    VECTOR_DRAWING = "vector_drawing"
    TEXT_GLYPH = "text_glyph"
    RASTER_IMAGE = "raster_image"

@dataclass
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def x0(self) -> float:
        return self.x

    @property
    def y0(self) -> float:
        return self.y

    @property
    def x1(self) -> float:
        return self.x + self.width

    @property
    def y1(self) -> float:
        return self.y + self.height

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def to_fitz_rect(self) -> fitz.Rect:
        return fitz.Rect(self.x0, self.y0, self.x1, self.y1)

    @classmethod
    def from_fitz_rect(cls, r: fitz.Rect) -> Box:
        return cls(
            x=float(r.x0),
            y=float(r.y0),
            width=float(max(0.0, r.width)),
            height=float(max(0.0, r.height))
        )

    def expanded(self, pad: float) -> Box:
        return Box(
            x=self.x - pad,
            y=self.y - pad,
            width=self.width + pad * 2,
            height=self.height + pad * 2
        )

    def iou(self, other: Box) -> float:
        ix0 = max(self.x0, other.x0)
        iy0 = max(self.y0, other.y0)
        ix1 = min(self.x1, other.x1)
        iy1 = min(self.y1, other.y1)
        if ix1 <= ix0 or iy1 <= iy0:
            return 0.0
        inter = (ix1 - ix0) * (iy1 - iy0)
        union = self.area + other.area - inter
        return inter / union if union > 0 else 0.0

    def to_dict(self) -> Dict[str, float]:
        return {
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "width": round(self.width, 2),
            "height": round(self.height, 2)
        }

@dataclass
class ExtractedLegendItem:
    name: str
    symbol_box: Box
    label_box: Box
    symbol_type: str  # "vector_drawing" | "text_glyph" | "raster_image"
    confidence: float = 1.0
    source_mode: str = "table"  # "table" | "inline" | "margin_miniature"
    raw_symbol_text: Optional[str] = None
    extra_meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "symbol_box": self.symbol_box.to_dict(),
            "label_box": self.label_box.to_dict(),
            "symbol_type": self.symbol_type,
            "confidence": round(self.confidence, 3),
            "source_mode": self.source_mode
        }

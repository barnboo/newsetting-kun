"""
Legend Extractor Engine
Pure local, deterministic extraction of legend symbols and equipment names from stage/layout PDF drawings.
"""

from .engine import extract_legends, LegendExtractor
from .models import ExtractedLegendItem, Box, SymbolType

__all__ = ["extract_legends", "LegendExtractor", "ExtractedLegendItem", "Box", "SymbolType"]

from google.genai import types

from services import analytics_ai_service
from services.tasklytic_ai_contracts import SUPPORTED_VERTEX_MODEL_IDS


def test_analytics_defaults_to_argon():
    assert analytics_ai_service.ANALYTICS_MODEL == "gemini-4-argon"


def test_structured_json_config_is_argon_compatible():
    config = analytics_ai_service._structured_json_config(
        response_schema=types.Schema(type=types.Type.OBJECT),
    )
    # Argon returns a 400 for thinking_budget and ignores sampling parameters.
    assert config.thinking_config.thinking_budget is None
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert config.temperature is None
    assert config.max_output_tokens >= 32_768


def test_tasklytic_offers_argon_instead_of_3_1_pro():
    assert "gemini-4-argon" in SUPPORTED_VERTEX_MODEL_IDS
    assert "gemini-3.1-pro-preview" not in SUPPORTED_VERTEX_MODEL_IDS

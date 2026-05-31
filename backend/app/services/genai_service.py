"""
GenAI Incident Narration Engine
================================
Interchangeable LLM provider architecture:

  - OllamaProvider  (default — local, no API key)
  - OpenAIProvider  (optional — if OPENAI_API_KEY is set)

Auto-selection logic:
  if settings.OPENAI_API_KEY:
      provider = OpenAIProvider()
  else:
      provider = OllamaProvider()

This pattern provides:
  ✓ Graceful degradation  (works fully offline)
  ✓ Vendor abstraction    (swap providers without code changes)
  ✓ Production scalability (migrate to any LLM)
"""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any, Dict

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


# ─────────────────────────────────────────────────────────────────
#   BASE PROVIDER
# ─────────────────────────────────────────────────────────────────
class LLMProvider(ABC):
    """Abstract base for all LLM providers."""

    provider_name: str = "base"
    model_name: str = "unknown"

    @abstractmethod
    async def generate_incident_summary(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a structured incident summary from event data.

        Returns dict with keys:
          - title: str
          - summary: str
          - classification: str
          - recommended_actions: List[str]
          - confidence_notes: str
          - severity_justification: str
        """
        ...

    @abstractmethod
    async def generate_daily_briefing(self, stats: Dict[str, Any]) -> str:
        """Generate an intelligence briefing from daily statistics."""
        ...

    def _build_incident_prompt(self, event_data: Dict[str, Any]) -> str:
        return f"""You are an expert security analyst AI at an enterprise surveillance operations center.
Analyze the following detection event and produce a structured incident report.

EVENT DATA:
- Event ID: {event_data.get('event_id')}
- Event Type: {event_data.get('event_type')}
- Severity: {event_data.get('severity')}
- Threat Score: {event_data.get('threat_score', 0):.2f} / 1.0
- Confidence: {event_data.get('confidence', 0):.2f}
- Timestamp: {event_data.get('timestamp')}
- Zone: {event_data.get('zone_name', 'Unknown')}
- Behavior Flags: {', '.join(event_data.get('behavior_flags', [])) or 'None'}

Respond ONLY with valid JSON matching this schema:
{{
  "title": "Brief incident title (max 80 chars)",
  "summary": "Professional 2-3 sentence incident summary for security operators",
  "classification": "One of: ROUTINE_MONITORING | SUSPICIOUS_ACTIVITY | SECURITY_BREACH | CRITICAL_THREAT | FALSE_POSITIVE",
  "recommended_actions": ["Action 1", "Action 2", "Action 3"],
  "confidence_notes": "Brief note on detection confidence and any caveats",
  "severity_justification": "Why this severity level was assigned"
}}"""

    def _build_briefing_prompt(self, stats: Dict[str, Any]) -> str:
        return f"""You are the AI intelligence officer for an enterprise security operations center.
Generate a concise daily intelligence briefing based on today's surveillance data.

STATISTICS:
- Total Events: {stats.get('total_events')}
- Critical Threats: {stats.get('critical_threats')}
- Persons Detected: {stats.get('persons_detected')}
- Top Zones: {stats.get('top_zones')}
- Behavior Summary: {stats.get('behavior_summary')}

Write a professional 3-paragraph briefing suitable for executive review.
Focus on: threat landscape, notable incidents, and recommendations."""

    def _parse_json_response(self, text: str) -> Dict[str, Any]:
        """Extract and parse JSON from LLM response."""
        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Extract JSON block
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        # Fallback structure
        logger.warning("llm_json_parse_failed", response_snippet=text[:200])
        return {
            "title": "Security Event Detected",
            "summary": text[:500] if text else "Incident detected by AI surveillance system.",
            "classification": "SUSPICIOUS_ACTIVITY",
            "recommended_actions": ["Review footage", "Dispatch security personnel"],
            "confidence_notes": "AI narration parsing encountered an issue; manual review recommended.",
            "severity_justification": "Automated assessment based on detection parameters.",
        }


# ─────────────────────────────────────────────────────────────────
#   OLLAMA PROVIDER  (local, default)
# ─────────────────────────────────────────────────────────────────
class OllamaProvider(LLMProvider):
    """Ollama local LLM provider — runs Llama3 or any Ollama model."""

    provider_name = "ollama"

    def __init__(self):
        self.model_name = settings.OLLAMA_MODEL
        self.base_url = settings.OLLAMA_BASE_URL
        logger.info("llm_provider_initialized", provider="ollama", model=self.model_name)

    async def warm_up(self):
        """Pre-warm/load the Ollama model to avoid first-load timeout."""
        import aiohttp
        payload = {
            "model": self.model_name,
            "prompt": "hello",
            "stream": False,
        }
        logger.info("llm_prewarm_started", provider="ollama", model=self.model_name)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=180),
                ) as resp:
                    if resp.status == 200:
                        logger.info("llm_prewarm_success", provider="ollama", model=self.model_name)
                    else:
                        logger.warning("llm_prewarm_failed", status=resp.status)
        except Exception as e:
            logger.warning("llm_prewarm_exception", error=str(e))

    async def generate_incident_summary(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        import aiohttp
        prompt = self._build_incident_prompt(event_data)

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 512},
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=180),
                ) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"Ollama returned {resp.status}")
                    data = await resp.json()
                    response_text = data.get("response", "")
        except Exception as e:
            logger.error("ollama_request_failed", error=str(e))
            response_text = self._fallback_narrative(event_data)

        return self._parse_json_response(response_text)

    async def generate_daily_briefing(self, stats: Dict[str, Any]) -> str:
        import aiohttp
        prompt = self._build_briefing_prompt(stats)
        payload = {"model": self.model_name, "prompt": prompt, "stream": False}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate", json=payload,
                    timeout=aiohttp.ClientTimeout(total=180),
                ) as resp:
                    data = await resp.json()
                    return data.get("response", "Daily briefing unavailable.")
        except Exception as e:
            logger.error("ollama_briefing_failed", error=str(e))
            return "Daily intelligence briefing temporarily unavailable."

    def _fallback_narrative(self, event_data: Dict[str, Any]) -> str:
        """Rule-based fallback when Ollama is unavailable."""
        severity = event_data.get("severity", "medium")
        event_type = event_data.get("event_type", "detection")
        score = event_data.get("threat_score", 0.5)
        zone = event_data.get("zone_name", "monitored area")
        flags = event_data.get("behavior_flags", [])

        classification = "SUSPICIOUS_ACTIVITY"
        if score >= 0.8:
            classification = "CRITICAL_THREAT"
        elif score >= 0.6:
            classification = "SECURITY_BREACH"
        elif score < 0.3:
            classification = "ROUTINE_MONITORING"

        actions = ["Review video footage", "Log incident"]
        if score >= 0.7:
            actions.insert(0, "Dispatch security personnel immediately")
        if "loitering" in flags:
            actions.append("Monitor for continued loitering behavior")
        if "tailgating" in flags:
            actions.append("Verify access control logs")

        return json.dumps({
            "title": f"{severity.title()} Security Event — {event_type.replace('_', ' ').title()}",
            "summary": (
                f"AI surveillance detected a {severity}-severity {event_type.replace('_', ' ')} "
                f"in the {zone} with a threat score of {score:.0%}. "
                f"{'Behavioral flags include: ' + ', '.join(flags) + '.' if flags else ''} "
                f"Immediate operator review is recommended."
            ),
            "classification": classification,
            "recommended_actions": actions,
            "confidence_notes": f"Detection confidence: {event_data.get('confidence', 0):.0%}. Local LLM provider active.",
            "severity_justification": f"Threat score of {score:.2f} maps to {severity} severity classification.",
        })


# ─────────────────────────────────────────────────────────────────
#   OPENAI PROVIDER  (optional — requires API key)
# ─────────────────────────────────────────────────────────────────
class OpenAIProvider(LLMProvider):
    """OpenAI GPT-4o provider — used when OPENAI_API_KEY is configured."""

    provider_name = "openai"

    def __init__(self):
        self.model_name = settings.OPENAI_MODEL
        from openai import AsyncOpenAI
        self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        logger.info("llm_provider_initialized", provider="openai", model=self.model_name)

    async def generate_incident_summary(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        prompt = self._build_incident_prompt(event_data)
        try:
            response = await self._client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "You are an expert security analyst AI. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=512,
            )
            return self._parse_json_response(response.choices[0].message.content)
        except Exception as e:
            logger.error("openai_request_failed", error=str(e))
            return self._parse_json_response("")

    async def generate_daily_briefing(self, stats: Dict[str, Any]) -> str:
        prompt = self._build_briefing_prompt(stats)
        try:
            response = await self._client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "You are an AI security intelligence officer. Write professional briefings."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=800,
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error("openai_briefing_failed", error=str(e))
            return "Daily intelligence briefing temporarily unavailable."


# ─────────────────────────────────────────────────────────────────
#   AUTO-SELECTION FACTORY
# ─────────────────────────────────────────────────────────────────
_provider_instance: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    """
    Auto-selects the best available LLM provider.

    Priority:
      1. OpenAI GPT-4o  — if OPENAI_API_KEY is set
      2. Ollama Llama3  — local fallback (always available)
    """
    global _provider_instance
    if _provider_instance is None:
        if settings.use_openai:
            _provider_instance = OpenAIProvider()
            logger.info("llm_auto_selected", provider="openai", reason="API key present")
        else:
            _provider_instance = OllamaProvider()
            logger.info("llm_auto_selected", provider="ollama", reason="No OpenAI key — using local LLM")
    return _provider_instance


async def prewarm_llm():
    """Asynchronously triggers model preloading on LLM provider."""
    try:
        provider = get_llm_provider()
        if hasattr(provider, "warm_up"):
            await provider.warm_up()
    except Exception as e:
        logger.warning("llm_prewarm_trigger_failed", error=str(e))

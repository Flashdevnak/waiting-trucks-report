"""Public-data validation shared by the Brain registry and its importer."""

import html
import json
from pathlib import Path
import re
import tempfile
from urllib.parse import unquote, urlsplit


REPO = "Flashdevnak/waiting-trucks-report"
CREDENTIAL = re.compile(
    r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|"
    r"(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{12,})\b|"
    r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|"
    r"(?i:\bBearer\s+[A-Za-z0-9_.~+/=-]{12,})|"
    r"(?i:\b(?:[\w-]*(?:api[_-]?key|access[_-]?key|token|secret|password|authorization|cookie))"
    r"[\s\"']{0,3}[:=]\s*[\"']?)(?!\$\{|<|\[|UNKNOWN\b|NOT_RECOVERED\b|REDACTED\b)[^\s\"`'<>|]{6,}|"
    r"(?i:\b(?:https?|postgres(?:ql)?|mysql|redis)://[^\s/@]+:[^\s/@]+@)"
)
PERSONAL = re.compile(
    r"\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|"
    r"(?<!\d)\+66[ .-]?(?:\d[ .-]?){8,9}(?!\d)|"
    r"\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b", re.I
)
PRIVATE_EVIDENCE = re.compile(
    r'(?i:"(?:request|response)Headers"\s*:|"cookies"\s*:\s*\[|'
    r'"entries"\s*:\s*\[\s*\{\s*"startedDateTime"|'
    r'\b(?:attachment|artifact|log|har)\s*[:=]\s*[^\s]+\.(?:har|log|zip)\b)'
)
PROMPT = re.compile(
    r"\b(?:ignore|disregard|override|forget)\b.{0,65}\b(?:instructions?|prompts?|rules?)\b|"
    r"\b(?:system|developer)\s+(?:message|prompt)\s*:|"
    r"\b(?:owner|admin)\s+(?:has\s+)?approv(?:ed|al)\s*[:=]|"
    r"\b(?:reveal|disclose|send|print|exfiltrate)\b.{0,65}\b(?:credentials|secrets|tokens)\b|"
    r"ละเว้น.{0,20}คำสั่ง|เปิดเผย.{0,20}(?:รหัสผ่าน|โทเคน)", re.I
)
ACTIVE_MARKUP = re.compile(
    r"<\s*(?:/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\s*/?|!--)|"
    r"!?\[[^\]\n]*\]\s*(?:\(|\[)|"
    r"(?i:\b(?:https?|file|data|javascript|vbscript):(?:/{0,2})\S+|\bwww\.\S+)"
)
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]")
GH_ROUTE = re.compile(
    rf"/{re.escape(REPO)}/(?:pull/\d+|issues/\d+|commit/[a-f0-9]{{40}}|"
    r"actions/runs/\d+(?:/job/\d+)?|blob/[a-f0-9]{40}/[\w./-]+|"
    r"releases/tag/[\w./-]+)"
)
LOCAL_REF = re.compile(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\.md")


def normalized(value):
    for _ in range(2):
        value = html.unescape(unquote(value))
    return value


def classifications(value, *, free_text=False):
    value = normalized(value)
    matches = [
        ("credential pattern", CREDENTIAL), ("personal data pattern", PERSONAL),
        ("private evidence pattern", PRIVATE_EVIDENCE),
    ]
    if free_text:
        matches += [("embedded instruction", PROMPT), ("active markup", ACTIVE_MARKUP),
                    ("control character", CONTROL)]
    return {category for category, pattern in matches if pattern.search(value)}


def public_text(value):
    if not isinstance(value, str):
        raise ValueError("Expected public text")
    issues = classifications(value, free_text=True)
    if issues & {"credential pattern", "personal data pattern", "private evidence pattern"}:
        return "[redacted]"
    if issues:
        return "[untrusted text omitted]"
    return value


def require_public_text(value, field):
    if not isinstance(value, str) or classifications(value, free_text=True):
        raise ValueError(f"Unsafe public text in {field}")


def strict_json(value):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = item
        return result

    def constant(_):
        raise ValueError("Non-finite JSON value")

    return json.loads(value, object_pairs_hook=pairs, parse_constant=constant)


def repository_path(root, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Unsafe repository path")
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink in repository path")
    return current


def validate_reference(value, root):
    if not isinstance(value, str) or classifications(value) or not re.fullmatch(r"[\w./#:-]+", value):
        raise ValueError("Unsafe evidence reference")
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        if (parsed.scheme != "https" or parsed.netloc != "github.com" or parsed.query
                or not GH_ROUTE.fullmatch(parsed.path)
                or any(part in {".", ".."} for part in parsed.path.split("/"))):
            raise ValueError("Untrusted evidence link")
        return
    path = parsed.path
    if not LOCAL_REF.fullmatch(path) or not path.startswith(("docs/", "DECISION_LOG.md")):
        raise ValueError("Unsafe local evidence reference")
    if not repository_path(root, path).is_file():
        raise ValueError("missing local reference")


def atomic_write(root, path, payload):
    relative = path.relative_to(root)
    repository_path(root, relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
        repository_path(root, relative)
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def markdown_text(value):
    return re.sub(r"([\\`*~\[\]<>])", r"\\\1", value)

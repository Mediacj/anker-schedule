"""Compact schedule helpers: e=1;m=oonxc...;p=0,0,500,...;s=100,10,100/10,..."""

from __future__ import annotations

from typing import Any

from .const import (
    CHAR_TO_MODE,
    DEFAULT_CHARGE_SOC,
    DEFAULT_DEFAULT_POWER,
    DEFAULT_DISCHARGE_SOC,
    MODE_CHARGE,
    MODE_DISCHARGE,
    MODE_NOM,
    MODE_OFF,
    MODE_TO_CHAR,
    MODES,
)


def clamp_soc(value: Any, fallback: int = 0) -> int:
    try:
        soc = int(value)
    except (TypeError, ValueError):
        soc = int(fallback)
    return max(0, min(100, soc))


def default_soc_for_mode(
    mode: str,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> int:
    """Primary SOC for modes with one slider (laden=max, ontladen=min)."""
    if mode == MODE_CHARGE:
        return int(charge_soc)
    if mode == MODE_DISCHARGE:
        return int(discharge_soc)
    if mode == MODE_NOM:
        return int(charge_soc)
    return 0


def slot_socs(
    slot: dict[str, Any],
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> tuple[int, int]:
    """Return (soc_max, soc_min) for a slot."""
    mode = slot.get("mode", MODE_OFF)
    max_fallback = (
        int(charge_soc) if mode in (MODE_CHARGE, MODE_NOM) else 0
    )
    min_fallback = (
        int(discharge_soc) if mode in (MODE_DISCHARGE, MODE_NOM) else 0
    )
    if "soc_max" in slot:
        soc_max = clamp_soc(slot.get("soc_max"), max_fallback)
    elif mode == MODE_CHARGE and "soc" in slot:
        soc_max = clamp_soc(slot.get("soc"), max_fallback)
    elif mode == MODE_NOM and "soc" in slot:
        soc_max = clamp_soc(slot.get("soc"), max_fallback)
    else:
        soc_max = max_fallback

    if "soc_min" in slot:
        soc_min = clamp_soc(slot.get("soc_min"), min_fallback)
    elif mode == MODE_DISCHARGE and "soc" in slot:
        soc_min = clamp_soc(slot.get("soc"), min_fallback)
    else:
        soc_min = min_fallback

    return soc_max, soc_min


def encode_soc_token(
    mode: str,
    soc_max: int,
    soc_min: int,
) -> str:
    if mode == MODE_NOM:
        return f"{int(soc_max)}/{int(soc_min)}"
    if mode == MODE_CHARGE:
        return str(int(soc_max))
    if mode == MODE_DISCHARGE:
        return str(int(soc_min))
    return "0"


def decode_soc_token(
    token: str,
    mode: str,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> tuple[int, int]:
    """Parse one s=-token into (soc_max, soc_min)."""
    text = (token or "").strip()
    max_fallback = int(charge_soc) if mode in (MODE_CHARGE, MODE_NOM) else 0
    min_fallback = int(discharge_soc) if mode in (MODE_DISCHARGE, MODE_NOM) else 0

    if "/" in text:
        left, right = text.split("/", 1)
        return (
            clamp_soc(left, max_fallback),
            clamp_soc(right, min_fallback),
        )

    if text == "":
        return max_fallback, min_fallback

    single = clamp_soc(text, default_soc_for_mode(
        mode, charge_soc=charge_soc, discharge_soc=discharge_soc
    ))
    if mode == MODE_CHARGE:
        return single, min_fallback
    if mode == MODE_DISCHARGE:
        return max_fallback, single
    if mode == MODE_NOM:
        # Legacy single value on NOM: treat as max, keep default min.
        return single, min_fallback
    return 0, 0


def default_slot(
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> dict[str, Any]:
    return {
        "mode": MODE_OFF,
        "power": int(default_power),
        "soc": 0,
        "soc_max": 0,
        "soc_min": 0,
    }


def normalize_slot(
    value: Any,
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> dict[str, Any]:
    base = default_slot(
        default_power, charge_soc=charge_soc, discharge_soc=discharge_soc
    )
    if value is True:
        mode = MODE_NOM
        soc_max, soc_min = int(charge_soc), int(discharge_soc)
        return {
            "mode": mode,
            "power": base["power"],
            "soc": soc_max,
            "soc_max": soc_max,
            "soc_min": soc_min,
        }
    if value is False or value is None:
        return dict(base)
    if isinstance(value, str) and value in MODES:
        mode = value
        if mode == MODE_NOM:
            soc_max, soc_min = int(charge_soc), int(discharge_soc)
        elif mode == MODE_CHARGE:
            soc_max, soc_min = int(charge_soc), 0
        elif mode == MODE_DISCHARGE:
            soc_max, soc_min = 0, int(discharge_soc)
        else:
            soc_max, soc_min = 0, 0
        return {
            "mode": mode,
            "power": base["power"],
            "soc": soc_max if mode != MODE_DISCHARGE else soc_min,
            "soc_max": soc_max,
            "soc_min": soc_min,
        }
    if isinstance(value, dict):
        mode = value.get("mode") if value.get("mode") in MODES else MODE_OFF
        try:
            power = int(value.get("power", default_power))
        except (TypeError, ValueError):
            power = default_power
        soc_max, soc_min = slot_socs(
            {"mode": mode, **value},
            charge_soc=charge_soc,
            discharge_soc=discharge_soc,
        )
        if mode == MODE_NOM and "soc_max" not in value and "soc_min" not in value:
            # Verse NOM zonder SOC: defaults.
            if "soc" not in value:
                soc_max, soc_min = int(charge_soc), int(discharge_soc)
        primary = soc_min if mode == MODE_DISCHARGE else soc_max
        return {
            "mode": mode,
            "power": max(0, power),
            "soc": primary,
            "soc_max": soc_max,
            "soc_min": soc_min,
        }
    return dict(base)


def normalize_schedule(
    value: Any,
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> list[dict[str, Any]]:
    arr = list(value)[:24] if isinstance(value, list) else []
    while len(arr) < 24:
        arr.append(None)
    return [
        normalize_slot(
            v,
            default_power,
            charge_soc=charge_soc,
            discharge_soc=discharge_soc,
        )
        for v in arr
    ]


def serialize_compact(
    enabled: bool,
    hours: list[dict[str, Any]],
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> str:
    schedule = normalize_schedule(
        hours,
        default_power,
        charge_soc=charge_soc,
        discharge_soc=discharge_soc,
    )
    modes = "".join(MODE_TO_CHAR.get(s["mode"], "o") for s in schedule)
    # Vermogen alleen voor laden/ontladen bewaren — anders past s=max/min niet in 255.
    power_tokens: list[str] = []
    for s in schedule:
        if s["mode"] in (MODE_CHARGE, MODE_DISCHARGE):
            power_tokens.append(str(int(s["power"])))
        else:
            power_tokens.append("")
    powers = ",".join(power_tokens)
    socs = ",".join(
        encode_soc_token(s["mode"], int(s["soc_max"]), int(s["soc_min"]))
        for s in schedule
    )
    return f"e={1 if enabled else 0};m={modes};p={powers};s={socs}"


def parse_compact(
    raw: str | None,
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> dict[str, Any] | None:
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text or text in ("unknown", "unavailable"):
        return None

    if text.startswith("{"):
        import json

        try:
            data = json.loads(text)
        except (TypeError, ValueError):
            return None
        return {
            "enabled": bool(data.get("enabled", True)),
            "hours": normalize_schedule(
                data.get("hours"),
                default_power,
                charge_soc=charge_soc,
                discharge_soc=discharge_soc,
            ),
        }

    parts: dict[str, str] = {}
    for chunk in text.split(";"):
        if "=" not in chunk:
            continue
        key, val = chunk.split("=", 1)
        parts[key] = val

    modes = parts.get("m", "")
    if len(modes) < 24:
        return None

    power_parts = parts.get("p", "").split(",") if parts.get("p") else []
    soc_parts = parts.get("s", "").split(",") if parts.get("s") else []
    hours: list[dict[str, Any]] = []
    for i in range(24):
        mode = CHAR_TO_MODE.get(modes[i], MODE_OFF)
        try:
            if i < len(power_parts) and power_parts[i] != "":
                power = int(power_parts[i])
            else:
                power = default_power
        except (TypeError, ValueError):
            power = default_power
        token = soc_parts[i] if i < len(soc_parts) else ""
        soc_max, soc_min = decode_soc_token(
            token,
            mode,
            charge_soc=charge_soc,
            discharge_soc=discharge_soc,
        )
        primary = soc_min if mode == MODE_DISCHARGE else soc_max
        hours.append(
            {
                "mode": mode,
                "power": max(0, power),
                "soc": primary,
                "soc_max": soc_max,
                "soc_min": soc_min,
            }
        )
    return {
        "enabled": parts.get("e", "1") != "0",
        "hours": hours,
    }


def empty_compact(
    default_power: int = DEFAULT_DEFAULT_POWER,
    *,
    charge_soc: int = DEFAULT_CHARGE_SOC,
    discharge_soc: int = DEFAULT_DISCHARGE_SOC,
) -> str:
    return serialize_compact(
        True,
        [
            default_slot(
                default_power, charge_soc=charge_soc, discharge_soc=discharge_soc
            )
            for _ in range(24)
        ],
        default_power,
        charge_soc=charge_soc,
        discharge_soc=discharge_soc,
    )

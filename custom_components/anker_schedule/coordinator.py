"""Schedule storage and hourly apply logic for Anker Schedule."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .const import (
    CONF_CHARGE_OPTION,
    CONF_CHARGE_SOC_ENTITY,
    CONF_DEFAULT_CHARGE_SOC,
    CONF_DEFAULT_DISCHARGE_SOC,
    CONF_DEFAULT_POWER,
    CONF_DIRECTION_ENTITY,
    CONF_DISCHARGE_OPTION,
    CONF_DISCHARGE_SOC_ENTITY,
    CONF_MAX_POWER,
    CONF_MIN_POWER,
    CONF_MODE_ENTITY,
    CONF_NOM_OPTION,
    CONF_NOM_SWITCH_ENTITY,
    CONF_OFF_OPTION,
    CONF_POWER_ENTITY,
    CONF_POWER_STEP,
    CONF_THIRD_PARTY_OPTION,
    DEFAULT_CHARGE_OPTION,
    DEFAULT_CHARGE_SOC,
    DEFAULT_DEFAULT_POWER,
    DEFAULT_DISCHARGE_OPTION,
    DEFAULT_DISCHARGE_SOC,
    DEFAULT_MAX_POWER,
    DEFAULT_MIN_POWER,
    DEFAULT_NOM_OPTION,
    DEFAULT_NOM_SWITCH,
    DEFAULT_OFF_OPTION,
    DEFAULT_POWER_STEP,
    DEFAULT_MODE_SETTLE_SECONDS,
    DEFAULT_THIRD_PARTY_OPTION,
    DOMAIN,
    MODE_CHARGE,
    MODE_DISCHARGE,
    MODE_NOM,
    MODE_NOM_O,
    MODE_OFF,
)
from .schedule import (
    clamp_soc,
    default_soc_for_mode,
    empty_compact,
    normalize_schedule,
    parse_compact,
    serialize_compact,
)

_LOGGER = logging.getLogger(__name__)


class AnkerScheduleCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Holds schedule state and applies the current hour to Anker entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=1),
        )
        self.entry = entry
        self._unsub_hourly = None
        self._last_applied_key: str | None = None
        self._schedule_entity_id: str | None = None
        self._apply_lock = asyncio.Lock()
        self._unsub_verify = None
        self.data = self._fresh_data()

    def _cfg(self, key: str, default: Any) -> Any:
        if key in self.entry.options:
            return self.entry.options[key]
        return self.entry.data.get(key, default)

    @property
    def default_power(self) -> int:
        return int(self._cfg(CONF_DEFAULT_POWER, DEFAULT_DEFAULT_POWER))

    @property
    def min_power(self) -> int:
        return max(0, int(self._cfg(CONF_MIN_POWER, DEFAULT_MIN_POWER)))

    @property
    def max_power(self) -> int:
        value = int(self._cfg(CONF_MAX_POWER, DEFAULT_MAX_POWER))
        return value if value >= self.min_power else self.min_power

    @property
    def power_step(self) -> int:
        step = int(self._cfg(CONF_POWER_STEP, DEFAULT_POWER_STEP))
        return step if step > 0 else DEFAULT_POWER_STEP

    @property
    def default_charge_soc(self) -> int:
        return clamp_soc(
            self._cfg(CONF_DEFAULT_CHARGE_SOC, DEFAULT_CHARGE_SOC),
            DEFAULT_CHARGE_SOC,
        )

    @property
    def default_discharge_soc(self) -> int:
        return clamp_soc(
            self._cfg(CONF_DEFAULT_DISCHARGE_SOC, DEFAULT_DISCHARGE_SOC),
            DEFAULT_DISCHARGE_SOC,
        )

    def _parse(self, raw: str | None) -> dict[str, Any] | None:
        return parse_compact(
            raw,
            self.default_power,
            charge_soc=self.default_charge_soc,
            discharge_soc=self.default_discharge_soc,
        )

    def _serialize(self, enabled: bool, hours: list[dict[str, Any]]) -> str:
        return serialize_compact(
            enabled,
            hours,
            self.default_power,
            charge_soc=self.default_charge_soc,
            discharge_soc=self.default_discharge_soc,
        )

    def _fresh_data(self) -> dict[str, Any]:
        hours = normalize_schedule(
            None,
            self.default_power,
            charge_soc=self.default_charge_soc,
            discharge_soc=self.default_discharge_soc,
        )
        return {
            "enabled": True,
            "hours": hours,
            "raw": self._serialize(True, hours),
            "current_mode": MODE_OFF,
            "current_power": self.default_power,
            "current_soc": 0,
            "current_hour": dt_util.now().hour,
        }

    def set_schedule_entity_id(self, entity_id: str) -> None:
        self._schedule_entity_id = entity_id

    async def async_setup(self) -> None:
        """Restore schedule and start hourly timer."""
        stored = self.entry.data.get("schedule_raw")
        parsed = self._parse(stored)
        if parsed is None:
            raw = empty_compact(
                self.default_power,
                charge_soc=self.default_charge_soc,
                discharge_soc=self.default_discharge_soc,
            )
            parsed = self._parse(raw)
            assert parsed is not None
        self._set_from_parsed(parsed, notify=False)

        self._unsub_hourly = async_track_time_change(
            self.hass, self._async_hourly_tick, minute=0, second=5
        )
        await self.async_apply_schedule(force=True)

    async def async_shutdown(self) -> None:
        if self._unsub_verify is not None:
            self._unsub_verify()
            self._unsub_verify = None
        if self._unsub_hourly is not None:
            self._unsub_hourly()
            self._unsub_hourly = None

    def _set_from_parsed(
        self, parsed: dict[str, Any], *, notify: bool = True
    ) -> None:
        hour = dt_util.now().hour
        slot = parsed["hours"][hour]
        self.data = {
            "enabled": parsed["enabled"],
            "hours": parsed["hours"],
            "raw": self._serialize(parsed["enabled"], parsed["hours"]),
            "current_mode": slot["mode"],
            "current_power": int(slot["power"]),
            "current_soc": int(slot.get("soc", 0)),
            "current_hour": hour,
        }
        if notify:
            self.async_set_updated_data(self.data)

    async def async_set_compact(
        self, raw: str, *, apply: bool = True, persist: bool = True
    ) -> None:
        parsed = self._parse(raw)
        if parsed is None:
            _LOGGER.warning("Ongeldig Anker-schema genegeerd: %s", raw)
            return
        self._set_from_parsed(parsed)
        if persist:
            await self._async_persist_raw(self.data["raw"])
        if apply:
            await self.async_apply_schedule(force=True)

    async def async_set_enabled(self, enabled: bool) -> None:
        raw = self._serialize(enabled, self.data["hours"])
        await self.async_set_compact(raw, apply=True, persist=True)

    async def _async_persist_raw(self, raw: str) -> None:
        data = {**self.entry.data, "schedule_raw": raw}
        self.hass.config_entries.async_update_entry(self.entry, data=data)

    def snap_power(self, watts: float | int) -> int:
        try:
            raw = float(watts)
        except (TypeError, ValueError):
            return self.min_power
        step = self.power_step
        snapped = int(round(raw / step) * step)
        return max(self.min_power, min(self.max_power, snapped))

    @callback
    def _async_hourly_tick(self, _now: datetime) -> None:
        self.hass.async_create_task(self.async_apply_schedule(force=True))

    async def _async_update_data(self) -> dict[str, Any]:
        hour = dt_util.now().hour
        slot = self.data["hours"][hour]
        self.data = {
            **self.data,
            "current_mode": slot["mode"],
            "current_power": int(slot["power"]),
            "current_soc": int(slot.get("soc", 0)),
            "current_hour": hour,
        }
        # Elke minuut: niet alleen toepassen bij uurwisseling, maar ook
        # herstellen als een andere bron de modus tussentijds overschrijft.
        await self.async_apply_schedule(force=False)
        return self.data

    def _resolve_option(self, entity_id: str, wanted: str) -> str | None:
        if not wanted:
            return None
        state = self.hass.states.get(entity_id)
        options = (state.attributes.get("options") if state else None) or []
        if not options:
            return str(wanted)

        wanted_str = str(wanted)
        lower = wanted_str.lower()
        for opt in options:
            if str(opt) == wanted_str:
                return str(opt)
        for opt in options:
            if str(opt).lower() == lower:
                return str(opt)

        aliases = {
            "self_consumption": ["0", "self_consumption"],
            "third_party_control": ["3", "third_party_control", "external"],
            "charge": ["0", "charge"],
            "discharge": ["1", "discharge"],
            "0": ["0", "self_consumption", "charge"],
            "1": ["1", "discharge"],
            "3": ["3", "third_party_control"],
        }
        for candidate in aliases.get(lower, []):
            for opt in options:
                if str(opt) == candidate:
                    return str(opt)
        return wanted_str

    async def _async_select_option(self, entity_id: str, wanted: str) -> None:
        option = self._resolve_option(entity_id, wanted)
        if option is None:
            return
        state = self.hass.states.get(entity_id)
        if state is not None and str(state.state) == str(option):
            return
        await self.hass.services.async_call(
            "select",
            "select_option",
            {"entity_id": entity_id, "option": option},
            blocking=True,
        )

    async def _async_set_power(self, entity_id: str, watts: int) -> None:
        if not entity_id:
            return
        value = self.snap_power(abs(watts))
        state = self.hass.states.get(entity_id)
        if state is not None:
            try:
                current = float(state.state)
            except (TypeError, ValueError):
                current = None
            if current is not None and round(current) == value:
                return
        await self.hass.services.async_call(
            "number",
            "set_value",
            {"entity_id": entity_id, "value": value},
            blocking=True,
        )

    async def _async_set_number(self, entity_id: str, value: int) -> None:
        """Set a plain number entity (SOC-limiet); geen vermogenssnapping."""
        if not entity_id:
            return
        state = self.hass.states.get(entity_id)
        if state is None:
            return
        try:
            current = float(state.state)
        except (TypeError, ValueError):
            current = None
        if current is not None and round(current) == int(value):
            return
        await self.hass.services.async_call(
            "number",
            "set_value",
            {"entity_id": entity_id, "value": int(value)},
            blocking=True,
        )

    async def _async_set_nom_switch(self, on: bool) -> None:
        entity_id = str(
            self._cfg(CONF_NOM_SWITCH_ENTITY, DEFAULT_NOM_SWITCH) or ""
        )
        if not entity_id or self.hass.states.get(entity_id) is None:
            return
        state = self.hass.states.get(entity_id)
        want = "on" if on else "off"
        if state is not None and state.state == want:
            return
        await self.hass.services.async_call(
            "switch",
            "turn_on" if on else "turn_off",
            {"entity_id": entity_id},
            blocking=True,
        )


    def _previous_slot_was_power(self, hour: int) -> bool:
        """True if the previous schedule hour was charge or discharge."""
        prev = self.data["hours"][(hour - 1) % 24]
        return prev["mode"] in (MODE_CHARGE, MODE_DISCHARGE)

    def _select_value(self, entity_id: str) -> str | None:
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        return str(state.state)

    def _nom_switch_is_on(self) -> bool | None:
        entity_id = str(
            self._cfg(CONF_NOM_SWITCH_ENTITY, DEFAULT_NOM_SWITCH) or ""
        )
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        return state.state == "on"

    def _slot_matches_live(
        self,
        *,
        mode: str,
        mode_entity: str,
        direction: str,
        power_entity: str,
        power: int,
        soc: int,
        charge_soc_entity: str,
        discharge_soc_entity: str,
    ) -> bool:
        """True when live Anker entities still match the planned slot."""
        if mode == MODE_OFF:
            # Uit-uur: geen minutelijk herstel van de bedrijfsmodus.
            return True

        if mode == MODE_NOM_O:
            # NOM-O: alleen de switch; bedrijfsmodus laten we met rust.
            switch_on = self._nom_switch_is_on()
            return switch_on is True if switch_on is not None else True

        if mode == MODE_NOM:
            wanted = self._resolve_option(
                mode_entity,
                str(self._cfg(CONF_NOM_OPTION, DEFAULT_NOM_OPTION)),
            )
            if wanted is None:
                return True
            live = self._select_value(mode_entity)
            switch_on = self._nom_switch_is_on()
            if live != wanted:
                return False
            if switch_on is True:
                return False
            return True

        if mode not in (MODE_CHARGE, MODE_DISCHARGE):
            return True

        mode_wanted = self._resolve_option(
            mode_entity,
            str(self._cfg(CONF_THIRD_PARTY_OPTION, DEFAULT_THIRD_PARTY_OPTION)),
        )
        dir_wanted = self._resolve_option(
            direction,
            str(
                self._cfg(CONF_CHARGE_OPTION, DEFAULT_CHARGE_OPTION)
                if mode == MODE_CHARGE
                else self._cfg(CONF_DISCHARGE_OPTION, DEFAULT_DISCHARGE_OPTION)
            ),
        )
        if mode_wanted is None or self._select_value(mode_entity) != mode_wanted:
            return False
        if dir_wanted is None or self._select_value(direction) != dir_wanted:
            return False

        if power_entity:
            state = self.hass.states.get(power_entity)
            if state is not None:
                try:
                    if round(float(state.state)) != int(power):
                        return False
                except (TypeError, ValueError):
                    return False

        soc_entity = (
            charge_soc_entity if mode == MODE_CHARGE else discharge_soc_entity
        )
        if soc_entity:
            state = self.hass.states.get(soc_entity)
            if state is not None:
                try:
                    if round(float(state.state)) != int(soc):
                        return False
                except (TypeError, ValueError):
                    return False
        return True

    def _schedule_verify_after_settle(self) -> None:
        """Na NOM opnieuw controleren: Anker/andere bron zet soms ~2s later third_party."""
        if self._unsub_verify is not None:
            self._unsub_verify()
            self._unsub_verify = None

        @callback
        def _run(_: datetime) -> None:
            self._unsub_verify = None
            self.hass.async_create_task(self.async_apply_schedule(force=False))

        self._unsub_verify = async_call_later(
            self.hass, DEFAULT_MODE_SETTLE_SECONDS + 1.0, _run
        )

    async def async_apply_schedule(self, *, force: bool = False) -> None:
        """Apply the slot for the current hour to Anker entities."""
        async with self._apply_lock:
            await self._async_apply_schedule_locked(force=force)

    async def _async_apply_schedule_locked(self, *, force: bool = False) -> None:
        hour = dt_util.now().hour
        slot = self.data["hours"][hour]
        enabled = bool(self.data["enabled"])
        soc = clamp_soc(
            slot.get("soc"),
            default_soc_for_mode(
                slot["mode"],
                charge_soc=self.default_charge_soc,
                discharge_soc=self.default_discharge_soc,
            ),
        )

        self.data = {
            **self.data,
            "current_mode": slot["mode"],
            "current_power": int(slot["power"]),
            "current_soc": soc,
            "current_hour": hour,
        }
        self.async_set_updated_data(self.data)

        if not enabled:
            key = f"{hour}:disabled"
            if not force and self._last_applied_key == key:
                return
            try:
                await self._async_set_nom_switch(False)
                self._last_applied_key = key
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Anker NOM-switch uitzetten mislukt")
            return

        mode_entity = str(self._cfg(CONF_MODE_ENTITY, ""))
        direction = str(self._cfg(CONF_DIRECTION_ENTITY, ""))
        power_entity = str(self._cfg(CONF_POWER_ENTITY, ""))
        charge_soc_entity = str(self._cfg(CONF_CHARGE_SOC_ENTITY, ""))
        discharge_soc_entity = str(self._cfg(CONF_DISCHARGE_SOC_ENTITY, ""))
        if not mode_entity:
            _LOGGER.error("Geen mode_entity geconfigureerd")
            return

        mode = slot["mode"]
        power = int(slot["power"])
        key = f"{hour}:{mode}:{power}:{soc}"
        matches_live = self._slot_matches_live(
            mode=mode,
            mode_entity=mode_entity,
            direction=direction,
            power_entity=power_entity,
            power=power,
            soc=soc,
            charge_soc_entity=charge_soc_entity,
            discharge_soc_entity=discharge_soc_entity,
        )
        if (
            not force
            and self._last_applied_key == key
            and matches_live
        ):
            return

        if not matches_live and self._last_applied_key == key:
            _LOGGER.warning(
                "Anker Schedule: live-modus wijkt af van schema (%s) — herstel",
                key,
            )

        try:
            # NOM-O: uitsluitend de NOM-switch — verder niets.
            # Vermogen 0 alleen bij overgang naar leeg/uit (niet bij NOM of NOM-O).
            if mode == MODE_OFF:
                await self._async_set_power(power_entity, 0)

            await self._async_set_nom_switch(mode == MODE_NOM_O)

            if mode == MODE_OFF:
                off_option = str(self._cfg(CONF_OFF_OPTION, DEFAULT_OFF_OPTION))
                if off_option:
                    await self._async_select_option(mode_entity, off_option)
            elif mode == MODE_NOM_O:
                pass
            elif mode == MODE_NOM:
                await self._async_select_option(
                    mode_entity,
                    str(self._cfg(CONF_NOM_OPTION, DEFAULT_NOM_OPTION)),
                )
                # Andere bron zet regelmatig ~2s later weer third_party; opnieuw checken.
                self._schedule_verify_after_settle()
            elif mode in (MODE_CHARGE, MODE_DISCHARGE):
                # Eerst externe modus, dan 2s wachten tot laad/ontlaadregeling
                # beschikbaar is, daarna richting en pas daarna vermogen.
                await self._async_select_option(
                    mode_entity,
                    str(
                        self._cfg(
                            CONF_THIRD_PARTY_OPTION, DEFAULT_THIRD_PARTY_OPTION
                        )
                    ),
                )
                await asyncio.sleep(DEFAULT_MODE_SETTLE_SECONDS)
                # Uur kan tijdens de sleep gewisseld zijn — niet doorzetten.
                if dt_util.now().hour != hour:
                    _LOGGER.info(
                        "Anker Schedule: uur gewisseld tijdens settle — "
                        "charge/discharge-apply afgebroken"
                    )
                    self._last_applied_key = None
                    return
                await self._async_select_option(
                    direction,
                    str(
                        self._cfg(CONF_CHARGE_OPTION, DEFAULT_CHARGE_OPTION)
                        if mode == MODE_CHARGE
                        else self._cfg(
                            CONF_DISCHARGE_OPTION, DEFAULT_DISCHARGE_OPTION
                        )
                    ),
                )
                await self._async_set_power(power_entity, power)
                await self._async_set_number(
                    charge_soc_entity
                    if mode == MODE_CHARGE
                    else discharge_soc_entity,
                    soc,
                )
            self._last_applied_key = key
            _LOGGER.debug("Anker schedule toegepast: %s", key)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Anker schedule toepassen mislukt")

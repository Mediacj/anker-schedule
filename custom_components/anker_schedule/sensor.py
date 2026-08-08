"""Sensors for the current planned Anker schedule slot."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_NAME, DEFAULT_NAME, DOMAIN, MODE_LABEL
from .coordinator import AnkerScheduleCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: AnkerScheduleCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            AnkerScheduleModeSensor(coordinator, entry),
            AnkerSchedulePowerSensor(coordinator, entry),
            AnkerScheduleHourSensor(coordinator, entry),
        ]
    )


class _AnkerScheduleSensorBase(SensorEntity):
    _attr_has_entity_name = True

    def __init__(
        self, coordinator: AnkerScheduleCoordinator, entry: ConfigEntry
    ) -> None:
        self.coordinator = coordinator
        self._entry = entry
        title = entry.data.get(CONF_NAME, DEFAULT_NAME)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=title,
            manufacturer="Anker",
            model="Schedule Planner",
        )

    async def async_added_to_hass(self) -> None:
        self.coordinator.async_add_listener(self.async_write_ha_state)


class AnkerScheduleModeSensor(_AnkerScheduleSensorBase):
    """Planned mode for the current hour."""

    _attr_name = "Geplande modus"
    _attr_icon = "mdi:transmission-tower"

    def __init__(
        self, coordinator: AnkerScheduleCoordinator, entry: ConfigEntry
    ) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_mode"

    @property
    def native_value(self) -> str:
        mode = self.coordinator.data.get("current_mode", "off")
        return MODE_LABEL.get(mode, mode)


class AnkerSchedulePowerSensor(_AnkerScheduleSensorBase):
    """Planned power for the current hour."""

    _attr_name = "Gepland vermogen"
    _attr_icon = "mdi:flash"
    _attr_native_unit_of_measurement = UnitOfPower.WATT

    def __init__(
        self, coordinator: AnkerScheduleCoordinator, entry: ConfigEntry
    ) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_power"

    @property
    def native_value(self) -> int:
        return int(self.coordinator.data.get("current_power", 0))


class AnkerScheduleHourSensor(_AnkerScheduleSensorBase):
    """Current schedule hour."""

    _attr_name = "Huidig uur"
    _attr_icon = "mdi:clock-outline"

    def __init__(
        self, coordinator: AnkerScheduleCoordinator, entry: ConfigEntry
    ) -> None:
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_hour"

    @property
    def native_value(self) -> int:
        return int(self.coordinator.data.get("current_hour", 0))

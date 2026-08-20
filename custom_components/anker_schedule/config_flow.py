"""Config flow for Anker Schedule."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

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
    CONF_MODE_SETTLE_SECONDS,
    CONF_NAME,
    CONF_NOM_OPTION,
    CONF_NOM_SWITCH_ENTITY,
    CONF_NORDPOOL_ENTITY,
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
    DEFAULT_MODE_SETTLE_SECONDS,
    DEFAULT_NAME,
    DEFAULT_NOM_OPTION,
    DEFAULT_NOM_SWITCH,
    DEFAULT_OFF_OPTION,
    DEFAULT_POWER_STEP,
    DEFAULT_THIRD_PARTY_OPTION,
    DOMAIN,
)


def _entity_field(
    key: str, domain: str, defaults: dict[str, Any]
) -> dict[Any, Any]:
    """Required entity picker; only prefill when editing an existing value."""
    selector_type = selector.EntitySelector(
        selector.EntitySelectorConfig(domain=domain)
    )
    current = defaults.get(key)
    if current:
        return {vol.Required(key, default=current): selector_type}
    return {vol.Required(key): selector_type}


def _optional_entity_field(
    key: str, domain: str, defaults: dict[str, Any], fallback: str = ""
) -> dict[Any, Any]:
    selector_type = selector.EntitySelector(
        selector.EntitySelectorConfig(domain=domain)
    )
    current = defaults.get(key, fallback)
    if current:
        return {vol.Optional(key, default=current): selector_type}
    return {vol.Optional(key): selector_type}


def _schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    d = defaults or {}
    fields: dict[Any, Any] = {
        vol.Required(CONF_NAME, default=d.get(CONF_NAME, DEFAULT_NAME)): str,
    }
    fields.update(_entity_field(CONF_MODE_ENTITY, "select", d))
    fields.update(_entity_field(CONF_DIRECTION_ENTITY, "select", d))
    fields.update(_entity_field(CONF_POWER_ENTITY, "number", d))
    fields.update(_optional_entity_field(CONF_CHARGE_SOC_ENTITY, "number", d))
    fields.update(_optional_entity_field(CONF_DISCHARGE_SOC_ENTITY, "number", d))
    fields.update(
        _optional_entity_field(
            CONF_NOM_SWITCH_ENTITY, "switch", d, DEFAULT_NOM_SWITCH
        )
    )
    fields.update(_optional_entity_field(CONF_NORDPOOL_ENTITY, "sensor", d))
    fields.update(
        {
            vol.Optional(
                CONF_NOM_OPTION,
                default=d.get(CONF_NOM_OPTION, DEFAULT_NOM_OPTION),
            ): str,
            vol.Optional(
                CONF_THIRD_PARTY_OPTION,
                default=d.get(
                    CONF_THIRD_PARTY_OPTION, DEFAULT_THIRD_PARTY_OPTION
                ),
            ): str,
            vol.Optional(
                CONF_CHARGE_OPTION,
                default=d.get(CONF_CHARGE_OPTION, DEFAULT_CHARGE_OPTION),
            ): str,
            vol.Optional(
                CONF_DISCHARGE_OPTION,
                default=d.get(CONF_DISCHARGE_OPTION, DEFAULT_DISCHARGE_OPTION),
            ): str,
            vol.Optional(
                CONF_OFF_OPTION,
                default=d.get(CONF_OFF_OPTION, DEFAULT_OFF_OPTION),
            ): str,
            vol.Optional(
                CONF_MODE_SETTLE_SECONDS,
                default=d.get(
                    CONF_MODE_SETTLE_SECONDS, DEFAULT_MODE_SETTLE_SECONDS
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=2, max=10)),
            vol.Optional(
                CONF_DEFAULT_POWER,
                default=d.get(CONF_DEFAULT_POWER, DEFAULT_DEFAULT_POWER),
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=10000)),
            vol.Optional(
                CONF_MAX_POWER,
                default=d.get(CONF_MAX_POWER, DEFAULT_MAX_POWER),
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=10000)),
            vol.Optional(
                CONF_MIN_POWER,
                default=d.get(CONF_MIN_POWER, DEFAULT_MIN_POWER),
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=10000)),
            vol.Optional(
                CONF_POWER_STEP,
                default=d.get(CONF_POWER_STEP, DEFAULT_POWER_STEP),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=1000)),
            vol.Optional(
                CONF_DEFAULT_CHARGE_SOC,
                default=d.get(CONF_DEFAULT_CHARGE_SOC, DEFAULT_CHARGE_SOC),
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            vol.Optional(
                CONF_DEFAULT_DISCHARGE_SOC,
                default=d.get(
                    CONF_DEFAULT_DISCHARGE_SOC, DEFAULT_DISCHARGE_SOC
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        }
    )
    return vol.Schema(fields)


class AnkerScheduleConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Anker Schedule."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            await self.async_set_unique_id(f"{user_input[CONF_MODE_ENTITY]}")
            self._abort_if_unique_id_configured()
            if not user_input.get(CONF_NOM_SWITCH_ENTITY):
                user_input[CONF_NOM_SWITCH_ENTITY] = DEFAULT_NOM_SWITCH
            return self.async_create_entry(
                title=user_input[CONF_NAME],
                data=user_input,
            )

        return self.async_show_form(step_id="user", data_schema=_schema())

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return AnkerScheduleOptionsFlow()


class AnkerScheduleOptionsFlow(config_entries.OptionsFlow):
    """Handle options."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        entry = self.config_entry
        if user_input is not None:
            data = {**entry.data}
            name = user_input.pop(CONF_NAME, data.get(CONF_NAME, DEFAULT_NAME))
            data[CONF_NAME] = name
            for key, value in user_input.items():
                data[key] = value
            if not data.get(CONF_NOM_SWITCH_ENTITY):
                data[CONF_NOM_SWITCH_ENTITY] = DEFAULT_NOM_SWITCH
            self.hass.config_entries.async_update_entry(
                entry, title=name, data=data, options={}
            )
            return self.async_create_entry(title="", data={})

        defaults = {**entry.data, **entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(defaults),
        )

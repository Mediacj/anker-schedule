from __future__ import annotations

DOMAIN = "anker_schedule"
PLATFORMS = ["sensor", "switch", "text"]

CONF_NAME = "name"
CONF_MODE_ENTITY = "mode_entity"
CONF_DIRECTION_ENTITY = "direction_entity"
CONF_POWER_ENTITY = "power_entity"
CONF_CHARGE_SOC_ENTITY = "charge_soc_entity"
CONF_DISCHARGE_SOC_ENTITY = "discharge_soc_entity"
CONF_NOM_SWITCH_ENTITY = "nom_switch_entity"
CONF_NOM_OPTION = "nom_option"
CONF_THIRD_PARTY_OPTION = "third_party_option"
CONF_CHARGE_OPTION = "charge_option"
CONF_DISCHARGE_OPTION = "discharge_option"
CONF_OFF_OPTION = "off_option"
CONF_DEFAULT_POWER = "default_power"
CONF_MAX_POWER = "max_power"
CONF_MIN_POWER = "min_power"
CONF_POWER_STEP = "power_step"
CONF_DEFAULT_CHARGE_SOC = "default_charge_soc"
CONF_DEFAULT_DISCHARGE_SOC = "default_discharge_soc"

DEFAULT_NAME = "Anker SOLIX Schedule"
DEFAULT_NOM_OPTION = "0"
DEFAULT_THIRD_PARTY_OPTION = "3"
DEFAULT_CHARGE_OPTION = "0"
DEFAULT_DISCHARGE_OPTION = "1"
DEFAULT_OFF_OPTION = ""
DEFAULT_NOM_SWITCH = "switch.anker_nom"
DEFAULT_DEFAULT_POWER = 500
DEFAULT_MAX_POWER = 3500
DEFAULT_MIN_POWER = 0
DEFAULT_POWER_STEP = 50
DEFAULT_CHARGE_SOC = 100
DEFAULT_DISCHARGE_SOC = 10
DEFAULT_MODE_SETTLE_SECONDS = 2.0

MODE_OFF = "off"
MODE_NOM = "nom"
MODE_NOM_O = "nom_o"
MODE_CHARGE = "charge"
MODE_DISCHARGE = "discharge"
MODES = (MODE_OFF, MODE_NOM, MODE_NOM_O, MODE_CHARGE, MODE_DISCHARGE)

MODE_TO_CHAR = {
    MODE_OFF: "o",
    MODE_NOM: "n",
    MODE_NOM_O: "x",
    MODE_CHARGE: "c",
    MODE_DISCHARGE: "d",
}
CHAR_TO_MODE = {v: k for k, v in MODE_TO_CHAR.items()}

MODE_LABEL = {
    MODE_OFF: "Uit",
    MODE_NOM: "NOM",
    MODE_NOM_O: "NOM-O",
    MODE_CHARGE: "Laden",
    MODE_DISCHARGE: "Ontladen",
}

FRONTEND_URL_BASE = f"/{DOMAIN}"
CARD_FILENAME = "anker-schedule.js"
CARD_TYPE = "anker-schedule"

/*
 * Anker Schedule — full Lovelace card (loaded by anker-schedule.js stub).
 * Do not register this file as a Lovelace resource; use the stub instead.
 */

const CARD_VERSION = "1.0.21";
const LOGO_URL = `/local/anker-schedule/energienerds-logo.png?v=${CARD_VERSION}`;
const BRAND_URL = "https://energienerds.nl";
const STORAGE_PREFIX = "anker-schedule-integration:v1:";

/** HA 2026.8 scoped customElements race heal (frontend#52960). */
const defineElement = (name, ctor) => {
  const registryAtLoad = customElements;
  if (!registryAtLoad.get(name)) {
    registryAtLoad.define(name, ctor);
  }
  const heal = (via) => {
    if (customElements.get(name)) return;
    try {
      customElements.define(name, ctor);
      console.info(
        `ANKER-SCHEDULE: re-defined ${name} after registry swap (${via})`
      );
      if (typeof window.__ankerScheduleActivate === "function") {
        window.__ankerScheduleActivate();
      }
    } catch (err) {
      console.warn(`ANKER-SCHEDULE: re-define ${name} failed (${via})`, err);
    }
  };
  registryAtLoad
    .whenDefined("home-assistant")
    .then(() => heal("ha-boot"))
    .catch(() => {});
  [0, 50, 100, 250, 500, 1000, 1500, 2000, 5000].forEach((ms) => {
    window.setTimeout(() => heal(`timer:${ms}ms`), ms);
  });
};
const MODES = ["off", "nom", "nom_o", "charge", "discharge"];
const MODE_LABEL = {
  off: "Uit",
  nom: "NOM",
  nom_o: "NOM-O",
  charge: "Laden",
  discharge: "Ontladen",
};
const MODE_TO_CHAR = {
  off: "o",
  nom: "n",
  nom_o: "x",
  charge: "c",
  discharge: "d",
};
const CHAR_TO_MODE = {
  o: "off",
  n: "nom",
  x: "nom_o",
  c: "charge",
  d: "discharge",
};

const DEFAULTS = {
  // Entities komen uit de integratie (text.* schema attributes)
  entity: "",
  direction_entity: "",
  power_entity: "",
  charge_soc_entity: "",
  discharge_soc_entity: "",
  nom_switch_entity: "switch.anker_nom",
  nom_o_label: "NOM-O",
  nom_o_tag: "N-O",
  show_soc: true,
  default_charge_soc: 100,
  default_discharge_soc: 10,
  nom_option: "0",
  third_party_option: "3",
  charge_option: "0",
  discharge_option: "1",
  off_option: "",
  storage_entity: "",
  default_power: 500,
  max_power: 3500,
  min_power: 0,
  power_step: 50,
  title: "ANKER PLANNER",
  enabled: true,
  colors: {
    nom: "#1b8a3a",
    nom_o: "#00e5c0",
    charge: "#3fb6ff",
    discharge: "#ff9800",
    current: "#eaf6ff",
    idle: "#7fa6b8",
  },
};

class AnkerScheduleCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("anker-schedule-editor-inner");
  }

  static getStubConfig() {
    return {
      title: DEFAULTS.title,
    };
  }

  setConfig(config) {
    try {
      this._config = {
        ...DEFAULTS,
        ...(config || {}),
        colors: { ...DEFAULTS.colors, ...((config && config.colors) || {}) },
      };
      this._selectedHours =
        this._selectedHours instanceof Set ? this._selectedHours : new Set();
      this._activeMode = this._activeMode ?? null;
      this._lastAppliedKey = null;
      this._schedule = this._normalizeSchedule(
        this._loadSchedule() ?? this._config.schedule
      );
      this._enabled =
        this._loadEnabled() ??
        (this._config.enabled !== undefined ? !!this._config.enabled : true);

      if (!this._built) {
        this._buildDom();
        this._built = true;
      } else {
        this._renderHours();
        this._syncChrome();
        this._renderEditorPanel();
      }
      if (this._hass) this._refreshFromHass();
    } catch (err) {
      console.error("Anker Schedule Card: setConfig failed", err);
      this._renderFallback(err);
    }
  }

  /** Toon een leesbare melding i.p.v. een lege card als opbouw faalt. */
  _renderFallback(err) {
    try {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      const card = document.createElement("ha-card");
      card.style.padding = "16px";
      card.textContent = `Anker Schedule: ${err?.message || err}`;
      this.shadowRoot.replaceChildren(card);
    } catch (_e) {
      /* ignore */
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) {
      // Hass kan eerder komen dan setConfig-rebuild; bouw zodra mogelijk.
      try {
        this._buildDom();
        this._built = true;
      } catch (err) {
        console.error("Anker Schedule Card: build failed", err);
        this._renderFallback(err);
        return;
      }
    }
    this._refreshFromHass();
  }

  connectedCallback() {
    if (this._config && !this._built) {
      try {
        this._buildDom();
        this._built = true;
      } catch (err) {
        console.error("Anker Schedule Card: connected build failed", err);
        this._renderFallback(err);
        return;
      }
    }
    if (this._hass && this._built) this._refreshFromHass();
  }

  _refreshFromHass() {
    if (!this._hass || !this._built || !this._config) return;
    try {
      this._hydrateFromIntegration();
      this._pullStorageEntity();
      this._renderStatus();
      this._highlightCurrentHour();
      this._syncPowerLimits();
      this._syncChrome();
      if (this._shouldAutoApply()) {
        this._maybeApplySchedule();
      }
    } catch (err) {
      console.error("Anker Schedule Card: refresh failed", err);
    }
  }

  /** Zoek de text-entity van de Anker Schedule-integratie. */
  _discoverStorageEntity() {
    if (!this._hass?.states) return null;
    // set hass vuurt bij elke state-change; hergebruik de vondst.
    const cached = this._discoveredStorageEntity;
    if (cached && this._hass.states[cached]) return cached;
    for (const [entityId, st] of Object.entries(this._hass.states)) {
      if (
        entityId.startsWith("text.") &&
        st?.attributes?.anker_schedule_storage
      ) {
        this._discoveredStorageEntity = entityId;
        return entityId;
      }
    }
    this._discoveredStorageEntity = null;
    return null;
  }

  _storageEntityId() {
    return this._config.storage_entity || this._discoverStorageEntity() || null;
  }

  /**
   * Vul ontbrekende entity-keys vanuit attributes op de schema-text-entity.
   */
  _hydrateFromIntegration() {
    const storageId = this._storageEntityId();
    if (!storageId) return;
    const attrs = this._hass.states[storageId]?.attributes || {};
    const patch = {};
    [
      ["entity", "mode_entity"],
      ["direction_entity", "direction_entity"],
      ["power_entity", "power_entity"],
      ["charge_soc_entity", "charge_soc_entity"],
      ["discharge_soc_entity", "discharge_soc_entity"],
      ["nom_switch_entity", "nom_switch_entity"],
    ].forEach(([key, attrKey]) => {
      if (!this._config[key] && attrs[attrKey]) {
        patch[key] = attrs[attrKey];
      }
    });
    if (Object.keys(patch).length) {
      this._config = { ...this._config, ...patch };
    }
  }

  /**
   * Met integratie-storage past het backend toe (niet de browser).
   * auto_apply: true forceert client-side apply.
   */
  _shouldAutoApply() {
    if (this._config.auto_apply === true) return true;
    if (this._config.auto_apply === false) return false;
    return !this._storageEntityId();
  }

  getCardSize() {
    return 5;
  }

  disconnectedCallback() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  _storageKey(suffix) {
    const entity =
      this._storageEntityId() || this._config?.entity || "default";
    return `${STORAGE_PREFIX}${entity}:${suffix}`;
  }

  _configuredPower(key, fallback) {
    const raw = this._config?.[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  _defaultPower() {
    return this._configuredPower("default_power", 500);
  }

  _defaultChargeSoc() {
    return Math.max(
      0,
      Math.min(100, this._configuredPower("default_charge_soc", 100))
    );
  }

  _defaultDischargeSoc() {
    return Math.max(
      0,
      Math.min(100, this._configuredPower("default_discharge_soc", 10))
    );
  }

  _defaultSocForMode(mode) {
    if (mode === "charge" || mode === "nom") return this._defaultChargeSoc();
    if (mode === "discharge") return this._defaultDischargeSoc();
    return 0;
  }

  _clampSoc(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  _showSoc() {
    return !!this._config?.show_soc;
  }

  _slotSocs(slot) {
    const mode = slot?.mode || "off";
    const maxFb = mode === "charge" || mode === "nom" ? this._defaultChargeSoc() : 0;
    const minFb = mode === "discharge" || mode === "nom" ? this._defaultDischargeSoc() : 0;
    let socMax =
      slot?.soc_max !== undefined && slot?.soc_max !== null
        ? this._clampSoc(slot.soc_max, maxFb)
        : mode === "charge" || mode === "nom"
          ? this._clampSoc(slot?.soc, maxFb)
          : maxFb;
    let socMin =
      slot?.soc_min !== undefined && slot?.soc_min !== null
        ? this._clampSoc(slot.soc_min, minFb)
        : mode === "discharge"
          ? this._clampSoc(slot?.soc, minFb)
          : minFb;
    if (mode === "nom" && (slot?.soc_max === undefined || slot?.soc_max === null) && (slot?.soc_min === undefined || slot?.soc_min === null) && (slot?.soc === undefined || slot?.soc === null)) {
      socMax = this._defaultChargeSoc();
      socMin = this._defaultDischargeSoc();
    }
    return { socMax, socMin };
  }

  _encodeSocToken(mode, socMax, socMin) {
    if (mode === "nom") return `${socMax}/${socMin}`;
    if (mode === "charge") return String(socMax);
    if (mode === "discharge") return String(socMin);
    return "0";
  }

  _decodeSocToken(token, mode) {
    const maxFb = mode === "charge" || mode === "nom" ? this._defaultChargeSoc() : 0;
    const minFb = mode === "discharge" || mode === "nom" ? this._defaultDischargeSoc() : 0;
    const text = String(token || "").trim();
    if (text.includes("/")) {
      const [left, right] = text.split("/", 2);
      return {
        socMax: this._clampSoc(left, maxFb),
        socMin: this._clampSoc(right, minFb),
      };
    }
    if (text === "") return { socMax: maxFb, socMin: minFb };
    const single = this._clampSoc(text, this._defaultSocForMode(mode));
    if (mode === "charge") return { socMax: single, socMin: minFb };
    if (mode === "discharge") return { socMax: maxFb, socMin: single };
    if (mode === "nom") return { socMax: single, socMin: minFb };
    return { socMax: 0, socMin: 0 };
  }

  /** Eigen tekst voor NOM-O; leeg valt terug op de standaardnaam. */
  _nomOLabel() {
    const raw = this._config?.nom_o_label;
    const label = typeof raw === "string" ? raw.trim() : "";
    return label || MODE_LABEL.nom_o;
  }

  _modeLabel(mode) {
    if (mode === "nom_o") return this._nomOLabel();
    return MODE_LABEL[mode] || mode;
  }

  /** Korte tekst op de uurtegel; de tegel is smal, dus max 3 tekens. */
  _nomOTag() {
    const raw = this._config?.nom_o_tag;
    const tag = typeof raw === "string" ? raw.trim().slice(0, 3) : "";
    return tag || DEFAULTS.nom_o_tag;
  }

  _defaultSlot() {
    return {
      mode: "off",
      power: this._defaultPower(),
      soc: 0,
      soc_max: 0,
      soc_min: 0,
    };
  }

  _normalizeSlot(value) {
    const base = this._defaultSlot();
    const pack = (mode, power, partial = {}) => {
      const { socMax, socMin } = this._slotSocs({ mode, ...partial });
      return {
        mode,
        power,
        soc: mode === "discharge" ? socMin : socMax,
        soc_max: socMax,
        soc_min: socMin,
      };
    };
    if (value === true) {
      return pack("nom", base.power, {
        soc_max: this._defaultChargeSoc(),
        soc_min: this._defaultDischargeSoc(),
      });
    }
    if (value === false || value == null) return { ...base };
    if (typeof value === "string" && MODES.includes(value)) {
      if (value === "nom") {
        return pack("nom", base.power, {
          soc_max: this._defaultChargeSoc(),
          soc_min: this._defaultDischargeSoc(),
        });
      }
      return pack(value, base.power);
    }
    if (typeof value === "object") {
      const mode = MODES.includes(value.mode) ? value.mode : "off";
      const power = Number(value.power);
      return pack(
        mode,
        Number.isFinite(power) && power >= 0 ? power : base.power,
        value
      );
    }
    return { ...base };
  }

  _normalizeSchedule(value) {
    const arr = Array.isArray(value) ? value.slice(0, 24) : [];
    while (arr.length < 24) arr.push(null);
    return arr.map((v) => this._normalizeSlot(v));
  }

  _loadSchedule() {
    try {
      const raw = localStorage.getItem(this._storageKey("hours"));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }

  _loadEnabled() {
    try {
      const raw = localStorage.getItem(this._storageKey("enabled"));
      if (raw === null) return null;
      return raw === "1";
    } catch (_e) {
      return null;
    }
  }

  _persist() {
    this._localEditPending = true;
    try {
      localStorage.setItem(
        this._storageKey("hours"),
        JSON.stringify(this._schedule)
      );
      localStorage.setItem(
        this._storageKey("enabled"),
        this._enabled ? "1" : "0"
      );
    } catch (_e) {
      /* ignore */
    }
    this._queueStorageWrite();
  }

  /** Compact format: e=1;m=oonxc...;p=0,0,500,...;s=100,10,100/10,... */
  _serializeCompact() {
    const m = this._schedule
      .map((s) => MODE_TO_CHAR[s.mode] || "o")
      .join("");
    const p = this._schedule
      .map((s) =>
        s.mode === "charge" || s.mode === "discharge"
          ? String(Math.round(s.power || 0))
          : ""
      )
      .join(",");
    const s = this._schedule
      .map((slot) => {
        const { socMax, socMin } = this._slotSocs(slot);
        return this._encodeSocToken(slot.mode, socMax, socMin);
      })
      .join(",");
    return `e=${this._enabled ? 1 : 0};m=${m};p=${p};s=${s}`;
  }

  _parseCompact(raw) {
    if (!raw || typeof raw !== "string") return null;
    if (raw.trim().startsWith("{")) {
      try {
        const data = JSON.parse(raw);
        return {
          enabled: !!data.enabled,
          hours: this._normalizeSchedule(data.hours),
        };
      } catch (_e) {
        return null;
      }
    }
    const parts = Object.fromEntries(
      raw.split(";").map((chunk) => {
        const i = chunk.indexOf("=");
        return i === -1
          ? [chunk, ""]
          : [chunk.slice(0, i), chunk.slice(i + 1)];
      })
    );
    if (!parts.m || parts.m.length < 24) return null;
    const powers = (parts.p || "")
      .split(",")
      .map((n) => parseInt(n, 10));
    const socTokens = (parts.s || "").split(",");
    const hours = [];
    for (let i = 0; i < 24; i++) {
      const mode = CHAR_TO_MODE[parts.m[i]] || "off";
      const { socMax, socMin } = this._decodeSocToken(socTokens[i] || "", mode);
      hours.push({
        mode,
        power:
          Number.isFinite(powers[i]) && powers[i] >= 0
            ? powers[i]
            : this._defaultPower(),
        soc: mode === "discharge" ? socMin : socMax,
        soc_max: socMax,
        soc_min: socMin,
      });
    }
    return {
      enabled: parts.e !== "0",
      hours,
    };
  }

  _queueStorageWrite() {
    if (!this._storageEntityId() || !this._hass) return;
    if (this._storageWriteTimer) clearTimeout(this._storageWriteTimer);
    this._storageWriteTimer = setTimeout(() => {
      this._storageWriteTimer = null;
      this._writeStorageNow();
    }, 250);
  }

  _flushStorageWrite() {
    if (this._storageWriteTimer) {
      clearTimeout(this._storageWriteTimer);
      this._storageWriteTimer = null;
    }
    this._writeStorageNow();
  }

  _writeStorageNow() {
    const entityId = this._storageEntityId();
    if (!entityId || !this._hass) return false;
    if (!this._hass.states[entityId]) {
      console.warn(
        "Anker Schedule Card: schema-entity niet gevonden:",
        entityId
      );
      return false;
    }
    const value = this._serializeCompact();
    if (value.length > 255) {
      console.error(
        "Anker Schedule Card: schema te lang voor text-entity:",
        value.length
      );
    }
    // Markeer onze eigen write vóór de service-call. Houd localEditPending
    // aan tot HA-state onze waarde toont — anders kan een trage state-update
    // met het óude schema (NOM) onze UIT/NOM-O-edit terugzetten.
    this._lastStorageRaw = value;
    this._storageSynced = true;
    this._localEditPending = true;
    this._ignorePullUntil = Date.now() + 5000;
    // Integratie = text.*; losse helper = input_text.*
    const domain = String(entityId).split(".")[0];
    const serviceDomain = domain === "text" ? "text" : "input_text";
    this._hass.callService(serviceDomain, "set_value", {
      entity_id: entityId,
      value,
    });
    return true;
  }

  _pullStorageEntity() {
    const entityId = this._storageEntityId();
    if (!entityId || !this._hass) {
      return;
    }
    const st = this._hass.states[entityId];
    if (!st) return;
    const raw = st.state;
    if (!raw || raw === "unknown" || raw === "unavailable" || !String(raw).trim()) {
      return;
    }
    if (raw === this._lastStorageRaw) {
      this._localEditPending = false;
      this._storageSynced = true;
      return;
    }
    // Eigen write nog niet in HA: negeer stale pulls.
    if (this._localEditPending || (this._ignorePullUntil && Date.now() < this._ignorePullUntil)) {
      return;
    }
    const parsed = this._parseCompact(raw);
    if (!parsed) return;
    this._lastStorageRaw = raw;
    this._storageSynced = true;
    this._localEditPending = false;
    this._schedule = parsed.hours;
    this._enabled = parsed.enabled;
    try {
      localStorage.setItem(
        this._storageKey("hours"),
        JSON.stringify(this._schedule)
      );
      localStorage.setItem(
        this._storageKey("enabled"),
        this._enabled ? "1" : "0"
      );
    } catch (_e) {
      /* ignore */
    }
    this._renderHours();
    this._syncChrome();
    this._renderEditorPanel();
  }

  _powerLimits() {
    const min = this._configuredPower("min_power", 0);
    const max = this._configuredPower("max_power", 3500);
    const step = this._configuredPower("power_step", 50);
    return {
      min: Math.max(0, min),
      max: max < min ? min : max,
      step: step > 0 ? step : 50,
    };
  }

  _snapPower(watts) {
    const { min, max, step } = this._powerLimits();
    const raw = Number(watts);
    if (!Number.isFinite(raw)) return min;
    const snapped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, snapped));
  }

  _syncPowerLimits() {
    if (!this._els?.powerSlider) return;
    const { min, max, step } = this._powerLimits();
    this._els.powerSlider.min = String(min);
    this._els.powerSlider.max = String(max);
    this._els.powerSlider.step = String(step);
  }

  _powerEntity() {
    return this._config.power_entity || "";
  }

  _nomSwitchEntity() {
    return this._config.nom_switch_entity || "switch.anker_nom";
  }

  _chargeSocEntity() {
    return this._config.charge_soc_entity || "";
  }

  _dischargeSocEntity() {
    return this._config.discharge_soc_entity || "";
  }

  _buildDom() {
    const style = document.createElement("style");
    style.textContent = this._css();

    const card = document.createElement("ha-card");
    card.innerHTML = `
      <div class="panel">
        <div class="screen">
          <div class="header">
            <div class="brand">
              <a class="brand-link" href="https://energienerds.nl/" target="_blank" rel="noopener noreferrer" title="energienerds.nl">
                <img class="brand-logo" src="${LOGO_URL}" alt="Energienerds" width="28" height="28">
              </a>
              <div class="brand-text">
                <div class="title"></div>
                <div class="subtitle">24U · NOM / LADEN / ONTLADEN</div>
              </div>
            </div>
            <button class="toggle-btn" type="button" title="Planner aan/uit">
              <span class="toggle-dot"></span>
              <span class="toggle-label">AAN</span>
            </button>
          </div>

          <div class="status-row">
            <div class="status-block">
              <div class="stat-label">MODUS NU</div>
              <div class="stat-value mode-value">—</div>
            </div>
            <div class="status-block">
              <div class="stat-label">HUIDIG UUR</div>
              <div class="stat-value hour-value">—</div>
            </div>
            <div class="status-block">
              <div class="stat-label">MODUS STRAKS</div>
              <div class="stat-value next-mode-value">—</div>
            </div>
          </div>

          <div class="brush-row" role="toolbar" aria-label="Modus toekennen">
            <button type="button" class="brush" data-brush="off" disabled>Uit</button>
            <button type="button" class="brush" data-brush="nom" disabled>NOM</button>
            <button type="button" class="brush" data-brush="nom_o" disabled>NOM-O</button>
            <button type="button" class="brush" data-brush="charge" disabled>Laden</button>
            <button type="button" class="brush" data-brush="discharge" disabled>Ontladen</button>
          </div>

          <div class="hours" role="grid" aria-label="24 uur schema"></div>

          <div class="editor-panel hidden">
            <div class="editor-head">
              <span class="editor-title">Uur —</span>
              <span class="editor-mode">—</span>
            </div>
            <div class="power-wrap">
              <div class="power-labels">
                <span>Vermogen</span>
                <span class="power-value">500 W</span>
              </div>
              <input class="power-slider" type="range" min="0" max="3500" step="50" value="500">
            </div>
            <div class="soc-wrap hidden">
              <div class="power-labels">
                <span class="soc-label">SOC</span>
                <span class="soc-value">100 %</span>
              </div>
              <input class="soc-slider" type="range" min="0" max="100" step="1" value="100">
            </div>
            <div class="soc-wrap soc-min-wrap hidden">
              <div class="power-labels">
                <span class="soc-min-label">Min SOC</span>
                <span class="soc-min-value">10 %</span>
              </div>
              <input class="soc-min-slider" type="range" min="0" max="100" step="1" value="10">
            </div>
          </div>

          <div class="legend">
            <span><i class="swatch nom"></i>NOM</span>
            <span><i class="swatch nom_o"></i><span class="legend-nom-o">NOM-O</span></span>
            <span><i class="swatch charge"></i>Laden</span>
            <span><i class="swatch discharge"></i>Ontladen</span>
            <span><i class="swatch current"></i>Nu</span>
          </div>

          <div class="actions">
            <button type="button" data-action="all-nom">Alles NOM</button>
            <button type="button" data-action="all-off">Alles uit</button>
            <button type="button" class="apply-now-btn" data-action="apply-now">Nu toepassen</button>
          </div>

          <div class="footer-bar">
            <button type="button" class="selection-clear hidden" data-action="clear-selection">Wis selectie</button>
            <span class="selection-count" aria-live="polite">0 geselecteerd</span>
          </div>

        </div>
      </div>
    `;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this.shadowRoot.replaceChildren(style, card);

    this._els = {
      title: card.querySelector(".title"),
      toggleBtn: card.querySelector(".toggle-btn"),
      toggleLabel: card.querySelector(".toggle-label"),
      modeValue: card.querySelector(".mode-value"),
      hourValue: card.querySelector(".hour-value"),
      nextModeValue: card.querySelector(".next-mode-value"),
      hours: card.querySelector(".hours"),
      screen: card.querySelector(".screen"),
      brushes: Array.from(card.querySelectorAll(".brush")),
      nomOBrush: card.querySelector('.brush[data-brush="nom_o"]'),
      nomOLegend: card.querySelector(".legend-nom-o"),
      editorPanel: card.querySelector(".editor-panel"),
      editorTitle: card.querySelector(".editor-title"),
      editorMode: card.querySelector(".editor-mode"),
      powerWrap: card.querySelector(".power-wrap"),
      powerSlider: card.querySelector(".power-slider"),
      powerValue: card.querySelector(".power-value"),
      socWrap: card.querySelector(".soc-wrap"),
      socSlider: card.querySelector(".soc-slider"),
      socLabel: card.querySelector(".soc-label"),
      socValue: card.querySelector(".soc-value"),
      socMinWrap: card.querySelector(".soc-min-wrap"),
      socMinSlider: card.querySelector(".soc-min-slider"),
      socMinLabel: card.querySelector(".soc-min-label"),
      socMinValue: card.querySelector(".soc-min-value"),
      applyBtn: card.querySelector(".apply-now-btn"),
      brushRow: card.querySelector(".brush-row"),
      selectionCount: card.querySelector(".selection-count"),
      selectionClear: card.querySelector(".selection-clear"),
    };

    this._els.toggleBtn.addEventListener("click", () => {
      this._enabled = !this._enabled;
      this._persist();
      this._syncChrome();
      this._maybeApplySchedule(true);
    });

    this._els.brushes.forEach((btn) => {
      btn.addEventListener("click", () => {
        this._assignModeToSelection(btn.dataset.brush);
      });
    });

    this._els.powerSlider.addEventListener("input", () => {
      if (!this._hasSelection()) return;
      const power = this._snapPower(this._els.powerSlider.value);
      this._els.powerSlider.value = String(power);
      this._els.powerValue.textContent = `${Math.round(power)} W`;
      for (const h of this._selectedHours) {
        this._schedule[h].power = power;
        this._updateHourButton(h);
      }
      this._persist();
    });
    this._els.powerSlider.addEventListener("change", () => {
      if (!this._hasSelection()) return;
      const now = new Date().getHours();
      if (this._selectedHours.has(now)) this._maybeApplySchedule(true);
    });

    this._els.socSlider.addEventListener("input", () => {
      if (!this._hasSelection()) return;
      const soc = this._clampSoc(
        this._els.socSlider.value,
        this._defaultChargeSoc()
      );
      this._els.socSlider.value = String(soc);
      this._els.socValue.textContent = `${soc} %`;
      for (const h of this._selectedHours) {
        const slot = this._schedule[h];
        slot.soc_max = soc;
        if (slot.mode !== "discharge") slot.soc = soc;
      }
      this._persist();
    });
    this._els.socSlider.addEventListener("change", () => {
      if (!this._hasSelection()) return;
      const now = new Date().getHours();
      if (this._selectedHours.has(now)) this._maybeApplySchedule(true);
    });

    this._els.socMinSlider.addEventListener("input", () => {
      if (!this._hasSelection()) return;
      const soc = this._clampSoc(
        this._els.socMinSlider.value,
        this._defaultDischargeSoc()
      );
      this._els.socMinSlider.value = String(soc);
      this._els.socMinValue.textContent = `${soc} %`;
      for (const h of this._selectedHours) {
        const slot = this._schedule[h];
        slot.soc_min = soc;
        if (slot.mode === "discharge") slot.soc = soc;
      }
      this._persist();
    });
    this._els.socMinSlider.addEventListener("change", () => {
      if (!this._hasSelection()) return;
      const now = new Date().getHours();
      if (this._selectedHours.has(now)) this._maybeApplySchedule(true);
    });

    card.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        if (action === "all-nom") {
          const power = this._defaultSlot().power;
          this._schedule = Array.from({ length: 24 }, () => ({
            mode: "nom",
            power,
            soc: this._defaultChargeSoc(),
            soc_max: this._defaultChargeSoc(),
            soc_min: this._defaultDischargeSoc(),
          }));
          this._clearSelection();
          this._afterScheduleEdit();
        } else if (action === "all-off") {
          this._schedule = Array.from({ length: 24 }, () => this._defaultSlot());
          this._clearSelection();
          this._afterScheduleEdit();
        } else if (action === "apply-now") {
          this._onApplyNowClick();
        } else if (action === "clear-selection") {
          this._clearSelection();
          this._syncChrome();
          this._renderEditorPanel();
        }
      });
    });

    this._renderHours();
    this._syncChrome();
    this._renderEditorPanel();

    if (!this._tickTimer) {
      this._tickTimer = setInterval(() => {
        this._highlightCurrentHour();
        if (this._shouldAutoApply()) {
          this._maybeApplySchedule();
        }
      }, 15000);
    }
  }

  _afterScheduleEdit() {
    this._persist();
    this._renderHours();
    this._syncChrome();
    this._renderEditorPanel();
    this._maybeApplySchedule(true);
  }

  _hasSelection() {
    return (this._selectedHours?.size || 0) > 0;
  }

  _selectedList() {
    return [...(this._selectedHours || [])].sort((a, b) => a - b);
  }

  _clearSelection() {
    this._selectedHours = new Set();
    this._activeMode = null;
  }

  /** Gemeenschappelijke modus van de selectie, of null bij gemengd/leeg. */
  _selectionMode() {
    const hours = this._selectedList();
    if (!hours.length) return null;
    if (this._activeMode && MODES.includes(this._activeMode)) {
      if (hours.every((h) => this._schedule[h]?.mode === this._activeMode)) {
        return this._activeMode;
      }
    }
    const modes = new Set(hours.map((h) => this._schedule[h]?.mode));
    return modes.size === 1 ? [...modes][0] : null;
  }

  _toggleHourSelection(h) {
    if (!this._selectedHours) this._selectedHours = new Set();
    if (this._selectedHours.has(h)) this._selectedHours.delete(h);
    else this._selectedHours.add(h);
    if (!this._hasSelection()) this._activeMode = null;
    else if (
      this._activeMode &&
      ![...this._selectedHours].every(
        (hour) => this._schedule[hour]?.mode === this._activeMode
      )
    ) {
      this._activeMode = null;
    }
    this._syncChrome();
    this._renderEditorPanel();
  }

  _assignModeToSelection(mode) {
    if (!this._hasSelection() || !MODES.includes(mode)) return;
    this._activeMode = mode;
    const now = new Date().getHours();
    let touchNow = false;
    for (const h of this._selectedHours) {
      this._applyModeToHour(h, mode);
      if (h === now) touchNow = true;
    }
    this._persist();
    this._syncChrome();
    this._renderEditorPanel();
    if (touchNow) this._maybeApplySchedule(true);
  }

  _renderHours() {
    const root = this._els.hours;
    root.innerHTML = "";
    for (let h = 0; h < 24; h++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hour";
      btn.dataset.hour = String(h);
      btn.innerHTML = `
        <span class="hour-num">${String(h).padStart(2, "0")}</span>
        <span class="hour-tag"></span>
        <span class="hour-power"></span>
      `;
      btn.addEventListener("click", () => {
        this._toggleHourSelection(h);
      });
      root.appendChild(btn);
    }
    this._hourButtons = Array.from(root.querySelectorAll(".hour"));
    this._hourButtons.forEach((_, h) => this._updateHourButton(h));
    this._highlightCurrentHour();
  }

  _updateHourButton(h) {
    const btn = this._hourButtons?.[h];
    if (!btn) return;
    const slot = this._schedule[h];
    btn.classList.remove(
      "mode-off",
      "mode-nom",
      "mode-nom_o",
      "mode-charge",
      "mode-discharge"
    );
    btn.classList.add(`mode-${slot.mode}`);
    btn.classList.toggle("selected", !!this._selectedHours?.has(h));
    const tags = {
      off: "—",
      nom: "NOM",
      nom_o: this._nomOTag(),
      charge: "IMP",
      discharge: "EXP",
    };
    btn.querySelector(".hour-tag").textContent = tags[slot.mode] || "—";
    const powerEl = btn.querySelector(".hour-power");
    if (slot.mode === "charge" || slot.mode === "discharge") {
      powerEl.textContent = `${Math.round(slot.power)}W`;
      powerEl.hidden = false;
    } else {
      powerEl.textContent = "";
      powerEl.hidden = true;
    }
  }

  _applyModeToHour(hour, mode) {
    if (hour < 0 || hour > 23 || !MODES.includes(mode)) return;
    let socMax = 0;
    let socMin = 0;
    if (mode === "nom") {
      socMax = this._defaultChargeSoc();
      socMin = this._defaultDischargeSoc();
    } else if (mode === "charge") {
      socMax = this._defaultChargeSoc();
    } else if (mode === "discharge") {
      socMin = this._defaultDischargeSoc();
    }
    this._schedule[hour] = {
      mode,
      power: this._defaultPower(),
      soc: mode === "discharge" ? socMin : socMax,
      soc_max: socMax,
      soc_min: socMin,
    };
    this._updateHourButton(hour);
  }

  _renderEditorPanel() {
    if (!this._els) return;
    const hours = this._selectedList();
    if (!hours.length) {
      this._els.editorPanel.classList.add("hidden");
      return;
    }

    const mode = this._selectionMode();
    this._els.editorPanel.classList.remove("hidden");

    if (hours.length === 1) {
      const h = hours[0];
      this._els.editorTitle.textContent = `Uur ${String(h).padStart(2, "0")}–${String(
        (h + 1) % 24
      ).padStart(2, "0")}`;
    } else {
      this._els.editorTitle.textContent = `${hours.length} uren geselecteerd`;
    }

    if (!mode) {
      this._els.editorMode.textContent = "Kies een modus";
      this._els.editorMode.dataset.mode = "";
      this._els.powerWrap.classList.add("hidden");
      this._els.socWrap?.classList.add("hidden");
      this._els.socMinWrap?.classList.add("hidden");
      return;
    }

    const slot = this._schedule[hours[0]];
    this._els.editorMode.textContent = this._modeLabel(mode);
    this._els.editorMode.dataset.mode = mode;

    const needsPower = mode === "charge" || mode === "discharge";
    const isNom = mode === "nom";
    const showSoc = this._showSoc() && (needsPower || isNom);
    const showMax = showSoc && (mode === "charge" || isNom);
    const showMin = showSoc && (mode === "discharge" || isNom);

    this._els.powerWrap.classList.toggle("hidden", !needsPower);
    if (needsPower) {
      this._syncPowerLimits();
      const power = this._snapPower(slot.power);
      for (const h of hours) this._schedule[h].power = power;
      this._els.powerSlider.value = String(power);
      this._els.powerValue.textContent = `${Math.round(power)} W`;
    }

    const { socMax, socMin } = this._slotSocs(slot);
    this._els.socWrap?.classList.toggle("hidden", !showMax);
    this._els.socMinWrap?.classList.toggle("hidden", !showMin);

    if (showMax) {
      for (const h of hours) {
        this._schedule[h].soc_max = socMax;
        if (this._schedule[h].mode !== "discharge") this._schedule[h].soc = socMax;
      }
      this._els.socSlider.value = String(socMax);
      this._els.socValue.textContent = `${socMax} %`;
      this._els.socLabel.textContent = "Max SOC";
      this._els.socSlider.style.accentColor = isNom
        ? this._config.colors.nom
        : this._config.colors.charge;
    }

    if (showMin) {
      for (const h of hours) {
        this._schedule[h].soc_min = socMin;
        if (this._schedule[h].mode === "discharge") this._schedule[h].soc = socMin;
      }
      this._els.socMinSlider.value = String(socMin);
      this._els.socMinValue.textContent = `${socMin} %`;
      this._els.socMinLabel.textContent = "Min SOC";
      this._els.socMinSlider.style.accentColor = isNom
        ? this._config.colors.nom
        : this._config.colors.discharge;
    }
  }

  /** #rgb / #rrggbb → {r,g,b}; null bij een niet-hex waarde. */
  _rgbOf(color) {
    let hex = String(color || "").trim().replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  _rgba(color, alpha) {
    const c = this._rgbOf(color);
    if (!c) return color;
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  }

  /** Mengt richting wit (amount > 0) of zwart (amount < 0). */
  _shade(color, amount) {
    const c = this._rgbOf(color);
    if (!c) return color;
    const target = amount >= 0 ? 255 : 0;
    const f = Math.abs(amount);
    const mix = (v) => Math.round(v + (target - v) * f);
    return `rgb(${mix(c.r)},${mix(c.g)},${mix(c.b)})`;
  }

  /** Vertaalt de gekozen moduskleuren naar vulling, rand, gloed en tekst. */
  _applyTileColors(c) {
    const s = this._els.screen.style;
    const nomO = c.nom_o || c.nom;
    const solid = [
      ["nom", c.nom, 0.28, 0.8, 0.3],
      ["charge", c.charge, 0.18, 0.55, 0.22],
      ["discharge", c.discharge, 0.18, 0.55, 0.22],
    ];
    solid.forEach(([key, color, fill, border, glow]) => {
      s.setProperty(`--fill-${key}`, this._rgba(color, fill));
      s.setProperty(`--border-${key}`, this._rgba(color, border));
      s.setProperty(`--glow-${key}`, this._rgba(color, glow));
      s.setProperty(`--tint-${key}`, this._shade(color, 0.85));
    });
    s.setProperty(
      "--fill-nom-o",
      `linear-gradient(180deg, ${this._rgba(nomO, 0.9)}, ${this._rgba(nomO, 0.62)})`
    );
    s.setProperty("--glow-nom-o", this._rgba(nomO, 0.5));
    s.setProperty("--shade-nom-o", this._shade(nomO, -0.8));
  }

  _syncChrome() {
    if (!this._els) return;
    const c = this._config.colors;
    this._els.screen.style.setProperty("--color-nom", c.nom);
    this._els.screen.style.setProperty("--color-nom-o", c.nom_o || c.nom);
    this._els.screen.style.setProperty("--color-charge", c.charge);
    this._els.screen.style.setProperty("--color-discharge", c.discharge);
    this._els.screen.style.setProperty("--color-current", c.current);
    this._els.screen.style.setProperty("--color-idle", c.idle);
    this._applyTileColors(c);
    this._els.title.textContent = this._config.title || DEFAULTS.title;
    const nomOLabel = this._nomOLabel();
    if (this._els.nomOBrush) this._els.nomOBrush.textContent = nomOLabel;
    if (this._els.nomOLegend) this._els.nomOLegend.textContent = nomOLabel;
    this._els.toggleBtn.classList.toggle("is-on", this._enabled);
    this._els.toggleLabel.textContent = this._enabled ? "AAN" : "UIT";
    this._els.screen.classList.toggle("scheduler-off", !this._enabled);

    this._hourButtons?.forEach((_, h) => this._updateHourButton(h));

    const armed = this._hasSelection();
    this._els.brushRow?.classList.toggle("has-selection", armed);
    this._els.brushes.forEach((btn) => {
      btn.disabled = !armed;
      btn.classList.toggle("is-muted", !armed);
      btn.classList.toggle(
        "active",
        armed && btn.dataset.brush === this._activeMode
      );
    });

    const count = this._selectedHours?.size || 0;
    if (this._els.selectionCount) {
      this._els.selectionCount.textContent =
        count === 1 ? "1 geselecteerd" : `${count} geselecteerd`;
      this._els.selectionCount.classList.toggle("has-selection", count > 0);
    }
    this._els.selectionClear?.classList.toggle("hidden", count === 0);

    this._updateNextMode();
  }

  _updateNextMode() {
    if (!this._els?.nextModeValue || !this._schedule) return;
    const nextHour = (new Date().getHours() + 1) % 24;
    const slot = this._schedule[nextHour] || this._defaultSlot();
    const label = this._modeLabel(slot.mode);
    if (slot.mode === "charge" || slot.mode === "discharge") {
      this._els.nextModeValue.textContent = `${label} ${Math.round(slot.power || 0)}W`;
    } else {
      this._els.nextModeValue.textContent = label;
    }
    this._els.nextModeValue.dataset.mode = slot.mode;
  }

  _highlightCurrentHour() {
    if (!this._hourButtons) return;
    const now = new Date().getHours();
    this._hourButtons.forEach((btn, h) => {
      btn.classList.toggle("current", h === now);
    });
    if (this._els?.hourValue) {
      this._els.hourValue.textContent = `${String(now).padStart(2, "0")}:00`;
    }
    this._updateNextMode();
  }

  _resolveOption(entityId, wanted) {
    if (!wanted) return null;
    const st = this._hass?.states?.[entityId];
    const options = st?.attributes?.options;
    if (!Array.isArray(options) || !options.length) return String(wanted);

    const wantedStr = String(wanted);
    const lower = wantedStr.toLowerCase();
    const exact = options.find((o) => String(o) === wantedStr);
    if (exact !== undefined) return String(exact);
    const byLower = options.find((o) => String(o).toLowerCase() === lower);
    if (byLower !== undefined) return String(byLower);

    const aliases = {
      self_consumption: ["0", "self_consumption"],
      third_party_control: ["3", "third_party_control", "external"],
      charge: ["0", "charge"],
      discharge: ["1", "discharge"],
      "0": ["0", "self_consumption", "charge"],
      "1": ["1", "discharge"],
      "3": ["3", "third_party_control"],
    };
    for (const candidate of aliases[lower] || []) {
      const hit = options.find((o) => String(o) === candidate);
      if (hit !== undefined) return String(hit);
    }
    return wantedStr;
  }

  _prettyMode(state) {
    const s = String(state);
    if (s === "0" || s.toLowerCase() === "self_consumption") return "NOM";
    if (s === "3" || s.toLowerCase().includes("third_party")) return "Extern";
    return s;
  }

  _renderStatus() {
    if (!this._els) return;
    const st = this._hass?.states?.[this._config.entity];
    if (!st) {
      this._els.modeValue.textContent = "entity?";
      return;
    }
    // NOM-O = alleen de switch; die wint altijd van de bedrijfsmodus-select.
    const nomSw = this._hass.states[this._nomSwitchEntity()]?.state;
    if (nomSw === "on") {
      this._els.modeValue.textContent = this._nomOLabel();
      this._els.modeValue.classList.add("is-self");
      return;
    }
    const mode = this._prettyMode(st.state);
    const dir = this._hass.states[this._config.direction_entity]?.state;
    const power = this._hass.states[this._powerEntity()]?.state;
    let extra = "";
    if (mode === "Extern" && dir != null) {
      const d =
        String(dir) === "0" || String(dir).toLowerCase() === "charge"
          ? "laden"
          : String(dir) === "1" || String(dir).toLowerCase() === "discharge"
            ? "ontladen"
            : dir;
      extra = power != null ? ` · ${d} ${power}W` : ` · ${d}`;
    }
    this._els.modeValue.textContent = `${mode}${extra}`;
    this._els.modeValue.classList.toggle("is-self", mode === "NOM");
  }

  async _selectOption(entityId, wanted) {
    if (!entityId || !wanted) return;
    const option = this._resolveOption(entityId, wanted);
    if (option == null) return;
    const current = this._hass.states[entityId]?.state;
    if (String(current) === String(option)) return;
    await this._hass.callService("select", "select_option", {
      entity_id: entityId,
      option,
    });
  }

  async _setPower(watts) {
    const entityId = this._powerEntity();
    if (!entityId) return;
    const value = this._snapPower(Math.abs(watts));
    const current = parseFloat(this._hass.states[entityId]?.state);
    if (Number.isFinite(current) && Math.round(current) === value) return;
    await this._hass.callService("number", "set_value", {
      entity_id: entityId,
      value,
    });
  }

  async _setNumber(entityId, value) {
    if (!entityId || !this._hass?.states?.[entityId]) return;
    const current = parseFloat(this._hass.states[entityId].state);
    if (Number.isFinite(current) && Math.round(current) === Math.round(value)) {
      return;
    }
    await this._hass.callService("number", "set_value", {
      entity_id: entityId,
      value: Math.round(value),
    });
  }

  async _setNomSwitch(on) {
    const entityId = this._nomSwitchEntity();
    if (!entityId || !this._hass?.states?.[entityId]) return;
    const current = this._hass.states[entityId].state;
    const want = on ? "on" : "off";
    if (current === want) return;
    await this._hass.callService("switch", on ? "turn_on" : "turn_off", {
      entity_id: entityId,
    });
  }

  async _onApplyNowClick() {
    if (this._applyBusy) return;
    this._applyBusy = true;
    const btn = this._els?.applyBtn;
    if (btn) {
      btn.disabled = true;
      btn.classList.remove("is-ok", "is-error");
      btn.classList.add("is-busy");
      btn.textContent = "…";
    }

    try {
      this._persist();
      this._flushStorageWrite();
      const result = await this._maybeApplySchedule(true, true);
      const ok = result?.ok !== false;
      if (btn) {
        btn.classList.remove("is-busy");
        btn.classList.add(ok ? "is-ok" : "is-error");
        btn.textContent = ok ? "✓" : "!";
      }
    } catch (err) {
      console.error("Anker Schedule Card: apply-now failed", err);
      if (btn) {
        btn.classList.remove("is-busy");
        btn.classList.add("is-error");
        btn.textContent = "!";
      }
    } finally {
      window.setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("is-busy", "is-ok", "is-error");
          btn.textContent = "Nu toepassen";
        }
        this._applyBusy = false;
      }, 1200);
    }
  }

  _previousSlotWasPower(hour) {
    const prev = this._schedule[(hour + 23) % 24];
    return !!prev && (prev.mode === "charge" || prev.mode === "discharge");
  }

  _describeSlot(hour, slot) {
    const label = this._modeLabel(slot.mode);
    const hh = String(hour).padStart(2, "0");
    if (slot.mode === "charge" || slot.mode === "discharge") {
      return `Uur ${hh}:00 → ${label} ${Math.round(slot.power || 0)} W`;
    }
    return `Uur ${hh}:00 → ${label}`;
  }

  /**
   * @param {boolean} force
   * @param {boolean} withResult  when true, always return a status object
   */
  async _maybeApplySchedule(force = false, withResult = false) {
    const fail = (message) => {
      if (withResult) return { ok: false, message };
      return undefined;
    };
    const ok = (message, extra = {}) => {
      if (withResult) return { ok: true, message, ...extra };
      return undefined;
    };

    if (!this._hass) return fail("Home Assistant niet beschikbaar");
    if (!this._config?.entity) {
      return fail("Geen bedrijfsmodus-entity geconfigureerd");
    }
    if (this._storageEntityId()) {
      if (this._localEditPending) {
        this._flushStorageWrite();
      } else {
        this._pullStorageEntity();
      }
      if (!this._storageSynced) {
        return fail("Schema nog niet gesynchroniseerd");
      }
    }

    const hour = new Date().getHours();
    const slot = this._schedule[hour] || this._defaultSlot();
    const summary = this._describeSlot(hour, slot);

    if (!this._enabled) {
      const offKey = `${hour}:disabled`;
      if (!force && this._lastAppliedKey === offKey) {
        return ok("Planner staat uit — niets gewijzigd");
      }
      try {
        await this._setNomSwitch(false);
        this._lastAppliedKey = offKey;
      } catch (err) {
        console.error("Anker Schedule Card: nom switch off failed", err);
        return fail("NOM-switch uitzetten mislukt");
      }
      return ok("Planner staat uit — NOM-switch uit");
    }

    const { socMax, socMin } = this._slotSocs(slot);
    const key = `${hour}:${slot.mode}:${Math.round(slot.power || 0)}:${socMax}:${socMin}`;
    if (!force && this._lastAppliedKey === key) {
      return ok(`Al actief: ${summary}`);
    }

    try {
      // NOM-O: uitsluitend de NOM-switch — verder niets.
      // Vermogen 0 alleen bij leeg/uit (niet bij NOM of NOM-O).
      if (slot.mode === "off") {
        await this._setPower(0);
      }

      await this._setNomSwitch(slot.mode === "nom_o");

      if (slot.mode === "off" || slot.mode === "nom_o") {
        if (slot.mode === "off" && this._config.off_option) {
          await this._selectOption(this._config.entity, this._config.off_option);
        }
        this._lastAppliedKey = key;
        return ok(`${summary} toegepast`);
      }

      if (slot.mode === "nom") {
        await this._selectOption(
          this._config.entity,
          this._config.nom_option || "0"
        );
        await this._setNumber(this._chargeSocEntity(), socMax);
        await this._setNumber(this._dischargeSocEntity(), socMin);
        this._lastAppliedKey = key;
        return ok(`${summary} toegepast`);
      }

      // charge / discharge → third_party, 2s wachten, dan richting, dan vermogen
      await this._selectOption(
        this._config.entity,
        this._config.third_party_option || "3"
      );
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      await this._selectOption(
        this._config.direction_entity,
        slot.mode === "charge"
          ? this._config.charge_option || "0"
          : this._config.discharge_option || "1"
      );
      await this._setPower(slot.power);
      await this._setNumber(
        slot.mode === "charge"
          ? this._chargeSocEntity()
          : this._dischargeSocEntity(),
        slot.mode === "charge" ? socMax : socMin
      );
      this._lastAppliedKey = key;
      return ok(`${summary} toegepast`);
    } catch (err) {
      console.error("Anker Schedule Card: apply failed", err);
      return fail(`Mislukt: ${summary}`);
    }
  }

  _css() {
    return `
      :host { display: block; }
      .panel { background: transparent; font-family: "Roboto", sans-serif; }
      .screen {
        --color-nom: #1b8a3a;
        --color-nom-o: #00e5c0;
        --color-charge: #3fb6ff;
        --color-discharge: #ff9800;
        --color-current: #eaf6ff;
        --color-idle: #7fa6b8;
        --fill-nom: rgba(27,138,58,0.28);
        --border-nom: rgba(27,138,58,0.8);
        --glow-nom: rgba(27,138,58,0.3);
        --tint-nom: #eaffef;
        --fill-nom-o: linear-gradient(180deg, rgba(0,229,192,0.9), rgba(0,229,192,0.62));
        --glow-nom-o: rgba(0,229,192,0.5);
        --shade-nom-o: #05302a;
        --fill-charge: rgba(63,182,255,0.18);
        --border-charge: rgba(63,182,255,0.55);
        --glow-charge: rgba(63,182,255,0.22);
        --tint-charge: #eaf6ff;
        --fill-discharge: rgba(255,152,0,0.18);
        --border-discharge: rgba(255,152,0,0.55);
        --glow-discharge: rgba(255,152,0,0.22);
        --tint-discharge: #fff3e0;
        border-radius: var(--ha-card-border-radius, 12px);
        padding: 16px 18px 18px;
        overflow: hidden;
        background:
          radial-gradient(120% 80% at 50% -20%, rgba(63,182,255,0.12), transparent 55%),
          linear-gradient(180deg, rgba(8,18,28,0.55), rgba(5,12,20,0.25));
      }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin-bottom: 14px;
      }
      .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .brand-link {
        display: inline-flex; line-height: 0; border-radius: 50%;
        text-decoration: none; flex-shrink: 0;
      }
      .brand-link:hover .brand-logo { filter: brightness(1.15); }
      .brand-logo {
        width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
        object-fit: cover; flex-shrink: 0;
        box-shadow: 0 0 8px rgba(63,182,255,0.35);
        background: #000;
      }
      .title {
        color: #eaf6ff; font-size: 15px; font-weight: 600; letter-spacing: 1.2px;
        text-shadow: 0 0 8px rgba(120,200,255,0.45);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .subtitle {
        color: #7fa6b8; font-size: 10px; letter-spacing: 1.4px; margin-top: 2px;
      }
      .toggle-btn {
        display: inline-flex; align-items: center; gap: 8px;
        border: 1px solid rgba(63,182,255,0.35);
        background: rgba(63,182,255,0.08);
        color: #9fc4d6; border-radius: 999px; padding: 6px 12px;
        cursor: pointer; font-size: 11px; letter-spacing: 1px;
      }
      .toggle-btn.is-on {
        color: #eaf6ff; border-color: rgba(76,175,80,0.55);
        background: rgba(76,175,80,0.16);
        box-shadow: 0 0 12px rgba(76,175,80,0.25);
      }
      .toggle-dot {
        width: 8px; height: 8px; border-radius: 50%; background: #7fa6b8;
      }
      .toggle-btn.is-on .toggle-dot {
        background: var(--color-nom); box-shadow: 0 0 8px var(--color-nom);
      }
      .status-row {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 8px; margin-bottom: 12px;
      }
      .status-block {
        text-align: center; padding: 8px 4px; border-radius: 8px;
        background: rgba(255,255,255,0.03);
      }
      .stat-label {
        font-size: 10px; letter-spacing: 1px; color: #7fa6b8; margin-bottom: 4px;
      }
      .stat-value {
        color: #eaf6ff; font-size: 12px;
        text-shadow: 0 0 6px rgba(120,200,255,0.35);
      }
      .mode-value.is-self {
        color: var(--color-nom);
        text-shadow: 0 0 8px rgba(76,175,80,0.55);
      }
      .brush-row {
        display: grid; grid-template-columns: repeat(5, 1fr);
        gap: 6px; margin-bottom: 12px;
      }
      .brush {
        appearance: none; border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.04); color: #9fc4d6;
        border-radius: 8px; padding: 8px 2px; cursor: pointer;
        font-size: 11px; letter-spacing: 0.3px;
        transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .brush.is-muted,
      .brush:disabled {
        color: #5f7380;
        border-color: rgba(255,255,255,0.05);
        background: rgba(255,255,255,0.02);
        box-shadow: none;
        opacity: 0.45;
        cursor: default;
      }
      .brush-row.has-selection .brush:not(:disabled) {
        opacity: 1;
        cursor: pointer;
      }
      .brush[data-brush="nom"].active {
        color: #eaffef; border-color: rgba(27,138,58,0.85);
        background: rgba(27,138,58,0.28); box-shadow: 0 0 10px rgba(27,138,58,0.35);
        opacity: 1;
      }
      .brush[data-brush="nom_o"].active {
        color: #eafffa; border-color: rgba(0,229,192,0.9);
        background: rgba(0,229,192,0.22); box-shadow: 0 0 12px rgba(0,229,192,0.4);
        opacity: 1;
      }
      .brush[data-brush="charge"].active {
        color: #eaf6ff; border-color: rgba(63,182,255,0.65);
        background: rgba(63,182,255,0.2); box-shadow: 0 0 10px rgba(63,182,255,0.25);
        opacity: 1;
      }
      .brush[data-brush="discharge"].active {
        color: #fff3e0; border-color: rgba(255,152,0,0.65);
        background: rgba(255,152,0,0.2); box-shadow: 0 0 10px rgba(255,152,0,0.25);
        opacity: 1;
      }
      .brush[data-brush="off"].active {
        color: #d8e6ee; border-color: rgba(255,255,255,0.28);
        background: rgba(255,255,255,0.1);
        opacity: 1;
      }
      .hours {
        display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px;
      }
      @media (min-width: 500px) {
        .hours { grid-template-columns: repeat(8, minmax(0, 1fr)); }
      }
      @media (min-width: 720px) {
        .hours { grid-template-columns: repeat(12, minmax(0, 1fr)); }
      }
      .hour {
        appearance: none; border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.03); color: var(--color-idle);
        border-radius: 8px; padding: 7px 2px 6px; cursor: pointer;
        user-select: none; touch-action: none;
        display: flex; flex-direction: column; align-items: center; gap: 1px;
        transition: transform 0.12s ease, border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      .hour:hover { filter: brightness(1.12); }
      .hour:active { transform: scale(0.96); }
      .hour-num { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .hour-tag {
        font-size: 9px; letter-spacing: 0.3px; opacity: 0.85;
        max-width: 100%; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .hour-power { font-size: 9px; opacity: 0.9; }
      /* Vulling volgt de kleuren uit de card-config; zie _syncChrome. */
      .hour.mode-nom {
        color: var(--tint-nom); border-color: var(--border-nom);
        background: var(--fill-nom); box-shadow: 0 0 8px var(--glow-nom);
      }
      /* Lichte vulling met donkere tekst: duidelijk anders dan NOM. */
      .hour.mode-nom_o {
        color: var(--shade-nom-o); border-color: var(--color-nom-o);
        background: var(--fill-nom-o);
        box-shadow: 0 0 12px var(--glow-nom-o);
      }
      .hour.mode-nom_o .hour-tag, .hour.mode-nom_o .hour-power { opacity: 1; }
      .hour.mode-charge {
        color: var(--tint-charge); border-color: var(--border-charge);
        background: var(--fill-charge); box-shadow: 0 0 8px var(--glow-charge);
      }
      .hour.mode-discharge {
        color: var(--tint-discharge); border-color: var(--border-discharge);
        background: var(--fill-discharge); box-shadow: 0 0 8px var(--glow-discharge);
      }
      .hour.current {
        outline: 3px solid var(--color-current);
        outline-offset: 1px;
        box-shadow: 0 0 12px rgba(234,246,255,0.55);
      }
      .hour.selected {
        outline: 2px solid rgba(63,182,255,1);
        outline-offset: 1px;
      }
      .hour.current.selected {
        outline: 3px solid var(--color-current);
        box-shadow:
          0 0 0 2px rgba(63,182,255,0.85),
          0 0 12px rgba(234,246,255,0.55);
      }
      .screen.scheduler-off .hour.mode-nom,
      .screen.scheduler-off .hour.mode-nom_o,
      .screen.scheduler-off .hour.mode-charge,
      .screen.scheduler-off .hour.mode-discharge {
        opacity: 0.55; box-shadow: none;
      }
      .editor-panel {
        margin-top: 12px; padding: 12px;
        border-radius: 10px; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(63,182,255,0.18);
      }
      .editor-panel.hidden, .power-wrap.hidden, .soc-wrap.hidden, .soc-min-wrap.hidden, .hidden { display: none; }
      .editor-head {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 8px; color: #d8e6ee; font-size: 12px;
      }
      .editor-mode[data-mode="nom"] { color: var(--color-nom); }
      .editor-mode[data-mode="nom_o"] { color: var(--color-nom-o); }
      .editor-mode[data-mode="charge"] { color: var(--color-charge); }
      .editor-mode[data-mode="discharge"] { color: var(--color-discharge); }
      .power-labels {
        display: flex; justify-content: space-between;
        color: #9fc4d6; font-size: 12px; margin-bottom: 6px;
      }
      .power-wrap, .soc-wrap, .soc-min-wrap { width: 100%; }
      .soc-wrap, .soc-min-wrap { margin-top: 10px; }
      .power-value, .soc-value, .soc-min-value { color: #eaf6ff; font-variant-numeric: tabular-nums; }
      .power-slider, .soc-slider, .soc-min-slider {
        width: 100%; accent-color: var(--color-charge); cursor: pointer;
        display: block; margin: 0; box-sizing: border-box;
      }
      .legend {
        display: flex; flex-wrap: wrap; gap: 12px;
        margin-top: 12px; color: #7fa6b8; font-size: 11px;
      }
      .legend span { display: inline-flex; align-items: center; gap: 6px; }
      .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
      .swatch.nom { background: var(--color-nom); box-shadow: 0 0 6px var(--color-nom); }
      .swatch.nom_o { background: var(--color-nom-o); box-shadow: 0 0 6px var(--color-nom-o); }
      .swatch.charge { background: var(--color-charge); box-shadow: 0 0 6px var(--color-charge); }
      .swatch.discharge { background: var(--color-discharge); box-shadow: 0 0 6px var(--color-discharge); }
      .swatch.current { background: rgba(255,255,255,0.55); }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .actions button {
        appearance: none; border: 1px solid rgba(63,182,255,0.28);
        background: rgba(63,182,255,0.08); color: #d8e6ee;
        border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer;
      }
      .actions button:hover {
        background: rgba(63,182,255,0.16); border-color: rgba(63,182,255,0.5);
      }
      .footer-bar {
        display: flex; justify-content: flex-end; align-items: center;
        gap: 12px; margin-top: 10px; min-height: 22px;
      }
      .selection-count {
        color: #6a8490; font-size: 11px; letter-spacing: 0.4px;
        font-variant-numeric: tabular-nums;
      }
      .selection-count.has-selection { color: #eaf6ff; }
      .selection-clear {
        appearance: none; border: none; background: transparent;
        color: #7fa6b8; font-size: 11px; cursor: pointer; padding: 0;
        text-decoration: underline; text-underline-offset: 2px;
      }
      .selection-clear:hover { color: #eaf6ff; }
      .selection-clear.hidden { display: none; }
      .actions button:disabled { opacity: 0.75; cursor: default; }
      .actions button.apply-now-btn.is-busy {
        border-color: rgba(63,182,255,0.65);
        background: rgba(63,182,255,0.18);
      }
      .actions button.apply-now-btn.is-ok {
        border-color: rgba(76,175,80,0.7);
        background: rgba(76,175,80,0.22);
        color: #eaffef;
      }
      .actions button.apply-now-btn.is-error {
        border-color: rgba(244,67,54,0.7);
        background: rgba(244,67,54,0.18);
        color: #ffebee;
      }
      .next-mode-value[data-mode="nom"] { color: var(--color-nom); }
      .next-mode-value[data-mode="nom_o"] { color: var(--color-nom-o); }
      .next-mode-value[data-mode="charge"] { color: var(--color-charge); }
      .next-mode-value[data-mode="discharge"] { color: var(--color-discharge); }
    `;
  }
}


defineElement("anker-schedule-inner", AnkerScheduleCard);

class AnkerScheduleEditor extends HTMLElement {
  setConfig(config) {
    this._raw = { ...(config || {}) };
    this._config = {
      ...DEFAULTS,
      ...this._raw,
      colors: { ...DEFAULTS.colors, ...(this._raw.colors || {}) },
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._render();
      return;
    }
    this.querySelectorAll("ha-entity-picker").forEach((picker) => {
      picker.hass = hass;
    });
  }

  connectedCallback() {
    this._render();
  }

  _isFocused(el) {
    return (
      !!el &&
      (el === document.activeElement ||
        el.matches(":focus") ||
        this.shadowRoot?.activeElement === el)
    );
  }

  _normalizeHex(value, fallback) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
    return fallback;
  }

  _render() {
    if (!this._config) return;

    if (!this._built) {
      this.innerHTML = `
        <style>
          .wrap { padding: 8px 0; display: flex; flex-direction: column; gap: 14px; }
          .section-title {
            font-size: 12px; font-weight: 600; letter-spacing: 0.4px;
            color: var(--primary-text-color); margin-top: 4px;
          }
          .row { display: flex; flex-direction: column; gap: 4px; }
          .row label { font-size: 12px; color: var(--secondary-text-color); }
          .hint { font-size: 11px; color: var(--secondary-text-color); line-height: 1.4; }
          .check-row {
            display: flex; align-items: center; gap: 8px;
            font-size: 13px; color: var(--primary-text-color);
          }
          input[type="text"], input[type="number"] {
            width: 100%; box-sizing: border-box; padding: 8px 10px;
            border-radius: 8px; border: 1px solid var(--divider-color);
            background: var(--card-background-color); color: var(--primary-text-color);
          }
          .color-row {
            display: grid; grid-template-columns: 1fr 44px; gap: 8px; align-items: center;
          }
          input[type="color"] {
            width: 44px; height: 36px; padding: 0; border: 1px solid var(--divider-color);
            border-radius: 8px; background: transparent; cursor: pointer;
          }
        </style>
        <div class="wrap">
          <div class="section-title">Basis</div>
          <div class="row">
            <label>Titel</label>
            <input type="text" data-key="title" placeholder="ANKER PLANNER">
          </div>
          <div class="row">
            <label>Tekst NOM-O-knop (nom_o_label)</label>
            <input type="text" data-key="nom_o_label" placeholder="NOM-O">
          </div>
          <div class="row">
            <label>Tekst NOM-O-uurtegel (nom_o_tag, max 3 tekens)</label>
            <input type="text" data-key="nom_o_tag" placeholder="N-O" maxlength="3">
          </div>
          <label class="check-row">
            <input type="checkbox" data-key="enabled">
            Planner standaard aan (enabled)
          </label>
          <label class="check-row">
            <input type="checkbox" data-key="auto_apply">
            Client-side auto_apply (normaal uit laten bij integratie)
          </label>
          <label class="check-row">
            <input type="checkbox" data-key="show_soc">
            SOC weergeven
          </label>

          <div class="section-title">Entities (optioneel, leeg = uit integratie)</div>
          <div class="row">
            <label>Bedrijfsmodus select (entity)</label>
            <ha-entity-picker data-key="entity" domain="select" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>Laad/ontlaadregeling (direction_entity)</label>
            <ha-entity-picker data-key="direction_entity" domain="select" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>Vermogen (power_entity)</label>
            <ha-entity-picker data-key="power_entity" domain="number" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>Max SOC laden (charge_soc_entity)</label>
            <ha-entity-picker data-key="charge_soc_entity" domain="number" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>Min SOC ontladen (discharge_soc_entity)</label>
            <ha-entity-picker data-key="discharge_soc_entity" domain="number" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>NOM-O switch (nom_switch_entity)</label>
            <ha-entity-picker data-key="nom_switch_entity" domain="switch" allow-custom-entity></ha-entity-picker>
          </div>
          <div class="row">
            <label>Schema-opslag (storage_entity)</label>
            <ha-entity-picker data-key="storage_entity" allow-custom-entity></ha-entity-picker>
          </div>

          <div class="section-title">Select-opties</div>
          <div class="row"><label>NOM (nom_option)</label><input type="text" data-key="nom_option" placeholder="0"></div>
          <div class="row"><label>Externe modus (third_party_option)</label><input type="text" data-key="third_party_option" placeholder="3"></div>
          <div class="row"><label>Laden (charge_option)</label><input type="text" data-key="charge_option" placeholder="0"></div>
          <div class="row"><label>Ontladen (discharge_option)</label><input type="text" data-key="discharge_option" placeholder="1"></div>
          <div class="row"><label>Uit-penseel option (off_option)</label><input type="text" data-key="off_option" placeholder="(leeg = niets wijzigen)"></div>

          <div class="section-title">Vermogen</div>
          <div class="row"><label>Standaard vermogen (default_power)</label><input type="number" data-key="default_power" min="0" step="50"></div>
          <div class="row"><label>Max (max_power)</label><input type="number" data-key="max_power" min="0" step="50"></div>
          <div class="row"><label>Min (min_power)</label><input type="number" data-key="min_power" min="0" step="50"></div>
          <div class="row"><label>Stap (power_step)</label><input type="number" data-key="power_step" min="1" step="1"></div>

          <div class="section-title">SOC</div>
          <div class="row"><label>Standaard max SOC laden (default_charge_soc)</label><input type="number" data-key="default_charge_soc" min="0" max="100" step="1"></div>
          <div class="row"><label>Standaard min SOC ontladen (default_discharge_soc)</label><input type="number" data-key="default_discharge_soc" min="0" max="100" step="1"></div>

          <div class="section-title">Kleuren</div>
          <div class="row">
            <label>NOM</label>
            <div class="color-row">
              <input type="text" data-color="nom" placeholder="#1b8a3a">
              <input type="color" data-color-picker="nom">
            </div>
          </div>
          <div class="row">
            <label>NOM-O</label>
            <div class="color-row">
              <input type="text" data-color="nom_o" placeholder="#00e5c0">
              <input type="color" data-color-picker="nom_o">
            </div>
          </div>
          <div class="row">
            <label>Laden</label>
            <div class="color-row">
              <input type="text" data-color="charge" placeholder="#3fb6ff">
              <input type="color" data-color-picker="charge">
            </div>
          </div>
          <div class="row">
            <label>Ontladen</label>
            <div class="color-row">
              <input type="text" data-color="discharge" placeholder="#ff9800">
              <input type="color" data-color-picker="discharge">
            </div>
          </div>
          <div class="row">
            <label>Huidig uur</label>
            <div class="color-row">
              <input type="text" data-color="current" placeholder="#eaf6ff">
              <input type="color" data-color-picker="current">
            </div>
          </div>
          <div class="row">
            <label>Idle / uit</label>
            <div class="color-row">
              <input type="text" data-color="idle" placeholder="#7fa6b8">
              <input type="color" data-color-picker="idle">
            </div>
          </div>

          <div class="hint">
            Lege entity-velden worden automatisch gevuld vanuit de Anker Schedule-integratie.
            Kleuren en opties overschrijven de standaardwaarden in de card.
          </div>
        </div>
      `;

      const textKeys = [
        "title",
        "nom_o_label",
        "nom_o_tag",
        "nom_option",
        "third_party_option",
        "charge_option",
        "discharge_option",
        "off_option",
      ];
      textKeys.forEach((key) => {
        const input = this.querySelector(`input[data-key="${key}"]`);
        if (!input) return;
        input.addEventListener("input", () => {
          this._updateConfig({ [key]: input.value });
        });
        input.addEventListener("change", () => {
          this._updateConfig({ [key]: input.value.trim() });
        });
      });

      const numberKeys = {
        default_power: 500,
        max_power: 3500,
        min_power: 0,
        power_step: 50,
        default_charge_soc: 100,
        default_discharge_soc: 10,
      };
      Object.keys(numberKeys).forEach((key) => {
        const input = this.querySelector(`input[data-key="${key}"]`);
        if (!input) return;
        input.addEventListener("input", () => {
          if (input.value === "") return;
          const val = parseFloat(input.value);
          if (!Number.isFinite(val) || val < 0) return;
          this._updateConfig({ [key]: val });
        });
        input.addEventListener("change", () => {
          const val = parseFloat(input.value);
          this._updateConfig({
            [key]: Number.isFinite(val) && val >= 0 ? val : numberKeys[key],
          });
        });
      });

      ["enabled", "auto_apply", "show_soc"].forEach((key) => {
        const input = this.querySelector(`input[data-key="${key}"]`);
        if (!input) return;
        input.addEventListener("change", () => {
          this._updateConfig({ [key]: !!input.checked });
        });
      });

      this.querySelectorAll("ha-entity-picker").forEach((picker) => {
        picker.addEventListener("value-changed", (ev) => {
          const key = picker.dataset.key;
          const value = ev.detail?.value || "";
          this._updateConfig({ [key]: value });
        });
      });

      ["nom", "nom_o", "charge", "discharge", "current", "idle"].forEach(
        (colorKey) => {
          const text = this.querySelector(`input[data-color="${colorKey}"]`);
          const picker = this.querySelector(
            `input[data-color-picker="${colorKey}"]`
          );
          if (!text || !picker) return;
          text.addEventListener("input", () => {
            const hex = this._normalizeHex(
              text.value,
              DEFAULTS.colors[colorKey]
            );
            if (/^#[0-9a-f]{6}$/.test(String(text.value).trim().toLowerCase()) ||
                /^[0-9a-f]{6}$/i.test(String(text.value).trim())) {
              picker.value = hex;
              this._updateConfig({ colors: { [colorKey]: hex } });
            }
          });
          text.addEventListener("change", () => {
            const hex = this._normalizeHex(
              text.value,
              DEFAULTS.colors[colorKey]
            );
            text.value = hex;
            picker.value = hex;
            this._updateConfig({ colors: { [colorKey]: hex } });
          });
          picker.addEventListener("input", () => {
            text.value = picker.value;
            this._updateConfig({ colors: { [colorKey]: picker.value } });
          });
        }
      );

      this._built = true;
    }

    if (this._hass) {
      this.querySelectorAll("ha-entity-picker").forEach((picker) => {
        picker.hass = this._hass;
        const key = picker.dataset.key;
        const val = this._config[key] || "";
        if (picker.value !== val) picker.value = val;
      });
    }

    const syncText = [
      "title",
      "nom_o_label",
      "nom_o_tag",
      "nom_option",
      "third_party_option",
      "charge_option",
      "discharge_option",
      "off_option",
    ];
    syncText.forEach((key) => {
      const input = this.querySelector(`input[data-key="${key}"]`);
      if (!input || this._isFocused(input)) return;
      const val = this._config[key] ?? "";
      if (input.value !== String(val)) input.value = val;
    });

    [
      "default_power",
      "max_power",
      "min_power",
      "power_step",
      "default_charge_soc",
      "default_discharge_soc",
    ].forEach((key) => {
      const input = this.querySelector(`input[data-key="${key}"]`);
      if (!input || this._isFocused(input)) return;
      const val = this._config[key];
      if (input.value !== String(val)) input.value = val;
    });

    ["enabled", "auto_apply", "show_soc"].forEach((key) => {
      const input = this.querySelector(`input[data-key="${key}"]`);
      if (!input) return;
      let checked = !!this._config.enabled;
      if (key === "auto_apply") checked = !!this._raw.auto_apply;
      if (key === "show_soc") checked = !!this._config.show_soc;
      if (input.checked !== checked) input.checked = checked;
    });

    ["nom", "nom_o", "charge", "discharge", "current", "idle"].forEach(
      (colorKey) => {
        const text = this.querySelector(`input[data-color="${colorKey}"]`);
        const picker = this.querySelector(
          `input[data-color-picker="${colorKey}"]`
        );
        if (!text || !picker) return;
        const hex = this._normalizeHex(
          this._config.colors?.[colorKey],
          DEFAULTS.colors[colorKey]
        );
        if (!this._isFocused(text) && text.value !== hex) text.value = hex;
        if (picker.value !== hex) picker.value = hex;
      }
    );
  }

  _updateConfig(patch) {
    const raw = { ...(this._raw || {}) };
    if (patch.colors) {
      raw.colors = { ...(raw.colors || {}), ...patch.colors };
      delete patch.colors;
    }
    Object.assign(raw, patch);
    this._raw = raw;
    this._config = {
      ...DEFAULTS,
      ...raw,
      colors: { ...DEFAULTS.colors, ...(raw.colors || {}) },
    };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: { ...raw } },
        bubbles: true,
        composed: true,
      })
    );
  }
}

defineElement("anker-schedule-editor-inner", AnkerScheduleEditor);


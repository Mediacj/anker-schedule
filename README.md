<p align="center">
  <img src="https://raw.githubusercontent.com/Mediacj/anker-schedule/main/images/energienerds.png" alt="Energienerds" width="140">
</p>

<h1 align="center">Anker Schedule</h1>

<p align="center">
  Home Assistant-integratie van <a href="https://energienerds.nl/">Energienerds.nl</a><br>
  24u-planner voor Anker Solix: NOM / NOM-O / laden / ontladen
</p>

<p align="center">
  <a href="https://github.com/Mediacj/anker-schedule"><img src="https://img.shields.io/github/last-commit/Mediacj/anker-schedule?style=flat-square" alt="last commit"></a>
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-orange.svg?style=flat-square" alt="HACS"></a>
</p>

---

Zelfstandige custom integration met 24u-planner voor Anker Solix (NOM / NOM-O / laden / ontladen).

- Eigen Lovelace-card (automatisch geladen) — **geen** community/`www/community` resource nodig
- Backend past elk uur toe — geen aparte automation of `input_text`-helper nodig
- Brand-icoon in `brand/` (Energienerds) voor het integratiescherm

## Installeren

1. Installeer via HACS (custom repository) of kopieer `custom_components/anker_schedule` naar je Home Assistant `custom_components`-map.
2. Herstart Home Assistant.
3. Ga naar **Instellingen → Apparaten en services → Integratie toevoegen** en zoek **Anker Schedule**.
4. Kies zelf je entities (velden starten leeg):
   - Bedrijfsmodus select
   - Laad/ontlaadregeling select
   - Vermogen number
   - NOM-O switch (standaard `switch.anker_nom`)

De card wordt automatisch geladen via `/anker_schedule/anker-schedule.js`.

## Dashboard card

Minimaal:

```yaml
type: custom:anker-schedule
title: ANKER PLANNER
```

Volledig voorbeeld:

```yaml
type: custom:anker-schedule
title: ANKER PLANNER
enabled: true
auto_apply: false
entity: select.anker_solix_device_bedrijfsmodus_apparaat_werkt_in_externe_modus
direction_entity: select.anker_solix_device_laad_ontlaadregeling
power_entity: number.anker_solix_device_ingestelde_laad_ontlaadvermogen
nom_switch_entity: switch.anker_nom
storage_entity: text.anker_schedule_schema
nom_option: "0"
third_party_option: "3"
charge_option: "0"
discharge_option: "1"
off_option: ""
default_power: 500
max_power: 3500
min_power: 0
power_step: 50
colors:
  nom: "#1b8a3a"
  nom_o: "#00e5c0"
  charge: "#3fb6ff"
  discharge: "#ff9800"
  current: "#eaf6ff"
  idle: "#7fa6b8"
```

Alle velden zijn ook bewerkbaar in de visuele HA-card-editor (inclusief color pickers).

### Card YAML-velden

| Veld | Type | Standaard | Beschrijving |
|------|------|-----------|--------------|
| `title` | string | `ANKER PLANNER` | Titel bovenaan de card |
| `enabled` | bool | `true` | Startwaarde planner aan/uit |
| `auto_apply` | bool | `false`* | Client-side toepassen; bij integratie-storage normaal niet nodig |
| `entity` | entity_id | *(uit integratie)* | Bedrijfsmodus-select |
| `direction_entity` | entity_id | *(uit integratie)* | Laad/ontlaadregeling |
| `power_entity` | entity_id | *(uit integratie)* | Vermogen number |
| `nom_switch_entity` | entity_id | `switch.anker_nom` | NOM-O switch |
| `storage_entity` | entity_id | *(auto)* | Text/input_text met compact schema |
| `nom_option` | string | `0` | Option voor NOM / self_consumption |
| `third_party_option` | string | `3` | Option voor externe modus |
| `charge_option` | string | `0` | Richting laden |
| `discharge_option` | string | `1` | Richting ontladen |
| `off_option` | string | `""` | Option bij penseel “Uit”; leeg = niets wijzigen |
| `default_power` | number | `500` | Standaard W bij nieuwe laad/ontlaad-uren |
| `max_power` | number | `3500` | Maximum van de vermogensslider |
| `min_power` | number | `0` | Minimum van de vermogensslider |
| `power_step` | number | `50` | Stapgrootte slider (W) |

\* `auto_apply` is impliciet `false` zodra er een `storage_entity` (of auto-discovered schema-text) is.

## Entities (integratie)

| Entity | Functie |
|--------|---------|
| `text.*_schema` | Compact schema `e=1;m=...;p=...` |
| `switch.*_planner` | Planner aan/uit |
| `sensor.*_geplande_modus` | Modus huidig uur |
| `sensor.*_gepland_vermogen` | Vermogen huidig uur |
| `sensor.*_huidig_uur` | Uur (0–23) |

## Services

- `anker_schedule.apply_now` — pas huidig uur direct toe
- `anker_schedule.set_schedule` — zet compact schema (`value`)

## Gedrag

- **NOM** → bedrijfsmodus = `self_consumption`/`0` + NOM-switch UIT
- **NOM-O** → alleen `switch.anker_nom` AAN (geen select-wijziging)
- **Laden** → externe modus + charge + vermogen
- **Ontladen** → externe modus + discharge + vermogen
- **Uit** → NOM-switch UIT (tenzij `off_option` gezet)

Toepassen gebeurt bij HA-start, elk heel uur, en bij schema-wijzigingen voor het huidige uur.

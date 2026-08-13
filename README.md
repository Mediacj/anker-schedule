<p align="center">
  <img src="https://raw.githubusercontent.com/Mediacj/anker-schedule/main/images/energienerds.png" alt="Energienerds" width="140">
</p>

<h1 align="center">Anker SOLIX Schedule</h1>

<p align="center">
  Home Assistant-integratie van <a href="https://energienerds.nl/">Energienerds.nl</a><br>
  24u-planner voor Anker Solix: NOM / NOM-O / laden / ontladen
</p>

<p align="center">
  <a href="https://github.com/Mediacj/anker-schedule"><img src="https://img.shields.io/github/last-commit/Mediacj/anker-schedule?style=flat-square" alt="last commit"></a>
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-orange.svg?style=flat-square" alt="HACS"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Mediacj/anker-schedule/main/images/dashboard.jpg" alt="Anker SOLIX Schedule dashboard" width="720">
</p>

---

Zelfstandige custom integration met 24u-planner voor Anker Solix (NOM / NOM-O / laden / ontladen).

- Eigen Lovelace-card (automatisch geladen) — **geen** community/`www/community` resource nodig
- Backend past elk uur toe — geen aparte automation of `input_text`-helper nodig
- Brand-icoon in `brand/` (Energienerds) voor het integratiescherm

## Installeren

1. Installeer via HACS (custom repository) of kopieer `custom_components/anker_schedule` naar je Home Assistant `custom_components`-map.
2. Herstart Home Assistant.
3. Ga naar **Instellingen → Apparaten en services → Integratie toevoegen** en zoek **Anker SOLIX Schedule**.
4. Kies zelf je entities (velden starten leeg):
   - Bedrijfsmodus select
   - Laad/ontlaadregeling select
   - Vermogen number
   - Max SOC laden (optioneel, bijv. `number.*_maximale_laadlimiet`)
   - Min SOC ontladen (optioneel, bijv. `number.*_ontladingslimiet`)
   - NOM-O switch (standaard `switch.anker_nom`)

De card wordt automatisch geladen via `/local/anker-schedule/anker-schedule.js`.

## Dashboard card

### Entities

Entities komen **alleen** uit de integratieconfiguratie (bij installeren/opties). Zet ze niet in de card-YAML — oude entity-velden worden bij openen van de editor opgeschoond.

Minimaal is dus genoeg:

```yaml
type: custom:anker-schedule
title: ANKER PLANNER
```

Voorbeeld met optionele UI-overrides:

```yaml
type: custom:anker-schedule
title: ANKER PLANNER
nom_o_label: NOM-O
nom_o_tag: N-O
enabled: true
auto_apply: false
nom_option: "0"
third_party_option: "3"
charge_option: "0"
discharge_option: "1"
off_option: ""
default_power: 500
max_power: 3500
min_power: 0
power_step: 50
show_soc: true
default_charge_soc: 100
default_discharge_soc: 10
colors:
  nom: "#1b8a3a"
  nom_o: "#00e5c0"
  charge: "#3fb6ff"
  discharge: "#ff9800"
  current: "#eaf6ff"
  idle: "#7fa6b8"
```

Entities (bedrijfsmodus, vermogen, SOC, NOM-switch, schema) komen uitsluitend uit de **integratieconfiguratie**, niet uit de card-YAML.

Alle velden zijn ook bewerkbaar in de visuele HA-card-editor (inclusief color pickers).

### Card YAML-velden

| Veld | Type | Standaard | Beschrijving |
|------|------|-----------|--------------|
| `title` | string | `ANKER PLANNER` | Titel bovenaan de card |
| `nom_o_label` | string | `NOM-O` | Eigen tekst voor de NOM-O-knop; wordt ook in de legenda en de statusblokken gebruikt |
| `nom_o_tag` | string | `N-O` | Eigen tekst op de NOM-O-uurtegels; maximaal 3 tekens, langer wordt afgekapt |
| `enabled` | bool | `true` | Startwaarde planner aan/uit |
| `auto_apply` | bool | `false`* | Client-side toepassen; bij integratie-storage normaal niet nodig |
| `nom_option` | string | `0` | Option voor NOM / self_consumption |
| `third_party_option` | string | `3` | Option voor externe modus |
| `charge_option` | string | `0` | Richting laden |
| `discharge_option` | string | `1` | Richting ontladen |
| `off_option` | string | `""` | Option bij penseel “Uit”; leeg = niets wijzigen |
| `default_power` | number | `500` | Standaard W bij nieuwe laad/ontlaad-uren |
| `max_power` | number | `3500` | Maximum van de vermogensslider |
| `min_power` | number | `0` | Minimum van de vermogensslider |
| `power_step` | number | `50` | Stapgrootte slider (W) |
| `show_soc` | bool | `true` | SOC weergeven: extra slider onder het vermogen bij laden/ontladen |
| `default_charge_soc` | number | `100` | Standaard max SOC (%) voor een nieuw laad-uur |
| `default_discharge_soc` | number | `10` | Standaard min SOC (%) voor een nieuw ontlaad-uur |
| `colors.nom` | hex | `#1b8a3a` | Kleur NOM |
| `colors.nom_o` | hex | `#00e5c0` | Kleur NOM-O |
| `colors.charge` | hex | `#3fb6ff` | Kleur laden |
| `colors.discharge` | hex | `#ff9800` | Kleur ontladen |
| `colors.current` | hex | `#eaf6ff` | Accent huidig uur |
| `colors.idle` | hex | `#7fa6b8` | Kleur uit/idle |

De moduskleuren bepalen de legenda én de **exacte achtergrondkleur** van de uurtegels (zoals in de color pickers).


\* `auto_apply` is impliciet `false` zodra de integratie-schema-entity beschikbaar is.

## Entities (integratie)

| Entity | Functie |
|--------|---------|
| `text.*_schema` | Compact schema `e=1;m=...;p=...;s=...` |
| `switch.*_planner` | Planner aan/uit |
| `sensor.*_geplande_modus` | Modus huidig uur |
| `sensor.*_gepland_vermogen` | Vermogen huidig uur |
| `sensor.*_huidig_uur` | Uur (0–23) |

## Services

- `anker_schedule.apply_now` — pas huidig uur direct toe
- `anker_schedule.set_schedule` — zet compact schema (`value`)

## Gedrag

- **NOM** → bedrijfsmodus = `self_consumption`/`0` + NOM-switch UIT + max/min SOC
- **NOM-O** → alleen `switch.anker_nom` AAN (geen select, geen vermogen)
- **Laden** → externe modus (`3`), **2s wachten**, daarna charge + vermogen + max SOC
- **Ontladen** → externe modus (`3`), **2s wachten**, daarna discharge + vermogen + min SOC
- **Uit / leeg** → vermogen op **0 W** + NOM-switch UIT (tenzij `off_option` gezet)
- **Na laden/ontladen → NOM of NOM-O** → geen vermogen-reset aan het einde van het uur

Toepassen gebeurt bij HA-start, elk heel uur, bij schema-wijzigingen voor het huidige uur, en **elke minuut** als de live bedrijfsmodus niet meer overeenkomt met het schema (bijv. als Anker of een andere automation tussentijds weer `third_party_control` zet). Bij uurwissel met **dezelfde modus** (NOM→NOM, NOM-O→NOM-O, laden→laden) gebeurt geen nieuwe mode-select — de modus loopt door; alleen power/SOC worden bijgewerkt als die afwijken. Elke write (modus, switch, vermogen, SOC) checkt eerst of de entity al op die waarde staat. De minuutcontrole herleest eerst het schema; staat het huidige uur op **Uit**, dan blijft de planner in stand-by en herstelt hij geen modus. Na een NOM-apply volgt ook een korte nabcontrole (~3s) om die race te winnen.

## SOC per uur

Zet `show_soc: false` in de card-YAML om de SOC-slider te verbergen (standaard aan). Selecteer je een uur met **Laden**, **Ontladen** of **NOM**, dan verschijnt onder (of i.p.v.) de vermogensslider de SOC-regelaar(s) in hetzelfde kader:

- **Laden** → *Max SOC*
- **Ontladen** → *Min SOC*
- **NOM** → beide: *Max SOC* en *Min SOC* (worden naar `charge_soc_entity` en `discharge_soc_entity` geschreven)

De waarde staat per uur in het schema, dus elk laad- of ontlaadblok kan een eigen SOC-grens hebben. Staat `show_soc` uit, dan gebruikt elk uur gewoon de standaardwaarde. Is er geen SOC-entity geconfigureerd, dan wordt er niets geschreven.

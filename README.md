# Vejle Kommune – Hype Cycle (Azure Static Web App)

Interaktiv hype cycle til Vejle Kommune. Forsiden er et rent visningsbillede; redigering (tilføj, omdøb, kategorisér, træk, slet) sker bag et admin-modul. Data gemmes centralt i **Azure Blob Storage**, så alle ser den samme version.

## Arkitektur

```
Browser (index.html)
   │  GET  /api/state   →  henter den gemte tilstand (alle må læse)
   │  POST /api/state   →  gemmer tilstanden (kun admin bør kunne dette)
   ▼
Azure Static Web App
   ├── Statisk frontend  (index.html)
   └── Managed API       (Azure Functions, /api/state)
            │
            ▼
   Azure Blob Storage  →  container "hypecycle", blob "state.json"
```

Hele tilstanden (teknologier, kategorier, overskrift, årstal) ligger som én JSON-blob. Det er rigeligt til formålet og holder omkostninger og kompleksitet nede.

## Mappestruktur

```
vejle-hypecycle-swa/
├── index.html                     # Appen (frontend)
├── staticwebapp.config.json       # Runtime + routing
├── .gitignore
└── api/                           # Managed Azure Functions API
    ├── host.json
    ├── package.json
    ├── local.settings.json.example
    └── src/functions/state.js     # GET/POST /api/state mod Blob Storage
```

---

## Forudsætninger

- En **Azure-konto** med rettigheder til at oprette ressourcer (Vejles eget tenant/abonnement).
- Et **GitHub-repo** (nemmeste deploy-vej) — alternativt kan der deployes med SWA CLI.
- Til lokal udvikling: **Node.js 20+**, [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local), [Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) og evt. [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) (lokal blob-emulator).

---

## Trin 1 – Opret Storage Account + container

1. I Azure-portalen: **Create resource → Storage account**.
2. Vælg abonnement og resource group, giv den et navn (fx `vejlehypecycle`), behold *StorageV2* og *Locally-redundant (LRS)* hvis det er nok.
3. Når den er oprettet: gå til **Containers → + Container**, navngiv den `hypecycle`, og sæt adgangsniveau til **Private**.
4. Gå til **Security + networking → Access keys**, og kopiér **Connection string** (key1). Den bruges i Trin 3.

> Blob'en `state.json` oprettes automatisk første gang der gemmes — du behøver ikke oprette den selv.

---

## Trin 2 – Deploy som Static Web App

### Mulighed A: via GitHub (anbefales)

1. Læg projektmappen i et GitHub-repo (behold mappestrukturen ovenfor i roden).
2. I Azure-portalen: **Create resource → Static Web App**.
3. Udfyld:
   - **Plan type:** *Standard* anbefales til et driftsværktøj (SLA + Entra ID-sikring). *Free* kan bruges til test.
   - **Source:** GitHub → vælg organisation, repo og branch.
   - **Build presets:** *Custom*.
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** *(tom)*
4. Klik **Review + create**. Azure tilføjer automatisk en GitHub Actions-workflow til repoet, som bygger og deployer ved hver push til branchen.

Workflowen bygger API'et ved at køre `npm install` i `api/`-mappen, så `@azure/storage-blob` kommer med automatisk.

### Mulighed B: via SWA CLI

```bash
npm install -g @azure/static-web-apps-cli
cd api && npm install && cd ..
swa login
swa deploy --app-location . --api-location api --env production
```

---

## Trin 3 – Tilføj connection string som application setting

API'et læser Storage-forbindelsen fra en miljøvariabel. Den sættes på Static Web App'en (ikke på Storage-kontoen):

1. Gå til din **Static Web App → Settings → Environment variables** (tidligere "Configuration").
2. Tilføj:

| Navn | Værdi |
|------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | *(connection string fra Trin 1)* |
| `BLOB_CONTAINER` | `hypecycle` *(valgfri – default er allerede `hypecycle`)* |
| `BLOB_NAME` | `state.json` *(valgfri)* |

3. Gem. API'et genstarter automatisk og kan nu læse/skrive blob'en.

Åbn nu URL'en på din Static Web App. Forsiden viser hype cyclen; klik **Admin**, lås op, og ret en teknologi — genindlæs siden, og ændringen er der. Den ligger nu i Blob Storage.

---

## Sikring af admin / skrivning (vigtigt)

Som udgangspunkt er `POST /api/state` åben (`anonymous`), og admin-koden i `index.html` er **kun kosmetisk** — den skjuler redigeringsknapperne, men forhindrer ikke nogen i at sende et POST direkte. Til et internt kommunalt værktøj bør skrivning beskyttes med rigtig adgangsstyring via **Microsoft Entra ID**:

1. Tilføj en route-regel i `staticwebapp.config.json`, så **kun læsning er åben**, mens skrivning kræver login:

```json
"routes": [
  { "route": "/api/state", "methods": ["GET"], "allowedRoles": ["anonymous"] },
  { "route": "/api/state", "methods": ["POST"], "allowedRoles": ["authenticated"] },
  { "route": "/.auth/login/github", "statusCode": 404 }
]
```

2. Login sker via det indbyggede endpoint `/.auth/login/aad` (Entra ID). På *Standard*-planen kan du desuden begrænse til specifikke brugere/roller via SWA's rolle-invitationer eller en custom rolle-funktion.
3. Vil du gøre det helt stramt, kan admin-knappen i appen sende brugeren til `/.auth/login/aad` i stedet for kode-modalet, og admin-tilstand kun aktiveres, hvis `/.auth/me` returnerer en bruger med den rette rolle.

Sig til, hvis I vil have Entra ID-login bygget direkte ind i appen frem for kode-låsen — det er en mindre ændring.

---

## Lokal udvikling

```bash
# 1) Start en lokal blob-emulator (valgfrit, men nemmest)
npm install -g azurite
azurite --silent --location ./.azurite &

# 2) Klargør API'et
cd api
npm install
cp local.settings.json.example local.settings.json   # bruger UseDevelopmentStorage=true (Azurite)
cd ..

# 3) Start frontend + API samlet med SWA CLI
npm install -g @azure/static-web-apps-cli
swa start . --api-location api
```

Åbn herefter den URL, SWA CLI viser (typisk `http://localhost:4280`). Kald til `/api/state` proxies automatisk til den lokale Function.

> Vil du teste mod den rigtige sky-blob i stedet for Azurite, så sæt `AZURE_STORAGE_CONNECTION_STRING` i `local.settings.json` til den rigtige connection string.

---

## Tilpasning

- **Admin-kode:** Øverst i `<script>` i `index.html`:
  ```js
  const ADMIN_CODE = "vejle";
  ```
- **Udgangspunkt (seed-teknologier):** funktionen `seed()` i `index.html`.
- **Farver / fonte / horisontlinje:** alt ligger i `<style>`-blokken i `index.html` og følger Vejles designguide (K2D-font, paletfarver, horisontlinje som baggrund).
- **Logo:** indlejret som data-URI i headeren/footeren — skift `<img class="vk-logo" ...>` ud for at opdatere.

---

## Fejlfinding

| Symptom | Sandsynlig årsag |
|---------|------------------|
| `/api/state` giver 404 efter deploy | API'et er ikke deployet — tjek at **Api location** = `api`, og at GitHub Actions-buildet kørte uden fejl. |
| Gem fejler (POST 500, "config") | `AZURE_STORAGE_CONNECTION_STRING` mangler eller er forkert i Environment variables. |
| Forsiden er tom / falder tilbage til udgangspunkt | Endnu ingen gemt tilstand (GET 404 er forventet før første gem), eller forkert container/blob-navn. |
| Node-version afvises | Sæt en aktuelt understøttet version i `staticwebapp.config.json` → `platform.apiRuntime` (tjek Microsofts liste over understøttede runtimes; `node:22` er nyeste på skrivende tidspunkt). |
| Skrivning kan ske uden login | Forventet indtil route-reglerne under *Sikring* er tilføjet. |

---

## Bemærkninger

- SWA's managed functions understøtter kun HTTP-triggere — det er præcis, hvad dette API bruger.
- Free-planen er tænkt til test/hobby og har ingen SLA. Til drift vælges *Standard*.
- Hvis VM'en/miljøet ikke har internetadgang til Google Fonts, skal **K2D** pakkes med lokalt (læg font-filer i projektet og referér dem i CSS i stedet for `fonts.googleapis.com`).

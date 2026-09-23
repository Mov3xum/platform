# Incident 2026-09-21 — "Deploy to Coolify Staging" faller på Coolify-triggern

**Status:** workflow-delen åtgärdad i repot; infrastrukturdelen (Coolify-
instansen) måste åtgärdas på servern. Se "Åtgärd på servern" nedan.

## Tidslinje (UTC, från GitHub Actions-loggarna)

| Tid | Körning | Utfall |
| --- | --- | --- |
| 06:56 | #482 | ✅ `POST $COOLIFY_BASE_URL/api/v1/deploy?uuid=…` → 2xx. Sista gröna. |
| 07:57 | #483 | ❌ Samma anrop → **HTTP 500 `{"message":"Server Error"}`** från Coolify. |
| 09:14 | #484 | ❌ HTTP 500 igen. |
| 10:11 | #485 (manuell) | ❌ HTTP 500 igen. |
| 11:43–12:14 | #487–#490 | ❌ **Port 8000 svarar inte längre** (`curl: (7) Couldn't connect to server`, refused inom 100 ms). Fyra Copilot-PR:ar (#379–#382) ändrade workflowet under tiden. |

Ingen kodändring i repot mellan #482 och #483 rörde deploy-steget — det var
identiskt. Det som ändrades var Coolify-instansens hälsa.

## Root cause

**Coolify-instansen själv** (inte workflowet) gick sönder ~07:00–07:57:
först svarade den 500 på deploy-API:et (Coolify svarar så när dess egen
databas/redis eller deploy-kö inte fungerar — t.ex. mitt i en avbruten
auto-update eller vid full disk), och senare slutade den lyssna på port 8000
helt (containern nere, eller porten stängd/flyttad).

De fyra "fixarna" i workflowet under förmiddagen adresserade fel sak:

- De lade till en fallback som provar `https://<ip>` och `http://<ip>` när
  `:8000` inte svarar. Det kan **aldrig** fungera: på port 80/443 svarar
  Coolifys Traefik-proxy, som routar på hostnamn — en naken IP matchar ingen
  router → `404` på http och självsignerat default-cert på https (exakt vad
  loggen visar). Dessutom skickades Bearer-tokenen i klartext till en annan
  lyssnare vid varje försök.
- `sync-pocketbase*.yml` fick anropa `node .github/scripts/coolify-base-
  candidates.mjs` i ett jobb **utan `actions/checkout`** → skriptet fanns
  inte på runnern → "COOLIFY_BASE_URL är ogiltig". Sync-workflowsen var
  alltså trasiga oavsett Coolifys hälsa.
- Ingen av kopiorna skilde "Coolify är nere" (infrastruktur) från "fel
  UUID/URL" (konfiguration) — slutmeddelandet skyllde alltid på secrets.

## Påverkan

Inga staging-deployer sedan 06:56 (imagen byggs och pushas fortfarande till
GHCR, men Coolify pullar den inte förrän en deploy triggas). PocketBase-
bootstrap/verify-stegen kördes inte heller (de ligger efter triggern).
Produktion opåverkad (ingen push till `production`). Ingen data berörd.

## Åtgärd i repot (denna PR)

- **Ett delat, testat skript** `.github/scripts/coolify-deploy.sh` ersätter
  fyra divergerande inline-kopior (`deploy.yml`, `deploy-production.yml`,
  `sync-pocketbase.yml`, `sync-pocketbase-production.yml`).
- **Förkontroll** `GET /api/v1/version` innan deploy-anropet: skiljer
  "nere" / "500 internt" / "ogiltig token" / "fel UUID" och skriver en
  `::error::` med rätt felsökning för respektive fall.
- **Omförsök** (10/20/30/60/60 s, ~3 min) vid transportfel och 5xx/429, så en
  Coolify-omstart eller auto-update mitt i körningen inte fäller deployen.
- **Inga gissade origins.** Skriptet anropar bara `COOLIFY_BASE_URL`; tokenen
  lämnar aldrig den konfigurerade lyssnaren. `coolify-base-candidates.mjs`
  är borttagen.
- `actions/checkout` tillagd i sync-jobben.
- 13 tester mot en mock-Coolify (`coolify-deploy.test.mjs`, i `yarn test`)
  låser: lyckad deploy, legacy-fallback vid 404, omförsök vid 500, "nere"-
  diagnos vid refused, token-fel, tag-deploy, webhook-väg, varnings-läge,
  och att exakt de förväntade anropen (och inga andra) görs.

## Åtgärd på servern (kvarstår — kan inte göras från repot)

SSH:a in på UpCloud-hosten (`212.147.227.223`) och kör:

```bash
docker ps -a --filter name=coolify        # coolify, coolify-db, coolify-redis, coolify-proxy — alla "Up"?
docker logs coolify --tail 200            # kraschloop? avbruten uppdatering? "SQLSTATE"/"Connection refused" mot db/redis?
df -h && free -m                          # full disk / OOM är den vanligaste orsaken till 500 → container nere
ss -ltnp | grep -E ':8000|:80|:443'       # lyssnar något på 8000?
```

Vanliga utfall:

1. **Containern är stoppad/kraschad** → `docker start coolify` eller kör om
   Coolifys installskript (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`
   — det är idempotent och startar om stacken). Rensa disk först om `df -h`
   visar > 90 %.
2. **Coolify har fått en egen domän** (Settings → Instance's Domain) och
   port 8000 stängts → uppdatera GitHub-secreten `COOLIFY_BASE_URL` till
   `https://<domänen>`. Det är dessutom det rekommenderade läget: tokenen
   går då över TLS (CLAUDE.md § 10.3 A.8.24) — skriptet varnar så länge
   secreten är `http://`.
3. **UpCloud-brandväggen** blockerar 8000 → öppna porten för GitHubs
   runners, eller (bättre) gör punkt 2.

Verifiera sedan med "Run workflow" på *Deploy to Coolify Staging*: loggen ska
visa `✓ Coolify svarar (version: …)` följt av `✓ Coolify-deploy köad (staging)`.

## Lärdomar

- Ett transportfel mot en infrastrukturtjänst ska rapporteras som just det —
  inte maskeras med fler URL-gissningar. Gissningarna dolde grundorsaken i
  fyra PR:ar.
- Deploy-logik som kopieras i flera workflows driftar isär inom timmar; den
  ska bo i ett skript med tester (samma princip som `lib/core/write`).
- Ett jobb som kör repo-skript måste ha `actions/checkout`.

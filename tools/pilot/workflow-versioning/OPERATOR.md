# OPERATOR — pilot F-W19 (niezależne wersje workflow i bridge’a)

Dla koordynatora/operatora. **Nie wklejaj tego agentom.** Agenci dostają wyłącznie
`$RUN/START-ASTRA-p1.md`, `$RUN/START-ASTRA-p2.md` i krótkie prośby z kroków 6–8. Scenariusz i
budżet: [design.md](../../../docs/features/F-W19-workflow-versioning/design.md) (pilot W19-06),
decyzja 02/03. Kod pomocniczy: `pilot_w19.py` (setup, preflight, snapshot, checks, collect).

## Zasady (zawsze)

- Wyłącznie izolowane profile i katalogi z `$RUN/env.sh`: `CODEX_HOME`, `CLAUDE_CONFIG_DIR`,
  `CLAUDE_CODEX_BRIDGE_HOME`. Każde polecenie klienta tylko w powłoce po `source $RUN/env.sh`.
  Osobiste profile, ich cache, logowanie i konfiguracje pozostają nietknięte (P-ISO-02 to sprawdza).
- Logowanie wyłącznie wspieraną metodą subskrypcji **w izolowanym profilu**; nic nie kopiować z
  osobistych profili, żadnych nowych kluczy ani płatnego API.
- Budżet (decyzja 02): ≤ 6 rund Claude’a (jedna rezerwa), ≤ 64 tury i ≤ 75 min na rundę, MCP 90 min,
  część modelowa łącznie ≤ 180 min, ≤ 24 tury Astry. Stan: `pilot_w19.py collect --run $RUN`
  (`budget.used`). Przekroczenie albo realny impas = stop, checkpoint, bez zastępczej rundy.
- Jedna natywna sesja managera na projekt (po restarcie `astra.sh resume`, nigdy nowa) i ta sama
  sesja Claude’a w rundach featura; zastępcza sesja = FAIL (C06/S-*).
- Przerwanie/capacity: `snapshot interrupted-<n>`, wznowienie istniejących sesji, bez resetu stanu.
- `$RUN` jest prywatny i poza Git. Jedyny wynik do udostępnienia: `--public` z kroku 9 (ścieżki
  względne, skróty natywnych ID, bez treści transkryptów); koordynator decyduje, co trafia do
  `evidence/W19-06/`.

## 0. Przygotowanie (bez modeli)

```bash
export BRIDGE=/ścieżka/do/checkoutu/F-W19            # kandydat, czysty i zbudowany
export WV=$BRIDGE/tools/pilot/workflow-versioning
export RUN=$HOME/tmp/w19-pilot-1                       # nowy katalog poza checkoutem, każde podejście osobno
cd $BRIDGE && npm ci --ignore-scripts && npm run build
sudo -v                                                # PILOT-HOST-01, tylko gdy host ukrywa procesy
CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo python3 $WV/pilot_w19.py setup --dest $RUN
source $RUN/env.sh
python3 $WV/pilot_w19.py preflight --run $RUN          # oczekiwane: wszystko PASS poza PILOT-AUTH PENDING
```

`setup` tworzy: wydania workflow A (0.0.0-pilot.a), B (0.0.0-pilot.b) i niekompatybilne C (0.0.0-pilot.c) z generatora
produktu, lokalny marketplace (`main` = A, gałąź `release-b` = B; paczki bridge’a identyczne),
starszą osobistą kopię wykonawcy (`personal-market`, 0.9.0), dwa syntetyczne projekty z tym samym
przypiętym kandydatem silnika (`bridge-plugin.mjs setup`, jednorazowa instalacja w izolowanym
bridge-home) oraz rozkazy startowe. `ACTIVE_USE_UNKNOWN` przy setupie to prawidłowa odmowa produktu
na hoście z ograniczonym `/proc` — `sudo -v`, ten sam `CLAUDE_CODEX_BRIDGE_PROCESS_INSPECTION=sudo`
w środowisku managera (eksportuj go przed `astra.sh`) i nowy `--dest`; niczego nie obchodzić.

## 1. Logowanie izolowanych profili (PILOT-AUTH-01/02)

```bash
source $RUN/env.sh
claude auth login --claudeai            # albo: claude setup-token (token tylko w env procesu, poza Git)
codex login                             # albo: codex login --device-auth
```

## 2. Instalacja wejść prawdziwymi poleceniami klientów (stan: starszy osobisty plugin wykonawcy)

```bash
codex plugin marketplace add $RUN/market
codex plugin add bridge-codex@claude-codex-bridge
codex plugin add feature-workflow@claude-codex-bridge         # wydanie A
claude plugin marketplace add $RUN/personal-market
claude plugin install feature-workflow@personal                # starsza osobista kopia 0.9.0
python3 $WV/pilot_w19.py preflight --run $RUN --clients        # oczekiwane: PREFLIGHT OK
python3 $WV/pilot_w19.py snapshot started --run $RUN
```

`--clients` czyta bez modelu: status logowania obu profili (ścieżka konfiguracji musi być w `$RUN`),
efektywną definicję `bridge` w Codexie z przekazaniem `CLAUDE_CONFIG_DIR` (PILOT-ENV-01) i
zainstalowane wejścia. Brak `PREFLIGHT OK` = stop przed płatnym krokiem.

## 3. Faza 1 — p1 na wydaniu A (runda 1)

```bash
PILOT_REPO=$RUN/projects/p1 $BRIDGE/tools/pilot/common/astra.sh check   # bridge widoczny, bez modelu
PILOT_REPO=$RUN/projects/p1 $BRIDGE/tools/pilot/common/astra.sh start
```

W TUI: `/mcp` (serwer `bridge`), potem cała treść `$RUN/START-ASTRA-p1.md`. Po końcu tury:
`python3 $WV/pilot_w19.py snapshot phase1-done --run $RUN`.

## 4. Publikacja B (bez modelu)

```bash
git -C $RUN/market checkout -q release-b
codex plugin add feature-workflow@claude-codex-bridge          # aktualizacja wejścia managera do 0.0.0-pilot.b
python3 $WV/pilot_w19.py snapshot updated-b --run $RUN
```

## 5. Usunięcie cache’u A i osobistej kopii wykonawcy, restart managera

Zakończ TUI p1 po normalnym końcu tury (`/exit`), potem:

```bash
rm -rf "$CODEX_HOME/plugins/cache/claude-codex-bridge/feature-workflow/0.0.0-pilot.a"   # jeśli jeszcze istnieje
claude plugin uninstall feature-workflow@personal                               # stan: osobistego pluginu brak
python3 $WV/pilot_w19.py snapshot cache-removed --run $RUN
PILOT_REPO=$RUN/projects/p1 $BRIDGE/tools/pilot/common/astra.sh resume           # ta sama sesja
```

## 6. Faza 2 — p1: stary feature zostaje na A, nowy wybiera B (rundy 2 i 3)

Prośby w TUI p1 (każda osobno, po końcu poprzedniej tury):

1. `Continue F-001-reset with exactly one more Claude round: add a test that reset() after several increment() calls returns 0. Stop after the round and report the workflow version and identity you follow.`
2. `Start a new feature F-002-peek: add Counter.peek(), which returns the value without changing it, with a unit test. The brief is agreed and I approve its execution gate; run exactly one Claude round, then stop and report its workflow version and identity.`

Po każdej turze `snapshot phase2-<n>`.

## 7. p2 — nowy feature po aktualizacji (runda 4)

```bash
PILOT_REPO=$RUN/projects/p2 $BRIDGE/tools/pilot/common/astra.sh start
```

W TUI: `/mcp`, treść `$RUN/START-ASTRA-p2.md`. Po turze `snapshot p2-done`.

## 8. Jawny switch A→B w tej samej sesji (runda 5)

W TUI p1:

`Switch F-001-reset explicitly to the installed workflow release 0.0.0-pilot.b through the bridge, as the workflow describes; then run exactly one more Claude round of F-001-reset in the same feature session: document reset() in the README. Stop after the round and report the workflow version, identity and generation.`

Po turze `snapshot switched`. Runda 6 to wyłącznie rezerwa na zwykłą poprawkę narzędzia/testu.

## 9. Kontrole bez modeli, aktualizacja w Claudzie i zebranie dowodów

```bash
python3 $WV/pilot_w19.py checks --run $RUN --feature-project p1 --feature F-001-reset
git -C $RUN/market checkout -q main
claude plugin marketplace add $RUN/market
claude plugin install feature-workflow@claude-codex-bridge     # 0.0.0-pilot.a
git -C $RUN/market checkout -q release-b
claude plugin marketplace update claude-codex-bridge
claude plugin update feature-workflow@claude-codex-bridge      # 0.0.0-pilot.b
python3 $WV/pilot_w19.py snapshot claude-updated --run $RUN
python3 $WV/pilot_w19.py collect --run $RUN --public $RUN/operator-results/public-result.json
```

`checks`: C (niekompatybilne) odrzucone przez `resolve` i `begin` bez zapisu; brak kopii w magazynie
wykryty i odtworzony dokładnie z paczki tej tożsamości, bez sieci; standalone bez pina i MCP.

## Co mierzy collector

Każdy przypadek wymaga zgodności trzech warstw: **configured** (lock i binding), **admitted**
(`attempt_workflow` każdej próby) i **followed** — znacznik wydania, który agent zapisał sam, a który
występuje wyłącznie w tekście tego wydania. Sama deklaracja manifestu ani fixture nie daje PASS.
Brak warunku wstępnego = `NOT_TESTED`, sprzeczność = `FAIL`; całość jest `NOT_TESTED`, dopóki choć
jeden przypadek nie został przeprowadzony.

| Przypadek | AC | Dowód |
| --- | --- | --- |
| C01 | AC-01 | B zainstalowane i zaktualizowane poleceniami obu klientów; ten sam pin silnika; paczki bridge’a bez zmian |
| C02 | AC-02 | Feature rozpoczęty po aktualizacji w p1 i p2: lock B, próby B, znaczniki B |
| C03 | AC-03 | F-001-reset po usunięciu cache’u i restarcie: próby A, znaczniki A |
| C04 | AC-04 | Znaczniki managera i Claude’a = wydanie wybrane w danym momencie; osobista kopia wykonawcy starsza i nieobecna |
| C05 / C08 / C10 | AC-05 / 08 / 10 | `checks`: niekompatybilność, dokładne odtworzenie offline, standalone |
| C06 | AC-06 | Switch: generacja +1, próby po nim B, jedna sesja Claude’a i jeden wątek managera |
| S-p1 / S-p2 | AC-04/06 | Jedna natywna sesja managera na projekt |

AC-07 i AC-09 mają dowody bez modeli (testy produktu, doctor/status); pilot ich nie zastępuje.

# Wave12 — raport wykonania

Status: WYKONANE LOKALNIE; REWORK W12-R1 z [review koordynatora](wave12-review.md) poprawiony
w `cb6cf1a` i zamknięty w `e087245`; smoke AC-08 z prawdziwym Codex TUI, Astrą i Claude'em
wykonany za zgodą użytkownika — PASS. Oczekuje odbioru użytkownika. Data: 2026-09-15.
Branch `wave12` (worktree Herdr), baza `95f9ea1`. Plan: [wave12.md](wave12.md),
postęp: [wave12-progress.md](wave12-progress.md). Bez push, merge, publikacji pakietu
i wdrożenia do rzeczywistych projektów. Modele wyłącznie w autoryzowanym smoke.

## Dostarczone

| Commit | Zakres |
| --- | --- |
| `e8dc4cc` | Wspólny układ konfiguracji, manifestu i danych dla wave13: [setup-layout.md](../setup-layout.md) |
| `e1126a2` | `scripts/bridge.mjs` i `scripts/setup/`: `install`, `runtimes`, `init`, `update`, `rollback`, `doctor`; 8 testów bez modeli |
| `85eb47f` | `.codex/config.toml` repo = blok zarządzany, `.mcp.json` → `.bridge-runtime/current`, `.gitignore` |
| `7bceb04` | Instrukcja użytkownika [setup.md](../setup.md), README, installation, fork-setup, troubleshooting, CHANGELOG |
| `cb6cf1a` | W12-R1: odmowa `PATH_REDIRECTED` przed zapisem przez symlink w zarządzanej ścieżce; regresja z prawdziwymi symlinkami |

Dystrybucja: `git archive` wskazanego commita z lokalnego klonu, `npm ci --ignore-scripts`
i `npm run build` w nowym katalogu `<home>/runtimes/<wersja>-<12 hex commita>`, potem tylko do
odczytu, z manifestem (commit, format instalacji, wersja, zgodność schematu i adaptera,
zestaw instrukcji, skrót drzewa). Bez rejestru npm i bez wrappera. Wybór wersji jest lokalny
dla worktree (`.bridge-runtime/current` + `install.json`); blok MCP w `.codex/config.toml`
nie zawiera ścieżek użytkownika.

## Walidacja bez modeli

- `npm ci --ignore-scripts`, `npm run build` — OK; `npm test` — 32 pliki, 434 testy OK
  po `cb6cf1a` (w tym 9 testów setup, ~20 s); `python3 -m unittest discover -s tests` — 29 OK;
  `python3 -m unittest discover -s tools/pilot/tests` — 140 OK; kontrola linków dokumentacji OK.
  Lokalnie Node 24.15.0, Python 3.12.3, Codex 0.154.0, Claude Code 2.1.272.
- Świeży klon brancha `wave12` przy `7bceb04`, poza repo: `install` 3,7 s; `init` samego klonu
  bridge planuje wyłącznie `.bridge-runtime/current` (drzewo klonu pozostaje czyste); `init`
  projektu z dwoma worktree w układzie Herdr; `doctor` z prawdziwym Codex 0.154 i izolowanym
  `CODEX_HOME` z zaufaniem w pliku: `ok`, 19/20 kontroli OK, jedynie `CODEX_LOGIN_MISSING`
  (izolowany home); bez zaufania `CODEX_PROJECT_UNTRUSTED`; pliki worktree bez zmian.
- Prawdziwy `codex app-server` 0.154 w tym worktree (`initialize`, `thread/start` z `cwd`
  i `ephemeral`, `mcpServerStatus/list`; bez `turn/start`): serwer `bridge` z 35 narzędziami
  (6 `bridge_feature_*`) uruchomiony jako `.bridge-runtime/current/scripts/native-bridge-mcp.mjs`
  z cwd = worktree; `.bridge/` nie powstało; po zamknięciu brak procesów. `thread/start`
  z nadpisaniem workera `mcp_servers.bridge.enabled=false` działa mimo `required = true`.
- Aktywne runtime innych sesji (wave7 na osobnym przypiętym runtime, sesja w głównym checkout)
  tylko odczytane w `/proc`; nie przebudowano ani nie przełączono żadnego z nich.
- W12-R1, scenariusz koordynatora z tym samym zainstalowanym runtime (projekt z `.agents` jako
  symlinkiem do zewnętrznego katalogu): `0741ae9` — `init` zastosowany, 14 plików w katalogu
  zewnętrznym; `cb6cf1a` — odmowa `PATH_REDIRECTED`, 0 plików, projekt bez `.bridge-runtime/`.
- `node scripts/certification-manifest.mjs` — FAIL, identycznie na bazowym `e8dc4cc`
  (historyczny manifest upstream nie obejmuje plików forka). Nie należy do walidacji z AGENTS;
  bez zmian w tej fali.

## Pokrycie kryteriów

| ID | Wynik | Dowody | Ograniczenia |
| --- | --- | --- | --- |
| AC-01 | PASS | Test: repo syntetyczne z bieżących plików → `git clone --no-local` → dwie instalacje z manifestem; ręcznie: klon `wave12`@`7bceb04` → `install` → start MCP. | `npm ci` wymaga rejestru npm lub cache. Źródłem jest lokalny klon; dla URL najpierw `git clone`. |
| AC-02 | PASS | Test „existing project”: plan bez `--yes` nic nie zapisuje, `--yes` dodaje skille obu ról, blok MCP, `.gitignore` i wybór; drugi `init` bez zmian (migawka z inode i mtime); doctor z handshake OK. Codex wykrywa `.agents/skills` i `.codex/skills`, Claude `.claude/skills`. | Walidacja TOML przez `python3` ≥ 3.11; bez niego tylko notatka. |
| AC-03 | PASS | Test „conflicts”: `INSTRUCTION_MODIFIED` bez zapisu, `--keep-local`, obca definicja i tabela inline → `CODEX_CONFIG_CONFLICT` bez zapisu, skopiowany rekord → `SETUP_RECORD_FOREIGN`. Test „interrupted”: SIGKILL po 3 zapisach → `pending.json`, doctor `SETUP_INTERRUPTED`, ponowny `init` kończy zmianę, bez plików tymczasowych i kopii, pliki użytkownika zachowane. Test „symlinks” (od `cb6cf1a`, po W12-R1): symlink `.agents` i `.bridge-runtime/backup` przy `init`, katalogu skilla przy `update`, `install.json` przy `rollback` → `PATH_REDIRECTED`; katalogi zewnętrzne bez zmian. | Skan TOML jest konserwatywny: np. wieloliniowy string może dać fałszywy konflikt (nigdy cichy zapis). Symlink w zarządzanej ścieżce jest odrzucany także wtedy, gdy wskazuje wnętrze worktree. |
| AC-04 | PASS | Test „two external worktrees”: ścieżki ze spacjami poza repo, stan związany w obu; `update` A nie zmienia migawki B (pliki, wybór, `.bridge`); różne przestrzenie wymiany; doctor na obu bez błędów i bez zmiany stanu. Ręcznie: dwa worktree świeżego klonu. Od `cb6cf1a` symlink nie przeniesie zapisu `init` A do katalogu współdzielonego z B. | Nowy worktree wymaga jednego `init`. |
| AC-05 | PASS | Runtime tylko do odczytu; instalacja B nie zmienia migawki A; ponowna instalacja = no-op. Test „in use”: prawdziwy launcher → `ACTIVE_SESSION` z pid, wybór bez zmian; po normalnym zamknięciu `update` przechodzi. Nic nie jest zabijane. | Aktywne użycie z `/proc` dla procesów bieżącego użytkownika; w sandboxie Codexa odpowiedź nieznana i `update` odmawia. |
| AC-06 | PASS | Test „rollback”: stan związany, `update` → `rollback`, `.bridge` identyczne (poza technicznymi `-wal`/`-shm`), historia i instrukcje A przywrócone. Schemat 99 → `update` i `rollback` odrzucone `STATE_SCHEMA_NEWER` bez zapisu; `CODEX_VERSION_UNSUPPORTED` odrzucony. | Zgodność = schemat SQLite i adaptery z manifestu; runtime bez tych eksportów → `RUNTIME_COMPATIBILITY_UNKNOWN`. Brak cofania migracji. |
| AC-07 | PASS | Test „diagnoses”: brak i niekompletny runtime, nieobsługiwany host, brak zaufania, zepsuty wybór, obcy stan, brak `init`, podkatalog, `ACCESS_DENIED`, `SANDBOX_RESTRICTED`; tekst i JSON `claude-codex-bridge.doctor/v1`; prawdziwy handshake bez claimu, migawki przed/po. Ręcznie: doctor z prawdziwym Codex. | Sandbox rozpoznawany po `CODEX_SANDBOX*`; `codex mcp get` może zapisać własny cache Codexa; sesja Claude’a sprawdzana tylko przez `claude auth status`. |
| AC-08 | PASS | [Smoke z 2026-09-15](#smoke-ac-08-z-modelami--wykonany-2026-09-15): nowy projekt, `init` z przypiętego runtime `e087245`, interaktywny zsh i zwykłe `codex` (funkcja użytkownika dodaje tylko `--profile`), bez `-c` i wrappera. Po akceptacji zaufania Codex uruchomił `.bridge-runtime/current/scripts/native-bridge-mcp.mjs` z cwd = projekt; `/mcp`: `bridge: connected (35 tools)`. Astra przeprowadziła feature przez bridge: jedna runda Claude'a `DONE`, commity wykonawcy, zweryfikowana paczka, review PASS, akceptacja syntetyczna. Po `/quit` instancja `detached`, doctor `ok` 20/20. Wcześniej bez modelu: `codex mcp get`, `app-server thread/start`. | Jeden host i trywialny feature. TUI prowadził operator przez PTY (tmux), nie użytkownik z klawiatury. Sandbox Codexa nie działa na tym hoście (AppArmor blokuje przestrzenie nazw), więc polecenia Astry szły przez automatyczne review eskalacji — niezależnie od bridge'a. Restart Astry i ścieżka poprawek poza zakresem. |
| AC-09 | PASS | [setup.md](../setup.md): instalacja, nowy worktree, update, rollback, doctor i kody, ograniczenia hosta, rozwój bridge; [setup-layout.md](../setup-layout.md): wspólny układ z wave13. | — |

## Decyzje i zmiany zachowania

- Jedna dystrybucja z lokalnego klonu; bez npm publish i artefaktów release.
- Bez wrappera: Codex liczy względną ścieżkę od własnego katalogu, więc start w korzeniu
  worktree (launcher i tak odrzuca podkatalog).
- **Breaking dla checkoutów bridge:** po merge każdy worktree bridge, także główny checkout,
  wymaga `node scripts/bridge.mjs init` przed startem klienta; blok ma `required = true`.
  Aktywnej sesji w głównym checkout nie przełączać w trakcie pracy.
- `.mcp.json` Claude’a jako managera w projektach zewnętrznych nie jest zarządzany.
- `init` bez `--runtime` wybiera: bieżący wybór, runtime, z którego działa CLI, albo runtime
  commita HEAD klonu; nigdy „najnowszy”.

## Znaleziska zastane (poza zakresem wave12)

1. Restart po zamknięciu serwera (skorygowane po W12-N1). Wcześniejsze stwierdzenie, że
   `IdentityRuntime` nie ma `detach`, było błędne: metoda istnieje w źródle i w `dist`
   (`typeof IdentityRuntime.prototype.detach === "function"`). Błędny wynik dało wyszukiwanie
   przez funkcję powłoki `grep`, która pominęła plik.
   - **Obserwacja** — launcher z builda worktree przy `1f8ceb0` (źródła runtime identyczne
     z `95f9ea1`), syntetyczne `_meta` Codex 0.154.0, bez modeli. Po pierwszym wywołaniu
     mutującym zamknięcie stdin kończy proces kodem 0 bez komunikatu o zamykaniu; powiązanie
     zostaje aktywne (generacja 1), a nowy proces tego samego wątku dostaje
     `MANAGER_INSTANCE_FENCED`. Po SIGTERM proces loguje „SIGTERM, shutting down”, instancja
     zostaje odłączona (generacja 2), a nowy proces tego samego wątku jest przyjęty.
   - **Hipoteza, niepotwierdzona:** przy EOF na stdin proces kończy się, zanim uporządkowane
     zamykanie dojdzie do `detach()`. Nie ustalono, jak prawdziwy Codex zamyka serwer.
   - Runtime nie był zmieniany. Ewentualne osobne zadanie powinno zacząć od tego reproduktora
     (obie drogi zamknięcia) i od zamknięcia przez prawdziwy klient. Po
     `MANAGER_INSTANCE_FENCED` dostępna jest `bridge_manager_resume_instance`. Doctor nie
     zapisuje stanu (migawki w testach).
   - **Prawdziwy klient (smoke AC-08, runtime `e087245`):** `/quit` w Codex 0.154 TUI zakończył
     launcher, a instancja została zapisana jako `detached` (generacja 2, w doctorze
     `active_instance: false`). Objaw z syntetycznego zamknięcia stdin nie wystąpił na tej drodze.
     Restartu tego wątku nie próbowano; przyczyna obserwacji syntetycznej pozostaje niepotwierdzona.
2. `certification-manifest.mjs` nie przechodzi już na bazie (patrz walidacja).

## Smoke AC-08 z modelami — wykonany 2026-09-15

Zgoda użytkownika z 21:52: jedna Astra w bieżącym profilu, jedna runda Claude'a (deadline do
30 min, `max_turns` 32), przebieg z modelami do 45 min, wpis zaufania tylko dla projektu smoke.
Nie powtarza pilota wave10 ani REWORK. Dowody lokalnie, poza Git:
`~/tmp/wave12-smoke-20260915/` (`evidence/`, `logs/`, zrzuty ekranu), rollouty Codexa
z 2026-09-15 i przestrzeń wymiany `ws_db4c662348c78b0b`.

**Przygotowanie bez modeli.**

- Runtime `0.2.0-e08724567c80` = `e087245` w osobnym `--home`, `tree_sha256` `3e015a1b…`.
- Nowe repo `project` (AGENTS.md, CLAUDE.md, README; commit `5c7662e`). `init` bez `--yes`
  planuje 30 zmian; z `--yes` zastosowany; ponowny `init`: 0 zmian. Pliki setupu zatwierdzone
  w projekcie commitem `53d47bb`.
- `codex debug prompt-input` (bez modelu) pokazuje AGENTS.md, `using-bridge` i sześć skilli
  `feature-*`. Doctor przed zaufaniem: jedyny błąd `CODEX_PROJECT_UNTRUSTED`.

**S1 — start zwykłym `codex`.** Interaktywny zsh w PTY (tmux na osobnym gnieździe; środowisko
bez zmiennych `CLAUDE*`/`HERDR*` sesji operatora), `codex` w katalogu projektu. Funkcja powłoki
użytkownika uruchomiła `codex --profile profile-ubuntu`; bez `-c`, app-servera i atrapy.
TUI pokazał prompt zaufania; po akceptacji Codex dopisał wyłącznie
`[projects."…/project"] trust_level = "trusted"` do `~/.codex/profile-ubuntu.config.toml`
(`config.toml` bez zmian). Launcher `node .bridge-runtime/current/scripts/native-bridge-mcp.mjs
--caller codex --delegation allow --workspace .` wystartował jako proces potomny Codexa z cwd =
projekt; `/mcp`: `bridge: connected (35 tools)`. `.bridge/` nie istniało do pierwszego wywołania
mutującego. Jedyne ostrzeżenie startowe dotyczyło sandboxa Codexa (ograniczenia niżej).

**S2 — Astra i Claude.** Jedno zlecenie o 22:02:23: wklejenie i jeden Enter, przyjęcie
potwierdzone na ekranie i w rolloucie, bez ponowienia. Tura zakończona raportem o 22:08:32.

- Astra: `bridge_server_info` (`codex`/`allow`), root, `bridge_feature_create`, zgoda i brief
  (commit `7e4cd81`), `bridge_feature_run` z `deadline_ms` 1 500 000 i `max_turns` 32,
  `bridge_get_task`, review, `bridge_feature_accept`, `bridge_submit_deliverable` (root `DONE`).
  Pierwsze wywołanie mutujące związało worktree: epoka 1, adapter `codex-0.154.0`,
  `turn-metadata`.
- Claude: jedna próba 22:04:50–22:06:18 (88,4 s), `completed`, kod wyjścia 0, 14 tur,
  `claude-opus-5` (wybór runtime `opus`/`high`), 444 417 tokenów, w tym 392 955 z cache; koszt
  raportowany przez runtime 0,81 USD, tryb rozliczenia nieznany runtime. Proces potomny launchera
  smoke z `--max-turns 32`, `acceptEdits` i Read/Edit/Write/Bash. Commity: `3c89e0d`
  (`calc.py`, `test_calc.py`) i `8a7c64d` (ledger). Paczka `F-001-add-round-1.zip`,
  SHA-256 `978565d7…`.
- Review Astry (`reviews/01-implementation.md`, commit `97e313a`): rzeczywisty diff, zakres
  commitów, testy 4/4 i `verify` paczki — PASS. Decyzja `decisions/02.md`: „akceptacja
  syntetyczna w teście smoke wave12, nie jest odbiorem użytkownika”; feature `accepted`.
- Kontrola operatora tylko do odczytu: 4 testy OK, SHA-256 paczki zgodny, `verify` dla
  `7e4cd81..8a7c64d` z kodem 0 (`code_range_matches_repository`, 3 zmiany kodu; `feature.json`
  różni się od paczki, bo Astra zaktualizowała go po rundzie), drzewo czyste.
- Codex: 17 wywołań narzędzi w trybie code mode, 7 prośb o eskalację, 21 ocen automatycznego
  review, wszystkie `allow`; bez ręcznych zatwierdzeń i bez interwencji operatora. Tokeny sesji
  Astry: 58 261 (51 530 wejścia + 797 568 z cache, 6 731 wyjścia).

**S3 — zamknięcie.** `/quit` o 22:09:03; launcher zakończył się, instancja zapisana jako
`detached` (22:09:04); nie zostały procesy Codexa, launchera ani workera; powłokę zamknięto
przez `exit`. Doctor po zamknięciu: `ok`, 20/20; stan związany, epoka 1,
`active_instance: false`, schemat 5; bez `ACTIVE_SESSION`. Runtime bez zmian (0 plików nowszych
niż manifest, lista runtime identyczna). Czas z modelami: około 6 min 41 s od zlecenia do
zamknięcia. Bez recovery, ponowień i dodatkowych rund; `MANAGER_*` nie wystąpiło.

**Wynik: PASS dla AC-08.** Ograniczenia:

- jeden host, Codex 0.154.0, Claude Code 2.1.272 i jeden trywialny feature; ścieżek poprawek,
  pytań i restartu nie sprawdzano;
- TUI prowadził operator przez PTY (wklejenie i klawisze), nie użytkownik z klawiatury;
  decyzje, review i akceptację wykonały modele;
- na tym hoście `kernel.apparmor_restrict_unprivileged_userns = 1` blokuje bubblewrap: sandbox
  Codexa nie działa (ostrzeżenie „1 startup issue”), a polecenia Astry przechodziły przez
  automatyczne review eskalacji; to cecha hosta, niezależna od setupu;
- akceptacja featura jest syntetyczna i nie jest odbiorem wave12 przez użytkownika.

Do odbioru nic nie usunięto. Potem można usunąć `~/tmp/wave12-smoke-20260915/`,
`~/tmp/bridge-exchange/ws_db4c662348c78b0b/` i wpis zaufania projektu smoke w
`~/.codex/profile-ubuntu.config.toml`.

## Punkt wznowienia

Branch `wave12`, worktree czysty po commicie raportu smoke. Review W12-R1 zamknięte w `e087245`,
AC-08 PASS po smoke. Następny krok: odbiór wave12 przez użytkownika i decyzja o merge do
`feature-workflow`; po odbiorze sprzątanie dowodów smoke. Znalezisko 1 tylko z reproduktorem.
Po merge: `init` w każdym worktree bridge przed startem klienta.

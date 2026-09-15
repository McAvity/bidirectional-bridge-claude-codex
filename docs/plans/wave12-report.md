# Wave12 — raport wykonania

Status: WYKONANE LOKALNIE; REWORK W12-R1 z [review koordynatora](wave12-review.md) poprawiony
w `cb6cf1a`, oczekuje ukierunkowanego review. Data: 2026-09-15.
Branch `wave12` (worktree Herdr), baza `95f9ea1`. Plan: [wave12.md](wave12.md),
postęp: [wave12-progress.md](wave12-progress.md). Bez push, merge, publikacji pakietu,
wdrożenia do rzeczywistych projektów i bez wywołań modeli.

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
| AC-08 | CZĘŚCIOWO | Konfiguracja i start MCP przez prawdziwy Codex 0.154 bez modelu (`codex mcp get`, `app-server thread/start`) z zwykłego bloku projektu; wrapper niepotrzebny. | Literalny start TUI niezweryfikowany: w izolowanym `CODEX_HOME` bez logowania TUI nie otworzył sesji; prawdziwego profilu i zaufania użytkownika nie zmieniano. Do potwierdzenia w smoke S1. Rzeczywista delegacja nie jest tu dowodzona. |
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
2. `certification-manifest.mjs` nie przechodzi już na bazie (patrz walidacja).

## Przygotowany smoke z modelami — do zatwierdzenia, nieuruchomiony

Cel: potwierdzić AC-08 S1 (zwykłe `codex` TUI) i jedną rzeczywistą delegację w worktree
przygotowanym wyłącznie przez `bridge.mjs`. Nie powtarza pilota wave10 ani REWORK.

Przygotowanie operatora (bez modeli):

1. `node scripts/bridge.mjs install --ref <zaakceptowany commit>`.
2. Jednorazowy projekt poza repo, np. `~/tmp/wave12-smoke/project`: `calc.py` z
   `def add(a, b): raise NotImplementedError`, `test_calc.py` (unittest), commit;
   `git worktree add ~/tmp/wave12-smoke/worktrees/smoke-a -b smoke-a`.
3. `node <runtime>/scripts/bridge.mjs init --workspace <worktree> --yes`, potem `doctor`;
   oczekiwany jedyny błąd przed zaufaniem: `CODEX_PROJECT_UNTRUSTED`.

Przebieg:

- **S1.** `cd <worktree> && codex` przez zwykłą funkcję i profil użytkownika; zaakceptować
  zaufanie projektu (zapis w konfiguracji Codexa wykonuje użytkownik). `/mcp` albo `ps`
  pokazuje launcher `.bridge-runtime/current/scripts/native-bridge-mcp.mjs`.
- **S2.** Jedno zlecenie dla Astry: „Użyj $using-bridge. Utwórz feature F-SMOKE
  (`bridge_feature_create`) i uruchom jedną rundę `bridge_feature_run`: zaimplementuj
  `add(a, b)` w `calc.py` i uruchom `python3 -m unittest`; `deadline_ms` 600000,
  `max_turns` 12. Zweryfikuj wynik i testy (review techniczne Astry); przy PASS wywołaj `bridge_feature_accept`
  jako syntetyczną akceptację testu smoke, nie odbiór użytkownika.
  Bez recovery, ponowień i kolejnych rund; potem zatrzymaj się.”
- **S3.** Zamknąć Codex normalnie; `doctor --workspace <worktree> --json`.

Budżet: Astra do 4 tur w bieżącym profilu (bez zmiany modelu i effort); Claude 1 runda,
`max_turns` 12, deadline 10 min; całość do 30 min; 0 ponowień, 0 recovery, 0 dodatkowych rund;
istniejąca subskrypcja (do potwierdzenia przy zgodzie).

PASS: S1 bridge dostępny bez flag i wrappera; S2 pierwsze wywołanie mutujące wiąże worktree
(epoka 1), runda DONE z realną przechodzącą weryfikacją, commit wykonawcy w worktree,
akceptacja oznaczona jako syntetyczna; S3 doctor bez błędów, stan związany, brak `ACTIVE_SESSION`, runtime
i inne katalogi bez zmian.

Stop bez naprawy w trakcie: brak MCP przy starcie, `MANAGER_*` lub `NATIVE_CONTEXT_INVALID`,
runda FAILED/BLOCKED, przekroczenie budżetu. Zebrać doctor JSON i wynik `bridge_feature_get`.
Poza zakresem smoke: restart Astry (znalezisko 1), drugi worktree (pokryty bez modeli).
Sprzątanie: usunąć projekt i worktree smoke; ewentualny wpis zaufania usuwa użytkownik.

## Punkt wznowienia

Branch `wave12`, worktree czysty po commicie odpowiedzi na review. Następny krok:
ukierunkowane review poprawki W12-R1, regresji i korekty raportu (`git diff 1f8ceb0..wave12`);
potem decyzja o odbiorze i o smoke z budżetem powyżej. Znalezisko 1 tylko z reproduktorem. Po merge: `init` w każdym worktree bridge przed startem klienta.

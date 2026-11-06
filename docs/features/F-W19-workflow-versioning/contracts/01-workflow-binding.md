# Kontrakt W19-01 — wydanie, wybór, powiązanie i zmiana workflow

Status: proponowany kontrakt W19-01 do lokalnego niezależnego review, 2026-11-06.
Authority: [decyzja03](../decisions/03.md) (zakres i budżet [decyzji02](../decisions/02.md)).
Wejście: [brief](../brief.md) SHA-256 `3856ac25d1c0f754846fefb6a88cc61e67e0ac3fe8b34a01d8a15ae898d6ee31`,
[design](../design.md), [review01](../reviews/01-plan.md). Baza kodu `914c018` (feature-workflow,
po wydaniu 0.7.0 z F-W20). Nic z tego kontraktu nie jest jeszcze zaimplementowane w produkcie.

Wykonywalna semantyka: [contract_model.py](../../../../tools/pilot/workflow-versioning/contract_model.py),
przykłady: [fixtures/](../../../../tools/pilot/workflow-versioning/fixtures/), próby klientów:
[probe_clients.py](../../../../tools/pilot/workflow-versioning/probe_clients.py) i
[evidence/W19-01/clients.json](../evidence/W19-01/clients.json). Implementacje W19-02…05 (Node/TS)
mają dawać te same tożsamości, werdykty i kody dla tych samych wejść (§ 12). Model referencyjny
nie jest produktem.

## 1. Słownik i stan wyjściowy

| Pojęcie | Znaczenie |
| --- | --- |
| silnik / runtime | Pakiet bridge’a: MCP, stan, delegacja, setup/upgrade, `using-bridge`. Wersja z `package.json`, pin `scripts/plugin-packages/release.json`. |
| workflow | Siedem `feature-*`, wspólny guide, ich referencje i helpery. Własna wersja i wydania. |
| bundle | Niezmienny, kompletny zestaw jednego wydania workflow: manifest + oba warianty klientowe (§ 3.1). |
| identity | `sha256:<64 hex>` treści bundle’a (§ 2.2). Jedyny dowód „tego samego workflow”. |
| workflow_id | `<version>-<12 hex identity>`: nazwa katalogu w magazynie; zawsze weryfikowana względem identity. |
| magazyn | `<bridge-home>/workflows/<workflow_id>/`; `bridge-home` jak dziś (`CLAUDE_CODEX_BRIDGE_HOME`, inaczej `$XDG_DATA_HOME|~/.local/share` + `/claude-codex-bridge`). |
| lock | `docs/features/<feature>/workflow.lock.json`: przenośny rejestr wyboru (§ 4.3). |
| binding | `FeatureRecord.workflow` w bazie bridge’a: operacyjne źródło wyboru dla rund (§ 6). |
| generation | Licznik wyborów featura: 1 przy begin/bind, +1 przy każdym switch. |
| wejście (entry) | Skill pluginu, od którego agent zaczął (`feature-workflow:feature-*`). |

Potwierdzone na bazie `914c018` (czytane źródła):
`generate.mjs` bierze jedną wersję z `package.json` dla czterech paczek, a `bridge-claude` kopiuje
całe `.agents/skills` (feature-* bez preambuły) obok `using-bridge` i `bridge-upgrade`;
`sourceDigest` obejmuje workflow, `workflowSourceDigest` jest osobny. `select-source.mjs`
(format `feature-workflow.instruction-source/v1`) jest czystym odczytem i przy pinie w stanie
serving kieruje do runtime’u. `EXECUTOR_PACKAGES = [bridge-claude, feature-workflow-claude]` są
brane raz przy starcie launchera z runtime’u. `ClaudeCodeRunner` dodaje `--resume <handle>` oraz
`--plugin-dir` dla każdej paczki. `SqliteStateStore` ma `SCHEMA_VERSION = 6` i odmawia nowszego
schematu (`schema_unsupported`) również w trybie odczytu. `FeatureRecord` nie ma pola workflow;
`task_attempts` nie ma tożsamości instrukcji. Manifest runtime’u
(`claude-codex-bridge.runtime/v1`) ma `compatibility` (`state_schema_version`, adaptery, node) i
`instructions.set_sha256` = SHA-256 z linii `path\0sha256\n` po `INSTRUCTION_PATHS`. Zainstalowane
runtime’y 0.6.x i 0.7.0 zawierają `plugins/feature-workflow-*`; starsze tylko `.agents/skills`.
Blok MCP tworzony przez setup przekazuje `env_vars = ["CLAUDE_CODEX_BRIDGE_HOME", "XDG_DATA_HOME"]`.

W20 (wielorepozytoryjne wykonanie) pozostaje nienaruszone: `multi-repo.md`, `multi_repo.py`,
`local-delivery.md` i format `DELIVERY=local-v1` są treścią workflow i trafiają do bundle’a
bez zmian; W20 nie wymagał zmian runtime’u, więc nie wprowadza capability (§ 5.2). Mapa
`REPO_MAP=<path> SHA256=<hash>` nadal podróżuje w kontrakcie rundy; binding dotyczy featura
w repozytorium nadrzędnym, a rundy w worktree potomnych używają tego samego wyboru.

## 2. Formaty i tożsamość

### 2.1 Kanoniczny JSON

Pola wchodzące w identity serializuje się jako JSON z kluczami posortowanymi bajtowo (UTF-16 code
units w JS = kolejność `sort_keys` dla kluczy ASCII; klucze muszą być ASCII), bez spacji
(`,` i `:`), UTF-8 bez escape’owania znaków spoza ASCII. Dozwolone: string, liczba całkowita,
bool, null, tablica, obiekt. Liczba zmiennoprzecinkowa → `FORMAT_INVALID`. Pliki na dysku
(manifesty, lock) zapisuje się czytelnie: wcięcie 2, posortowane klucze, `\n` na końcu; identity
nie zależy od tego formatowania.

### 2.2 Identity bundle’a

```text
identity = "sha256:" + hex(sha256(canonical_json({format, component, kind, version, requires,
           variants, files, legacy?})))
```

`files` = wszystkie pliki bundle’a poza `bundle.json`, posortowane bajtowo po `path`, każdy
`{"path": "<client>/<rel>", "sha256": "<hex>", "mode": "644"|"755"}`. `source` (repozytorium,
commit) jest proweniencją i **nie** wchodzi do identity: ta sama treść z innego commita ma tę samą
identity (fixture `REL-01`), a ten sam numer z innymi bajtami — inną (`REL-02`). `requires` wchodzi:
zmiana deklaracji zgodności jest zmianą wydania.

### 2.3 Wersje, tagi i rejestr wydań

- Workflow ma własny semver; numer startowy ustala W19-02 przy pierwszym wydaniu. Numery
  silnika i workflow nigdy nie są porównywane ani wnioskowane jeden z drugiego.
- Tagi przyszłych wydań: `bridge-v<version>`, `workflow-v<version>`; istniejące `v*` zostają.
  Publikacja tagów nie należy do F-W19.
- Źródło wydania: `scripts/workflow-source/release.json`, format `feature-workflow.release/v1`
  (`component`, `version`, `tag`, `requires`, `notes`; przykład
  [examples/release.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/release.json)).
- Rejestr: `scripts/workflow-source/releases.json`, format `feature-workflow.releases/v1`, lista
  tylko dopisywana `{version, identity, commit}`. Generator/`--check` odrzuca wersję już
  zarejestrowaną z inną identity (`VERSION_REUSED`) oraz wbudowywanie bieżącego HEAD lub wspólnego
  digestu w niezmieniony komponent. Analogiczna reguła dla silnika: `package_version` +
  zawartość paczek bridge’a.

## 3. Pakowanie: niezależne i nierekurencyjne

### 3.1 Układ bundle’a

```text
<bundle>/
  bundle.json                    feature-workflow.bundle/v1 (identity, workflow_id, files, source)
  claude/.claude-plugin/plugin.json, claude/skills/feature-*/**, claude/workflow/README.md,
  claude/scripts/{select-source.mjs, workflow.mjs}
  codex/.codex-plugin/plugin.json,  codex/skills/feature-*/**,  codex/workflow/README.md,
  codex/scripts/{select-source.mjs, workflow.mjs}
```

Każdy wariant jest kompletnym pluginem `feature-workflow` dla swojego klienta (manifest, skille
z preambułą, guide, helpery). `kind` = `release` albo `legacy` (§ 10). Przykład pełnego
manifestu: [examples/bundle-A.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/bundle-A.json).

**Nierekurencyjność.** Żadna ścieżka wariantu nie zaczyna się od `bundle/` ani nie jest
`GENERATED.json`; bundle nie zawiera paczek bridge’a ani ról runtime’u
(`skills/using-bridge/`, `skills/bridge-upgrade/`, `skills/bridge/`). Naruszenie:
`BUNDLE_RECURSIVE`, `BUNDLE_RUNTIME_OWNED` (fixtures `BUNDLE-recursive`, `BUNDLE-runtime-owned`).

### 3.2 Granica komponentów

| Ścieżka źródłowa | Właściciel | Trafia do |
| --- | --- | --- |
| `.agents/skills/feature-*/**` (w tym `references/{bridge-loop,local-delivery,multi-repo}.md`, `scripts/{feature_exchange,multi_repo}.py`, `agents/openai.yaml`) | workflow | bundle, oba warianty |
| `docs/features/README.md` | workflow | bundle `*/workflow/README.md` |
| `scripts/workflow-source/{select-source,workflow}.mjs`, `templates/workflow-source-preamble.md`, `release.json`, `releases.json` | workflow | bundle `*/scripts/` (kod kopiowany bajtowo) |
| `.codex/skills/using-bridge`, `.claude/skills/using-bridge`, `scripts/plugin-packages/skills/bridge-upgrade`, instalator | silnik | `bridge-codex`, `bridge-claude` |
| MCP, store, runner, setup | silnik | runtime |

Treść workflow wymieniająca narzędzia MCP (`bridge_feature_*`, `bridge_get_task`) jest *wymaganiem*
wobec silnika wyrażonym przez capabilities (§ 5.2), nie kopią instrukcji silnika. Instrukcje
techniczne API (`using-bridge`) zawsze dostarcza bieżący runtime.

### 3.3 Weryfikacja

`verify(bundle, expected_identity?)` (pełna, przed każdym użyciem przez bind/rezerwację/resolve
w trybie `full`): poprawny `bundle.json` i format; identity przeliczona z manifestu; `workflow_id`
wyprowadzone z `version`+identity; każda ścieżka bezpieczna (względna, bez `..`, `\`, absolutnej,
pod `claude/` lub `codex/`); brak dowiązań symbolicznych w całym drzewie (także katalogów);
zbiór plików na dysku = `files` (brak → `BUNDLE_INCOMPLETE`, nadmiar → `BUNDLE_EXTRA_FILES`);
SHA-256 każdego pliku. Kody i przykłady: § 9, fixtures `BUNDLE-*`.

### 3.4 Magazyn

- Publikacja: kopia do `<store>/.staging-<workflow_id>-<pid>`, pełna weryfikacja kopii,
  `rename` do `<store>/<workflow_id>`, odebranie prawa zapisu plikom. Przerwanie zostawia tylko
  `.staging-*`, którego nikt nie czyta jako bundle’a; ponowienie publikuje (`STORE-03`).
- Istniejący katalog: weryfikacja; ta sama identity → no-op (`STORE-01`), inna →
  `STORE_ID_COLLISION`, bez nadpisania (`STORE-02`); uszkodzony → kod weryfikacji, bez naprawy
  w miejscu.
- Odtworzenie (`workflow.mjs restore --identity <id> [--from <plugin-root>|--source <repo> --commit <sha>]`):
  tylko ze źródła dającego **dokładnie** tę identity — paczki pluginu z `bundle/` o tej identity
  albo regeneracji ze wskazanego commita i porównania identity. Żadnego „najnowszego”, żadnej sieci
  bez jawnego `--source`. Po publikacji cache marketplace można usunąć (`STORE-04`, AC-03/08).
- Standalone używa tylko `<bridge-home>/workflows/`; bez runtime’u, bazy i setupu projektu.

### 3.5 Paczki pluginów i marketplace

- `feature-workflow-claude` / `feature-workflow-codex` = wariant klienta (pliki w korzeniu,
  ładowane przez klienta) **+** `bundle/` = pełna kopia bundle’a (oba warianty i `bundle.json`) +
  `GENERATED.json`. Pliki korzenia muszą być bajtowo równe `bundle/<client>/` (sprawdza
  `workflow.mjs verify-plugin` i `generate --check`). Dlatego instalacja tylko w kliencie
  koordynatora daje wariant Claude’a dla wykonawcy (AC-04).
- Wersja w `plugin.json`, `GENERATED.json` i wpisie marketplace Claude’a = wersja workflow;
  `GENERATED.json.source_digest` = digest wejść workflow. Paczki bridge’a: wersja silnika i digest
  wyłącznie wejść silnika.
- Generator: `--component bridge|workflow|all` dla zapisu i `--check`. Workflow-only zmienia tylko
  dwa drzewa `plugins/feature-workflow-*` i wpisy `feature-workflow` obu marketplace; bridge-only
  zostawia te drzewa i wpisy bajtowo identyczne. Test AC-01 porównuje pełne inwentaryzacje drzew
  drugiego komponentu oraz kanoniczny JSON jego wpisu, nie cały wspólny plik marketplace (`REL-03`).
- Nowe `bridge-claude` nie zawiera `feature-*` ani `workflow/README.md`; zawiera `using-bridge`,
  `bridge-upgrade` i instalator. Historyczne runtime’y i ich paczki pozostają nietknięte.

## 4. Wybór przed briefem i lock

### 4.1 Helper `workflow.mjs`

Kanoniczny `scripts/workflow-source/workflow.mjs` (W19-02), kopiowany do obu wariantów. Node
standard library, bez sieci, bez MCP. Operacje (`--json` zawsze dostępne; exit 0 wynik, 3
odmowa z kodem, 1 błąd helpera):

| Operacja | Skutek |
| --- | --- |
| `resolve --feature <dir|id> | --new [--standalone]` | czysty odczyt (§ 4.2); następca `select-source` |
| `begin --slug <slug> [--feature-id <id>]` | weryfikuje bundle **własnego** pluginu, publikuje do magazynu, tworzy katalog draft (lub wskazany katalog featura bez locka) i lock gen 1 |
| `finalize --draft <token> --feature-id <id>` | draft → finalny katalog (§ 4.4) |
| `adopt --feature <dir> --identity <id> --reason <text>` | jawny wybór dla istniejącego featura bez locka w standalone (decyzja użytkownika) |
| `switch --feature <dir> --to <identity> --expected-generation <n>` | tylko standalone (§ 7.4); z bridge’em odmowa `SWITCH_REQUIRES_BRIDGE` |
| `verify --identity <id>`, `verify-plugin [--root]`, `restore …` | § 3.3–3.5 |

`select-source.mjs` zostaje jako zgodny alias: bez argumentu featura zwraca format v1 jak dziś;
z `--feature`/`--new` deleguje do `resolve` (v2). Status/doctor nie wywołują operacji zapisujących.

### 4.2 Wynik `resolve` i tabela decyzji

Format `feature-workflow.instruction-source/v2`; pola v1 zachowane, dodane `feature`, `bundle`,
`entry` (wydanie aktywnego wejścia odczytane z jego własnego `bundle/bundle.json`, nigdy ze
skanowania cache’ów, dat ani semver) i `record`. Przykład:
[examples/resolve-bound.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/resolve-bound.json).
Linia do ledgera: `INSTRUCTIONS=bundle:<workflow_id> IDENTITY=<identity> GENERATION=<n>`.

| Feature | Projekt | Wynik (`code`) | Fixture |
| --- | --- | --- | --- |
| nowy | runtime z binding / bez bridge’a | `SELECTION_REQUIRED` → `begin` z bieżącego wejścia | RESOLVE-01/02 |
| nowy | pin runtime’u bez binding (≤0.7.0) | `RUNTIME_WITHOUT_BINDING`: jednorazowy upgrade albo jawne standalone; nic nie jest zmieniane | RESOLVE-03 |
| nowy | wejście bez `bundle/` (stary plugin) | `ENTRY_WITHOUT_BUNDLE` | RESOLVE-12 |
| nowy/zablokowany | niezgodny workflow | `WORKFLOW_INCOMPATIBLE` z listą braków | RESOLVE-11 |
| z lockiem | bundle w magazynie zweryfikowany | `BOUND_BUNDLE`: instrukcje z `<store>/<workflow_id>/<client>/` | RESOLVE-07/10 |
| z lockiem | brak / uszkodzony bundle | `BUNDLE_MISSING` / `BUNDLE_CORRUPT` + `restore` dokładnej identity | RESOLVE-08/09 |
| z lockiem | pin cofnięty do runtime’u bez binding | `RUNTIME_WITHOUT_BINDING` | RESOLVE-13 |
| bez locka | stary pin | `LEGACY_PINNED_RUNTIME`: dotychczasowa ścieżka v1, bez locka | RESOLVE-04 |
| bez locka | runtime z binding | `LEGACY_BIND_REQUIRED` / `LEGACY_AMBIGUOUS` / `LEGACY_UNPROVEN` / `LEGACY_SOURCE_MISSING` (§ 10) | RESOLVE-05/06 |
| bez locka | standalone | `SELECTION_REQUIRED` → `adopt` (jawny wybór), nigdy cichy latest | RESOLVE-14 |

Wejście inne niż związany bundle nie jest błędem: agent czyta wskazany skill z magazynu i nie
miesza zestawów. Gdy związany bundle nie zawiera danego wejścia → `ENTRY_NOT_IN_BUNDLE`, bez
fallbacku do kopii pluginu.

### 4.3 Lock

Format `feature-workflow.lock/v1`
([examples/lock-begin.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/lock-begin.json),
[po switch](../../../../tools/pilot/workflow-versioning/fixtures/examples/lock-final-after-switch.json)):

```json
{
  "format": "feature-workflow.lock/v1",
  "feature": {"feature_id": null, "draft_token": "a1b2c3d4"},
  "workflow": {"version": "1.0.0", "identity": "sha256:…", "workflow_id": "1.0.0-5f0a32cc9caa", "kind": "release"},
  "generation": 1,
  "origin": {"kind": "active-plugin", "client": "codex", "plugin_version": "1.0.0"},
  "history": [{"generation": 1, "op": "begin", "version": "1.0.0", "identity": "sha256:…", "origin": "active-plugin", "at": "2026-11-06T00:00:00Z"}]
}
```

Reguły: `history` 1..n bez luk, głowa = bieżący wybór; `origin.kind` ∈ `active-plugin`,
`explicit-source` (snapshot repo z commitem, nie ruchomy branch), `adopt`, `legacy-bind`, `switch`.
Zakazane: ścieżki absolutne/osobiste, natywne ID sesji/wątków, zgody, statusy lifecycle, dane
użytkownika (`LOCK_INVALID`, fixtures LOCK-02…05). Zapis zawsze przez plik tymczasowy + `rename`.
Rejestracja w indeksie: `feature.json` dostaje `"workflow_lock": "docs/features/<id>/workflow.lock.json"`
(pole indeksu, nie drugi lifecycle; dopisuje właściciel indeksu przy pierwszym zapisie po design).

### 4.4 Draft path → finalne ID

Przed nadaniem ID: `docs/features/.draft-<token>/workflow.lock.json`, `token` = 8 losowych hex.
`finalize` jest idempotentny i wznawialny (fixtures DRAFT-01…06):

1. lock w drafcie dostaje `feature.feature_id` (atomowo); już przypisany inny ID →
   `DRAFT_ALREADY_ASSIGNED`;
2. cel nie istnieje → `rename(draft, cel)`; cel istnieje bez locka i draft zawiera tylko lock →
   przeniesienie locka, usunięcie pustego draftu; oba katalogi mają dokumenty albo cel ma inny lock
   → `FEATURE_DIR_COLLISION` (bez scalania);
3. ponowienie po przerwaniu po kroku 1 lub 2 kończy pracę; po zakończeniu → `ALREADY_FINAL`.

Zmiana ID po bind jest poza zakresem: `ID_CHANGE_AFTER_BIND`.

## 5. Zgodność

### 5.1 Deklaracja workflow (`requires`)

```json
{"workflow_formats": {"bundle": 1, "lock": 1},
 "bridge": {"binding_contract": 1,
            "capabilities": ["feature.lifecycle/v1", "feature.close/v1", "round.recovery/v1", "round.report/v1", "workflow.binding/v1"],
            "known_incompatible": [{"versions": ["0.8.1"], "reason": "…"}]},
 "standalone": {"node": ">=22.13.0", "python": ">=3.11"}}
```

### 5.2 Ogłoszenie silnika i capabilities v1

Runtime publikuje `compatibility.workflow_binding = {"contracts": [1], "capabilities": [...]}` w
`runtime-manifest.json` oraz w odpowiedzi `bridge_workflow_status`; schemat stanu 7
([examples/runtime-advertisement.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/runtime-advertisement.json)).
Brak pola = runtime bez binding (wszystkie dotychczasowe, w tym 0.7.0).

| Capability | Znaczenie (istniejące narzędzia) |
| --- | --- |
| `feature.lifecycle/v1` | `bridge_feature_create/get/run/wait_user/answer_user/accept` |
| `feature.close/v1` | `bridge_feature_close` (F-W18) |
| `round.recovery/v1` | `bridge_resume_delegated_task`, `bridge_recover`, `termination_evidence` |
| `round.report/v1` | zachowanie `summary` (4000 znaków), `verification_results`, `remaining_risks` wymagane przez local-v1 |
| `workflow.binding/v1` | operacje § 6.3, tożsamość per próba, paczki z rezerwacji |

Nową capability dodaje się tylko, gdy workflow zaczyna wymagać zmienionego zachowania silnika.

### 5.3 Reguły

Przed bind, rezerwacją, switch i zmianą pina: format bundle/lock obsługiwany; `binding_contract`
∈ `contracts`; każda wymagana capability ogłoszona; runtime nie pasuje do `known_incompatible`.
Pierwszy brak daje kod (`RUNTIME_WITHOUT_BINDING`, `BINDING_CONTRACT_UNSUPPORTED`,
`CAPABILITY_MISSING` z listą, `RUNTIME_KNOWN_INCOMPATIBLE`), pełna lista w `problems`. Brak zgodności
nie tworzy próby, claim, bindingu, pina ani fallbacku (COMPAT-01…06, BIND-01). Zgodna poprawka
tekstu przechodzi na niezmienionym runtime’ie bez zmiany jego pina/konfiguracji (COMPAT-06).

### 5.4 Standalone i downgrade

Standalone sprawdza tylko formaty i `requires.standalone`; reguły `bridge` nie blokują (COMPAT-05,
AC-10). Downgrade: setup przed zapisem pina sprawdza schemat bazy i binding; baza 7 z dowolnym
bindingiem a docelowy runtime bez `workflow.binding/v1` → `DOWNGRADE_WOULD_ORPHAN_BINDING`. Starszy
runtime sam odmawia bazy 7 (`schema_unsupported`), więc nie zignoruje zapisanego wyboru.

## 6. Powiązanie z bridge’em i próby

### 6.1 `FeatureRecord.workflow`

```json
{"format": "bridge.workflow-binding/v1", "identity": "sha256:…", "version": "1.0.1",
 "workflow_id": "1.0.1-…", "kind": "release", "generation": 2, "lock_sha256_at_bind": "…",
 "history": [{"generation": 1, "op": "bind", "identity": "…", "at": "…", "idempotency_key": "k-bind"},
             {"generation": 2, "op": "switch", "identity": "…", "from_identity": "…", "at": "…", "idempotency_key": "k-sw"}],
 "pending_switch": null}
```

([examples/binding-after-switch.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/binding-after-switch.json)).
Pole opcjonalne: jego brak = feature legacy/niepowiązany; odczyt go nie tworzy.

### 6.2 Schemat 7

Migracja 6 → 7 (W19-03): `task_attempts` + `workflow_identity TEXT NULL`,
`workflow_generation INTEGER NULL`; tabela `workflow_switches(feature_id, idempotency_key, step,
payload_json, created_at, PRIMARY KEY(feature_id, idempotency_key))` jako trwały dziennik intencji
(lub równoważny zapis w `FeatureRecord.workflow.pending_switch` w tej samej transakcji). Stare wiersze
nie są przepisywane (NULL = próba sprzed binding). Dokładny numer potwierdza W19-03 na bazie wejścia.

### 6.3 Operacje MCP (manager featura, istniejące ownership/lease/epoch)

| Narzędzie | Parametry | Zachowanie |
| --- | --- | --- |
| `bridge_workflow_status` | `feature_id?` | odczyt: runtime (`workflow_binding`), binding, stan locka (§ 8), pending switch; nic nie zapisuje |
| `bridge_workflow_bind` | `feature_id, lock_path, expected_identity, idempotency_key` | weryfikuje lock, bundle i zgodność; zapisuje binding gen = lock.generation; ten sam → idempotentnie, inny → `WORKFLOW_ALREADY_BOUND` (BIND-02/03) |
| `bridge_workflow_bind_legacy` | `feature_id, runtime_id, expected_set_sha256, idempotency_key` | § 10; tworzy legacy bundle, binding i lock `origin: legacy-bind` |
| `bridge_workflow_switch` | `feature_id, target_identity, expected_generation, idempotency_key` | § 7 |
| `bridge_workflow_project` | `feature_id` | jawna naprawa projekcji locka z DB (po `projection-behind`/`lock-missing`) |
| `bridge_feature_run` (+) | dodatkowe `workflow_identity` | wymagane dla powiązanego featura: identity, którą manager właśnie przeczytał |

Bind nie tworzy featura ani roota, nie przejmuje managera i nie omija `waiting_user`.
`bridge_feature_create` może przyjąć opcjonalne `workflow: {lock_path, expected_identity}` i wtedy
wykonuje bind w tej samej transakcji.

### 6.4 Rezerwacja i paczki rundy

W transakcji rezerwacji próby (run, resume, recovery): binding istnieje (`WORKFLOW_UNBOUND`), brak
`pending_switch` (`WORKFLOW_SWITCH_PENDING`), `workflow_identity` z wywołania = binding
(`WORKFLOW_ACK_MISMATCH`), wykonawca to Claude (`WORKFLOW_EXECUTOR_UNSUPPORTED`), pełna weryfikacja
bundle’a; zapis `workflow_identity/generation` w wierszu próby (RUN-01…04). Identyczne ponowienie
(ten sam klucz) zwraca tę samą próbę i identity. Resume tego samego taska zawsze ma tę samą
generację, bo switch wymaga rozliczonych prób. Runner dostaje paczki z rekordu próby:
`--plugin-dir <runtime>/plugins/bridge-claude` (role) i `--plugin-dir <store>/<workflow_id>/claude`
(plugin `feature-workflow`), nigdy z globalnej konfiguracji ani pluginu managera. Brak bundle’a →
blokada z dowodem przed startem procesu, bez zastępczej próby.

### 6.5 Potwierdzenie tożsamości w rundzie

Prompt rundy zawiera blok:

```text
WORKFLOW=<version> IDENTITY=<identity> GENERATION=<n> ROOT=<store>/<workflow_id>/claude
Te instrukcje zastępują każde wcześniejsze workflow widoczne w tej sesji. Przeczytaj
wskazane wejście z ROOT, nie z listy skilli ani historii rozmowy.
```

Wykonawca zapisuje w ledgerze `INSTRUCTIONS=bundle:<workflow_id> IDENTITY=<identity> GENERATION=<n>`
(wynik `resolve` w swoim worktree). Linia `DELIVERY=local-v1` i kolejność linii `PACKAGE`/`REPO_MAP`
(W16/W20) się nie zmieniają. Potwierdzenie jest deklaracją agenta, nie dowodem załadowania (AC-09);
dowód AC-04 daje dopiero W19-06.

### 6.6 Kierunek delegacji

Gwarancja dotyczy Codex-manager → Claude-worker. Wykonawca Codex pod bindingiem → odmowa
`WORKFLOW_EXECUTOR_UNSUPPORTED` (RUN-03); bez bindingu obecny kontrakt bez zmian.

## 7. Jawna zmiana workflow (switch)

### 7.1 Warunki

Feature powiązany; `expected_generation` = bieżąca (`WORKFLOW_GENERATION_CONFLICT`); brak aktywnej
i nierozliczonej próby (`WORKFLOW_SWITCH_ACTIVE_ATTEMPT`, bez żadnego skutku — SWITCH-01); stan
różny od `waiting_user` (`WORKFLOW_SWITCH_WAITING_USER`); docelowy bundle zweryfikowany i zgodny.
Odpowiedź przed zmianą pokazuje wersję/identity obecną i docelową.

### 7.2 Protokół

1. **intent** — trwały wpis `pending_switch` {klucz, from, target, step=intent};
2. **commit** — w jednej transakcji: binding = target, generation+1, wpis historii `switch`,
   step=commit;
3. **project** — lock w katalogu featura nadpisany atomowo (generation, workflow, `origin: switch`,
   dopisana historia), następnie `pending_switch = null`.

Od kroku 1 do końca rundy są blokowane (`WORKFLOW_SWITCH_PENDING`). Feature, taski, decyzje,
uprawnienia, natywne sesje i wcześniejsze zdarzenia/próby pozostają (SWITCH-04: próba t1 nadal ma A).

### 7.3 Przerwanie i ponowienie

Ponowienie z tym samym kluczem kończy od zapisanego kroku dokładnie raz; powtórka po zakończeniu →
`ALREADY_APPLIED`; inny klucz przy pending → `WORKFLOW_SWITCH_PENDING` (fixtures
`SWITCH-crash-{intent,commit,project}`, SWITCH-05). Status po przerwaniu opisuje
`switch-pending:<step>`, nie naprawia go.

### 7.4 Standalone

`workflow.mjs switch`: weryfikacja docelowego bundle’a, zgodność formatów, `expected-generation`,
atomowa wymiana locka z dopisaną historią. Bez DB i bez dziennika: jedno `rename` jest punktem
zatwierdzenia.

### 7.5 Ta sama sesja: przeładowanie i restart

Na podstawie prób § 11: żaden klient nie zastępuje instrukcji już widocznych w historii sesji;
po wznowieniu tej samej sesji (ten sam `session_id`/`thread_id`) nowe wywołanie wejścia wstrzykuje
nową treść, a stara zostaje w historii. Lista skilli Claude’a po resume jest historią przyrostów
i może wskazywać inną wersję niż aktywna paczka. Dlatego kontrakt nie opiera się na liście skilli
ani na ponownym wczytaniu pluginu w procesie:

- **wykonawca**: każda runda to nowy proces `claude -p --resume <handle>` z paczką z rezerwacji;
  `--plugin-dir` zastępuje plugin o tej samej nazwie także przy resume (próba C). Blok § 6.5
  wymusza odczyt z `ROOT` i jawne zastąpienie wcześniejszych instrukcji;
- **manager**: po switch ponownie uruchamia `resolve` i czyta wskazane wejście z magazynu w tej
  samej sesji (`reload_mode = reread`), a następną rundę wywołuje z nową `workflow_identity`;
  stara identity → `WORKFLOW_ACK_MISMATCH`. Jeżeli aktywne wejście nie obsługuje binding (stary
  plugin), wymagany jest zwykły restart klienta i wznowienie **tej samej** sesji
  (`codex resume <thread>` / `claude --resume <id>`, `reload_mode = restart-resume`); switch
  pozostaje zatwierdzony, a rundy zablokowane brakiem właściwego potwierdzenia, nie nową sesją.

To jest wykonalność bez modelu. Że model rzeczywiście stosuje nowe instrukcje mimo starej historii,
pozostaje do udowodnienia w W19-06 (AC-04/06, NOT_TESTED do tego czasu).

## 8. Status i diagnostyka (wymagania dla W19-05)

Odczyt rozróżnia: runtime projektu (id, `workflow_binding` lub brak), plugin wejścia (wersja,
identity jego `bundle/`, ścieżka tylko jako `<plugin-cache>`/`<store>`), wybór featura (identity,
generation, kind, pochodzenie) i dostępność kopii (`verified`/`missing`/`corrupt`). Klasyfikacja
locka względem DB: `in-sync`, `projection-behind`, `lock-missing`, `diverged`, `unbound-with-lock`,
`legacy-unbound`, `switch-pending:<step>`; plik nie wygrywa po mtime, status nie naprawia
(STATUS-01). Deklaracja (lock/DB/ack) jest odróżniona od obserwacji (próba klienta). Allowlista bez
treści skilli, promptów, ścieżek osobistych i natywnych ID. Eksport `feature-exchange` przenosi lock
bez zmian; import nie zmienia lokalnego wyboru.

## 9. Kody

| Kod | Kiedy | Następny krok |
| --- | --- | --- |
| `FORMAT_INVALID`, `FORMAT_UNSUPPORTED`, `LOCK_FORMAT_UNSUPPORTED` | nieznany/niepoprawny format | aktualizacja helpera/runtime’u |
| `BUNDLE_MISSING`, `BUNDLE_CORRUPT`, `BUNDLE_INCOMPLETE`, `BUNDLE_EXTRA_FILES`, `BUNDLE_SYMLINK`, `BUNDLE_PATH_UNSAFE`, `BUNDLE_RECURSIVE`, `BUNDLE_RUNTIME_OWNED`, `BUNDLE_IDENTITY_MISMATCH` | § 3.3 | `restore` dokładnej identity |
| `STORE_ID_COLLISION` | inny bundle pod tą nazwą | diagnoza ręczna; bez nadpisania |
| `VERSION_REUSED` | numer wydania z innymi bajtami | nowy numer |
| `LOCK_INVALID` | § 4.3 | przywrócić z historii Git / `bridge_workflow_project` |
| `DRAFT_MISSING`, `DRAFT_ALREADY_ASSIGNED`, `FEATURE_DIR_COLLISION`, `ID_CHANGE_AFTER_BIND` | § 4.4 | decyzja użytkownika o katalogach |
| `SELECTION_REQUIRED`, `ENTRY_WITHOUT_BUNDLE`, `ENTRY_NOT_IN_BUNDLE`, `ENTRY_BUNDLE_CORRUPT` | § 4.2 | `begin`/`adopt`, aktualizacja pluginu |
| `RUNTIME_WITHOUT_BINDING`, `RUNTIME_MISSING`, `BINDING_CONTRACT_UNSUPPORTED`, `CAPABILITY_MISSING`, `RUNTIME_KNOWN_INCOMPATIBLE`, `WORKFLOW_INCOMPATIBLE`, `DOWNGRADE_WOULD_ORPHAN_BINDING` | § 5 | wskazany upgrade; nic automatycznie |
| `WORKFLOW_UNBOUND`, `WORKFLOW_ALREADY_BOUND`, `WORKFLOW_ACK_MISMATCH`, `WORKFLOW_EXECUTOR_UNSUPPORTED` | § 6 | bind / ponowny `resolve` |
| `WORKFLOW_SWITCH_ACTIVE_ATTEMPT`, `WORKFLOW_SWITCH_WAITING_USER`, `WORKFLOW_GENERATION_CONFLICT`, `WORKFLOW_SWITCH_PENDING`, `SWITCH_REQUIRES_BRIDGE` | § 7 | rozliczyć próbę / dokończyć tym samym kluczem |
| `LEGACY_PINNED_RUNTIME` (odpowiedź), `LEGACY_BIND_REQUIRED`, `LEGACY_AMBIGUOUS`, `LEGACY_UNPROVEN`, `LEGACY_SOURCE_MISSING` | § 10 | bind_legacy / jawny wybór / reinstalacja pina |

W bridge’u kody trafiają do `BridgeError.details.reason` w postaci małych liter
(`workflow_unbound`, …) z polami `missing`, `expected`, `found`, `next_step`.

## 10. Dotychczasowe feature’y i przejście

### 10.1 Stany

Feature bez locka i bez bindingu jest *legacy*. Sam odczyt, status ani brak pola nie przypisuje mu
wydania (AC-07). Kontynuuje na dotychczasowej ścieżce, dopóki projekt ma stary pin (RESOLVE-04);
po jednorazowym upgrade silnika do runtime’u z binding rundy wymagają `bind_legacy` (RUN-01,
RESOLVE-05).

### 10.2 Zawartość legacy bundle’a

Źródło: pliki z `instructions.files` manifestu **dokładnie tego** starego runtime’u, sprawdzone
hashami. Wchodzą wyłącznie `.agents/skills/feature-*/**` i `docs/features/README.md`; nie wchodzą
`.claude/skills/using-bridge`, `.codex/skills/using-bridge`, `bridge-upgrade`, `plugins/bridge-*`
(LEGACY-01). Warianty klientowe generuje `legacy-adapter/v1`: przepisanie odnośników jak w
generatorze tego wydania workflow i preambuła bootstrapu; tekst reguł bez zmian. Bundle ma
`kind: "legacy"` i pole `legacy` {`runtime_id`, `runtime_commit`, `instructions_set_sha256`,
`adapter: {name, sha256}`, `profile`} wchodzące w identity. Stare `bridge-claude` nigdy nie jest
przekazywane wykonawcy (nadpisałoby bieżące role po nazwie pluginu). Wbudowanych w stare runtime’y
paczek `feature-workflow-*` nie używa się: ich preambuła kierowałaby do *bieżącego* pina.

### 10.3 Dowód starego zestawu

Kolejność: linie `INSTRUCTIONS=runtime:<id> SET=<sha>` z ledgerów featura → pin projektu sprzed
upgrade (zachowana historia wyboru runtime’u w setupie). Jeden zestaw → `PROVEN` (LEGACY-02/06);
różne → `LEGACY_AMBIGUOUS` z kandydatami i jawnym wyborem użytkownika (LEGACY-03); brak →
`LEGACY_UNPROVEN` (LEGACY-04, także sam rekord pluginu standalone LEGACY-07); runtime usunięty
(przerwany upgrade/sprzątanie) → `LEGACY_SOURCE_MISSING` i reinstalacja dokładnie tego pina
(LEGACY-05). Nigdy wybór najnowszego.

### 10.4 Nowy plugin przy starym pinie

Istniejący feature: `LEGACY_PINNED_RUNTIME`, ścieżka v1, bez locka i udawanego bindingu
(RESOLVE-04). Nowy feature: `RUNTIME_WITHOUT_BINDING` z diagnozą brakującego kontraktu i wskazaniem
jednorazowego upgrade; plugin go nie wykonuje (RESOLVE-03). Feature z lockiem po cofnięciu pina:
`RUNTIME_WITHOUT_BINDING` (RESOLVE-13).

### 10.5 Profil zgodności legacy

Legacy bez manifestu zgodności dostaje profil `feature-workflow.legacy-profile/v1`
([examples/legacy-profile.json](../../../../tools/pilot/workflow-versioning/fixtures/examples/legacy-profile.json)):
`runtime_id`, `runtime_commit`, `instructions_set_sha256`, adapter, `requires` i `declared_by`.
Tabela profili jest częścią nowego runtime’u (to on wie, które capabilities zapewnia starym
regułom) i obejmuje wyłącznie zestawy, które W19-03 sprawdzi testem (np. 0.6.2, 0.7.0). Zestaw
bez profilu → `LEGACY_UNPROVEN`; profil podlega § 5.3 jak każde wydanie.

### 10.6 Przerwany upgrade

Upgrade najpierw zachowuje stary runtime i jego wybór, potem prowadzi zapis pina; legacy bundle
powstaje dopiero w `bind_legacy`. Przerwanie przed zapisem pina: stary pin działa dalej
(RESOLVE-04). Po zapisie pina bez bindingu: rundy odmawiają (`WORKFLOW_UNBOUND`/
`LEGACY_BIND_REQUIRED`) do jawnego bind; brak starego runtime’u → LEGACY-05.

## 11. Próby klientów bez modeli (W19-01)

Polecenie: `python3 tools/pilot/workflow-versioning/probe_clients.py --out <plik>`. Wynik:
[evidence/W19-01/clients.json](../evidence/W19-01/clients.json) (redagowany; surowe zapisy zapytań
w izolowanym katalogu poza Git). Hosty: **Claude Code 2.1.316**, **codex-cli 0.166.0**, Node
v24.15.0, Python 3.12.3, Linux.

Bez inferencji: Claude łączy się z lokalnym stubem (`ANTHROPIC_BASE_URL`, odpowiedź 400), każdy
wynik ma koszt 0 i 0 tokenów; Codex używa providera z `base_url` = lokalny stub, każda tura kończy
się błędem stubu `w19_probe`. Stub zapisuje treść zapytania (wejście widoczne dla modelu), niczego
nie przekazuje dalej. Profile osobiste (`~/.claude`, `~/.codex`) są odrzucane przez
`assert_isolated`, a metadane ich plików pluginów porównane przed/po: bez zmian.

| Obszar | Obserwacja | Wniosek dla kontraktu |
| --- | --- | --- |
| Izolacja Claude | `CLAUDE_CONFIG_DIR=<run>/claude-config`: instalacja i cache `<cfg>/plugins/cache/<market>/<plugin>/<ver>`, transkrypty `<cfg>/projects/`, `auth status` zgłasza ten katalog | ścieżki efektywne są w izolacji |
| Źródło aktywnego wejścia Claude | marketplace katalogowy jest serwowany z folderu źródłowego (`readFromFolder`), nie z cache; `${CLAUDE_PLUGIN_ROOT}` w rozwiniętym wejściu = ta ścieżka | identity z własnego `bundle/`, nie ze ścieżki (§ 4.2) |
| Resume Claude | `--resume` zachowuje `session_id`; po aktualizacji pluginu wywołanie wejścia daje nowy tekst, stary zostaje w historii; `--plugin-dir` przy resume zastępuje zainstalowany plugin tej nazwy; bez wywołania nic nowego nie jest wstrzykiwane; ostatnia pozycja listy skilli wskazuje 3.0.0, choć aktywna jest 2.0.0 | § 6.5, § 7.5: odczyt z `ROOT`, ack identity, lista skilli nie jest dowodem |
| Izolacja Codex | `CODEX_HOME=<run>/codex-home`: cache `<home>/plugins/cache/<market>/<plugin>/<ver>`, sesje `<home>/sessions/` | ścieżki efektywne w izolacji |
| Resume Codex | `$plugin:entry` wstrzykuje treść i absolutną ścieżkę; `exec resume <thread>` zachowuje `thread_id`, pokazuje nową wersję, historia zawiera starą treść i ścieżkę; aktualizacja usuwa katalog cache starej wersji | historia może wskazywać nieistniejące pliki → magazyn niezależny od cache (§ 3.4) |
| Środowisko MCP | serwer MCP uruchomiony przez Codex z `env_vars` setupu bridge’a nie dostaje `CLAUDE_CONFIG_DIR`; dodanie zmiennej do `env_vars` przekazuje izolowaną ścieżkę | pilot W19-06 musi dodać `CLAUDE_CONFIG_DIR` do `env_vars` izolowanej konfiguracji Codexa, inaczej delegowany Claude użyje profilu osobistego |
| Logowanie | izolowane profile: Claude `loggedIn: false`, Codex `Not logged in`; wspierane drogi: `CLAUDE_CONFIG_DIR=<iso> claude auth login --claudeai` lub `claude setup-token` (token subskrypcji w zmiennej środowiskowej procesu), `CODEX_HOME=<iso> codex login [--device-auth]` | **warunek wstępny pilota PILOT-AUTH-01/02** (§ 13); nie kopiowano poświadczeń |

Ograniczenia prób: brak inferencji, więc nie wiadomo, czy model zastosuje nowe instrukcje mimo
historii; nie badano przeładowania pluginów w działającym procesie interaktywnym (TUI, `/plugin`);
marketplace był lokalnym katalogiem (marketplace Git/GitHub serwuje z cache); ruch inny niż zapytania
modelu (telemetria) nie był monitorowany, choć Claude miał `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`;
nie sprawdzano stanu logowania profili osobistych.

## 12. Przykłady kryteriów odbioru

`python3 tools/pilot/workflow-versioning/contract_fixtures.py --check` odtwarza fixtures bajtowo;
`python3 -m unittest discover -s tools/pilot/workflow-versioning` sprawdza werdykty z
[cases.json](../../../../tools/pilot/workflow-versioning/fixtures/cases.json).

| AC | Reprezentatywne przypadki | Oczekiwany wynik |
| --- | --- | --- |
| AC-01 | REL-01, REL-02, REL-03 | identity tylko z treści; `VERSION_REUSED`; wpis bridge’a niezmieniony przy wydaniu workflow |
| AC-02 | RESOLVE-01, RESOLVE-12 | nowy feature: `begin` z aktywnego wejścia; stary plugin bez bundle’a jawnie odrzucony |
| AC-03 | STORE-01, STORE-04, RUN-04, RESOLVE-07 | zachowana kopia obsługuje feature po usunięciu cache; próba zapisuje A |
| AC-04 | RUN-02, RUN-03, RUN-04, SWITCH-06; próby § 11 C | rezerwacja wymaga ack; paczka z rekordu próby; Codex-worker odrzucony; dowód modelowy w W19-06 |
| AC-05 | COMPAT-01…06, BIND-01, RESOLVE-11 | konkretny brak przed pracą; poprawka tekstu przechodzi |
| AC-06 | SWITCH-01…06, SWITCH-crash-* | odmowa przy aktywnej próbie bez skutku; dokładnie jedno przejście po każdym przerwaniu |
| AC-07 | LEGACY-01…07, RESOLVE-03/04/05/06/13, RUN-01 | legacy bez ról runtime’u; bez zgadywania; stary pin osobno dla starego i nowego featura |
| AC-08 | LOCK-01…05, DRAFT-01…06, BUNDLE-*, STORE-02/03, RESOLVE-08/09 | lock przed briefem; draft→ID z kolizją i przerwaniem; uszkodzenie wykryte |
| AC-09 | STATUS-01; § 8 | rozbieżność opisana, nie naprawiona; deklaracja ≠ obserwacja |
| AC-10 | COMPAT-05, RESOLVE-02/10/14 | standalone bez MCP/runtime’u; reguły bridge nie blokują |

Przykłady są syntetyczne i dowodzą semantyki kontraktu, nie realizacji AC w produkcie.

## 13. Przekazanie, ograniczenia i warunki pilota

- **W19-02**: `release.json`/`releases.json`, `bundle.json`, identity (§ 2), generator
  komponentowy, `bundle/` w paczkach, `workflow.mjs` begin/finalize/verify/restore/resolve/switch
  standalone, magazyn. Zgodność z fixtures przez porównanie identity dla tych samych plików.
- **W19-03**: schemat 7, `FeatureRecord.workflow`, operacje § 6.3, rezerwacja § 6.4, switch § 7,
  legacy § 10, downgrade § 5.4.
- **W19-04**: preambuła → `resolve`, blok § 6.5, runner z paczkami z próby, `select-source` v1/v2.
- **W19-05**: § 8 i dokumentacja upgrade/switch/restore/legacy.
- **W19-06 (pilot)** — warunki wstępne, które W19-01 nazywa, a nie spełnia:
  - PILOT-AUTH-01: zalogować izolowany profil Claude’a wspieraną drogą subskrypcji
    (`CLAUDE_CONFIG_DIR=<pilot>/claude claude auth login --claudeai` albo `claude setup-token`
    i przekazanie tokenu tylko w środowisku procesu, poza Git);
  - PILOT-AUTH-02: `CODEX_HOME=<pilot>/codex codex login` (lub `--device-auth`);
  - PILOT-ENV-01: izolowana konfiguracja Codexa dla bloku bridge’a z `env_vars` zawierającym
    `CLAUDE_CONFIG_DIR` (i `CLAUDE_CODEX_BRIDGE_HOME` pilota), potwierdzona przed pierwszą rundą.
  Bez nich pilot się zatrzymuje z konkretnym pytaniem o dostęp; żadnego przeniesienia do profilu
  osobistego ani na API.
- Brak dowodu, że model stosuje nowe instrukcje po resume mimo starej historii; brak próby
  interaktywnego przeładowania w procesie. Żaden wynik W19-01 nie wykazał niemożności zachowania
  sesji: obie ścieżki resume zachowują ID sesji i pokazują nową treść, więc zależne taski nie są
  blokowane. Nie wymaga to zmiany AC.

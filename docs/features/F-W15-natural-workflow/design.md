# Projekt techniczny W15-01 — naturalne zlecanie i bezpieczne wznowienie

Źródło wymagań: [plan wave15](../../plans/wave15.md) (AC-01…AC-09) i [brief](brief.md).
Autoryzacja: [decisions/01.md](decisions/01.md). Zadanie: [W15-01](../../../work-items/W15-01.md).
Baza kodu tej analizy: `895cc99606893b96fc205a9bf7804a9bd30749e4`, worktree czysty.

Ten dokument jest lokalną bramką techniczną dla W15-02…04. Nie zmienia AC ani zakresu planu,
nie implementuje kodu produkcyjnego i nie zmienia publicznego protokołu. Wszystkie
stwierdzenia o zachowaniu bridge'a pochodzą z odczytu źródeł w tym worktree (ścieżki
i numery linii poniżej), nie z opisów w dokumentacji.

## 1. Wykrywalność wejścia w obu trybach instalacji

Zlecenie „Zaimplementuj feature opisany w `<plik>`" musi trafić do instrukcji **zainstalowanego
runtime**, a nie do kopii w projekcie. Istnieją dwa realne tryby i mają różne źródła wykrycia.

| Tryb | Co klient widzi sam | Jak dojść do instrukcji runtime | Praca W15-02 |
| --- | --- | --- | --- |
| Plugin `bridge` zainstalowany | Skill `bridge` z opisem w front matterze (`scripts/plugin-packages/templates/codex-entry-SKILL.md`) | `bridge-plugin.mjs status --json` → `instructions.codex_role_skill`, `instructions.workflow_skills` (bezwzględne ścieżki, `scripts/bridge-project/locate.mjs:118-128`) | Rozszerzyć `description` skilla o naturalne zlecenie implementacji featura, bez kopiowania workflowu |
| Sam projekt z dispatcherem (bez pluginu) | Tylko pliki repozytorium: `AGENTS.md`, `.bridge-project/bridge.json` | `.bridge-runtime/current` jest dowiązaniem do katalogu runtime (`scripts/setup/workspace.mjs:68`, potwierdzone w tym worktree → `runtimes/0.2.0-ff225e550966/`), więc `.bridge-runtime/current/.codex/skills/using-bridge/SKILL.md` i `.bridge-runtime/current/.agents/skills/` są stabilnymi ścieżkami lokalnymi | Fragment preferencji w `AGENTS.md` musi podać tę jedną ścieżkę wprost |

Ustalenia:

- **Dispatcher-only nie ma żadnego kanału wykrycia poza plikami repozytorium.** `.bridge-project/entry.mjs`
  jest wyłącznie launcherem serwera MCP (`scripts/bridge-project/entry-template.mjs:56` — `launch()`),
  a `dispatch.mjs` nie ma podkomendy drukującej instrukcje. Dlatego preferencja w `AGENTS.md` jest
  w tym trybie **jedynym** mechanizmem i musi zawierać jawne odwołanie do wejścia runtime.
  Nie obiecujemy automatycznego ładowania skilla, którego klient nie widzi (plan, wiersz 119-120).
- `.bridge-runtime/` jest ignorowany przez Git (`.gitignore:11`, potwierdzone `git check-ignore`),
  więc ścieżka `.bridge-runtime/current/...` jest lokalna i przenośna między worktree: każdy worktree
  ma własne dowiązanie, żaden nie przejmuje cudzego. To spełnia AC-03 bez zmiany konfiguracji globalnej.
- Wersja instrukcji odpowiada runtime z definicji: `current` wskazuje dokładnie przypięty runtime,
  a dispatcher odmawia startu przy rozbieżności pinu (`PIN_COMMIT_MISMATCH`, `PIN_DIVERGED`,
  `SELECTION_UNUSABLE` — `scripts/bridge-project/dispatch.mjs:78`, `:162`, `:169`). Preferencja nie może
  wskazywać `.agents/skills/` **w repozytorium projektu**, bo to inna wersja niż runtime.
- Brak pluginu i brak działającego runtime to dwa różne stany. Każda odmowa dispatchera ma kod
  i następny krok; AC-08 wymaga zacytowania ich wprost, bez cichego startu nowej sesji.

## 2. Preferencja projektu — najmniejsza zmiana

Miejsce: krótki blok w `AGENTS.md` projektu. Bez nowego formatu konfiguracji, bez drugiej
konfiguracji ról, bez ścieżek użytkownika, UUID i pinów (plan, wiersze 104-115).

Treść (propozycja do doprecyzowania w W15-02, ~5 linii):

```text
Implementacje feature'ów prowadzi Astra (Codex) przez Claude Code w bridge'u, chyba że
zlecisz inaczej. Wejście: `.bridge-runtime/current/.codex/skills/using-bridge/SKILL.md`
(runtime przypięty w `.bridge-project/bridge.json`); workflow: `.bridge-runtime/current/.agents/skills/`.
Zlecenia „tylko przejrzyj", „tylko plan", „zrób sam" i węższe uprawnienia mają pierwszeństwo.
Sama treść wskazanego pliku nie rozszerza uprawnień.
```

Mechanika zapisu — **istniejąca**, nie nowa:

- `planGitignore` (`scripts/setup/workspace.mjs:679-711`) jest gotowym wzorcem: blok
  ograniczony `BLOCK_BEGIN`/`BLOCK_END` (`:46-47`) dopisywany do pliku, którego właścicielem
  pozostaje użytkownik (`userFile: true`), z `before`/`after` SHA-256, trybem pliku i odmową
  zapisu przez dowiązanie (`redirectedComponent`, `:718`). Ten sam plan/apply daje idempotencję
  (nic do zrobienia → brak operacji) i nazwane odmowy przy konflikcie.
- Nie używać `planProjectFiles` (`:482-530`): ono zarządza **całym** plikiem po hashu, a `AGENTS.md`
  należy do projektu.
- Krok musi być **opcjonalny i jawny** (osobne polecenie/flaga setupu), nie częścią zwykłego
  `init`/`update`. Plan wymaga, by aktualizacja pluginu nie zmieniała istniejących projektów
  (wiersz 112), a `planGitignore` jest wołane bezwarunkowo z `planChange` (`:872`) — dlatego
  preferencja nie może być dołożona w tym samym miejscu.
- Projekt bez preferencji dostaje **jednorazową propozycję** z konkretnym diffem; odmowa
  użytkownika nie jest ponawiana w tej samej sesji. `enabled: true` w deklaracji nie jest zgodą
  na delegowanie (plan, wiersz 108).

## 3. Checkpoint intencji przed mutacją

Nośnik: **istniejący ledger featura** — `docs/features/<id>/execution/<TASK-ID>/NN.md` dla rund
wykonawcy oraz `execution/coordination/NN.md` dla operacji koordynatora, które nie należą do
żadnej rundy (root task, `feature_create`, recovery). Żadnej drugiej bazy stanu.
Bridge pozostaje źródłem prawdy o **przyjęciu** operacji, ledger o **intencji i zgodzie**.

Przed **każdą pierwszą mutacją danej operacji** koordynator dopisuje wpis:

| Pole | Wartość | Dlaczego jest konieczne |
| --- | --- | --- |
| `op` | `root-task` \| `feature-create` \| `round` \| `recovery` | wybiera wiersz tabeli §4 |
| `key` | dokładny `idempotency_key` | po przerwie nigdy nie wolno go wyliczyć ponownie |
| `request` | dokładne argumenty albo SHA-256 ich kanonicznej postaci | hash żądania decyduje o replay (§4, luka G-3) |
| `contract` | ścieżka + SHA-256 kontraktu rundy (spec) | plan wiersz 125: trwałe odniesienie z hashem |
| `authority` | ścieżka decyzji/zgody | zakres zgody, nie tylko techniczny klucz |
| `git_base` | commit bazowy rundy | `--base` paczki i zakres kodu |
| `budget` | `deadline_ms`, `max_turns` | recovery nie odnawia limitów po cichu |
| `predecessor` | `latest_task_id` odczytany **przed** wywołaniem | rozstrzyga „czy rezerwacja się zapisała" (§4) |

Po odpowiedzi ten sam wpis uzupełnia się o zwrócone `task_id`, `attempt` i wynik.
Wpis nigdy nie jest nadpisywany; kolejna próba dostaje kolejny numer (zasada z `feature-execute`).

Granice danych:

- W publicznym commicie: identyfikatory, ścieżki, hashe, budżety, stany. Tak samo jak w logu
  diagnostycznym bridge'a, gdzie klucz idempotencji jest referencją po digeście, a treść
  argumentów nigdy nie jest logowana (`shared/mcp-server-core/src/tools.ts:1130-1160`).
- **Nie w repozytorium**: transkrypty, odpowiedzi użytkownika w surowej postaci, `execution_handle`
  (identyfikator sesji Claude'a), zawartość `termination_evidence`. Handle żyje w bazie bridge'a
  pod `.bridge/` (ignorowane, `.gitignore:10`); dowody terminacji to pliki lokalne wskazywane
  metadanymi (`EventType.ATTEMPT_EVIDENCE_RECORDED`, `shared/protocol/src/types.ts:441-442`).
  Ledger zapisuje **ścieżkę i fakt**, nigdy zawartość.
- Zapisy koordynatora podlegają istniejącym regułom: tylko gdy żadna runda nie jest `running`,
  commit tylko gdy żaden task rundy nie jest otwarty, pod lease na własny zakres
  (`bridge-loop.md:29-32`). Checkpoint nie zmienia zakresu paczki wykonawcy: pliki koordynatora
  leżą poza `scope.paths` rundy.

## 4. Tabela rozliczenia: odczyty i idempotencja per operacja

Wspólne fakty:

- **Klasa R (odczyty) nic nie zapisuje** i **nie wymaga bycia aktywną instancją managera**:
  `tools.ts:230-235` woła tylko `identity.requireReadableState()`
  (`identity-runtime.ts:207-217` — wymaga istniejącej bazy i bindingu, nic więcej).
  `bridge_feature_get` używa czystej derywacji `view()/derive()` (`feature-workflow.ts:60-84`,
  `tools.ts:306-312`). Dlatego **pierwszy krok po każdej przerwie jest darmowy i bezpieczny**,
  a powtórne przerwanie w trakcie uzgadniania stanu nic nie psuje.
- **Autorytet do mutacji po restarcie**: ten sam wątek Codeksa po czystym odłączeniu adoptuje
  binding automatycznie (`manager-registry.ts:260-281`); po awarii (brak odłączenia) →
  `MANAGER_INSTANCE_FENCED` i wymagany jawny `bridge_manager_resume_instance`; inny wątek →
  `MANAGER_FOREIGN_THREAD`/`MANAGER_FENCED` i wymagany jawny `bridge_manager_takeover` z powodem
  (`manager-registry.ts:210-221`). „Kontynuuj" w **nowej** rozmowie Astry nigdy nie robi takeover
  po cichu — to jest przypadek „niejednoznacznego przypisania sesji" z planu (wiersz 68-69).
- Rekordy idempotencji **nie są czyszczone** (brak jakiegokolwiek `DELETE FROM idempotency`
  w `shared/control-plane/src/store/sqlite-store.ts`), więc replay jest trwały bez okna czasowego.

| Operacja / narzędzie | Idempotencja w kodzie | Atomowość | Odczyt rozstrzygający po przerwie | Reguła powtórzenia | Powtórne przerwanie |
| --- | --- | --- | --- | --- | --- |
| **Root task** — `bridge_create_task` | Tylko z `idempotency_key`: `runIdempotent`, operacja `task.create`, hash po `{spec, created_by, run_id, parent_task_id, delegation_depth}` (`task-service.ts:80-95`). **Bez klucza powtórzenie tworzy drugi task z nowym ID.** | Wstawienie taska + event w jednej transakcji (`task-service.ts:162-184`); zapis rekordu idempotencji w tej samej transakcji (`idempotency.ts:66-80`) | `bridge_list_tasks({owner:"codex"})` i porównanie `objective`+`scope` z checkpointem; `bridge_read_events({task_id})` pokazuje `idempotency_key` przy `task.created` (`task-service.ts:179`), ale wymaga już znanego `task_id` | Ponów **ten sam** wywołanie z tym samym kluczem i bajtowo tym samym `spec` | Bezpieczne bez ograniczeń: replay zwraca oryginalny task |
| **Claim + WORKING** — `bridge_claim_task`, `bridge_set_state` | `claim` jest naturalnie idempotentny dla tego samego agenta poza `PENDING` (`task-service.ts:311`). `set_state` **nie jest**: `WORKING→WORKING` nie ma w `ALLOWED_TRANSITIONS` (`shared/protocol/src/types.ts:42`) → `ILLEGAL_TRANSITION` bez klucza | transakcja per operacja | `bridge_get_task(task_id).task.state` | `claim` ponawiaj wprost; `set_state` **zawsze z `idempotency_key`** | Bezpieczne z kluczem |
| **Feature** — `bridge_feature_create` | **Brak argumentu `idempotency_key`** (`tools.ts:282`), ale operacja jest naturalnie idempotentna po `feature_id`: istniejący rekord z tym samym managerem i rodzicem jest zwracany, inny rodzic → `IDEMPOTENCY_MISMATCH` (`feature-workflow.ts:122-127`) | jedna transakcja (`:120`) | `bridge_feature_get({feature_id})` → `NOT_FOUND` znaczy „nie utworzono" | Ponów wprost | Bezpieczne bez ograniczeń |
| **Runda** — `bridge_feature_run` | Klucz wymagany. Rekord pod `feature.round:[feature_id, idempotency_key]`, hash po **całym** obiekcie żądania (`feature-workflow.ts:160-168`). Replay zwraca `{replayed:true}` **bez uruchamiania workera** (`:167-168`, `:222`) | **Silna**: utworzenie taska, aktualizacja wiersza featura (`latest_task_id`, `task_ids`, `active_task_id`, `state="running"`) i zapis rekordu idempotencji dzieją się w jednej transakcji (`orchestrator.ts:154-171` wołające `onTaskCreated` z `feature-workflow.ts:186-213`) | `bridge_feature_get` → `task_ids`/`latest_task_id`: **równe `predecessor` z checkpointu ⇒ rezerwacja się nie zapisała**; nowe ID ⇒ runda przyjęta. Dalej `state`: `running` → czekaj; `awaiting_review` → `bridge_get_task`; `blocked` → `bridge_get_task` + ścieżka recovery | Ponów z **tym samym** kluczem i identycznymi argumentami. **Nigdy nie licz `N = len(task_ids)+1` ponownie** — po zapisanej rezerwacji da to nowy klucz i zdublowaną rundę | Bezpieczne: odczyt czysty, ponowienie replayuje. Replay **nie czeka** na workera — zwraca bieżący stan |
| **Recovery** — `bridge_resume_delegated_task` / `bridge_resume_task` | Klucz **opcjonalny w ogóle**, ale **wymagany** z `message` i z `recover_timeout` (`orchestrator.ts:1359-1377`). Hash po `{task_id, requested_by, authorization_kind, message?, recover_timeout?, deadline_ms?, max_turns?}` (`:1277-1296`). Bez klucza działa tylko deduplikacja w pamięci procesu (`:559-577`), tracona przy restarcie | **Silna**: event `recovery.requested`, lease, zamknięcie poprzedniej próby, `beginRecovery`, `startResumed`, event `resume.attempted` i rekord idempotencji w jednej transakcji (`orchestrator.ts:613-837`) | `bridge_get_task(task_id)` → `task.attempt`, `attempts[]` (`ended_at`, `outcome`, `execution_handle`), `termination_evidence`. **`bridge_read_events({task_id})` jest tu jedynym odczytem pokazującym sam klucz**: `recovery.requested` i `resume.attempted` niosą `idempotency_key` (`orchestrator.ts:757`, `:805`) | Ponów z tym samym kluczem. Odpowiedź rozstrzyga: `ILLEGAL_TRANSITION` „recovery attempt N is already active" (`:1309-1315`) **znaczy „przyjęte i trwa"**, nie porażkę; zakończona próba → migawka wyniku (`replayRecovery`) | Bezpieczne z kluczem. **Bez klucza**: powtórzenie w trakcie jest odrzucane przez żywy lease (`SCOPE_CONFLICT`, `:700-706`), ale powtórzenie **po** zakończeniu próby tworzy prawdziwą nową próbę i zjada budżet |

Dodatkowe reguły wynikające z kodu, potrzebne do AC-04…AC-06:

1. **Przerwanie przed wysłaniem** (checkpoint zapisany, wywołania nie było): `bridge_feature_get`
   pokazuje `predecessor` bez zmian; wysyłamy operację pierwszy raz. Liczba tasków nie rośnie.
2. **Przerwanie po przyjęciu, przed odpowiedzią**: wiersz featura już się zmienił, bo rezerwacja
   jest atomowa. Odczyt to widzi; ponowienie replayuje. To jest właśnie przypadek „przerwa może
   nastąpić po rezerwacji zadania, zanim manager pozna jego ID" (plan, wiersz 54) — rozwiązuje go
   `feature.task_ids`, nie żaden nowy zapis.
3. **Przerwanie w trakcie pracy Claude'a**: `state="running"`. Czekać, nie delegować. `bridge_feature_run`
   i tak odmówi nowej rundy przy ustawionym `active_task_id` (`feature-workflow.ts:169-170`).
4. **Przerwanie po zakończeniu, przed odebraniem wyniku**: `awaiting_review`/`blocked` + kompletny
   `bridge_get_task`. Odbiór wyniku to odczyt; nie zwiększa liczby prób.
5. **Stan lokalny też trzeba odczytać**: `git log <git_base>..HEAD`, `git status --porcelain`,
   obecność paczki w przestrzeni wymiany. Zniknięcie podsumowania nie dowodzi, że commit/eksport
   się nie wykonał (plan, wiersze 66-67).
6. **„Kontynuuj" nie odpowiada na pytanie produktowe**: `waiting_user` zamraża rundy i recovery
   (`feature-workflow.ts:262`, `orchestrator.ts:631-634`), a `answerUser` wymaga prawdziwej
   odpowiedzi użytkownika.

## 5. Luki — wąskie, do osobnego rozstrzygnięcia

Zgodnie z kontraktem rundy **nie implementujemy** tu żadnej zmiany protokołu.

### G-1 — osierocona runda pozostaje `running` bez jednego odczytu rozstrzygającego

`derive`/`refresh` kończą się wcześnie, gdy ostatnia próba ma `ended_at == null` **lub** istnieje
jakikolwiek wiersz lease w stanie `HELD` (`feature-workflow.ts:64-72`, `:88-100`).
`listHeldLeases()` wybiera po `state='HELD'` **bez sprawdzania wygaśnięcia**
(`store/sqlite-store.ts:709-714`), podczas gdy `isLive` sprawdza też `expires_at`
(`lease-manager.ts:53-54`). Przy włączonej tożsamości **nic nie wygasza przeterminowanych lease'ów**:
`bridge_recover` mapuje się na czyste `inspectRecovery` (`tools.ts:1096`, `control-plane.ts:285-302`),
a start procesu również tylko raportuje (`lifecycle.ts:100-102`). Skutek: po restarcie MCP w trakcie
rundy feature raportuje `running` bezterminowo.

**Rozstrzygalne dzisiaj, bez zmiany protokołu**: dwa odczyty razem dają odpowiedź —
`bridge_recover` (czysty) zwraca `expirable_leases` i `in_flight_tasks[].has_live_lease`,
a `bridge_get_task` pokazuje otwartą próbę i dowody terminacji. Reguła nie jest jednak nigdzie
zapisana. **Praca W15-03**: udokumentować tę parę odczytów jako obowiązkowy krok przy `running`
przekraczającym deadline (`bridge-loop.md:174-175` mówi dziś tylko „confirm the old worker has stopped").

### G-2 — osierocona runda bez utrwalonego `execution_handle` nie ma wyjścia (luka protokołu)

Recovery wymaga `prior.execution_handle` (`orchestrator.ts:675-682`). Jednocześnie:
nowa runda jest odmawiana przy ustawionym `active_task_id` (`feature-workflow.ts:169-170`),
`waitUser` odmawia przy nieukończonej próbie (`:262`), `accept` wymaga `awaiting_review` (`:292`).
Okno: między otwarciem próby (`orchestrator.ts:313`) a utrwaleniem handle'a z pierwszej ramki
init CLI (`claude/claude-side/src/adapters/claude-code-runner.ts:791-798`); dodatkowo runner
świadomie **kontynuuje** po nieudanym zapisie handle'a (`:799-802`). Okno jest wąskie, ale wtedy
feature jest trwale zablokowany.

Alternatywy (do osobnego rozstrzygnięcia, żadna nie jest tu wykonana):

| Wariant | Opis | Koszt / ryzyko |
| --- | --- | --- |
| a | Pozwolić recovery **anulować** task, gdy nie ma handle'a | Nowe przejście terminalne i nowa semantyka istniejącego narzędzia — największa zmiana publiczna |
| b | Osobna, jawnie autoryzowana operacja „porzuć osieroconą próbę": kończy próbę jako `interrupted` i przenosi task do `FAILED`, bez nowego workera i bez zastępczego taska; feature ląduje w `blocked` | Najmniejsza nowa operacja; wykorzystuje istniejące `attempts.end` i przejście `WORKING→FAILED` (`types.ts:42`) |
| c | Bez zmiany protokołu: udokumentować zaklinowanie, zachować dowody i kontynuować pod nowym `feature_id` | Najtańsze, ale traci gwarancję AC-05 w tym oknie |

**Rekomendacja: (b)**, wyłącznie po osobnym rozstrzygnięciu użytkownika. W15-02/03 nie zależą
od tej decyzji — dokumentują (c) jako stan faktyczny i odsyłają do rozstrzygnięcia.

### G-3 — hash żądania rundy obejmuje obecność callbacków serwera

`hashRequest(request)` liczy hash z **całego** `RoundRequest` (`feature-workflow.ts:163`), a
`stableStringify` zachowuje klucze o wartościach funkcyjnych jako `null` (`idempotency.ts:23-30`).
Narzędzie dokłada `authorize`, `attribution` i `onReserved` warunkowo, zależnie od konfiguracji
serwera (`tools.ts:325-347`). Zmierzone na `shared/control-plane/dist/idempotency.js`:
bez callbacków `21c9ea2175ca9b84`, z callbackami `0ea8434f2646032c` — hashe są różne.

Skutek: klucz rundy utworzony na jednej konfiguracji serwera nie zreplayuje się na innej
(np. po zmianie profilu/pinu w trakcie otwartej rundy) — dostaniemy `IDEMPOTENCY_MISMATCH`
zamiast replay. Przy stałym przypiętym runtime problem się nie ujawnia.
Alternatywy: (a) liczyć hash tylko z pól deklarowanych w API — zmiana publicznego kontraktu
idempotencji, wymaga osobnego rozstrzygnięcia; (b) zapisać ograniczenie: nie przesuwać pinu,
gdy istnieje niezamknięty klucz rundy. **W15 przyjmuje (b).**

### G-4 — nie ma odczytu „czy mój klucz został przyjęty" dla `task.create`

`bridge_read_events` filtruje po `after`/`task_id`/`limit` (`tools.ts:1074-1078`); nie ma filtra
po kluczu, a rekordy idempotencji nie są wystawione żadnym narzędziem. Dla roota rozstrzyga
dopasowanie `objective`+`scope` z checkpointu przez `bridge_list_tasks`; dla recovery klucz jest
widoczny w evencie. To ograniczenie, nie blokada — **nie proponujemy tu zmiany protokołu**.

## 6. Ograniczone syntetyczne przypadki przerwań

Testy bez modeli, na istniejącym harnessie `shared/control-plane/src/feature-workflow.test.ts`:
atrapa adaptera z bramką (`behavior.gate`), sterowanym handle'em (`behavior.handle`) i funkcją
`open()` ponownie otwierającą SQLite, co odtwarza restart procesu. Dla każdego przypadku raport
podaje stan przed/po, liczbę uruchomień adaptera, klucz, kontrakt i wynik (plan, wiersze 178-181).

| ID | Przerwanie | Oczekiwany wynik | AC |
| --- | --- | --- | --- |
| S-01 | Po `create_task` z kluczem, przed `feature_create`; restart; powtórzenie obu | Jeden task, jeden feature; `task.create` replay; `feature_create` zwraca istniejący | AC-05 |
| S-02 | `create_task` **bez** klucza, powtórzone | Dwa taski — test dokumentuje, dlaczego klucz jest obowiązkowy (kontrprzykład, nie zachowanie docelowe) | AC-05 |
| S-03 | Rezerwacja rundy zatwierdzona, odpowiedź utracona (bramka trzyma workera), restart, `feature_get` | `task_ids` ma nowe ID, `state="running"`; `seen.length == 1` | AC-04, AC-05 |
| S-04 | Jak S-03, ale zamiast czekać manager ponawia `feature_run` z tym samym kluczem | `replayed == true`, `seen.length == 1`, brak nowego taska | AC-04 |
| S-05 | Jak S-03, ale manager wylicza `N = len(task_ids)+1` i wysyła **nowy** klucz | Druga runda startuje — kontrprzykład uzasadniający regułę „klucz z checkpointu" | AC-05 |
| S-06 | Przerwanie **w trakcie uzgadniania stanu**: dwa restarty pod rząd między `feature_get` a `feature_run` | Wynik identyczny jak S-03/S-04; liczba prób i tasków bez zmian | AC-05 |
| S-07 | Runda `blocked`, recovery z kluczem, przerwanie przed odpowiedzią, powtórzenie tego samego wywołania w trakcie | `ILLEGAL_TRANSITION` „already active" przy otwartej próbie; brak drugiej próby | AC-04, AC-06 |
| S-08 | Jak S-07, ale recovery **bez** klucza i powtórzone po zakończeniu próby | Powstaje dodatkowa próba — kontrprzykład uzasadniający obowiązkowy klucz recovery | AC-06 |
| S-09 | `waiting_user`, następnie „kontynuuj" bez odpowiedzi użytkownika | `feature_run` i recovery odmawiają; nic się nie zmienia | AC-06 |
| S-10 | Osierocona runda: `behavior.handle = null`, restart podczas otwartej próby | Feature `running`; recovery odmawia („no persisted execution handle"); test **przypina** lukę G-2 jako znaną | AC-05 |
| S-11 | Wybór instrukcji: projekt z preferencją i bez, plugin obecny i nieobecny | Wskazana ścieżka wejścia odpowiada wybranemu runtime; brak preferencji daje propozycję, nie automatyczny zapis | AC-01, AC-03 |
| S-12 | Opcjonalny zapis preferencji: brak `AGENTS.md`, `AGENTS.md` z cudzą treścią, ponowne uruchomienie, dowiązanie symboliczne | Utworzenie / dopisanie bloku z zachowaniem cudzej treści / brak zmian / nazwana odmowa | AC-03 |

S-11 i S-12 sprawdzają **wybór ścieżki instrukcji i zapis pliku**, nie zachowanie modelu.
Lista scenariuszy oceny instrukcji nie jest dowodem zachowania modelu (plan, wiersz 181);
smoke z modelami pozostaje niezlecony.

## 7. Wpływ na dalsze zadania i otwarte kwestie

- **W15-02**: opis wyzwalacza w `codex-entry-SKILL.md`, fragment preferencji, opcjonalny krok setupu
  wzorowany na `planGitignore`, generator `plugins/**`, README. Pliki wspólne z W15-03: `bridge-loop.md`
  — kolejność edycji: W15-02 przed W15-03 (plan, wiersz 152).
- **W15-03**: reguły z §3 i §4 w `bridge-loop.md` i `.codex/skills/using-bridge`, regresje S-01…S-10.
  Helpery tylko przy wykazanej potrzebie — z tej analizy **nie wynika potrzeba nowego helpera**:
  wszystkie rozstrzygnięcia są osiągalne istniejącymi odczytami.
- **W15-04**: wspólna walidacja (build, testy JS/Python/pilot, `packages:check`, kontrola linków,
  `git diff --check`), jedno niezależne review, raport.
- **Otwarte**: G-2 wymaga rozstrzygnięcia użytkownika przed jakąkolwiek implementacją wariantu (b).
  Do tego czasu zakres W15 opisuje stan faktyczny i nie obiecuje pełnej odporności w tym oknie.
- **Ograniczenie tej analizy**: wszystko powyżej pochodzi z odczytu źródeł i jednego pomiaru
  hasha na `dist/idempotency.js`. Nie uruchomiono bridge'a, nie wykonano rund ani recovery;
  scenariusze §6 są projektem testów, nie wykonanym dowodem.

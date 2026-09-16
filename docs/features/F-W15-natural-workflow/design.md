# Projekt techniczny W15-01 — naturalne zlecanie i bezpieczne wznowienie

Źródło wymagań: [plan wave15](../../plans/wave15.md) (AC-01…AC-09) i [brief](brief.md).
Autoryzacja: [decisions/01.md](decisions/01.md). Zadanie: [W15-01](../../../work-items/W15-01.md).
Baza pierwszej wersji: `895cc99606893b96fc205a9bf7804a9bd30749e4`.
Korekta W15-C1…C4 po review [01-contracts](reviews/01-contracts.md), rundy 2 i 3;
korekty W15-I1…I5 po [02-implementation](reviews/02-implementation.md) opisuje §7.

Ten dokument jest lokalną bramką techniczną dla W15-02…04. Nie zmienia AC ani zakresu planu
i nie zmienia publicznego protokołu. Wszystkie stwierdzenia o zachowaniu bridge'a pochodzą
z odczytu źródeł w tym worktree (ścieżki i numery linii poniżej), nie z opisów w dokumentacji.
Numery linii odnoszą się do bazy pierwszej wersji; §1–§2 opisują stan po W15-02.

## 1. Wykrywalność wejścia w obu trybach instalacji

> Korekta W15-C1 (review [01-contracts](reviews/01-contracts.md)): pierwotna wersja opierała
> tryb bez pluginu wyłącznie na `.bridge-runtime/current`. To było błędne — worktree
> odziedziczony przez Git jest `inherited-pristine` i nie ma tej ścieżki
> (`scripts/bridge-project/locate.mjs`, klasyfikacja przy braku `.bridge-runtime` i `.bridge`),
> a czysty odczyt niczego nie tworzy. Poniżej wersja obowiązująca, zrealizowana w W15-02.

Zlecenie „Zaimplementuj feature opisany w `<plik>`" musi trafić do instrukcji **zainstalowanego
runtime**, a nie do kopii w projekcie. Istnieją dwa realne tryby i mają różne źródła wykrycia.

| Tryb | Co klient widzi sam | Jak dojść do instrukcji runtime | Praca W15-02 |
| --- | --- | --- | --- |
| Plugin `bridge` zainstalowany | Skill `bridge` z opisem w front matterze (`scripts/plugin-packages/templates/codex-entry-SKILL.md`) | `bridge-plugin.mjs status --json` → `instructions.*` (bezwzględne ścieżki) | Rozpoznanie naturalnego zlecenia w opisie i treści skilla; opcjonalny krok preferencji |
| Sam projekt z dispatcherem (bez pluginu) | Tylko pliki repozytorium: `AGENTS.md`, `.bridge-project/` | `node ./.bridge-project/entry.mjs --status` (albo `--instructions`) → JSON z `instructions.*` | Minimalny tryb odczytu w istniejącym entry point i dispatcherze |

Ustalenia:

- **Wejście musi działać w worktree pristine.** Dlatego tryb odczytu rozwiązuje pin **sam**:
  entry point czyta `.bridge-project/bridge.json`, ładuje dispatcher przypiętego runtime i woła
  `describe()`, które wyprowadza ścieżki instrukcji z katalogu tego runtime
  (`instructionPaths()` w `locate.mjs`). Nie dotyka `.bridge-runtime/current`, nie rozwiązuje
  tożsamości, nie otwiera bazy, nie bierze lease i nie zapisuje nic w żadnym stanie.
- **To nie jest drugi instalator.** Tryb odczytu nigdy nie instaluje runtime, nie tworzy selekcji
  ani nie naprawia stanu. Brak runtime (`RUNTIME_NOT_INSTALLED`), nierozpoznana deklaracja
  (`DECLARATION_INVALID`) i rozbieżny pin (`PIN_COMMIT_MISMATCH`) wracają jako kod i `next_step`.
  Jedyną drogą do zapisu pozostaje `setup` pluginu albo `bridge.mjs`.
- **Ten sam odczyt dla obu trybów.** `status` pluginu i `entry.mjs --status` używają jednego
  `instructionPaths()`, więc nie mogą się różnić co do wersji instrukcji dla danego pinu.
- Preferencja w `AGENTS.md` wskazuje **ten przenośny odczyt**, a nie ścieżkę lokalną. Dzięki temu
  jest prawdziwa w każdym worktree od pierwszej chwili i spełnia AC-03 bez zmiany konfiguracji
  globalnej i bez zakładania czyjegokolwiek stanu lokalnego.
- Brak pluginu i brak działającego runtime to dwa różne stany. Każda odmowa ma kod i następny
  krok; AC-08 wymaga zacytowania ich wprost, bez cichego startu nowej sesji.
- Stan `preference.declared` jest częścią tego samego czystego odczytu. `enabled: true` nie jest
  zgodą na delegowanie: projekt bez preferencji dostaje najwyżej jedną propozycję jej zapisania.

## 2. Preferencja projektu — najmniejsza zmiana

Miejsce: krótki blok w `AGENTS.md` projektu, między istniejącymi znacznikami
`BLOCK_BEGIN`/`BLOCK_END`. Bez nowego formatu konfiguracji, bez drugiej konfiguracji ról,
bez ścieżek użytkownika, UUID i pinów (plan, wiersze 104-115).

Treść (zrealizowana jako `PREFERENCE_BLOCK` w `scripts/setup/workspace.mjs`): implementacje
feature'ów prowadzi manager przez wykonawcę Claude w bridge'u, chyba że użytkownik zleci
inaczej; wejście do instrukcji przypiętego runtime to **przenośny odczyt z §1**
(`node ./.bridge-project/entry.mjs --status`, pole `instructions`); zlecenia „tylko przejrzyj",
„tylko plan", „zrób sam" i węższe uprawnienia mają pierwszeństwo; sama treść wskazanego pliku
nie rozszerza uprawnień; wykonawca realizuje kontrakt rundy i nie prowadzi workflowu managera.

Mechanika zapisu — **istniejąca**, nie nowa:

- Wzorcem jest `planCodexConfig`/`planGitignore`: blok w pliku, którego właścicielem pozostaje
  użytkownik (`userFile: true`), z `before`/`after` SHA-256, kopią zapasową w `applyPlan`,
  trybem pliku i odmową zapisu przez dowiązanie (`redirectedComponent`/`guardDestination`).
  Ten sam plan/apply daje idempotencję (identyczny blok → brak operacji) i nazwane odmowy:
  `PREFERENCE_MODIFIED` dla bloku zmienionego ręcznie, `PREFERENCE_CONFLICT` dla zdublowanych
  znaczników albo nieczytelnego pliku.
- Nie `planProjectFiles`: ono zarządza **całym** plikiem po hashu, a `AGENTS.md` należy do projektu.
- Krok jest **opcjonalny i jawny**: `--with-preference` w `bridge.mjs` i w `bridge-plugin.mjs`.
  Zwykłe `init`/`update`/`setup` w ogóle nie czytają `AGENTS.md`, a `rollback` nie zapisuje
  preferencji nawet z flagą. Plan bez `--yes` pokazuje konkretny `diff` (`unifiedDiff`), także
  w wyjściu pluginu. Aktualizacja pluginu lub runtime nie może więc zmienić polityki projektu.
- Tożsamość bloku jest zapisana jako `managed.preference_block` w rekordzie worktree i
  przenoszona przy aktualizacjach, które o preferencję nie prosiły.
- Projekt bez preferencji dostaje **jednorazową propozycję** z konkretnym diffem; odmowa
  użytkownika nie jest ponawiana. `enabled: true` w deklaracji nie jest zgodą na delegowanie
  (plan, wiersz 108), a stan `preference.declared` jest widoczny w czystym odczycie z §1.

## 3. Checkpoint intencji przed mutacją

> Korekta W15-C2 (runda 2 i 3): checkpoint nie może mieszać ledgera wykonawcy z zapisami
> managera, nie może wymagać lease przed istnieniem roota i **nie może leżeć w `.bridge/`**.
> Katalog `.bridge` bez `workspace.json` jest dla `classifyNativeState` stanem „unexplained",
> a `assertPristineStateDirectory` odrzuca nieznane pliki — zapis intencji przed bootstrapem
> zablokowałby właśnie ten bootstrap. Poniżej wersja obowiązująca.

Checkpoint ma **dwa nośniki o różnych rolach**, i żaden z nich nie jest drugą bazą stanu bridge'a:

| Nośnik | Gdzie | Kiedy powstaje | Co zawiera |
| --- | --- | --- | --- |
| **Plik intencji** | `<namespace>/intents/<op>-<klucz>.json` w **istniejącej prywatnej przestrzeni wymiany tego worktree** (`~/tmp/bridge-exchange/ws_<16 hex>/`, tej samej, którą wypisuje `feature_exchange.py namespace` — czysty odczyt) | **przed pierwszą mutacją** danej operacji, zanim istnieje root task, ownership i lease | dokładne argumenty wywołania w postaci, w jakiej zostaną wysłane; klucz; ścieżka i SHA-256 kontraktu; ścieżka autoryzacji; baza Git; budżet; odczytany `predecessor` |
| **Ledger koordynatora** | `docs/features/<id>/execution/coordination/NN.md` | **dopiero po uzyskaniu własności i lease**, gdy żadna runda nie jest otwarta | odwołanie do pliku intencji (nazwa + SHA-256), klucz, ścieżki i hashe kontraktu/autoryzacji, baza Git, budżet, zwrócone `task_id`/`attempt`, wynik |

Zasady, które z tego wynikają:

- **Nigdy `.bridge/` ani `.bridge-runtime/` przed bootstrapem.** Oba katalogi należą do runtime
  i do setupu; obcy plik w nich zmienia klasyfikację worktree i jest odmawiany, a nie ignorowany.
  Przestrzeń wymiany jest już prywatna dla worktree, leży poza repozytorium, nie jest commitowana
  i jest wyliczana istniejącym mechanizmem — nie dokładamy więc żadnej nowej lokalizacji ani
  nowego formatu konfiguracji. Żaden guard nie jest osłabiany.
- **Jeden plik, atomowo, przed wysłaniem.** Zapis przez `write` do pliku tymczasowego w tym samym
  katalogu i `rename` — trwały i niepodzielny. Plik zostaje do zamknięcia operacji.
  **Brak pliku albo plik nieczytelny to blokada**: manager zatrzymuje operację i prosi
  o rozstrzygnięcie, zamiast rekonstruować żądanie z pamięci albo z hasha.
- **Kolejność jest wymuszona przez bridge, nie przez ten dokument.** Root task trzeba utworzyć,
  zanim istnieje cokolwiek, na czym manager może wziąć lease; dlatego zapis intencji dla
  `root-task` musi być poza repozytorium i bezcommitowy. Reguła „zapisy koordynatora tylko przy
  zamkniętej rundzie i pod lease" obowiązuje wyłącznie dla ledgera w repozytorium.
- **Ledger wykonawcy pozostaje wyłącznie jego.** Koordynator nigdy nie dopisuje do
  `execution/<TASK-ID>/NN.md`; sposób checkpointowania nie zmienia zakresu paczki rundy.
- **Aktualizacja identyfikatorów w trakcie `running`** idzie do pliku intencji — zapis poza
  repozytorium, więc nie łamie zakazu commitowania w otwartej rundzie i nie wprowadza zmian
  managera do paczki wykonawcy. Do ledgera trafiają po zamknięciu rundy, jednym wpisem.
- **Granice danych.** W commicie: identyfikatory, ścieżki, hashe, budżety, stany. **Nigdy w
  commicie**: pełne kontrakty rund z prywatną treścią, surowe odpowiedzi użytkownika,
  transkrypty, `execution_handle`, zawartość `termination_evidence` — te zostają w pliku intencji
  i w stanie lokalnym runtime.
- **Plik intencji nie orzeka o przyjęciu operacji.** O tym mówi wyłącznie bridge (§4). Wpis
  intencji bez potwierdzenia w stanie bridge'a znaczy „nie wiem", nie „nie wykonano".
  Nie ma tu żadnej maszyny stanów: jeden plik i istniejący replay.

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
| **Root task** — `bridge_create_task` | Tylko z `idempotency_key`: `runIdempotent`, operacja `task.create`, hash po `{spec, created_by, run_id, parent_task_id, delegation_depth}` (`task-service.ts:80-95`). **Bez klucza powtórzenie tworzy drugi task z nowym ID.** | Wstawienie taska + event w jednej transakcji (`task-service.ts:162-184`); zapis rekordu idempotencji w tej samej transakcji (`idempotency.ts:66-80`) **Nie ma odczytu rozstrzygającego** — i nie wolno go udawać. Root utracony przed `claim` ma `owner: null`, więc nie pojawia się w `bridge_list_tasks({owner:"codex"})`, a `objective`+`scope` nie są tożsamością. Rozstrzyga **wyłącznie ponowne wysłanie identycznego wywołania z zapisanym kluczem**: replay zwróci oryginalny task albo operacja wykona się pierwszy raz | Ponów **ten sam** wywołanie z tym samym kluczem i bajtowo tym samym `spec` | Bezpieczne bez ograniczeń: replay zwraca oryginalny task |
| **Claim + WORKING** — `bridge_claim_task`, `bridge_set_state` | Oba są naturalnie idempotentne dla tego samego agenta i tego samego celu: `claim` zwraca task poza `PENDING` (`task-service.ts:311`), a `transition` ma jawne `if (task.state === input.to) return task` **przed** kontrolą legalności (`task-service.ts:445`), więc `WORKING→WORKING` nie jest odmawiane. **Korekta W15-03**: wcześniejsza wersja tego wiersza wywodziła `ILLEGAL_TRANSITION` z samej tabeli `ALLOWED_TRANSITIONS`; regresja na rzeczywistym stanie pokazała, że to nieprawda | transakcja per operacja | `bridge_get_task(task_id).task.state` | Ponawiaj wprost; klucz jest dodatkowym zabezpieczeniem, nie warunkiem | Bezpieczne; historia zawiera jedną zmianę stanu niezależnie od liczby powtórzeń |
| **Feature** — `bridge_feature_create` | **Brak argumentu `idempotency_key`** (`tools.ts:282`), ale operacja jest naturalnie idempotentna po `feature_id`: istniejący rekord z tym samym managerem i rodzicem jest zwracany, inny rodzic → `IDEMPOTENCY_MISMATCH` (`feature-workflow.ts:122-127`) | jedna transakcja (`:120`) | `bridge_feature_get({feature_id})` → `NOT_FOUND` znaczy „nie utworzono" | Ponów wprost | Bezpieczne bez ograniczeń |
| **Runda** — `bridge_feature_run` | Klucz wymagany. Rekord pod `feature.round:[feature_id, idempotency_key]`, hash po **całym** obiekcie żądania (`feature-workflow.ts:160-168`). Replay zwraca `{replayed:true}` **bez uruchamiania workera** (`:167-168`, `:222`) | **Silna**: utworzenie taska, aktualizacja wiersza featura (`latest_task_id`, `task_ids`, `active_task_id`, `state="running"`) i zapis rekordu idempotencji dzieją się w jednej transakcji (`orchestrator.ts:154-171` wołające `onTaskCreated` z `feature-workflow.ts:186-213`) `bridge_feature_get` → `task_ids`/`latest_task_id`. **Nowe ID ⇒ runda na pewno przyjęta**; `task_ids` równe `predecessor` z checkpointu to tylko obserwacja z jednej chwili, nie dowód braku rezerwacji — przerwane żądanie mogło jeszcze trwać. W obu przypadkach rozstrzyga ten sam ruch: identyczny replay. Gdy runda jest przyjęta, `state` mówi co dalej: `running` → czekaj; `awaiting_review` → `bridge_get_task`; `blocked` → `bridge_get_task` + ścieżka recovery | Ponów z **tym samym** kluczem i identycznymi argumentami. **Nigdy nie licz `N = len(task_ids)+1` ponownie** — po zapisanej rezerwacji da to nowy klucz i zdublowaną rundę | Bezpieczne: odczyt czysty, ponowienie replayuje. Replay **nie czeka** na workera — zwraca bieżący stan |
| **Recovery** — `bridge_resume_delegated_task` / `bridge_resume_task` | Klucz **opcjonalny w ogóle**, ale **wymagany** z `message` i z `recover_timeout` (`orchestrator.ts:1359-1377`). Hash po `{task_id, requested_by, authorization_kind, message?, recover_timeout?, deadline_ms?, max_turns?}` (`:1277-1296`). Bez klucza działa tylko deduplikacja w pamięci procesu (`:559-577`), tracona przy restarcie | **Silna**: event `recovery.requested`, lease, zamknięcie poprzedniej próby, `beginRecovery`, `startResumed`, event `resume.attempted` i rekord idempotencji w jednej transakcji (`orchestrator.ts:613-837`) | `bridge_get_task(task_id)` → `task.attempt`, `attempts[]` (`ended_at`, `outcome`, `execution_handle`), `termination_evidence`. **`bridge_read_events({task_id})` jest tu jedynym odczytem pokazującym sam klucz**: `recovery.requested` i `resume.attempted` niosą `idempotency_key` (`orchestrator.ts:757`, `:805`) | Ponów z tym samym kluczem. Odpowiedź rozstrzyga: `ILLEGAL_TRANSITION` „recovery attempt N is already active" (`:1309-1315`) **znaczy „przyjęte i trwa"**, nie porażkę; zakończona próba → migawka wyniku (`replayRecovery`) | Bezpieczne z kluczem. **Bez klucza**: powtórzenie w trakcie jest odrzucane przez żywy lease (`SCOPE_CONFLICT`, `:700-706`), ale powtórzenie **po** zakończeniu próby tworzy prawdziwą nową próbę i zjada budżet |

Dodatkowe reguły wynikające z kodu, potrzebne do AC-04…AC-06:

1. **Przerwanie przed wysłaniem** (checkpoint zapisany, wywołania nie było): `bridge_feature_get`
   pokazuje `predecessor` bez zmian; wysyłamy operację pierwszy raz. Liczba tasków nie rośnie.
2. **Przerwanie po przyjęciu, przed odpowiedzią**: wiersz featura już się zmienił, bo rezerwacja
   jest atomowa, i odczyt to widzi — rozwiązuje ten przypadek `feature.task_ids`, nie żaden nowy
   zapis (plan, wiersz 54). Odczyt nie rozstrzyga jednak przypadku odwrotnego: **niezmieniony
   `predecessor` niczego nie dowodzi**, bo przerwane żądanie mogło zatwierdzić rezerwację zaraz
   po nim. Dlatego po każdej przerwie obowiązuje jeden ruch — **identyczny replay tym samym
   kluczem i tymi samymi argumentami** — który jest poprawny w obu przypadkach. Nigdy nowy klucz
   i nigdy dobieranie taska po podobieństwie.
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

### G-2 — osierocona runda bez utrwalonego `execution_handle` jest rzeczywistą granicą recovery

> Korekta W15-C3: wariant „kontynuuj pod nowym `feature_id`" był obejściem zakazu obejść i
> został wycofany. Brak handle'a nie jest zgodą na nową sesję, nowy feature ani zastępczy task.

Recovery wymaga `prior.execution_handle` (`orchestrator.ts:675-682`). Jednocześnie:
nowa runda jest odmawiana przy ustawionym `active_task_id` (`feature-workflow.ts:169-170`),
`waitUser` odmawia przy nieukończonej próbie (`:262`), `accept` wymaga `awaiting_review` (`:292`).
Okno: między otwarciem próby (`orchestrator.ts:313`) a utrwaleniem handle'a z pierwszej ramki
init CLI (`claude/claude-side/src/adapters/claude-code-runner.ts:791-798`); dodatkowo runner
świadomie **kontynuuje** po nieudanym zapisie handle'a (`:799-802`).

**Obowiązujące zachowanie, bez zmiany protokołu:** strict resume nie ma czego wznowić, więc
manager **zatrzymuje się z konkretną diagnozą** — task, próba, powód (`no persisted execution
handle`), stan featura, dowody terminacji — zachowuje wszystkie dowody i przedstawia to
użytkownikowi jako blokadę wymagającą decyzji. Nie startuje nowej sesji Claude'a, nie tworzy
zastępczego taska, nie zakłada nowego `feature_id` i nie obchodzi recovery żadną inną drogą.

**Dwa różne zdarzenia, które łatwo pomylić.** Utrata odpowiedzi managera (klient przerwał
wywołanie, sesja Astry padła) **nie** dowodzi, że serwer MCP albo worker przestały działać:
serwer żyje w swoim procesie, a runda może trwać dalej i normalnie się zakończyć. Dopiero
śmierć procesu serwera osierocza próbę. Pierwszy przypadek rozstrzyga zwykłe uzgodnienie stanu
z §4 (odczyt, ewentualny identyczny replay); drugi prowadzi do G-1, a przy braku handle'a do
tej blokady. Testy W15-03 muszą te przypadki rozdzielać, a nie symulować jednym przerwaniem.

Rozważana wcześniej osobna operacja „porzuć osieroconą próbę" pozostaje **niezaimplementowana**
i nie jest tu proponowana jako praca W15: byłaby zmianą publicznego protokołu i wymaga osobnego
rozstrzygnięcia. Dopóki go nie ma, granicą jest uczciwe zatrzymanie opisane wyżej.

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

> Korekta W15-C4: dobieranie roota po `objective`+`scope` zostało wycofane. Root utracony
> przed `claim` ma `owner: null`, więc nie pojawi się w `bridge_list_tasks({owner: "codex"})`,
> a objective i scope nie są tożsamością — dwa taski mogą je mieć identyczne.

`bridge_read_events` filtruje po `after`/`task_id`/`limit` (`tools.ts:1074-1078`); nie ma filtra
po kluczu, a rekordy idempotencji nie są wystawione żadnym narzędziem.

**Rozstrzygnięcie**: powtórzyć **identyczne** `bridge_create_task` z utrwalonym kluczem z pliku
intencji. `runIdempotent` albo zwróci oryginalny task (replay), albo wykona operację pierwszy
raz — w obu przypadkach powstaje dokładnie jeden task i manager poznaje jego `task_id`
(`task-service.ts:80-95`). To jest cały mechanizm rozstrzygający; żadne dopasowywanie po
podobieństwie nie jest dozwolone. Bez dokładnych argumentów w pliku intencji operacja jest
zablokowana (§3), a nie odtwarzana ze zgadywania. Dla recovery klucz jest dodatkowo widoczny
wprost w evencie. To ograniczenie, nie blokada — **nie proponujemy tu zmiany protokołu**.

## 6. Ograniczone syntetyczne przypadki przerwań

> Korekta W15-C4: scenariusze poniżej poprawiono tak, by odpowiadały rzeczywistym przejściom
> bridge'a. W15-03 ma je wykonać na prawdziwym harnessie; do tego czasu są projektem testów.

Testy bez modeli, na istniejącym harnessie `shared/control-plane/src/feature-workflow.test.ts`:
atrapa adaptera z bramką (`behavior.gate`), sterowanym handle'em (`behavior.handle`) i funkcją
`open()` ponownie otwierającą SQLite, co odtwarza restart procesu. Dla każdego przypadku raport
podaje stan przed/po, liczbę uruchomień adaptera, klucz, kontrakt i wynik (plan, wiersze 178-181).

| ID | Przerwanie | Oczekiwany wynik | AC |
| --- | --- | --- | --- |
| S-01 | Po `create_task` z kluczem, przed `feature_create`; restart; powtórzenie **identycznego** `create_task`, potem `feature_create` | Jeden task (replay zwraca oryginalny `task_id`, także gdy task nie ma jeszcze właściciela), jeden feature | AC-05 |
| S-02 | `create_task` **bez** klucza, powtórzone | Dwa taski, oba z `owner: null` — kontrprzykład: nie da się ich rozróżnić po `objective`/`scope` ani znaleźć przez `list_tasks({owner: "codex"})`. Uzasadnia obowiązkowy klucz i dokładne argumenty w pliku intencji | AC-05 |
| S-03 | Rezerwacja rundy zatwierdzona, odpowiedź utracona (bramka trzyma workera), restart, `feature_get` | `task_ids` ma nowe ID, `state="running"`; `seen.length == 1` | AC-04, AC-05 |
| S-04 | Jak S-03, ale zamiast czekać manager ponawia `feature_run` z tym samym kluczem i identycznymi argumentami | `replayed == true`, `seen.length == 1`, brak nowego taska | AC-04 |
| S-05a | Jak S-03 (worker nadal aktywny), ale manager wylicza `N = len(task_ids)+1` i wysyła **nowy** klucz | Odmowa: `feature cannot start a round` przy ustawionym `active_task_id` (`feature-workflow.ts:169-170`). Duplikat tu nie powstaje — chroni stan featura, nie dyscyplina managera | AC-04 |
| S-05b | Runda zakończona `DONE`, wynik nieodebrany; manager wylicza nowy klucz zamiast odczytać go z pliku intencji | Startuje **druga runda** — tu duplikat jest realny. To jest właściwe uzasadnienie reguły „klucz z checkpointu, nigdy nowy po przerwie" | AC-05 |
| S-06 | Przerwanie **w trakcie uzgadniania stanu**: dwa restarty pod rząd między `feature_get` a `feature_run` | Wynik identyczny jak S-03/S-04; liczba prób i tasków bez zmian | AC-05 |
| S-07 | Runda `blocked`, recovery z kluczem, przerwanie przed odpowiedzią, powtórzenie tego samego wywołania w trakcie | `ILLEGAL_TRANSITION` „already active" przy otwartej próbie; brak drugiej próby | AC-04, AC-06 |
| S-08 | Jak S-07, ale recovery **bez** klucza, powtórzone po zakończeniu próby, która pozostawiła task w stanie recoverable (np. znów `BLOCKED`) | Powstaje dodatkowa próba — kontrprzykład uzasadniający obowiązkowy klucz. Gdyby próba skończyła się `DONE`, drugie wywołanie odmawia (`assertRecoverable`), więc scenariusz musi jawnie ustawić stan recoverable | AC-06 |
| S-09 | `waiting_user`, następnie „kontynuuj" bez odpowiedzi użytkownika | `feature_run` i recovery odmawiają; nic się nie zmienia | AC-06 |
| S-10a | Utrata odpowiedzi managera przy żyjącym serwerze: klient przerywa wywołanie, worker kończy rundę | Po odczycie feature jest `awaiting_review`; żadnej nowej próby ani taska. Utrata odpowiedzi **nie** jest dowodem śmierci workera | AC-05 |
| S-10b | Śmierć procesu serwera w trakcie rundy, `behavior.handle = null` | Feature `running`, próba otwarta; recovery odmawia („no persisted execution handle"). Test **przypina** granicę G-2: zatrzymanie z diagnozą, bez zastępczego featura lub sesji | AC-05 |
| S-11 | Wybór instrukcji: worktree `inherited-pristine` i `ready`, z pluginem i bez; brak runtime, nierozpoznana deklaracja, rozbieżny pin | Wskazana ścieżka wejścia odpowiada przypiętemu runtime; odmowy mają kod i następny krok; nic nie jest zapisywane | AC-01, AC-03, AC-08 |
| S-12 | Opcjonalny zapis preferencji: brak `AGENTS.md`, `AGENTS.md` z cudzą treścią, ponowne uruchomienie, blok zmieniony ręcznie, zdublowane znaczniki, dowiązanie symboliczne, zwykły `init`/`update`/`rollback` | Utworzenie / dopisanie z zachowaniem cudzej treści / brak zmian / `PREFERENCE_MODIFIED` / `PREFERENCE_CONFLICT` / odmowa symlinku / `AGENTS.md` nietknięty | AC-03 |

S-11 i S-12 są **wykonane w W15-02** (`scripts/bridge-project/bridge-project.test.ts`,
`scripts/setup/setup.test.ts`). S-01…S-10 pozostają projektem testów dla W15-03.
Sprawdzają wybór ścieżki instrukcji i zapis pliku, nie zachowanie modelu: lista scenariuszy
oceny instrukcji nie jest dowodem zachowania modelu (plan, wiersz 181), a smoke z modelami
pozostaje niezlecony.

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

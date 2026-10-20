# F-W18 — kontrakt zamknięcia v1

Status: dostawa W18-01 do lokalnego review, 2026-10-20. Źródła: brief i design
z decyzji 01; kod bazowy 48823d5 (bez zmian produktu względem 6433d2b).
Normatywny zakres: zamknięcie bez aktywnej lub nierozliczonej pracy. Nie zabija
procesów, nie usuwa kodu, nie zmienia spełnienia AC i nie otwiera ponownie featura.

## 1. Narzędzie i zapis

`bridge_feature_close` jest synchroniczną mutacją managera:

```json
{"feature_id":"F-example","outcome":"rejected","reason":"Wycofany kierunek",
 "decision_ref":"docs/features/F-example/decisions/02.md","idempotency_key":"F-example:close:02"}
```

Wymagane teksty po sprawdzeniu trim nie mogą być puste. Limity długości znaków:
feature_id 256, reason 4000, decision_ref 1000, idempotency_key 256. Nie normalizujemy
zawartości po walidacji: jej dokładna wartość uczestniczy w hashu. Outcome przyjmuje
wyłącznie `rejected|cancelled`. Walidacja w MCP oraz usłudze, przed zmianami domeny.
Decision_ref jest nieinterpretowanym opisem źródła decyzji; nie czytamy pliku/URL.
Nie jest dowodem autorstwa człowieka. To oświadczenie uprawnionego managera.

Odpowiedź: `{feature: FeatureRecord, replayed: boolean}`. Odczyt feature_get pokazuje
nowy stan oraz `closure` bez osobnego pobierania decyzji. Closure jest niezmienne:

```text
{ outcome, reason, decision_ref, closed_at: server milliseconds,
  manager: AgentId,
  attribution: {workspace_id, native_thread_id, epoch} | null,
  coordinator_effect: "cancelled" | "terminal_preserved" | "shared_preserved" }
```

Attribution pochodzi z istniejącego guardu, nigdy z argumentów modelu; null tylko
w testach/bezpośrednim API bez IdentityRuntime. Historyczne pytanie, odpowiedź null,
listy tasków, rund i wyniki pozostają. Closure nie tworzy odpowiedzi na pytanie.
Stany terminalne featura: accepted/rejected/cancelled. Accepted pozostaje bez closure.

Idempotencja trwała: operation `feature.close`, klucz namespacowany z feature_id
oraz klucza klienta (JSON tuple), hash feature_id/manager/outcome/reason/decision_ref.
Nie haszujemy epoch/instance: wznowienie legalnego managera nie zmienia decyzji.
Klucz ten sam + inny hash: IDEMPOTENCY_MISMATCH. Identyczny payload z nowym kluczem
jest dozwolonym replay bez zapisu nowego zdarzenia/closure i bez zmiany czasu;
można dopisać wyłącznie jego idempotentny alias w tej samej transakcji. Inna decyzja
na już zamkniętym feature: FEATURE_CLOSED. Accepted nie można zamknąć tym narzędziem.

## 2. Atomowość i dowód bezczynności

IdentityRuntime.runMutation utrzymuje istniejące kontrole native thread, instance,
workspace i transakcję. Wewnątrz niej FeatureWorkflow.close wykonuje:

1. Odczyt własności i walidację parametrów; rozpoznanie replay **przed** claim slot.
2. Dla nowej decyzji sprawdzenie slotu: null albo ten feature. Inny ID daje
   FEATURE_CONFLICT. Nie zajmujemy slotu tylko po to, żeby go zwolnić.
3. Zebranie wszystkich task_ids featura, ich potomków oraz koordynatora. Rekord
   brakujący, sprzeczna lineage/latest/active lub nierozliczona próba odmawia.
   Dla każdego wykonawczego taska musi istnieć zakończona ostatnia próba i spójny
   stan DONE/FAILED/CANCELLED/BLOCKED. Każda próba bez ended_at odmawia, również
   wcześniejsza. Task zarezerwowany lecz bez pierwszej próby odmawia. Ready bez
   task_ids jest prawidłowe. Żadna lease w stanie HELD nie może pozostać na tych
   taskach ani koordynatorze, nawet po expires_at. Close nie wygasza lease.
4. Koordynator może nie mieć prób (zwykła koordynacja). Jeżeli ma próbę, każda musi
   być zakończona; jego aktywna próba/HELD lease także blokuje. Nieprzypisany potomek
   pod jego drzewem w stanie wykonawczym lub z niezamkniętą próbą blokuje close:
   nie wolno uznać nieznanej pracy za bezczynność. Zakończone historyczne potomki
   zachowujemy. Brak procesu/timeout klienta/expiry nie zastępują tych dowodów.
5. Ustalenie efektu koordynatora, zapis closure + terminalnego stanu + active=null,
   idempotencji i jednego FEATURE_UPDATED z outcome/czasem (bez prywatnych tekstów),
   a następnie releaseFeature wyłącznie tego ID. Wszystko w jednej transakcji
   StateStore, bez await. Błąd każdego kroku cofa całość, także slot i koordynatora.

`refresh` może rozliczyć spójny zakończony worker, lecz sam zapis active=null nie
wystarcza. Próba ended_at=null lub niespójne rekordy zawsze wymagają istniejącej
procedury rozliczenia, nie nowego modelu ani automatycznego recovery z close.
Nowy FEATURE_BUSY oznacza istniejącą aktywność; FEATURE_UNSETTLED oznacza brak
wystarczających/spójnych dowodów. Oba są odmową bez zmian domeny i bez retry workera.

Rezerwacja run/delegate/recovery i close serializują się w tej samej bazie.
Jeżeli rezerwacja wygra, close zobaczy task/otwartą próbę i odmówi. Jeżeli close
wygra, ponowiona kontrola terminalności **wewnątrz rezerwacji** odmówi przed adapterem.
Sprawdzenie tylko przed await albo tylko w MCP jest niewystarczające.

## 3. Koordynator i współdzielenie

Dla parenta używanego wyłącznie przez zamykany feature (lub featury już terminalne):
PENDING/CLAIMED/WORKING/BLOCKED/VERIFYING → CANCELLED, completed_at=closed_at,
version+1, TASK_STATE_CHANGED z reason=`feature_rejected|feature_cancelled` i feature_id.
VERIFYING wymaga wąskiej metody TaskService do zamknięcia koordynacji; nie rozszerzamy
ALLOWED_TRANSITIONS ani bridge_set_state. Brak sztucznego WORKING/DONE i deliverable.
Terminalny DONE/FAILED/CANCELLED jest zachowany bajtowo; efekt terminal_preserved.

Jeżeli parent jest również parentem innego nieterminalnego featura, zachowujemy
parenta i jego dotychczasowy lifecycle (shared_preserved). Rekord closure jednoznacznie
kończy wyłącznie tę koordynację; nie deklaruje sukcesu parenta. Inny aktywny slot
nadal powoduje FEATURE_CONFLICT. Aktywne próby/lease parenta blokują tak samo jak
wyżej. Feature używający taska jako rundy innego otwartego featura to niespójność:
FEATURE_UNSETTLED, nie anulowanie cudzej pracy. Nie zwalniamy cudzych lease.
Historyczne wyniki wykonawców nigdy nie są przepisywane na CANCELLED.

## 4. Macierz mutacji i terminalności

Guard współdzielony w warstwie usług sprawdza przynależność taska do zamkniętych
rejected/cancelled featurów: task_ids i ich potomkowie; parent tylko gdy nie jest
współdzielony z innym otwartym featurem. Nie rozprzestrzenia blokady na taski, które
mają wyłącznie dependency na dostarczoną pracę. Nowy feature używa nowego parenta;
wykorzystanie kodu nie oznacza reopening starego drzewa. Sprawdzenie przodków jest
odporne na cykle/brakujące rekordy i odmawia zamiast pomijać nieznaną lineage.
Dla accepted zachowujemy dotychczasowe ogólne operacje historyczne; zakaz kolejnych
rund/recovery i niezmienność stanu featura obowiązują tak jak dotąd.

| Wejście | Rejected/cancelled | Punkt kontroli |
| --- | --- | --- |
| get/view/derive/refresh/snapshot/events | odczyt zachowuje terminalność | FeatureWorkflow, projekcje |
| create istniejącego ID zgodnej własności/parenta | zwrot starego rekordu, bez claim slot | FeatureWorkflow + tools |
| close zgodny replay | zwrot closure, bez claim/release nowego slotu | close |
| accept/wait_user/answer_user | FEATURE_CLOSED, także identyczna dawna odpowiedź | przed zapisami/claim slot |
| feature_run, nawet stary klucz | FEATURE_CLOSED; wynik dostępny przez get_task | przed replay i w rezerwacji |
| create_task z parentem w zamkniętym drzewie | FEATURE_CLOSED, także replay create | TaskService.create |
| delegate/runReady/retry/resume obu odmian/timeout recovery | FEATURE_CLOSED przed replay/rezerwacją oraz przed startem próby | Orchestrator + TaskService |
| claim/release ownership, set_state, block/unblock, add_dependency (task docelowy), report_status | FEATURE_CLOSED bez mutacji | TaskService |
| set_execution_handle | FEATURE_CLOSED | usługa uchwytów oraz MCP |
| acquire/renew/assertWritable lease | FEATURE_CLOSED | LeaseManager, wewnątrz transakcji zapisu |
| release lease/reapExpired | dozwolone porządkowanie, bez wznowienia | istniejące kontrole holdera |
| publish_artifact, record_verification, submit_deliverable | FEATURE_CLOSED przed zapisem pliku/metadanych/wyniku | Artifact/DeliverableService |
| późny callback / reconcile | brak zmiany closure/slotu; nie nadpisuje wyników taska | orchestrator, terminal guard |
| manager status/resume/takeover | istniejące reguły; nie otwiera featura | IdentityRuntime/ManagerRegistry |

Odmowy domeny mogą pozostawić istniejący bezpieczny audit wywołania, lecz nie stan
featura/taska, nową próbę, plik artefaktu ani adapter invocation. Nie wymagamy
blokowania ręcznej edycji SQLite ani dowolnego procesu piszącego poza bridge.
Wewnętrzne zapisanie closure jest jedynym wyjątkiem pozwalającym anulować parenta;
nie wystawiamy publicznego skip-guard. Zdarzenie techniczne późnego callbacku może
zostać dopisane bez surowego payloadu; nie jest dostawą ani nowym wynikiem produktu.

Kody istniejące NOT_OWNER/NOT_FOUND/WORKSPACE_MISMATCH/MANAGER_* zachowane.
Nowe FEATURE_CLOSED/FEATURE_BUSY/FEATURE_UNSETTLED są stabilne i niereetrywalne;
INVALID_ARGUMENT dla walidacji, IDEMPOTENCY_MISMATCH dla konfliktu klucza,
FEATURE_CONFLICT dla innego slotu. Errors/details nie powtarzają reason/decision_ref.

## 5. Schema i wspierana zgodność

Schema 5 → 6, bez przepisywania JSON istniejących featurów. Closure opcjonalne;
nowy runtime odczytuje stare rekordy oraz zamyka je po istniejącej legalnej adopcji
workspace/managera. Żadna migracja nie oznacza automatycznej decyzji produktowej.

Nowy SqliteStateStore sprawdza found>supported **przed** configureJournal, DDL,
migrateSchema i upsert numeru w constructor initialize. To samo initializeSchema,
attach i readonly. Nowa migracja DDL/numeru atomowa; read-only nie migruje, pierwsza
uprawniona mutacja robi to przez istniejący IdentityRuntime. Runtime manifest
musi deklarować schema6; setup/update/rollback badają wersję istniejącej bazy przed
zmianą wyboru runtime i odmawiają target schema<db schema.

**Granica starego kodu:** 0.4.3 initialize bezwarunkowo zapisuje swój numer5 i nie
jest bezpiecznym openerem schema6. Nie możemy naprawić zainstalowanego starego API
nowym numerem ani obiecać odmowy dowolnej starej biblioteki. Wspierany launcher
0.4.3 używa attach/readonly dla istniejącej bazy, które odmawiają6; installer
odmawia rollbacku do5. Test ma udowodnić rzeczywistą ścieżkę starego launchera oraz
osobno wykazać ograniczenie bezpośredniego initialize na jednorazowej kopii.
Nie uruchamiać starego initialize na danych użytkownika. Jeżeli test launchera
wykaże ścieżkę initialize istniejącej bazy, nie wolno ogłosić kompatybilności:
naprawić wspierany dispatcher/guard wyboru wersji przed wydaniem i ujawnić zakres
starego bezpośredniego uruchomienia. Nie polegać na nowym teście imitującym starą klasę.

Przed migracją operator zachowuje spójną kopię SQLite. Po zapisach schema6 nie ma
bezstratnego downgrade. Rollback kodu runtime do starszego wymaga odrębnego odtworzenia
starej kopii (utrata późniejszych decyzji, poza automatycznym rollback); installer
nie wykonuje takiego odtwarzania. Zmiana pin bez kontroli schematu jest niewspierana.

## 6. Diagnostyka, workflow i przypadki odbioru

Lokalny autoryzowany odczyt pokazuje całą closure. Domyślny eksport incydentu pokazuje
outcome, closed_at, coordinator_effect i alias managera/workspace według obecnej
polityki. reason/decision_ref i native_thread_id nie trafiają surowo do logów ani
publicznego eksportu; opcjonalny rozszerzony eksport stosuje istniejącą świadomą
politykę prywatności. W logach wystarczają state/outcome i kod błędu. Taski/docsy
pozostają historią, brak usuwania/pakowania prywatnych odpowiedzi do repo.

Feature-decide zapisuje decyzję przed close; feature-execute sprawdza bezczynność,
wywołuje close z trwałym kluczem i dopiero po odpowiedzi zapisuje checkpoint sukcesu.
Po utracie odpowiedzi odczyt/replay zamyka lukę między dokumentami i DB. Nie potrzeba
ponownej zgody przy jasnym odrzuceniu; REWORK i pauza nie wywołują close. Standalone
zapisuje decyzję bez twierdzenia o zwolnieniu slotu. Stary MCP: wymagany upgrade,
żadnego zastępczego accept. Feature nie jest odrzucony automatycznie przez FAIL.

W18-02/03 mają utrwalić testy co najmniej:

1. Ready bez rund, waiting_user z null answer, awaiting_review DONE, blocked z
   zakończonym FAILED/TIMEOUT/BLOCKED: oba outcome; żadnego modelu. Pytanie zachowane.
2. Każdy nieterminalny stan parenta, szczególnie VERIFYING; terminalny parent
   zachowany; wspólny parent zachowany; nieznany/aktywny potomek odmawia.
3. A-close → B-create/run (atrapa); replay A tym samym/nowym kluczem nie zmienia
   czasu ani slotu B; sprzeczny klucz/decision odmawia; restart tego samego managera.
4. Fault injection po closure/przed release/przed idempotency: rollback całości;
   utrata odpowiedzi po commit odtwarza pojedynczy efekt.
5. Obie kolejności close kontra rezerwacja run/recovery/delegate; task bez próby,
   ended_at=null, expired HELD i niespójne lineage nie przechodzą. Late callback
   zachowuje terminalność i wyniki. Pokrycie każdego wiersza macierzy usług/MCP.
6. Foreign thread, fenced instance, inne workspace: brak zmian domeny; stare
   ownership checks pozostają. Zwykły accept nadal działa i nie staje się close.
7. Syntetyczna baza prawdziwej wersji0.4.3 → autoryzowana migracja → close → B;
   stary launcher/attach/readonly i installer rollback odmawiają6. Nowe wszystkie
   openery odmawiają przyszłego schema7 bez zmian. Stary initialize: jawny negatywny
   dowód ograniczenia, nie deklaracja gwarancji.
8. Snapshot Git/dostaw/plików/historii przed i po, privacy sentinel w reason/source,
   dokumentacja/skille/generated packs. Wszystkie dane syntetyczne.

Właściciele kodu: FeatureWorkflow/StateStore, TaskService/Orchestrator,
LeaseManager/ArtifactService/DeliverableService, tools i IdentityRuntime,
SqliteStateStore + setup oraz diagnostyka (W18-02); instrukcje/generowane pluginy,
dokumentacja i zintegrowana walidacja (W18-03). Nie jest to dowód implementacji:
przykłady powyżej są specyfikacją deterministycznych testów, jeszcze nie wynikami.

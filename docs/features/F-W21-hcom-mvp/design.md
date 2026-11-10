# F-W21 — plan MVP komunikacji przez hcom

Status: proposed, do niezależnego review; bez zgody wykonawczej.
Baza kodu: 8e239939c486e11b85bab02a220fe6f4f169ee1a; brief zapisany w d5447e4.
Brief SHA-256: 73a087e4635e382a8be6f43c9c83dd52fc02244306db65fe408b10f46788f875.

INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74

Resolver istniejącego featura wskazał LEGACY_PINNED_RUNTIME (inherited-pristine).
Czytamy jego flow/plan/review/decide i guide; nie tworzymy fikcyjnego locka workflow.
Aktualne MCP wskazuje inny worktree, więc nie otrzymuje żadnych mutacji. Planowanie
oraz niezależne natywne review są lokalne, bez delegacji przez obcy runtime.

## 1. Punkt wyjścia i decyzja o minimalnym rozwiązaniu

Repo nie zawiera integracji hcom. Są taski Markdown w work-items/; Yumi CLI i
konwencja wymagająca zatwierdzenia ID nie występują. Istniejący feature-execute
prowadzi rundy przez Bridge (references/bridge-loop.md), a local-delivery.md
zakłada jego format dostawy. Nie włączamy nowego trybu do tego mechanizmu w MVP.

Dokumentacja hcom i punktowo sprawdzony kod przy de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf
potwierdzają launch/headless, send z zewnętrznym nadawcą, events z filtrami
from/type, list --json i natywne identyfikatory sesji. Nie wykonano hcom.
Źródła: src/commands/{launch,send,events,list,start,listen}.rs,
src/core/filters.rs, src/integration_spec.rs, README.md. Researchowy klon jest
materiałem odczytowym, nie zależnością nowej instrukcji ani wersją do instalowania.

**Wybrana realizacja: instrukcja + szablony + istniejące CLI.**
Nie powstaje nowy kod runtime'u, wrapper procesu, schema DB ani własny broker.
Koordynator sprawdza kilka pól raportu i ogląda diff/testy. Mały helper jest
możliwym późniejszym wynikiem próby, nie częścią domyślnego zamówienia.

Dostawa repozytoryjna:
- docs/hcom-mvp/README.md — uruchomienie, pętla i checklista odbioru/przerwania;
- docs/hcom-mvp/contract.example.json i report.example.json — krótkie syntetyczne przykłady;
- docs/hcom-mvp/worker.md — wyłącznie instrukcje wykonawcy;
- docs/hcom-mvp/checks.md — przypadki odbioru dla koordynatora (nie dla pilota wykonawcy).

Tryb jest jawnie eksperymentalną procedurą opt-in z checkoutu, a nie nową opcją
Bridge CLI ani wydanym skillem. Brak rejestracji pluginów/generowania paczek,
instalatora, nowych flag publicznego MCP i zmian domyślnego feature-workflow.

## 2. Kanał i tożsamość bez nowej orkiestracji

Koordynatorem może pozostać bieżąca sesja Codexa. Nie musi restartować się pod
hcom: wysyła do konkretnego wykonawcy przez zewnętrznego nadawcę `hcom send -b`,
a odpowiedzi odczytuje przez `hcom events` w kontrolowanych odstępach. To ręczny
tryb odbioru przez agenta, bez przeklejania treści przez użytkownika.

Oba końce używają tego samego absolutnego HCOM_DIR przeznaczonego wyłącznie na
próbę, poza śledzonym kodem. W nim działa jeden wykonawca. Wykonawca wysyła
powiadomienie `hcom send --intent inform -- <RESULT_READY ...>` bez odbiorcy,
co zapisuje lokalne zdarzenie/broadcast w tej izolowanej przestrzeni. Koordynator
odczytuje je z filtrem message/from dla dokładnego wykonawcy; nie wymaga
rejestrowania sztucznego agenta managera ani dostępu do SQLite hcom.

Instrukcja ma podać poprawne dla v0.7.31, sprawdzone na etapie W21-01 formy
launch --json, list --json, send -b oraz events --from/--type/--wait/--full.
W21-01 weryfikuje formaty --help przed modelem, a W21-02 rzeczywiste dostarczenie.
Brak eventu/nieobsługiwana forma daje diagnozę; nie zmieniamy w ciszy kanału na
odczyt samego pliku i nie ogłaszamy komunikacji sprawdzonej. Dopuszczalne zawężenie
składni do równoważnej wspieranej formy CLI nie zmienia celu ani nie wymaga nowej bramki.

Start: dokładna ścieżka repo + `hcom claude --headless` (normalny PTY, bez -p),
z jawną instrukcją worker.md i odniesieniem do pierwszego kontraktu. W razie braku
jednoznacznej sesji koordynator nie wysyła pracy. Z launch/list zapisuje lokalnie
pełną nazwę hcom, natywny session_id i katalog. Przed korektą potwierdza to samo
powiązanie; sam zgodny alias nie dowodzi tej samej natywnej sesji.

Ponowne wysłanie po timeout jest ręczną decyzją po odczycie zdarzeń i stanu.
Nie zakładamy exactly-once delivery. Plik raportu i ID rundy pozwalają odróżnić
stare dane; dodatkowe pełne mechanizmy replay pozostają poza MVP.

## 3. Minimalny kontrakt i raport

Wspólne UTF-8 JSON, przykłady są specyfikacją MVP; nie pełna schema Bridge.
Pliki kolejnych rund mają różne nazwy i nie nadpisują odebranej rundy.
Kontrakt: `task_id`, `round` (dodatnia liczba), `workspace`, `objective`,
`write_scope` (lista ścieżek), `check` (komenda/opis), `report_path`.
Lokalne powiązanie koordynatora zawiera hcom-name/native-session/workspace;
nie wymagamy, by model sam zgadywał własne ID. Znane ID pozostają lokalne.

Raport: `task_id`, `round`, `outcome` (complete/partial/blocked), `summary`,
`changes` (konkretne ścieżki i commit albo zapisany diff), `checks` (komenda i wynik,
wyraźne not_run przy braku), `remaining` (lista). Powiadomienie RESULT_READY
niesie task_id, round i report_path; koordynator ufa dopiero lokalnemu sprawdzeniu.

Checklista odbioru:
1. Event pochodzi od zapisanego wykonawcy, dotyczy aktualnego task_id/rundy,
   a raport istnieje we wcześniej uzgodnionej lokalizacji.
2. Raport pasuje do kontraktu; opis zmian da się powiązać z rzeczywistym diffem.
3. Koordynator ogląda zmiany i wykonuje/odczytuje uzgodniony test. Failing lub not_run
   nie są zaliczonym sprawdzeniem; potrzebna korekta albo jawny brak odbioru.
4. Zapisuje krótko odebrane/uwagi/blocked. Nawet complete wykonawcy nie przyjmuje
   automatycznie rezultatu; idle nigdy nie zastępuje raportu.

Nie budujemy automatycznej blokady scope, walidatora dowolnych raportów ani systemu
podpisów. To współpraca z zaufanym lokalnym agentem; zakres jest instrukcją, nie sandboxem.
Niejasny/out-of-scope wynik nie zostaje odebrany. Cudza lub stara wiadomość jest
odnotowana/ignorowana bez wykonania zawartej w niej komendy i bez nowej sesji.

## 4. Dostawa i zależności

Prace kolejno: W21-01 dostarcza powtarzalną instrukcję i syntetyczne przypadki;
W21-02 używa dokładnie tej dostawy do rzeczywistej próby, dopracowuje jej instrukcje
w tym samym zakresie i zbiera dowody. Taski są źródłem zależności i własności.
Koordynator integruje dokumentację, prowadzi odbiór i index/decisions. Niezależny
reviewer ocenia plan oraz później rezultat; nie tworzymy równoległych torów zapisu.

Wykonanie tej procedury na materiale pilota jest odstępstwem od domyślnej sekcji
rund Bridge (docs/features/README.md), wymagającym Gate 1 dla tego planu. Odstępstwo
dotyczy tylko opt-in pilota F-W21; nie jest powodem przełączenia innych featurów.
Brak właściwego MCP nie blokuje lokalnej pracy dokumentacyjnej i review natywnego.
Jeżeli wykonanie pomocniczych prac repozytoryjnych ma użyć Bridge'a, najpierw musi
mieć poprawnie związany worktree; obcy MCP nigdy nie służy do obejścia tego warunku.

## 5. Próba, budżet i reguła zakończenia

Proponowane w ramach jednej zgody wykonawczej:
- hcom 0.7.31 w prywatnym środowisku narzędzi próby, bez zmiany globalnej instalacji;
  istniejące działające logowanie klientów, bez kopiowania sekretów ani nowych API keys;
- osobne syntetyczne repo bez aktywowanego Bridge'a, jeden HCOM_DIR, jedna sesja Claude;
  jawne uprawnienia klienta, bez --yolo/--dangerously-skip-permissions;
- mała funkcja Python + unittest (np. normalizacja listy etykiet: trim, pomijanie
  pustych, deduplikacja z zachowaniem kolejności). Początkowy kontrakt jest pełny.
  Review po pierwszej dostawie wskazuje rzeczywistą poprawkę; gdy brak błędu,
  dopuszczalna jest jawnie nazwana poprawa testu/czytelności, bez fabrykowania defektu;
- pierwsza dostawa i co najmniej jedna korekta z rzeczywistą zmianą w tej samej
  natywnej sesji. Te same publiczne wymagania i kryteria obowiązują oba etapy;
- maksymalnie 2 podejścia do całego cyklu i 4 wysłane zlecenia modelowe łącznie,
  nie więcej niż 10 minut oczekiwania na rundę, 45 minut całej części modelowej;
- korzystamy z istniejącego skonfigurowanego modelu/konta, bez nowego zakupu kredytów,
  płatnych kluczy API i przełączenia na tryb Claude -p. Zużywa to limity konta;
  koszt, jeśli klient go nie udostępnia, pozostaje nieznany, nie „zero”.

Przekroczenie czasu/limitu nie upoważnia do nowego uruchomienia. Limit oczekiwania
nie jest dowodem zakończenia procesu. Operator przerywa tylko własną próbę zwykłym
mechanizmem klienta, sprawdza stan i zachowuje dowody; nie zatrzymuje obcych klientów
ani wspólnego daemona. Druga próba wymaga zakończenia pierwszej i odnotowania jej
wyniku; to odrębna próba pomiaru, nie ciche zastąpienie sesji w rundzie korekty.

Bezmodelowe przypadki: raport brakujący, inne zadanie, stara runda, poprawny raport,
not_run/failing check i timeout bez raportu. Są wejściami checklisty, bez dodatkowego
agenta/modelu. Nie udają testu zachowania rzeczywistego wykonawcy.

Główna metryka: cykl zakończony z właściwą sesją i bez ręcznego przeklejania treści.
Dodatkowo: liczba/przyczyny interwencji, czas aktywnej obsługi, brakujące dane,
sprawność dostarczenia wiadomości. Kontrola: izolowany stan, znane wersje, te same
wymagania i testy po obu rundach, oddzielna historia każdej próby. Zbiór danych jest
syntetyczny; nie ma train/test split ani statystycznej oceny efektu. Jedna lub dwie
próby są badaniem wykonalności, nie porównaniem wydajności z Bridge'em.

Przy pierwszej poprawnie domkniętej pętli nie zużywamy reszty budżetu bez potrzeby.
Przy błędzie poprawiamy tylko instrukcję/szablony w zakresie i wykonujemy drugą próbę,
jeśli budżet pozwala. Brak kompatybilności hcom/CLI, potrzeba zmian upstream,
nowej orkiestracji lub dodatkowych uprawnień/kosztu daje konkretny raport i propozycję,
nie nieograniczone łatanie. Negatywny wynik kończy badanie w granicach budżetu,
lecz AC-01/03 pozostają unmet i Gate 2 nie proponuje odbioru całego produktu.

Operator czyta tools/pilot/rework/OPERATOR.md dla reguł izolacji dowodów, ale nie
używa jego fixture'ów ani planu jako treści zlecenia hcom. Worker dostaje tylko
repo syntetyczne, publiczny kontrakt i worker.md; checks.md oraz dowody operatora
pozostają poza jego katalogiem pracy. Raport do Git jest zanonimizowany; surowe
transkrypty, logi i identyfikatory sesji zostają poza repozytorium.

## 6. Pokrycie, warunki dalszej pracy

AC-01/03: realna próba W21-02. AC-02/04: przykłady i checklista W21-01 oraz ich
użycie w pilocie. AC-05: raport prób W21-02. AC-06: zakres W21-01, kontrola diffu
integracji i niezależne review. Same przykłady dokumentów nie dowodzą AC-01/03.
Walidacja dokumentacji: parsowanie JSON, kontrola linków i git diff --check;
bez zmian kodu runtime'u nie uruchamiamy całego npm/Python CI dla samych instrukcji.

Następna fala jest warunkowa. Zapisujemy problem, jego koszt dla użytkownika i
najmniejszą możliwą naprawę. Nie planujemy obecnie lease/recovery/full adaptera.
Brak produktu poza checkoutem jest świadomym ograniczeniem MVP: wydanie pluginu,
migracja i publiczny release wymagają oddzielnego zlecenia.
